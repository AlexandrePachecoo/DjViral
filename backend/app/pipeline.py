"""Orquestra o processamento de um projeto: analisa → corta → sobe → persiste."""
import logging
import os
import subprocess
import tempfile
import threading
import time

from . import analyzer, clipper, youtube
from .config import settings
from .supabase_client import download_source, get_client, upload_clip

logger = logging.getLogger("djviral.pipeline")


class PlanLimitExceeded(RuntimeError):
    """O vídeo é mais longo do que a cota restante do plano do usuário."""


def probe_duration(path: str) -> float:
    """Duração real do vídeo em segundos, via ffprobe (0.0 se indisponível)."""
    result = subprocess.run(
        [
            "ffprobe",
            "-v", "error",
            "-show_entries", "format=duration",
            "-of", "default=noprint_wrappers=1:nokey=1",
            path,
        ],
        capture_output=True,
        text=True,
    )
    try:
        return float(result.stdout.strip())
    except ValueError:
        logger.warning("ffprobe não conseguiu medir %s: %s", path, result.stderr[-500:])
        return 0.0

# Limita quantos jobs pesados (download de GB + análise + FFmpeg) rodam ao
# mesmo tempo. Sem isso, dois POST /process simultâneos dobram o pico de
# memória e derrubam o container na Railway. Jobs excedentes ficam na fila
# (bloqueiam a thread de background até chegar a vez).
_job_slots = threading.BoundedSemaphore(settings.max_concurrent_jobs)


def _fetch_source(client, project_id: str, limit_seconds: int | None = None) -> str:
    """Baixa o vídeo original do projeto e retorna o caminho local.

    A linha ``sources`` diz a origem: ``source_type='youtube'`` guarda a URL
    do vídeo (baixada via yt-dlp); caso contrário ``url`` é o caminho no
    Storage do Supabase.

    ``limit_seconds`` (cota restante do plano) aperta o teto de duração do
    YouTube, evitando baixar um vídeo que seria rejeitado em seguida.
    """
    source = (
        client.table("sources")
        .select("url, source_type")
        .eq("project_id", project_id)
        .limit(1)
        .execute()
    )
    if not source.data or not source.data[0].get("url"):
        raise RuntimeError(
            f"Nenhum source com origem de vídeo para o projeto {project_id}"
        )
    row = source.data[0]
    max_duration = settings.max_source_duration
    if limit_seconds is not None:
        max_duration = min(max_duration, limit_seconds)
    if row.get("source_type") == "youtube":
        return youtube.download_youtube(row["url"], max_duration)
    return download_source(row["url"])


def process_project(
    project_id: str,
    limit_seconds: int | None = None,
    max_cuts: int | None = None,
) -> None:
    """Pipeline completo, rodado em background.

    Baixa o vídeo original (Supabase Storage ou YouTube, conforme a linha
    ``source`` do projeto), analisa o áudio, corta os top picos em clipes,
    sobe cada clipe no Storage e grava os registros ``cuts``. Em caso de erro,
    marca o projeto como ``error``. Sempre remove o arquivo temporário ao final.

    ``limit_seconds`` e ``max_cuts`` são os limites do plano do usuário
    (enviados pela Vercel): a duração real do vídeo é medida com ffprobe e o
    processamento é abortado se estourar a cota; ``max_cuts`` reduz o número
    de clipes gerados (ex.: 10 no teste grátis).
    """
    with _job_slots:
        _process_project(project_id, limit_seconds, max_cuts)


def _process_project(
    project_id: str,
    limit_seconds: int | None = None,
    max_cuts: int | None = None,
) -> None:
    client = get_client()
    video_path: str | None = None
    try:
        video_path = _fetch_source(client, project_id, limit_seconds)
        logger.info("Projeto %s: vídeo baixado para %s", project_id, video_path)

        # Duração real do vídeo: persiste em sources.duracao (é ela que conta
        # na cota do plano — corrige a duração estimada pelo navegador) e
        # barra sets maiores que a cota restante.
        duration = round(probe_duration(video_path))
        if duration > 0:
            client.table("sources").update({"duracao": duration}).eq(
                "project_id", project_id
            ).execute()
        if limit_seconds is not None and duration > limit_seconds:
            raise PlanLimitExceeded(
                f"Vídeo com {duration:.0f}s excede a cota restante do plano "
                f"({limit_seconds}s)"
            )

        top_n = settings.top_n if max_cuts is None else min(settings.top_n, max_cuts)
        peaks, bpm = analyzer.analyze(video_path, top_n=top_n)
        logger.info(
            "Projeto %s: %d picos encontrados (%d BPM)", project_id, len(peaks), bpm
        )

        for idx, peak in enumerate(peaks):
            with tempfile.NamedTemporaryFile(suffix=".mp4", delete=False) as tmp:
                clip_path = tmp.name
            try:
                clipper.cut(
                    input_file=video_path,
                    start_sec=peak.start_sec,
                    output_path=clip_path,
                    duration=settings.clip_duration,
                    pre_roll=settings.pre_roll,
                )

                dest_name = f"{project_id}/clipe_{idx + 1}_{int(peak.start_sec)}s.mp4"
                url = upload_clip(clip_path, dest_name)

                start = max(0.0, peak.start_sec - settings.pre_roll)
                client.table("cuts").insert(
                    {
                        "project_id": project_id,
                        "titulo": f"Drop {idx + 1} · {bpm} BPM",
                        "inicio": start,
                        "fim": start + settings.clip_duration,
                        "duracao": settings.clip_duration,
                        "score": peak.score,
                        "url": url,
                    }
                ).execute()
            finally:
                if os.path.exists(clip_path):
                    os.remove(clip_path)

        client.table("projects").update({"status": "done"}).eq(
            "id", project_id
        ).execute()
        logger.info("Projeto %s concluído", project_id)

    except Exception:  # noqa: BLE001 - queremos registrar qualquer falha
        logger.exception("Falha ao processar projeto %s", project_id)
        client.table("projects").update({"status": "error"}).eq(
            "id", project_id
        ).execute()
    finally:
        if video_path and os.path.exists(video_path):
            os.remove(video_path)


def recut_cut(project_id: str, cut_id: str, inicio: float, fim: float) -> None:
    """Re-corta um clipe existente com novo início/fim, regenerando o vídeo.

    Baixa o vídeo original do projeto, corta o novo trecho com FFmpeg, sobe um
    arquivo com nome novo (a URL pública muda, evitando cache do clipe antigo) e
    atualiza a linha ``cuts`` com os novos valores e ``status='ready'``. Em caso
    de falha, marca o corte como ``error``.

    O início aqui é absoluto (segundos no set), então usamos ``pre_roll=0`` — o
    usuário já escolheu exatamente onde o corte começa.
    """
    with _job_slots:
        _recut_cut(project_id, cut_id, inicio, fim)


def _recut_cut(project_id: str, cut_id: str, inicio: float, fim: float) -> None:
    client = get_client()
    video_path: str | None = None
    clip_path: str | None = None
    duration = max(1, round(fim - inicio))
    try:
        video_path = _fetch_source(client, project_id)

        with tempfile.NamedTemporaryFile(suffix=".mp4", delete=False) as tmp:
            clip_path = tmp.name
        clipper.cut(
            input_file=video_path,
            start_sec=inicio,
            output_path=clip_path,
            duration=duration,
            pre_roll=0,
        )

        dest_name = f"{project_id}/recut_{cut_id}_{int(time.time())}.mp4"
        url = upload_clip(clip_path, dest_name)

        client.table("cuts").update(
            {
                "inicio": inicio,
                "fim": fim,
                "duracao": duration,
                "url": url,
                "status": "ready",
            }
        ).eq("id", cut_id).execute()
        logger.info("Corte %s re-cortado (%.1f–%.1fs)", cut_id, inicio, fim)

    except Exception:  # noqa: BLE001 - queremos registrar qualquer falha
        logger.exception("Falha ao re-cortar o corte %s", cut_id)
        client.table("cuts").update({"status": "error"}).eq("id", cut_id).execute()
    finally:
        for path in (video_path, clip_path):
            if path and os.path.exists(path):
                os.remove(path)
