"""Wrapper sobre o FFmpeg para cortar clipes de vídeo em torno de um pico."""
import os
import re
import subprocess

from .config import settings
from .dynamic import Shot

# Linhas de progresso do FFmpeg (uma por frame/flush, separadas por \r, não
# \n) — não são erro, só spam. Filtradas antes de compor a mensagem de falha
# para o texto de erro real (se existir) não ficar escondido no meio delas.
_PROGRESS_LINE = re.compile(r"^\s*(frame=|size=)")
# Linhas ruidosas mas inofensivas que também não ajudam a diagnosticar.
_NOISE_LINE = re.compile(r"^\s*(Input #|Stream mapping:|Press \[q\])")


def _clean_stderr_tail(stderr: str, n: int = 30) -> str:
    """Últimas ``n`` linhas REAIS do stderr, sem o spam de progresso do FFmpeg.

    O FFmpeg emite uma linha de progresso (``frame=...``) por frame/flush,
    separadas por ``\\r`` (não ``\\n``); pegar só a cauda bruta do stderr quase
    sempre cai no meio de uma dessas linhas e esconde qualquer texto de erro
    real que exista antes dela.
    """
    lines = stderr.splitlines()
    real_lines = [
        ln for ln in lines if not _PROGRESS_LINE.match(ln) and not _NOISE_LINE.match(ln)
    ]
    return "\n".join(real_lines[-n:])


def _ffmpeg_failure(error_prefix: str, returncode: int, stderr: str) -> RuntimeError:
    """Monta uma mensagem de erro legível a partir do resultado do FFmpeg.

    Detecta processo morto por SINAL (``returncode`` negativo em POSIX —
    tipicamente SIGKILL de um OOM killer externo) e nomeia isso explicitamente
    em vez de deixar o chamador adivinhar. Se não sobrar nenhuma linha real
    depois de filtrar o progresso, isso por si só é informativo: o FFmpeg não
    chegou a reportar um erro, o processo provavelmente morreu externamente.
    """
    tail = _clean_stderr_tail(stderr)
    if returncode < 0:
        cause = f"processo morto pelo sinal {-returncode} (provável kill externo/OOM)"
    elif not tail.strip():
        cause = (
            f"saiu com código {returncode} sem mensagem de erro (só progresso) "
            "— processo provavelmente morto externamente"
        )
    else:
        cause = f"código {returncode}"
    detail = f"\n{tail}" if tail.strip() else ""
    return RuntimeError(f"{error_prefix}: {cause}{detail}")


def _run_ffmpeg(
    cmd: list[str], output_path: str, duration: float, error_prefix: str
) -> None:
    """Roda um comando FFmpeg com timeout e traduz falhas num erro legível.

    Sem timeout, um FFmpeg travado prende o job (e o semáforo de concorrência)
    indefinidamente sem nunca aparecer no log. O timeout é generoso (mín. 2
    min, ou 8x a duração do clipe) — folga de sobra pra qualquer render real,
    curto o suficiente pra nunca travar um job pra sempre.
    """
    timeout = max(120.0, duration * 8)
    try:
        result = subprocess.run(
            cmd, capture_output=True, text=True, timeout=timeout
        )
    except subprocess.TimeoutExpired:
        raise RuntimeError(
            f"{error_prefix}: FFmpeg travou (> {timeout:.0f}s) e foi encerrado"
        ) from None

    if result.returncode != 0:
        raise _ffmpeg_failure(error_prefix, result.returncode, result.stderr)
    if not os.path.exists(output_path):
        # Raro (returncode 0 mas sem arquivo) — mesma limpeza de stderr.
        raise _ffmpeg_failure(f"{error_prefix} (sem arquivo de saída)", 0, result.stderr)


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

    _run_ffmpeg(cmd, output_path, duration, "FFmpeg falhou ao cortar clipe")
    return output_path


def cut_dynamic(
    input_file: str,
    start_sec: float,
    output_path: str,
    shots: list[Shot],
    duration: int = 60,
    pre_roll: int = 5,
    fps: float = 30.0,
    force_static: bool = False,
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

    ``force_static=True`` ignora o ``drift`` de TODOS os shots (nenhum vira
    zoompan/supersample — todos usam o branch estático, igual aos shots
    ``wide``). É o 2º nível do fallback do pipeline: mesmo shot plan (mesmos
    cortes/tempos/beats), sem a parte mais pesada em CPU/memória, para quando
    a versão com zoom falha num container mais apertado.
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
        if shot.drift and not force_static:
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
        # Sem isso o FFmpeg escalona o filtro (split/scale/zoompan) em uma
        # thread por núcleo do host (~34 na Railway) — a mesma classe de
        # problema que -threads já resolve pro encoder, nunca estendida pro
        # lado do filtro. Com vários branches de zoompan supersampleados
        # (2160x3840) ativos ao mesmo tempo, isso pode inflar bastante o pico
        # de memória do processo.
        "-filter_threads", str(settings.dynamic_filter_threads),
        "-filter_complex_threads", str(settings.dynamic_filter_threads),
        "-filter_complex", filter_complex,
        "-map", "[vout]",
        "-map", "0:a?",
        "-c:v", "libx264",
        "-preset", "veryfast",
        "-c:a", "aac",
        "-movflags", "+faststart",
        output_path,
    ]

    try:
        _run_ffmpeg(cmd, output_path, duration, "FFmpeg falhou no corte dinâmico")
    except RuntimeError as exc:
        raise RuntimeError(f"{exc}\nfiltergraph: {filter_complex}") from exc

    return output_path
