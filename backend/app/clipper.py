"""Wrapper sobre o FFmpeg para cortar clipes de vídeo em torno de um pico."""
import os
import subprocess

from .config import settings


def cut(
    input_file: str,
    start_sec: float,
    output_path: str,
    duration: int = 60,
    pre_roll: int = 5,
) -> str:
    """Corta ``duration`` segundos de vídeo começando ``pre_roll`` s antes do pico.

    Retorna o caminho do arquivo gerado.

    Diferenças propositais em relação ao snippet do brief:
    - ``max(0, ...)`` evita um ``-ss`` negativo quando o pico está no início.
    - Re-encode (libx264 / aac) em vez de ``-c copy``: copiar corta apenas em
      keyframes, o que dessincroniza o início e o áudio do clipe. Re-encodar uns
      poucos clipes de 60s tem custo aceitável e garante corte preciso.
    - ``-threads``: sem isso o x264 abre uma thread por núcleo do host (~34 na
      Railway), e cada thread segura buffers de frame 1080p → ~900 MB por corte,
      o que estoura a memória do container. Limitar as threads derruba o pico
      para ~300 MB sem custo real de velocidade (CPU da VM é limitada).
    """
    ss = max(0.0, start_sec - pre_roll)

    cmd = [
        "ffmpeg",
        "-y",                      # sobrescreve se já existir
        "-ss", str(ss),           # antes do -i: seek rápido
        "-i", input_file,
        "-t", str(duration),
        "-threads", str(settings.ffmpeg_threads),
        "-c:v", "libx264",
        "-preset", "veryfast",
        "-c:a", "aac",
        "-movflags", "+faststart",  # bom para streaming/preview web
        output_path,
    ]

    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0 or not os.path.exists(output_path):
        raise RuntimeError(f"FFmpeg falhou ao cortar clipe: {result.stderr[-2000:]}")

    return output_path
