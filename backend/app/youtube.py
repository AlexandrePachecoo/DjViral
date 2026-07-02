"""Download de vídeos do YouTube (yt-dlp) para o pipeline de análise."""
import logging
import os
import re
import tempfile
import uuid

import yt_dlp

logger = logging.getLogger("djviral.youtube")

# Formatos de link aceitos: watch, youtu.be, shorts e music.youtube. O id de
# vídeo do YouTube tem 11 caracteres [A-Za-z0-9_-]. Mantenha em sincronia com
# frontend/lib/youtube.ts.
_ID_PATTERNS = (
    re.compile(
        r"^(?:https?://)?(?:www\.|m\.|music\.)?youtube\.com/watch\?"
        r"(?:[^#]*&)?v=([A-Za-z0-9_-]{11})"
    ),
    re.compile(r"^(?:https?://)?(?:www\.)?youtu\.be/([A-Za-z0-9_-]{11})"),
    re.compile(
        r"^(?:https?://)?(?:www\.|m\.)?youtube\.com/shorts/([A-Za-z0-9_-]{11})"
    ),
)


def extract_video_id(url: str) -> str | None:
    """Extrai o id do vídeo de uma URL do YouTube, ou None se não for aceita."""
    for pattern in _ID_PATTERNS:
        match = pattern.match(url.strip())
        if match:
            return match.group(1)
    return None


def canonical_url(video_id: str) -> str:
    return f"https://www.youtube.com/watch?v={video_id}"


def download_youtube(url: str, max_duration_sec: int) -> str:
    """Baixa o vídeo (mp4 até 1080p) para um arquivo temporário local.

    Antes de baixar, consulta os metadados e rejeita vídeos mais longos que
    ``max_duration_sec``. Retorna o caminho do mp4; o chamador é responsável
    por remover o arquivo (o ``finally`` do pipeline já faz isso).
    """
    video_id = extract_video_id(url)
    if not video_id:
        raise RuntimeError(f"URL do YouTube inválida: {url}")
    target = canonical_url(video_id)

    base_opts = {"quiet": True, "no_warnings": True, "noplaylist": True}

    with yt_dlp.YoutubeDL(base_opts) as ydl:
        info = ydl.extract_info(target, download=False)
    duration = info.get("duration") or 0
    if duration > max_duration_sec:
        raise RuntimeError(
            f"Vídeo do YouTube com {duration}s excede o limite de "
            f"{max_duration_sec // 3600}h"
        )

    output_path = os.path.join(
        tempfile.gettempdir(), f"djviral_yt_{video_id}_{uuid.uuid4().hex}.mp4"
    )
    opts = {
        **base_opts,
        # mp4 até 1080p: qualidade suficiente para os cortes 9:16 sem inflar
        # download/disco (sets de 3h em 4K passariam de dezenas de GB).
        "format": (
            "bestvideo[ext=mp4][height<=1080]+bestaudio[ext=m4a]"
            "/best[ext=mp4][height<=1080]/best"
        ),
        "merge_output_format": "mp4",
        "outtmpl": output_path,
    }
    logger.info("Baixando do YouTube: %s (%ds)", target, duration)
    try:
        with yt_dlp.YoutubeDL(opts) as ydl:
            ydl.download([target])
    except Exception:
        if os.path.exists(output_path):
            os.remove(output_path)
        raise

    if not os.path.exists(output_path):
        raise RuntimeError(f"yt-dlp não gerou o arquivo esperado para {target}")
    return output_path
