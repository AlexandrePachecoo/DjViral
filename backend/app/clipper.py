"""Wrapper sobre o FFmpeg para cortar clipes de vídeo em torno de um pico."""
import math
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


def _smoothstep(frac_expr: str) -> str:
    """``f*f*(3-2*f)`` — ease-in/ease-out puro, em função de uma fração 0-1.

    Substitui a interpolação LINEAR por uma curva que começa e termina devagar
    (derivada 0 nas pontas): é o que tira a sensação de câmera "mecânica" de um
    pan/zoom com velocidade constante. Vale exatamente 0 em f=0, 1 em f=1 e 0.5
    em f=0.5 — mesmo valor do linear no meio do caminho, só a trajetória entre
    os extremos muda.
    """
    return f"(({frac_expr})*({frac_expr})*(3-2*({frac_expr})))"


def _pan_expr(points: list[tuple[float, float]], var: str = "t") -> str:
    """Expressão FFmpeg piecewise, com easing, em ``var`` para keyframes.

    ``points`` são ``(t relativo ao trecho, valor)`` crescentes em t. Dentro do
    branch (pós ``setpts=PTS-STARTPTS``) o ``t`` do filtro ``crop`` é o tempo
    desde o início do shot; antes do primeiro keyframe segura o primeiro
    valor, depois do último segura o último (sem extrapolar). Cada segmento
    interpola com :func:`_smoothstep` em vez de linear — a câmera desacelera
    ao chegar em cada keyframe, em vez de andar em velocidade constante e
    freiar de repente.

    ``var`` é a variável de tempo do filtro alvo: ``t`` no ``crop`` (segundos
    do branch) ou algo como ``(on/30)`` no ``zoompan`` (que não expõe ``t``,
    só o número do frame de saída ``on``).
    """
    expr = f"{points[-1][1]:g}"
    for i in range(len(points) - 1, 0, -1):
        ta, va = points[i - 1]
        tb, vb = points[i]
        if tb - ta <= 1e-6:
            continue
        frac = f"({var}-{ta:.3f})/{tb - ta:.3f}"
        seg = f"({va:g}+{vb - va:g}*{_smoothstep(frac)})"
        expr = f"if(lt({var},{tb:.3f}),{seg},{expr})"
    if points[0][0] > 0:
        expr = f"if(lt({var},{points[0][0]:.3f}),{points[0][1]:g},{expr})"
    return expr


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
    - cada branch faz ``trim`` do seu trecho + ``crop`` + ``scale``. O filtro
      ``crop`` do FFmpeg não anima largura/altura (zoom animado via expressão
      não é possível), mas avalia x/y POR FRAME: shots com ``path`` (keyframes
      de pan da track do DJ/dançarino) usam expressões piecewise com easing
      (:func:`_pan_expr`/:func:`_smoothstep`) para a câmera SEGUIR a pessoa
      dentro do shot;
    - shots com ``drift`` ganham um ``zoompan`` com rampa de zoom (também com
      easing), sobre supersample 2× (mata o jitter de arredondamento inteiro
      do zoompan). ``path`` e ``drift`` PODEM coexistir no mesmo shot: o pan
      (via ``crop``) desloca a câmera seguindo a pessoa e o zoom (via
      ``zoompan`` em cima do resultado já panorâmico) aproxima ao mesmo
      tempo — é o que dá o efeito Ken Burns (pan + zoom simultâneos) em vez
      de um OU outro por shot;
    - ``concat`` re-emenda os branches. O áudio vai direto do input
      (``-map 0:a``) — os cortes são só no vídeo, o áudio é contínuo por
      construção.

    ``force_static=True`` ignora o ``drift`` de TODOS os shots (nenhum vira
    zoompan/supersample — todos usam o branch estático, igual aos shots
    ``wide``). É o 2º nível do fallback do pipeline: mesmo shot plan (mesmos
    cortes/tempos/beats), sem a parte mais pesada em CPU/memória, para quando
    a versão com zoom falha num container mais apertado. O pan (``path``) é
    barato — só expressões no ``crop``, sem supersample — e é MANTIDO nesse
    nível.
    """
    if not shots:
        raise ValueError("cut_dynamic exige ao menos um shot")

    ss = max(0.0, start_sec - pre_roll)
    w, h = settings.output_width, settings.output_height

    n = len(shots)
    parts = [f"[0:v]split={n}" + "".join(f"[v{i}]" for i in range(n))]
    for i, shot in enumerate(shots):
        cw, ch, cx, cy = shot.crop
        if shot.path and len(shot.path) >= 2:
            x_expr = _pan_expr([(t, x) for t, x, _ in shot.path])
            y_expr = _pan_expr([(t, y) for t, _, y in shot.path])
            crop_f = f"crop={cw}:{ch}:x='{x_expr}':y='{y_expr}'"
        else:
            crop_f = f"crop={cw}:{ch}:{cx}:{cy}"
        chain = (
            f"[v{i}]trim=start={shot.t0:.3f}:end={shot.t1:.3f},"
            f"setpts=PTS-STARTPTS,{crop_f}"
        )
        if shot.drift and not force_static:
            # Rampa de zoom (com easing) ao longo do shot (frames do shot = F).
            # Supersample 2x antes do zoompan: o x/y inteiro do zoompan em
            # resolução final treme; em 2x o erro cai para meio pixel. Quando
            # o shot também tem ``path`` (pan), este zoompan roda EM CIMA do
            # crop já panorâmico (centrado): pan e zoom acontecem juntos.
            drift = abs(shot.drift)
            if shot.zoom_keys and len(shot.zoom_keys) >= 2:
                # Zoom de antecipação de batida: keyframes (t, z) "lento-depois-
                # punch" já calculados em `dynamic._beat_zoom_keys`. O zoompan
                # não expõe ``t``, só o frame de saída ``on`` (d=1 → 1:1) — o
                # mesmo padrão do corte com keyframes manuais.
                z_expr = _pan_expr(shot.zoom_keys, f"(on/{fps:g})")
            else:
                # Rampa uniforme (sem batida no trecho / beat-punch desligado).
                frames = max(1, round((shot.t1 - shot.t0) * fps))
                smooth = _smoothstep(f"on/{frames}")
                if shot.drift > 0:  # aproxima
                    z_expr = f"min({1 + drift:.4f},1+{drift:.4f}*{smooth})"
                else:  # afasta
                    z_expr = f"max(1,{1 + drift:.4f}-{drift:.4f}*{smooth})"
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


def _even(value: float) -> int:
    """Arredonda para baixo até um inteiro PAR ≥ 2 (exigência do crop/x264)."""
    return max(2, int(value) - (int(value) % 2))


def _normalize_keyframes(
    keyframes: list[dict], duration: float
) -> list[tuple[float, float, float, float]]:
    """Sanitiza os keyframes do editor manual → ``(t, cx, cy, zoom)`` ordenados.

    ``t`` em segundos relativos ao início do clipe (clampado a ``[0,
    duration]``), ``cx``/``cy`` frações 0-1 do frame da FONTE (centro da
    janela) e ``zoom`` ≥ 1 (1 = a maior janela 9:16 que cabe no frame).
    Keyframes duplicados no mesmo ``t`` colapsam (vence o último).
    """
    cleaned: dict[float, tuple[float, float, float, float]] = {}
    for kf in keyframes or []:
        try:
            t = float(kf["t"])
            cx = float(kf["cx"])
            cy = float(kf["cy"])
            zoom = float(kf["zoom"])
        except (KeyError, TypeError, ValueError):
            continue
        if not all(map(math.isfinite, (t, cx, cy, zoom))):
            continue
        t = round(min(max(t, 0.0), duration), 3)
        cleaned[t] = (
            t,
            min(max(cx, 0.0), 1.0),
            min(max(cy, 0.0), 1.0),
            min(max(zoom, 1.0), 8.0),
        )
    return [cleaned[t] for t in sorted(cleaned)]


def cut_keyframed(
    input_file: str,
    start_sec: float,
    output_path: str,
    keyframes: list[dict],
    src_w: int,
    src_h: int,
    duration: float,
    fps: float = 30.0,
    force_static: bool = False,
) -> str:
    """Corta um clipe 9:16 com a câmera dirigida À MÃO pelo usuário (editor).

    ``keyframes`` (``{t, cx, cy, zoom}``, ver :func:`_normalize_keyframes`)
    descrevem onde a janela 9:16 está em cada instante; entre keyframes a
    câmera interpola com easing (:func:`_smoothstep`) — pan E zoom ao mesmo
    tempo, segurando o primeiro/último valor fora do intervalo coberto.

    Render em dois estágios (mesma técnica do corte dinâmico, já que o filtro
    ``crop`` não anima w/h):

    1. ``crop`` 9:16 na MAIOR janela pedida (menor zoom), com x/y animados por
       expressão (:func:`_pan_expr`) seguindo o centro dos keyframes — o pan.
    2. Se o zoom VARIA entre keyframes, um ``zoompan`` (sobre supersample 2×,
       anti-jitter) por cima aplica o zoom RESIDUAL ``zoom(t)/zoom_min`` com
       x/y compensando o clamp do estágio 1 nas bordas do frame — o resultado
       enquadra exatamente a janela pedida sempre que ela cabe no frame.

    ``force_static=True`` pula o zoompan (nível 2 do fallback do pipeline):
    mantém o pan (barato, só expressões no ``crop``) e fixa a janela no menor
    zoom — nunca corta fora nada que o usuário pediu para mostrar.
    """
    kfs = _normalize_keyframes(keyframes, duration)
    if not kfs:
        raise ValueError("cut_keyframed exige ao menos um keyframe válido")

    ss = max(0.0, start_sec)
    out_w, out_h = settings.output_width, settings.output_height

    # Maior janela 9:16 que cabe na fonte (zoom = 1).
    base_w = min(float(src_w), src_h * out_w / out_h)
    base_h = base_w * out_h / out_w

    # Janela de cada keyframe, com o centro clampado para caber no frame.
    frames_kf: list[tuple[float, float, float, float, float]] = []  # t, cx, cy, w, h
    for t, cx, cy, zoom in kfs:
        win_w = base_w / zoom
        win_h = base_h / zoom
        cx_px = min(max(cx * src_w, win_w / 2), src_w - win_w / 2)
        cy_px = min(max(cy * src_h, win_h / 2), src_h - win_h / 2)
        frames_kf.append((t, cx_px, cy_px, win_w, win_h))

    z_min = min(zoom for _t, _cx, _cy, zoom in kfs)
    z_max = max(zoom for _t, _cx, _cy, zoom in kfs)
    animate_zoom = z_max - z_min > 1e-3 and not force_static

    # ---- estágio 1: crop 9:16 no MENOR zoom, com pan (x/y por frame) ----
    w0 = _even(min(base_w / z_min, float(src_w)))
    h0 = _even(min(base_h / z_min, float(src_h)))
    stage1: list[tuple[float, float, float]] = []  # t, x, y do canto do crop
    for t, cx_px, cy_px, _w, _h in frames_kf:
        x0 = min(max(cx_px - w0 / 2, 0.0), src_w - w0)
        y0 = min(max(cy_px - h0 / 2, 0.0), src_h - h0)
        stage1.append((t, round(x0, 2), round(y0, 2)))

    pan_moves = len(stage1) > 1 and (
        max(x for _t, x, _y in stage1) - min(x for _t, x, _y in stage1) > 0.5
        or max(y for _t, _x, y in stage1) - min(y for _t, _x, y in stage1) > 0.5
    )
    if pan_moves:
        x_expr = _pan_expr([(t, x) for t, x, _y in stage1])
        y_expr = _pan_expr([(t, y) for t, _x, y in stage1])
        crop_f = f"crop={w0}:{h0}:x='{x_expr}':y='{y_expr}'"
    else:
        crop_f = f"crop={w0}:{h0}:{stage1[0][1]:g}:{stage1[0][2]:g}"

    # ---- estágio 2: zoom residual via zoompan (se o zoom varia) ----
    if animate_zoom:
        ss_w, ss_h = out_w * 2, out_h * 2  # supersample anti-jitter
        sx = ss_w / w0
        sy = ss_h / h0
        z_pts: list[tuple[float, float]] = []
        x_pts: list[tuple[float, float]] = []
        y_pts: list[tuple[float, float]] = []
        for i, ((t, cx_px, cy_px, _w, _h), (_t, x0, y0)) in enumerate(
            zip(frames_kf, stage1)
        ):
            z = max(1.0, kfs[i][3] / z_min)
            zx = min(max((cx_px - x0) * sx - ss_w / (2 * z), 0.0), ss_w - ss_w / z)
            zy = min(max((cy_px - y0) * sy - ss_h / (2 * z), 0.0), ss_h - ss_h / z)
            z_pts.append((t, round(z, 4)))
            x_pts.append((t, round(zx, 2)))
            y_pts.append((t, round(zy, 2)))
        # O zoompan não expõe ``t``, só o frame de saída ``on`` (d=1 → 1:1).
        tvar = f"(on/{fps:.4f})"
        vf = (
            f"{crop_f},scale={ss_w}:{ss_h}"
            f",zoompan=z='{_pan_expr(z_pts, tvar)}'"
            f":x='{_pan_expr(x_pts, tvar)}'"
            f":y='{_pan_expr(y_pts, tvar)}'"
            f":d=1:s={out_w}x{out_h}:fps={fps:g}"
            f",setsar=1"
        )
    else:
        vf = f"{crop_f},scale={out_w}:{out_h},setsar=1"

    cmd = [
        "ffmpeg",
        "-y",
        "-ss", str(ss),
        "-i", input_file,
        "-t", str(duration),
        "-threads", str(settings.ffmpeg_threads),
        # Mesmo racional do corte dinâmico: sem isso o lado do filtro abre uma
        # thread por núcleo do host, e o zoompan supersampleado infla o pico
        # de memória do container.
        "-filter_threads", str(settings.dynamic_filter_threads),
        "-filter_complex_threads", str(settings.dynamic_filter_threads),
        "-vf", vf,
        "-c:v", "libx264",
        "-preset", "veryfast",
        "-c:a", "aac",
        "-movflags", "+faststart",
        output_path,
    ]

    try:
        _run_ffmpeg(cmd, output_path, duration, "FFmpeg falhou no corte com keyframes")
    except RuntimeError as exc:
        raise RuntimeError(f"{exc}\nvf: {vf}") from exc

    return output_path
