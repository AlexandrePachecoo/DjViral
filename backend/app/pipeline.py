"""Orquestra o processamento de um projeto: analisa → corta → sobe → persiste."""
import logging
import os
import tempfile

from . import analyzer, clipper
from .config import settings
from .supabase_client import get_client, upload_clip

logger = logging.getLogger("djviral.pipeline")


def process_project(project_id: str, video_path: str) -> None:
    """Pipeline completo, rodado em background.

    Analisa o áudio, corta os top picos em clipes de vídeo, sobe cada clipe no
    Supabase Storage e grava os registros ``cuts``. Em caso de erro, marca o
    projeto como ``error``. Sempre remove o arquivo temporário ao final.
    """
    client = get_client()
    try:
        peaks = analyzer.analyze(video_path, top_n=settings.top_n)
        logger.info("Projeto %s: %d picos encontrados", project_id, len(peaks))

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
                        "titulo": f"Corte {idx + 1}",
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
        if os.path.exists(video_path):
            os.remove(video_path)
