"""Orquestra o processamento de um projeto: analisa → corta → sobe → persiste."""
import json
import logging
import os
import subprocess
import tempfile
import threading
import time

from . import analyzer, clipper, dynamic, visual, youtube
from .analyzer import Peak
from .config import settings
from .supabase_client import download_source, get_client, upload_clip
from .visual import WindowVisual

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


def probe_video(path: str) -> dict:
    """Dimensões e fps do stream de vídeo (para o corte dinâmico).

    Retorna ``{"width", "height", "fps"}``; zeros/default se o ffprobe falhar
    (o chamador cai para o corte seco).
    """
    result = subprocess.run(
        [
            "ffprobe",
            "-v", "error",
            "-select_streams", "v:0",
            "-show_entries", "stream=width,height,avg_frame_rate",
            "-of", "json",
            path,
        ],
        capture_output=True,
        text=True,
    )
    info = {"width": 0, "height": 0, "fps": 30.0}
    try:
        stream = json.loads(result.stdout)["streams"][0]
        info["width"] = int(stream.get("width") or 0)
        info["height"] = int(stream.get("height") or 0)
        rate = stream.get("avg_frame_rate") or "0/1"
        num, _, den = rate.partition("/")
        if float(den or 1) > 0 and float(num) > 0:
            info["fps"] = float(num) / float(den or 1)
    except (KeyError, IndexError, ValueError, json.JSONDecodeError):
        logger.warning("ffprobe não achou o stream de vídeo de %s", path)
    return info

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
    cut_style: str = "basic",
) -> None:
    """Pipeline completo, rodado em background.

    Baixa o vídeo original (Supabase Storage ou YouTube, conforme a linha
    ``source`` do projeto), analisa o áudio, corta os top picos em clipes,
    sobe cada clipe no Storage e grava os registros ``cuts``. Em caso de erro,
    marca o projeto como ``error``. Sempre remove o arquivo temporário ao final.

    ``limit_seconds`` e ``max_cuts`` são os limites do plano do usuário
    (enviados pela Vercel): a duração real do vídeo é medida com ffprobe e o
    processamento é abortado se estourar a cota; ``max_cuts`` reduz o número
    de clipes gerados (ex.: 10 no teste grátis). ``cut_style`` é a escolha do
    usuário na criação do projeto: 'basic' (corte seco) ou 'dynamic' (zooms no
    DJ/público no ritmo da batida).
    """
    with _job_slots:
        _process_project(project_id, limit_seconds, max_cuts, cut_style)


def _process_project(
    project_id: str,
    limit_seconds: int | None = None,
    max_cuts: int | None = None,
    cut_style: str = "basic",
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

        # O áudio gera MAIS candidatos do que o pedido; a análise visual
        # re-ranqueia (score musical + visual) e ficam os n_final melhores.
        n_final = max(
            1, settings.top_n if max_cuts is None else min(settings.top_n, max_cuts)
        )
        n_cand = n_final
        if settings.visual_enabled:
            n_cand = max(
                n_final,
                min(
                    n_final * settings.visual_candidates_factor,
                    settings.visual_candidates_cap,
                ),
            )
        peaks, bpm = analyzer.analyze(video_path, top_n=n_cand)
        logger.info(
            "Projeto %s: %d picos candidatos (%d BPM)", project_id, len(peaks), bpm
        )

        candidates = _score_candidates(video_path, peaks, cut_style)[:n_final]

        src_dims = probe_video(video_path) if cut_style == "dynamic" else None

        for idx, (peak, wv, final_score) in enumerate(candidates):
            with tempfile.NamedTemporaryFile(suffix=".mp4", delete=False) as tmp:
                clip_path = tmp.name
            try:
                _render_clip(video_path, peak, wv, cut_style, clip_path, src_dims, bpm)

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
                        "score": final_score,
                        "score_musical": peak.score,
                        "score_visual": wv.visual_score if wv is not None else None,
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


def _score_candidates(
    video_path: str,
    peaks: list[Peak],
    cut_style: str,
) -> list[tuple[Peak, WindowVisual | None, float]]:
    """Roda a análise visual das janelas candidatas e re-ranqueia.

    Score final = ``score_music_weight * musical + (1 - peso) * visual``.
    Janela sem análise visual (visual desligado, budget de tempo estourado ou
    erro) fica só com o score musical — a fase visual nunca derruba o job.
    No corte seco a detecção de pessoas é bem mais esparsa (só para o score);
    no dinâmico é densa (os boxes viram alvos de zoom).
    """
    if not settings.visual_enabled or not peaks:
        return [(peak, None, peak.score) for peak in peaks]

    net = visual.load_model()
    if cut_style == "dynamic":
        detect_every = settings.visual_detect_every
    else:
        detect_every = max(1, int(8 * settings.visual_fps))  # ~1 detecção/8s
    deadline = time.monotonic() + settings.visual_budget_seconds
    w_music = settings.score_music_weight

    scored: list[tuple[Peak, WindowVisual | None, float]] = []
    for peak in peaks:
        wv: WindowVisual | None = None
        if time.monotonic() < deadline:
            try:
                wv = visual.analyze_window(
                    video_path,
                    max(0.0, peak.start_sec - settings.pre_roll),
                    float(settings.clip_duration),
                    net=net,
                    detect_every=detect_every,
                    fps=settings.visual_fps,
                )
            except Exception:  # noqa: BLE001 - análise visual nunca é fatal
                logger.exception(
                    "Análise visual falhou na janela %.1fs", peak.start_sec
                )
        elif not scored or scored[-1][1] is not None:
            logger.warning(
                "Budget visual (%ss) estourado — janelas restantes só com "
                "score musical",
                settings.visual_budget_seconds,
            )
        final = (
            w_music * peak.score + (1 - w_music) * wv.visual_score
            if wv is not None
            else peak.score
        )
        scored.append((peak, wv, final))

    scored.sort(key=lambda item: item[2], reverse=True)
    return scored


def _render_clip(
    video_path: str,
    peak: Peak,
    wv: WindowVisual | None,
    cut_style: str,
    clip_path: str,
    src_dims: dict | None,
    bpm: int,
) -> None:
    """Renderiza um clipe no estilo pedido, com fallback para o corte seco.

    O corte dinâmico exige as dimensões da fonte e vale a pena quando há
    gente detectada OU movimento na cena; janela parada e vazia fica no corte
    seco (zoom no nada só chama atenção para o vazio). Qualquer erro do
    render dinâmico cai para o corte seco — o clipe nunca é perdido.
    """
    start = max(0.0, peak.start_sec - settings.pre_roll)
    if cut_style == "dynamic" and src_dims and src_dims["width"] and src_dims["height"]:
        # Detecção rodou, não achou ninguém e a cena está parada → seco.
        boring = (
            wv is not None
            and wv.detected
            and wv.dj_box is None
            and wv.motion_score < 0.1
        )
        if not boring:
            try:
                beats = visual.get_beat_times(
                    video_path, start, float(settings.clip_duration), bpm
                )
                shots = dynamic.build_shot_plan(
                    wv,
                    beats,
                    float(settings.clip_duration),
                    src_dims["width"],
                    src_dims["height"],
                    peak_at=peak.start_sec - start,
                )
                clipper.cut_dynamic(
                    input_file=video_path,
                    start_sec=peak.start_sec,
                    output_path=clip_path,
                    shots=shots,
                    duration=settings.clip_duration,
                    pre_roll=settings.pre_roll,
                    fps=src_dims["fps"],
                )
                return
            except Exception:  # noqa: BLE001 - dinâmico nunca perde o corte
                logger.exception(
                    "Corte dinâmico falhou em %.1fs — usando corte seco",
                    peak.start_sec,
                )

    clipper.cut(
        input_file=video_path,
        start_sec=peak.start_sec,
        output_path=clip_path,
        duration=settings.clip_duration,
        pre_roll=settings.pre_roll,
    )


def recut_cut(project_id: str, cut_id: str, inicio: float, fim: float) -> None:
    """Re-corta um clipe existente com novo início/fim, regenerando o vídeo.

    Baixa o vídeo original do projeto, corta o novo trecho com FFmpeg, sobe um
    arquivo com nome novo (a URL pública muda, evitando cache do clipe antigo) e
    atualiza a linha ``cuts`` com os novos valores e ``status='ready'``. Em caso
    de falha, marca o corte como ``error``.

    O início aqui é absoluto (segundos no set), então usamos ``pre_roll=0`` — o
    usuário já escolheu exatamente onde o corte começa. O estilo do projeto
    (``projects.cut_style``) é respeitado: num projeto dinâmico o re-corte
    re-roda a análise visual só na janela nova e regenera os zooms.
    """
    with _job_slots:
        _recut_cut(project_id, cut_id, inicio, fim)


def _recut_style(client, project_id: str) -> str:
    """Estilo de corte do projeto ('basic' se a coluna não existir/estiver vazia)."""
    try:
        proj = (
            client.table("projects")
            .select("cut_style")
            .eq("id", project_id)
            .limit(1)
            .execute()
        )
        if proj.data and proj.data[0].get("cut_style") == "dynamic":
            return "dynamic"
    except Exception:  # noqa: BLE001 - sem estilo → seco (comportamento antigo)
        logger.exception("Falha ao ler cut_style do projeto %s", project_id)
    return "basic"


def _recut_cut(project_id: str, cut_id: str, inicio: float, fim: float) -> None:
    client = get_client()
    video_path: str | None = None
    clip_path: str | None = None
    duration = max(1, round(fim - inicio))
    try:
        cut_style = _recut_style(client, project_id)
        video_path = _fetch_source(client, project_id)

        with tempfile.NamedTemporaryFile(suffix=".mp4", delete=False) as tmp:
            clip_path = tmp.name

        rendered = False
        if cut_style == "dynamic":
            try:
                src_dims = probe_video(video_path)
                if src_dims["width"] and src_dims["height"]:
                    net = visual.load_model() if settings.visual_enabled else None
                    wv = visual.analyze_window(
                        video_path,
                        inicio,
                        float(duration),
                        net=net,
                        detect_every=settings.visual_detect_every,
                        fps=settings.visual_fps,
                    )
                    beats = visual.get_beat_times(video_path, inicio, float(duration))
                    # peak_at=None: o usuário escolheu o trecho à mão, não há
                    # um drop conhecido para forçar o punch-in.
                    shots = dynamic.build_shot_plan(
                        wv,
                        beats,
                        float(duration),
                        src_dims["width"],
                        src_dims["height"],
                        peak_at=None,
                    )
                    clipper.cut_dynamic(
                        input_file=video_path,
                        start_sec=inicio,
                        output_path=clip_path,
                        shots=shots,
                        duration=duration,
                        pre_roll=0,
                        fps=src_dims["fps"],
                    )
                    rendered = True
            except Exception:  # noqa: BLE001 - dinâmico nunca perde o re-corte
                logger.exception(
                    "Re-corte dinâmico falhou (%s) — usando corte seco", cut_id
                )

        if not rendered:
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
