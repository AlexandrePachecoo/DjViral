"""Wrapper sobre o FFmpeg para cortar clipes de vídeo em torno de um pico."""
import os
import subprocess

from .config import settings
from .dynamic import Shot


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

    # Saída vertical 9:16 (TikTok/Reels): recorta a faixa central de altura cheia
    # e largura proporcional, depois escala para a resolução alvo. O ``min(...)``
    # evita um crop mais largo que o vídeo caso a fonte já seja vertical;
    # ``setsar=1`` garante pixels quadrados. Filtrar já força re-encode, o que o
    # código abaixo já faz (libx264/aac).
    w, h = settings.output_width, settings.output_height
    vf = f"crop='min(iw,ih*{w}/{h})':ih,scale={w}:{h},setsar=1"

    cmd = [
        "ffmpeg",
        "-y",                      # sobrescreve se já existir
        "-ss", str(ss),           # antes do -i: seek rápido
        "-i", input_file,
        "-t", str(duration),
        "-threads", str(settings.ffmpeg_threads),
        "-vf", vf,
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


def cut_dynamic(
    input_file: str,
    start_sec: float,
    output_path: str,
    shots: list[Shot],
    duration: int = 60,
    pre_roll: int = 5,
    fps: float = 30.0,
) -> str:
    """Corta um clipe "dinâmico": um enquadramento (shot) por trecho, com os
    cortes alinhados aos beats e zoom-drift suave opcional dentro dos shots.

    Os ``shots`` (ver ``dynamic.build_shot_plan``) devem ser contíguos e
    cobrir ``[0, duration]``. Tudo acontece num único comando FFmpeg — um
    decode só, sem arquivos intermediários — via ``filter_complex``:

    - ``split`` duplica o vídeo decodificado em um branch por shot;
    - cada branch faz ``trim`` do seu trecho + ``crop`` ESTÁTICO (o filtro
      ``crop`` do FFmpeg não anima largura/altura — só x/y são por frame,
      então zoom animado via expressão não é possível) + ``scale``;
    - shots com ``drift`` ganham um ``zoompan`` com rampa linear de zoom,
      sobre supersample 2× (mata o jitter de arredondamento inteiro do
      zoompan);
    - ``concat`` re-emenda os branches. O áudio vai direto do input
      (``-map 0:a``) — os cortes são só no vídeo, o áudio é contínuo por
      construção.
    """
    if not shots:
        raise ValueError("cut_dynamic exige ao menos um shot")

    ss = max(0.0, start_sec - pre_roll)
    w, h = settings.output_width, settings.output_height

    n = len(shots)
    parts = [f"[0:v]split={n}" + "".join(f"[v{i}]" for i in range(n))]
    for i, shot in enumerate(shots):
        cw, ch, cx, cy = shot.crop
        chain = (
            f"[v{i}]trim=start={shot.t0:.3f}:end={shot.t1:.3f},"
            f"setpts=PTS-STARTPTS,crop={cw}:{ch}:{cx}:{cy}"
        )
        if shot.drift:
            # Rampa linear de zoom ao longo do shot (frames do shot = F).
            # Supersample 2x antes do zoompan: o x/y inteiro do zoompan em
            # resolução final treme; em 2x o erro cai para meio pixel.
            frames = max(1, round((shot.t1 - shot.t0) * fps))
            drift = abs(shot.drift)
            if shot.drift > 0:  # aproxima
                z_expr = f"min({1 + drift:.4f},1+{drift:.4f}*on/{frames})"
            else:  # afasta
                z_expr = f"max(1,{1 + drift:.4f}-{drift:.4f}*on/{frames})"
            chain += (
                f",scale={w * 2}:{h * 2}"
                f",zoompan=z='{z_expr}'"
                f":x='iw/2-iw/zoom/2':y='ih/2-ih/zoom/2'"
                f":d=1:s={w}x{h}:fps={fps:g}"
            )
        else:
            chain += f",scale={w}:{h}"
        # setsar=1 POR BRANCH: crops de proporções diferentes deixam SARs
        # ligeiramente diferentes após o scale, e o concat exige SAR igual
        # em todas as entradas.
        parts.append(chain + f",setsar=1[s{i}]")
    parts.append(
        "".join(f"[s{i}]" for i in range(n)) + f"concat=n={n}:v=1:a=0[vout]"
    )
    filter_complex = ";".join(parts)

    cmd = [
        "ffmpeg",
        "-y",
        "-ss", str(ss),
        "-i", input_file,
        "-t", str(duration),
        "-threads", str(settings.ffmpeg_threads),
        "-filter_complex", filter_complex,
        "-map", "[vout]",
        "-map", "0:a?",
        "-c:v", "libx264",
        "-preset", "veryfast",
        "-c:a", "aac",
        "-movflags", "+faststart",
        output_path,
    ]

    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0 or not os.path.exists(output_path):
        raise RuntimeError(
            "FFmpeg falhou no corte dinâmico: "
            f"{result.stderr[-2000:]}\nfiltergraph: {filter_complex}"
        )

    return output_path
