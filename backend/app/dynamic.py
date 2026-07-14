"""Planejador de shots do corte dinâmico.

Transforma o resultado visual de uma janela (:class:`app.visual.WindowVisual`)
numa *timeline de shots*: trechos contíguos de 3–8 s, cada um com um
enquadramento fixo (wide, zoom no DJ, zoom no público ou zoom central), com as
fronteiras alinhadas aos beats da música. A alternância wide→zoom cortada no
beat é o que dá a sensação de zoom in/out dos vídeos virais; dentro dos shots
de zoom um *drift* suave opcional (zoompan) completa o efeito.

O renderizador (``clipper.cut_dynamic``) consome a lista de shots num único
``filter_complex`` do FFmpeg. Módulo puro e determinístico dado o input — os
crops são calculados aqui, em pixels da fonte, já com dimensões pares e
clampados aos limites do frame.
"""
import math
import statistics
from dataclasses import dataclass

from .config import DYNAMIC_INTENSITY_PRESETS, settings
from .visual import Box, FrameSample, WindowVisual, _median_box

# Fronteira de shot "snapa" ao beat mais próximo dentro desta tolerância (s).
BEAT_SNAP_TOLERANCE = 0.6
# Zoom do enquadramento central de fallback (sem detecção de pessoas).
CENTER_ZOOM = 1.3
# Margem vertical do enquadramento do DJ: a altura do crop é ~1.9x a altura
# da pessoa detectada (enquadra busto, cabine e um respiro).
DJ_BOX_MARGIN = 1.9
# Folga (s) em volta do shot ao juntar as detecções da track para o
# enquadramento por shot (pega detecções vizinhas quando o shot é curto).
TRACK_LOCAL_PAD = 0.75
# Mínimo de detecções da track dentro do shot para confiar no box local;
# menos que isso, usa o box global da janela.
TRACK_LOCAL_MIN = 2
# Janela (nº de detecções) da média móvel que suaviza a track antes do pan.
PAN_SMOOTH = 3
# Gap máximo (s) entre detecções consecutivas para a track contar como
# "presente" naquele trecho do shot (acima disso é um buraco — pessoa saiu de
# quadro / detecção falhou). Folgado o bastante para não confundir a CADÊNCIA
# normal de amostragem (~1 det/s em produção; até 2s) com ausência: só um
# buraco de vários segundos sem detecção conta como a pessoa fora de quadro.
TRACK_PRESENCE_GAP = 3.0
# Teto de batidas consideradas por shot no zoom de antecipação — segura o
# tamanho da expressão FFmpeg (um shot de ~8s a 128 BPM tem ~4-5 beats).
BEAT_PUNCH_MAX_BEATS = 4


def _resolve_cfg(intensity: str):
    """Config efetiva para um nível de intensidade, SEM mutar o singleton.

    ``settings`` é compartilhado entre jobs concorrentes (o worker roda os
    renders num threadpool); mutar seus atributos por job seria condição de
    corrida. ``model_copy(update=...)`` devolve uma cópia isolada com os knobs
    do preset sobrescritos. ``medium`` (preset vazio) devolve o próprio
    ``settings`` — zero cópia, comportamento idêntico ao atual.
    """
    preset = DYNAMIC_INTENSITY_PRESETS.get(intensity or "medium")
    if not preset:
        return settings
    return settings.model_copy(update=preset)


@dataclass
class Shot:
    """Um trecho do clipe com enquadramento de nível de zoom fixo.

    ``crop`` é ``(w, h, x, y)`` em pixels da FONTE (pré-scale), com dimensões
    pares. ``drift`` é o zoom relativo aplicado ao longo do shot pelo zoompan
    (ex.: 0.06 = aproxima 6%; negativo afasta; 0 = estático). ``path``
    (opcional) são keyframes ``(t relativo ao início do shot, x, y)`` do canto
    do crop: a câmera PANORAMIZA seguindo a pessoa (o filtro ``crop`` avalia
    x/y por frame; w/h continuam fixos). ``path`` e ``drift`` PODEM coexistir
    (Ken Burns: pan + zoom simultâneos) — o renderizador aplica o pan via
    ``crop`` e o zoom via um ``zoompan`` em cima do resultado já panorâmico.

    ``zoom_keys`` (opcional) são keyframes ``(t relativo ao shot, z)`` do NÍVEL
    de zoom do zoompan: quando presente, substitui a rampa uniforme por uma
    curva "lento-depois-punch" ancorada nas batidas (ver
    :func:`_beat_zoom_keys`). ``None`` = rampa de ``drift`` uniforme (padrão).
    """

    t0: float
    t1: float
    kind: str  # wide | dj | dancer | crowd | center
    crop: tuple[int, int, int, int]
    drift: float = 0.0
    path: list[tuple[float, int, int]] | None = None
    zoom_keys: list[tuple[float, float]] | None = None


def _even(v: float) -> int:
    return max(2, int(round(v / 2)) * 2)


def _even_pos(v: float, hi: float) -> int:
    """Posição (x/y) de crop arredondada para par, clampada em [0, hi]."""
    return max(0, min(int(round(v / 2)) * 2, int(hi)))


def crop_for_box(
    box: Box | None,
    src_w: int,
    src_h: int,
    zoom: float = 1.5,
    anchor_cx: float | None = None,
    cfg=settings,
) -> tuple[int, int, int, int]:
    """Crop 9:16 (w, h, x, y) em px da fonte para enquadrar ``box``.

    - ``box=None``: crop wide de altura cheia. Por padrão central (o mesmo
      enquadramento do corte seco); ``anchor_cx`` (fração 0-1) centra o wide
      na AÇÃO — num 16:9 o crop 9:16 mostra só ~1/3 da largura, e um wide no
      centro do frame perde o DJ que está no canto do palco.
    - Box de pessoa: enquadra a pessoa com margem (:data:`DJ_BOX_MARGIN`);
      ``zoom`` é o teto de aproximação quando a pessoa é pequena no frame.
    - Box "pontual" (``w=h=0``): zoom puro de ``zoom``× centrado em (cx, cy)
      — usado no enquadramento central de fallback.

    O zoom nunca passa de ``dynamic_zoom_max`` (a saída 1080×1920 já é
    upscale de fonte 1080p; aproximar demais pixelaria).
    """
    out_ar = cfg.output_width / cfg.output_height  # 9/16

    if box is None:
        h = _even(src_h)
        w = _even(min(src_w, src_h * out_ar))
        cx = 0.5 if anchor_cx is None else min(max(float(anchor_cx), 0.0), 1.0)
        x = min(max(cx * src_w - w / 2, 0), src_w - w)
        return w, h, _even_pos(x, src_w - w), 0

    zoom = min(max(zoom, 1.0), cfg.dynamic_zoom_max)
    if box.w <= 0 or box.h <= 0:
        h = src_h / zoom
    else:
        person_h = box.h * src_h
        # Nunca mais apertado que o zoom pedido, nem mais largo que o frame.
        h = min(max(person_h * DJ_BOX_MARGIN, src_h / zoom), src_h)
    w = h * out_ar
    if w > src_w:  # fonte mais estreita que o crop pedido (ex. já vertical)
        w = src_w
        h = min(src_h, w / out_ar)

    x = box.cx * src_w - w / 2
    y = box.cy * src_h - h / 2
    x = min(max(x, 0), src_w - w)
    y = min(max(y, 0), src_h - h)
    w_i, h_i = _even(w), _even(h)
    x_i = _even_pos(x, src_w - w_i)
    y_i = _even_pos(y, src_h - h_i)
    return w_i, h_i, x_i, y_i


def _track_in_span(
    track: list[tuple[float, Box]], t0: float, t1: float
) -> list[tuple[float, Box]]:
    """Detecções da track no trecho ``[t0, t1]`` (com folga TRACK_LOCAL_PAD)."""
    return [(t, b) for t, b in track if t0 - TRACK_LOCAL_PAD <= t <= t1 + TRACK_LOCAL_PAD]


def _local_box(track: list[tuple[float, Box]], t0: float, t1: float) -> Box | None:
    """Box mediano da track DENTRO do shot (com folga :data:`TRACK_LOCAL_PAD`).

    É o que centraliza a pessoa de verdade: o box global da janela é a mediana
    de ~60s — se o DJ circula pela cabine, cada shot mira "onde ele esteve em
    média", não onde ele está naquele trecho. ``None`` (track ausente ou com
    menos de :data:`TRACK_LOCAL_MIN` detecções no trecho) → o chamador usa o
    box global.
    """
    boxes = [b for _t, b in _track_in_span(track, t0, t1)]
    if len(boxes) < TRACK_LOCAL_MIN:
        return None
    return _median_box(boxes)


def _local_track_stats(
    track: list[tuple[float, Box]], t0: float, t1: float
) -> tuple[int, float, float]:
    """``(n_det, coverage, median_conf)`` da track no shot ``[t0, t1]``.

    - ``n_det``: nº de detecções no trecho (com folga TRACK_LOCAL_PAD).
    - ``coverage``: fração do shot "coberta" por detecções recentes — soma dos
      gaps entre detecções consecutivas que são ``<= TRACK_PRESENCE_GAP``,
      dividida pela duração do shot. Pega o caso "a track existia no início mas
      a pessoa saiu de quadro no meio e ficou um buraco longo sem detecção".
    - ``median_conf``: confiança mediana das detecções (0 quando não há).

    É o sinal per-shot de "esse box corresponde MESMO a alguém aqui?" — usado
    por :func:`_shot_presence_ok` para degradar o kind quando a track é fraca/
    intermitente NAQUELE trecho (o box global da janela pode ser forte e ainda
    assim estar vazio num shot específico).
    """
    pts = _track_in_span(track, t0, t1)
    if not pts:
        return 0, 0.0, 0.0
    times = sorted(t for t, _ in pts)
    dur = max(t1 - t0, 1e-6)
    covered = 0.0
    for a, b in zip(times, times[1:]):
        gap = b - a
        if gap <= TRACK_PRESENCE_GAP:
            covered += gap
    coverage = min(1.0, covered / dur)
    confs = sorted(b.conf for _t, b in pts)
    median_conf = confs[len(confs) // 2]
    return len(pts), coverage, median_conf


def _shot_presence_ok(
    track: list[tuple[float, Box]], t0: float, t1: float, cfg=settings
) -> bool:
    """A track sustenta um enquadramento de pessoa neste shot?

    Exige um mínimo de detecções, cobertura temporal (``dynamic_min_shot_coverage``)
    e confiança mediana (``dynamic_min_shot_conf``). Track vazia → ``False`` (o
    chamador degrada o kind). Sem track alguma (``[]`` — box de cena única da
    IA, sem detecções por frame) o chamador NÃO deve chamar esta função: não há
    o que medir e a decisão fica só na guarda de atividade.
    """
    n_det, coverage, median_conf = _local_track_stats(track, t0, t1)
    if n_det < TRACK_LOCAL_MIN:
        return False
    return (
        coverage >= cfg.dynamic_min_shot_coverage
        and median_conf >= cfg.dynamic_min_shot_conf
    )


def _smooth(vals: list[float], k: int = PAN_SMOOTH) -> list[float]:
    """Média móvel centrada de janela ``k`` (bordas encolhem a janela)."""
    if len(vals) <= 2 or k <= 1:
        return list(vals)
    half = k // 2
    out: list[float] = []
    for i in range(len(vals)):
        lo, hi = max(0, i - half), min(len(vals), i + half + 1)
        out.append(sum(vals[lo:hi]) / (hi - lo))
    return out


def _pan_path(
    track: list[tuple[float, Box]],
    t0: float,
    t1: float,
    crop_w: int,
    crop_h: int,
    src_w: int,
    src_h: int,
    cfg=settings,
) -> list[tuple[float, int, int]] | None:
    """Keyframes de pan ``(t relativo ao shot, x, y)`` seguindo a track.

    É o que mantém o DJ no quadro quando ele se move DURANTE o shot: o nível
    de zoom (w/h do crop) fica fixo e só a POSIÇÃO acompanha a pessoa. A zona
    morta (``dynamic_pan_deadband``) segura a câmera enquanto a pessoa não sai
    do lugar (sem micro-jitter) e o teto de velocidade
    (``dynamic_pan_max_speed``) faz a câmera "atrasar" e alcançar, em vez de
    chicotear. ``None`` = sem movimento útil → crop estático (comportamento
    original).
    """
    if not cfg.dynamic_pan:
        return None
    pts = _track_in_span(track, t0, t1)
    if len(pts) < 2:
        return None
    times = [t for t, _ in pts]
    cxs = _smooth([b.cx for _, b in pts])
    cys = _smooth([b.cy for _, b in pts])

    # Zona morta: só vira keyframe o ponto que se afastou do último keyframe.
    deadband = max(0.0, cfg.dynamic_pan_deadband)
    keys = [(times[0], cxs[0], cys[0])]
    for t, cx, cy in zip(times[1:], cxs[1:], cys[1:]):
        _, px, py = keys[-1]
        if math.hypot(cx - px, cy - py) >= deadband:
            keys.append((t, cx, cy))
    if len(keys) < 2:
        return None

    # Teto de velocidade (fração do frame/s): se a pessoa correu, o pan anda
    # só o permitido na direção dela e completa nos keyframes seguintes.
    max_speed = max(1e-6, cfg.dynamic_pan_max_speed)
    limited = [keys[0]]
    for t, cx, cy in keys[1:]:
        pt, px, py = limited[-1]
        dist = math.hypot(cx - px, cy - py)
        reach = max_speed * max(t - pt, 1e-6)
        if dist > reach:
            f = reach / dist
            cx, cy = px + (cx - px) * f, py + (cy - py) * f
        limited.append((t, cx, cy))

    # Centros → canto do crop em px (pares, clampados), t relativo ao shot.
    dur = t1 - t0
    path: list[tuple[float, int, int]] = []
    for t, cx, cy in limited:
        x = _even_pos(cx * src_w - crop_w / 2, src_w - crop_w)
        y = _even_pos(cy * src_h - crop_h / 2, src_h - crop_h)
        tr = round(min(max(t - t0, 0.0), dur), 3)
        if path and abs(tr - path[-1][0]) < 1e-6:
            path[-1] = (tr, x, y)  # keyframes clampados no mesmo t: fica o último
        else:
            path.append((tr, x, y))
    if len(path) < 2 or all((x, y) == (path[0][1], path[0][2]) for _, x, y in path):
        return None
    return path


def _inflate_for_span(
    box: Box, track: list[tuple[float, Box]], t0: float, t1: float, cfg=settings
) -> Box:
    """Alarga a altura do box pelo percurso VERTICAL da track no trecho.

    O zoom não anima dentro do shot — a altura do crop precisa acomodar o
    vaivém da pessoa entre os keyframes do pan (com pan ligado só sobra o
    resíduo além da zona morta; com pan desligado, o percurso inteiro).
    """
    pts = [b for _t, b in _track_in_span(track, t0, t1)]
    if len(pts) < 2:
        return box
    span = max(b.cy for b in pts) - min(b.cy for b in pts)
    if cfg.dynamic_pan:
        span = max(0.0, span - cfg.dynamic_pan_deadband)
    if span <= 0.0:
        return box
    return Box(cx=box.cx, cy=box.cy, w=box.w, h=box.h + span, conf=box.conf)


def _face_anchor(box: Box, face_bias_y: float | None, cfg=settings) -> Box:
    """Nudge vertical do crop em direção ao rosto (Fase 6 do plano de melhorias).

    ``face_bias_y`` é a mediana de ``(face.cy - box.cy) / box.h`` observada na
    track (ver ``visual._face_bias_y``) — tipicamente negativa (o rosto fica
    acima do centro geométrico do corpo). Só desloca ``cy``: ``w``/``h`` (e
    portanto o zoom) NUNCA mudam aqui — o enquadramento continua mostrando o
    corpo/dança/controladora, só para de arriscar cortar a cabeça no topo do
    quadro. Sem rosto detectado (``None``) ou feature desligada, devolve o box
    intacto.
    """
    if face_bias_y is None or not cfg.face_enabled:
        return box
    weight = min(1.0, max(0.0, cfg.face_anchor_weight))
    new_cy = min(1.0, max(0.0, box.cy + face_bias_y * box.h * weight))
    return Box(cx=box.cx, cy=new_cy, w=box.w, h=box.h, conf=box.conf)


def _snap_to_beat(t: float, beats: list[float]) -> float:
    if not beats:
        return t
    nearest = min(beats, key=lambda b: abs(b - t))
    return nearest if abs(nearest - t) <= BEAT_SNAP_TOLERANCE else t


def _shot_activity(samples: list[FrameSample], t0: float, t1: float) -> float | None:
    """Atividade de imagem MÉDIA do trecho ``[t0, t1]`` (frame-diff dos samples).

    É o sinal barato de "está acontecendo alguma coisa AGORA?" — usado para
    soltar um zoom parado em quem já parou de dançar (vira wide) e para fechar
    mais quando a pessoa está claramente agitada. ``None`` quando nenhum sample
    cai no trecho (janela sem análise de movimento).
    """
    vals = [s.motion for s in samples if t0 - 1e-6 <= s.t <= t1 + 1e-6]
    if not vals:
        return None
    return sum(vals) / len(vals)


def _local_baseline(
    samples: list[FrameSample], t0: float, t1: float, window: float, fallback: float
) -> float:
    """Mediana da atividade dos VIZINHOS do shot (±``window`` s).

    O baseline global (mediana da janela inteira de ~60s) mascara uma queda de
    ação no MEIO de um clipe agitado: o trecho morto ainda fica acima de
    ``ratio × mediana_global``. Comparar contra os vizinhos imediatos detecta
    essa queda. Poucos samples locais (< 3) → cai no ``fallback`` global.
    """
    vals = [
        s.motion for s in samples if t0 - window <= s.t <= t1 + window and s.motion > 0
    ]
    if len(vals) < 3:
        return fallback
    return statistics.median(vals)


def _beat_zoom_keys(
    dur: float,
    drift: float,
    shot_beats: list[float],
    anticip_frac: float,
    anticip_zoom_frac: float,
) -> list[tuple[float, float]] | None:
    """Keyframes ``(t, z)`` de zoom "lento-depois-punch" ancorados nas batidas.

    Entre batidas consecutivas (com ``0`` e ``dur`` como bordas) o zoom sobe
    DEVAGAR até ``z_prev + anticip_zoom_frac*(z_next-z_prev)`` na primeira
    ``anticip_frac`` do intervalo, e RÁPIDO até ``z_next`` no resto (logo antes
    do beat). O nível de zoom por beat interpola de ``1.0`` a ``1+drift`` ao
    longo dos beats — o último ponto é ``1+drift`` no fim do shot, então o teto
    do zoom continua o mesmo (o beat-punch só redistribui QUANDO o ganho
    acontece, não QUANTO). A desproporção tempo/zoom (ex.: 70% do tempo cobre
    30% do zoom, depois 30% do tempo cobre 70%) é o que dá o "punch" — a
    interpolação com easing de :func:`clipper._pan_expr` faz o resto.

    ``None`` quando não há batida dentro do shot (o chamador mantém a rampa
    uniforme de ``drift``, sem mudar o visual dos shots sem beat).
    """
    beats = sorted(b for b in shot_beats if 0.0 < b < dur)
    beats = beats[:BEAT_PUNCH_MAX_BEATS]
    if not beats:
        return None
    bounds = [0.0] + beats + [dur]
    n = len(bounds) - 1
    z_at = [1.0 + drift * (i / n) for i in range(n + 1)]
    points: list[tuple[float, float]] = [(0.0, 1.0)]
    for i in range(1, len(bounds)):
        t_prev, t_cur = bounds[i - 1], bounds[i]
        z_prev, z_cur = z_at[i - 1], z_at[i]
        anticip_t = t_prev + anticip_frac * (t_cur - t_prev)
        z_anticip = z_prev + anticip_zoom_frac * (z_cur - z_prev)
        points.append((round(anticip_t, 3), round(z_anticip, 4)))
        points.append((round(t_cur, 3), round(z_cur, 4)))
    return points


def build_shot_plan(
    wv: WindowVisual | None,
    beats: list[float],
    duration: float,
    src_w: int,
    src_h: int,
    peak_at: float | None = None,
    ai: "AIDirection | None" = None,
    intensity: str = "medium",
) -> list[Shot]:
    """Monta a timeline de shots de um clipe de ``duration`` segundos.

    Invariantes (exigidas pelo concat do renderizador): shots contíguos,
    monotônicos, cobrindo exatamente ``[0, duration]``.

    - Arco narrativo: abre em wide/protagonista com push-in (build-up),
      ``peak_at`` (instante do drop, ~pre_roll) força uma fronteira com
      punch-in apertado no protagonista, e depois do drop a rotação alterna
      protagonista ↔ dançarino/público com wide de respiro — zooms sempre
      aproximam (nada de drift alternado cego).
    - ``ai`` (opcional, do :mod:`app.ai_director`) dirige: ``ai.story`` (roteiro
      de câmera ``[(t, subject)]``) comanda as fronteiras/enquadramentos no
      lugar da rotação heurística; ``ai.subject`` escolhe o protagonista;
      ``ai.moments`` adicionam punch-ins nos auges visuais. ``ai.dj_box`` /
      ``ai.crowd_box`` / ``ai.dancer_box`` completam o enquadramento onde o
      YOLO falhou: nenhuma pessoa achada OU track fraca/intermitente (presente
      em menos de :data:`settings.dynamic_ai_box_takeover_ratio` dos frames detectados —
      flicker de cena escura); uma track sólida do YOLO sempre vence a
      estimativa da IA.
    - Shots de DJ/dançarino são enquadrados POR SHOT (mediana da track no
      trecho, via :func:`_local_box`) e a câmera PANORAMIZA dentro do shot
      seguindo a track (:func:`_pan_path`), AO MESMO TEMPO em que aproxima
      (``drift``) — pan e zoom coexistem no shot (efeito Ken Burns), em vez
      de escolher um ou outro. O wide é ancorado no protagonista.
    - Fronteiras snapam ao beat mais próximo; sem beats, grade fixa.
    - Trechos agitados (motion alto) recebem shots mais curtos.
    - Nunca ultrapassa :data:`settings.dynamic_max_shots` (o teto limita a
      largura do `split=N` no filtergraph renderizado, e portanto a memória).
    """
    # Config efetiva do nível de intensidade escolhido pelo usuário — cópia
    # isolada (nunca muta o singleton `settings`), passada às sub-funções.
    cfg = _resolve_cfg(intensity)
    shot_min = cfg.dynamic_shot_min
    shot_max = cfg.dynamic_shot_max
    motion = wv.motion_score if wv is not None else 0.5
    max_shots = max(1, cfg.dynamic_max_shots)

    # Atividade de imagem por trecho (frame-diff dos samples): a MEDIANA da
    # janela é a referência contra a qual cada shot é medido — um trecho bem
    # abaixo dela está "parado" (respiro/wide), um bem acima está agitado
    # (take mais fechado). Sem samples (visual off) fica 0 e os dois efeitos
    # ficam inertes (as heurísticas de kind/zoom seguem como antes).
    motion_samples = wv.samples if wv is not None else []
    _activity_vals = [s.motion for s in motion_samples[1:]]  # samples[0].motion == 0
    baseline_activity = (
        statistics.median(_activity_vals) if len(_activity_vals) >= 3 else 0.0
    )

    # ---- Instantes de punch-in: drop musical + momentos de auge visual da IA ----
    punch_times: list[float] = []

    def _add_punch(t: float | None) -> None:
        if t is None:
            return
        if shot_min * 0.5 <= t <= duration - shot_min:
            punch_times.append(round(float(t), 3))

    _add_punch(peak_at)
    if ai is not None:
        for m in ai.moments:
            _add_punch(m)
    # Ordena e afasta punch-ins colados (< shot_min entre si), limitados ao teto.
    punch_times.sort()
    kept_punches: list[float] = []
    for t in punch_times:
        if not kept_punches or t - kept_punches[-1] >= shot_min:
            kept_punches.append(t)
    kept_punches = kept_punches[: max(0, max_shots - 1)]

    # ---- Roteiro de câmera da IA (story): fronteiras + enquadramentos ----
    # Passos snapados ao beat (mesma grade das demais fronteiras); o primeiro
    # instante não vira fronteira (o clipe já começa em 0), mas continua no
    # mapa de kinds.
    story_steps: list[tuple[float, str]] = []
    if ai is not None and ai.story:
        for t, subj in ai.story:
            if 0.0 <= t < duration - shot_min * 0.6:
                story_steps.append((round(_snap_to_beat(float(t), beats), 3), subj))
        story_steps.sort(key=lambda s: s[0])
    story_set = {t for t, _ in story_steps if t >= shot_min * 0.5}

    # Duração-alvo dos shots: cena parada → shots longos; agitada → curtos. O
    # teto reserva espaço para as fronteiras de punch-in já escolhidas.
    base_len = shot_max - (shot_max - shot_min) * min(1.0, motion)
    reserve = min(len(kept_punches), max_shots - 1)
    min_base_len = duration / max(1, max_shots - reserve)
    base_len = max(base_len, min_base_len)

    # ---- Fronteiras: grade regular fundida a punch-ins e story ----
    grid = [0.0]
    while True:
        prev = grid[-1]
        # Varia ±15% alternando para a timeline não ficar metronômica.
        wobble = 1.15 if len(grid) % 2 else 0.85
        nxt = _snap_to_beat(prev + base_len * wobble, beats)
        if nxt <= prev + shot_min * 0.5:
            nxt = prev + base_len
        if nxt >= duration - shot_min * 0.6:
            break
        grid.append(round(nxt, 3))

    punch_set = set(kept_punches)

    def _prio(b: float) -> int:
        """Prioridade da fronteira: punch-in > passo da story > grade."""
        if b in punch_set:
            return 2
        if b in story_set:
            return 1
        return 0

    bounds = [0.0]
    for b in sorted(set(grid[1:]) | story_set | punch_set):
        if b >= duration - shot_min * 0.6:
            continue
        # Fronteira de prioridade maior vence: uma de prioridade menor colada
        # logo antes criaria um shot-relâmpago (< shot_min/2) — sai a menor.
        while (
            len(bounds) > 1
            and b - bounds[-1] < shot_min * 0.5
            and _prio(bounds[-1]) < _prio(b)
        ):
            bounds.pop()
        if b - bounds[-1] >= shot_min * 0.5:
            bounds.append(b)
        # senão: muito colado a uma fronteira de prioridade >= → descarta
    # Teto de shots (largura do split=N): remove as fronteiras de menor
    # prioridade mais coladas até caber, preservando os punch-ins. O append
    # de ``duration`` logo abaixo fecha o último shot — o nº final de shots
    # é o len(bounds) daqui, daí o teto SEM o -1.
    while len(bounds) > max_shots and len(bounds) > 2:
        gaps = [
            (_prio(bounds[i]), bounds[i] - bounds[i - 1], i)
            for i in range(1, len(bounds))
            if bounds[i] not in punch_set
        ]
        if not gaps:
            break
        _, _, idx = min(gaps)
        bounds.pop(idx)
    bounds.append(round(duration, 3))

    # ---- Enquadramentos ----
    # YOLO primeiro (mediana de track, mais preciso); os boxes da IA entram
    # onde a detecção local falhou (cena escura, laser, contraluz) — nenhum
    # box, ou uma track fraca/intermitente (mediana de meia dúzia de detecções
    # tremidas perde para a estimativa de cena da IA).
    dj_box = wv.dj_box if wv is not None else None
    crowd_box = wv.crowd_box if wv is not None else None
    dj_track = list(wv.dj_track) if wv is not None else []
    dancer_box = wv.dancer_box if wv is not None else None
    dancer_track = list(wv.dancer_track) if wv is not None else []
    # Viés vertical do rosto (sinal de ancoragem, ver `crop_for_kind`/Fase 6
    # do plano) — None quando não há rosto detectado na track (YuNet ausente
    # ou ninguém de frente pra câmera).
    dj_face_bias = wv.dj_face_bias_y if wv is not None else None
    dancer_face_bias = wv.dancer_face_bias_y if wv is not None else None
    if ai is not None:
        weak_track = (
            dj_box is not None
            and wv is not None
            and wv.dj_track_ratio < cfg.dynamic_ai_box_takeover_ratio
        )
        if ai.dj_box is not None and (dj_box is None or weak_track):
            dj_box = ai.dj_box
            dj_track = []  # box de cena única — sem enquadramento por shot
        if crowd_box is None:
            crowd_box = ai.crowd_box
        if dancer_box is None:
            dancer_box = ai.dancer_box
            dancer_track = []

    # Protagonista da janela, enviesado pela IA quando disponível.
    subject = ai.subject if ai is not None else "wide"
    have_dj = dj_box is not None
    have_crowd = crowd_box is not None
    have_dancer = dancer_box is not None
    if subject == "crowd" and have_crowd:
        primary_kind = "crowd"
        secondary_kind = "dj" if have_dj else "crowd"
    elif subject == "dj" and have_dj:
        primary_kind = "dj"
        secondary_kind = "crowd" if have_crowd else "dj"
    else:  # wide, ou sem os boxes necessários → comportamento original
        primary_kind = "dj" if have_dj else "center"
        secondary_kind = "crowd" if have_crowd else primary_kind

    def _resolve_kind(kind: str) -> str:
        """Degrada um kind pedido (ex.: pela story) para o que a cena tem."""
        if kind == "dancer" and not have_dancer:
            kind = "crowd"
        if kind == "crowd" and not have_crowd:
            kind = "dj"
        if kind == "dj" and not have_dj:
            kind = "center"
        return kind

    def _story_kind(t: float) -> str | None:
        kind = None
        for st, subj in story_steps:
            if st <= t + 1e-6:
                kind = subj
            else:
                break
        return _resolve_kind(kind) if kind else None

    # Rotação pós-drop (sem story): o protagonista reestabelece e alterna com
    # dançarino/público, com um wide de RESPIRO a cada troca — a "celebração"
    # com intenção (zoom no protagonista → respiro → quem dança → volta ao
    # protagonista → respiro → público...). O respiro frequente é de propósito:
    # sem ele a timeline fica tempo demais colada nas pessoas.
    extras: list[str] = []
    if have_dancer and primary_kind != "dancer":
        extras.append("dancer")
    if secondary_kind != primary_kind:
        extras.append(secondary_kind)
    post_cycle: list[str] = [primary_kind]
    for extra in extras:
        post_cycle += ["wide", extra, primary_kind]
    if "wide" not in post_cycle:  # protagonista sozinho (sem dançarino/público)
        post_cycle.append("wide")

    # Wide ancorado na ação: centrado no protagonista (o crop 9:16 de um 16:9
    # mostra ~1/3 da largura; wide no centro do frame perde o DJ no canto e a
    # alternância wide↔zoom fica sem nexo). Sem box → centro (original).
    anchor_box = crowd_box if primary_kind == "crowd" else dj_box
    wide = crop_for_box(
        None, src_w, src_h,
        anchor_cx=anchor_box.cx if anchor_box is not None else None,
        cfg=cfg,
    )

    # Continuidade de câmera: (cx, cy) de ONDE A CÂMERA PAROU no fim do último
    # shot de cada kind (dj/dancer/crowd), pra puxar o enquadramento do
    # próximo shot desse kind em vez de saltar reto pro alvo — ver
    # :data:`settings.dynamic_camera_continuity`. "wide"/"center" ficam de
    # fora de propósito (são o respiro/reset da narrativa).
    prev_camera: dict[str, tuple[float, float]] = {}

    def _apply_continuity(
        kind: str,
        crop: tuple[int, int, int, int],
        path: list[tuple[float, int, int]] | None,
    ) -> tuple[tuple[int, int, int, int], list[tuple[float, int, int]] | None]:
        cw, ch, cx, cy = crop
        blend = min(1.0, max(0.0, cfg.dynamic_camera_continuity))
        prev = prev_camera.get(kind)
        if path is None and prev is not None and blend > 0:
            # Shot estático: puxa o centro do crop uma fração em direção à
            # posição final da câmera na última vez que este kind apareceu —
            # sem isso, dois shots do mesmo protagonista longe um do outro na
            # timeline enquadram de forma totalmente desconexa.
            cur_cx, cur_cy = (cx + cw / 2) / src_w, (cy + ch / 2) / src_h
            new_cx = cur_cx * (1 - blend) + prev[0] * blend
            new_cy = cur_cy * (1 - blend) + prev[1] * blend
            cx = _even_pos(new_cx * src_w - cw / 2, src_w - cw)
            cy = _even_pos(new_cy * src_h - ch / 2, src_h - ch)
            crop = (cw, ch, cx, cy)

        # Guarda pra próxima vez: fim do path se houver pan, senão o próprio
        # centro do crop estático (já com a continuidade aplicada acima).
        if path:
            _end_t, end_x, end_y = path[-1]
            prev_camera[kind] = ((end_x + cw / 2) / src_w, (end_y + ch / 2) / src_h)
        else:
            prev_camera[kind] = ((cx + cw / 2) / src_w, (cy + ch / 2) / src_h)
        return crop, path

    def crop_for_kind(
        kind: str, tight: bool, t0: float, t1: float
    ) -> tuple[tuple[int, int, int, int], list[tuple[float, int, int]] | None]:
        """Crop do shot + keyframes de pan (quando a track dá movimento)."""
        if kind == "crowd":
            crop = crop_for_box(crowd_box, src_w, src_h, zoom=1.35, cfg=cfg)
            return _apply_continuity(kind, crop, None)
        if kind in ("dj", "dancer"):
            # Enquadramento POR SHOT: mediana da track dentro do trecho —
            # segue a pessoa pela cena em vez de mirar a posição média dos 60s
            # — e pan dentro do shot para ela não sair do quadro no meio.
            track = dj_track if kind == "dj" else dancer_track
            base = dj_box if kind == "dj" else dancer_box
            face_bias = dj_face_bias if kind == "dj" else dancer_face_bias
            box = _local_box(track, t0, t1) or base
            box = _inflate_for_span(box, track, t0, t1, cfg=cfg)
            # Rosto: só um NUDGE vertical do crop (nunca w/h) — mantém a
            # dança/controladora no quadro, só evita cortar a cabeça.
            box = _face_anchor(box, face_bias, cfg=cfg)
            zoom = 1.65 if tight else 1.45
            # Bônus de zoom limitado: só em shots JÁ "tight" (punch-in no
            # drop/auge) e com rosto detectado — nunca vira um close-up
            # genérico fora desses momentos.
            if tight and face_bias is not None and cfg.face_enabled:
                zoom += cfg.face_zoom_bonus
            # Take mais fechado quando a pessoa está claramente "on": trecho
            # com atividade de imagem bem acima da mediana da janela ganha um
            # aperto extra (clampado a `dynamic_zoom_max` em `crop_for_box`).
            act = _shot_activity(motion_samples, t0, t1)
            if (
                cfg.dynamic_activity_zoom_bonus > 0
                and baseline_activity > 0
                and act is not None
                and act >= cfg.dynamic_tight_activity_ratio * baseline_activity
            ):
                zoom += cfg.dynamic_activity_zoom_bonus
            crop = crop_for_box(box, src_w, src_h, zoom=zoom, cfg=cfg)
            path = _pan_path(track, t0, t1, crop[0], crop[1], src_w, src_h, cfg=cfg)
            return _apply_continuity(kind, crop, path)
        # center: zoom puro no centro (box pontual), leve variação de intensidade.
        # Fica de fora da continuidade (fallback sem sujeito real).
        center = Box(cx=0.5, cy=0.5, w=0.0, h=0.0, conf=1.0)
        crop = crop_for_box(
            center, src_w, src_h, zoom=CENTER_ZOOM + (0.15 if tight else 0.0), cfg=cfg
        )
        return crop, None

    def _presence_ok_for(kind: str, t0: float, t1: float) -> bool:
        """A track do kind sustenta um enquadramento de pessoa NESTE shot?

        ``dj``/``dancer`` com track (do YOLO) são validados por
        :func:`_shot_presence_ok`. Uma track vazia (``[]`` — box de cena única
        da IA, sem detecções por frame) não tem o que medir → considera OK (a
        decisão fica só na guarda de atividade). ``crowd``/``center``/``wide``
        não têm track por pessoa → sempre OK.
        """
        if kind == "dj":
            return _shot_presence_ok(dj_track, t0, t1, cfg=cfg) if dj_track else True
        if kind == "dancer":
            return (
                _shot_presence_ok(dancer_track, t0, t1, cfg=cfg)
                if dancer_track
                else True
            )
        return True

    def _degrade_by_presence(kind: str, t0: float, t1: float) -> str:
        """Degrada um kind de pessoa cuja track não sustenta ESTE shot.

        Se o DJ/dançarino não está de fato enquadrável neste trecho (saiu de
        quadro, track intermitente), troca o SUJEITO em cascata em vez de
        segurar um zoom num box vazio — só depois a guarda de atividade decide
        se o sujeito resolvido está parado (vira wide). Nunca degrada direto
        pra wide aqui (isso mataria um punch-in): sempre para outro sujeito ou
        o zoom central.
        """
        if kind == "dj" and not _presence_ok_for("dj", t0, t1):
            if have_dancer and _presence_ok_for("dancer", t0, t1):
                return "dancer"
            if have_crowd:
                return "crowd"
            return "center"
        if kind == "dancer" and not _presence_ok_for("dancer", t0, t1):
            if have_crowd:
                return "crowd"
            if have_dj and _presence_ok_for("dj", t0, t1):
                return "dj"
            return "center"
        return kind

    shots: list[Shot] = []
    post_idx = 0
    # Sem nenhum punch (drop fora do clipe), o clipe inteiro é "celebração".
    seen_punch = not kept_punches
    for i in range(len(bounds) - 1):
        t0, t1 = bounds[i], bounds[i + 1]
        is_punch = any(math.isclose(t0, p, abs_tol=1e-6) for p in kept_punches)

        if is_punch:
            kind = primary_kind  # punch-in no protagonista
            seen_punch = True
        elif story_steps:
            kind = _story_kind(t0) or ("wide" if i == 0 else primary_kind)
        elif i == 0:
            kind = "wide"
        elif not seen_punch:
            # Build-up (antes do drop): wide ↔ protagonista com push-in lento.
            kind = "wide" if shots[-1].kind != "wide" else primary_kind
        else:
            kind = post_cycle[post_idx % len(post_cycle)]
            post_idx += 1

        # Guarda de PRESENÇA (per-shot): troca o sujeito quando a track dele não
        # tem sustentação neste trecho (aplica a punch-ins também — só troca o
        # sujeito, nunca mata o zoom).
        kind = _degrade_by_presence(kind, t0, t1)

        # Respiro reativo à AÇÃO: se a imagem está PARADA neste trecho (ninguém
        # dançando de fato), não segura um zoom estático numa pessoa — vira
        # wide. O punch-in do drop é intencional e fica de fora. Compara contra
        # o baseline LOCAL (vizinhos) — pega uma queda de ação no meio de um
        # clipe agitado — e contra um PISO absoluto — pega a janela inteira de
        # baixa energia, onde o baseline relativo também é baixo.
        if kind in ("dj", "dancer", "crowd") and not is_punch:
            act = _shot_activity(motion_samples, t0, t1)
            if act is not None:
                local_base = _local_baseline(
                    motion_samples, t0, t1,
                    cfg.dynamic_local_baseline_window, baseline_activity,
                )
                too_still = (
                    cfg.dynamic_still_activity_ratio > 0
                    and local_base > 0
                    and act < cfg.dynamic_still_activity_ratio * local_base
                )
                below_floor = (
                    cfg.dynamic_still_activity_floor > 0
                    and act < cfg.dynamic_still_activity_floor
                )
                if too_still or below_floor:
                    kind = "wide"

        path = None
        zoom_keys = None
        if kind == "wide":
            crop = wide
            drift = 0.0
        else:
            crop, path = crop_for_kind(kind, tight=is_punch, t0=t0, t1=t1)
            # Zoom SEMPRE aproxima — o zoom-out aleatório (sinal alternado
            # cego) era o que deixava os zooms "sem objetivo". Com ou sem
            # pan: a câmera aproxima ENQUANTO acompanha a pessoa (Ken Burns),
            # em vez de escolher entre panorâmica OU zoom por shot.
            drift = abs(cfg.dynamic_drift)
            # Zoom de antecipação de batida: em vez da rampa uniforme, aproxima
            # devagar entre as batidas e dá o punch logo antes de cada beat
            # DENTRO do shot. Só quando o nível liga (`beat_punch_enabled`) e há
            # batida no trecho — senão `zoom_keys` fica None e o render usa a
            # rampa de `drift` de sempre.
            if cfg.beat_punch_enabled and drift > 0:
                shot_beats = [b - t0 for b in beats if t0 < b < t1]
                zoom_keys = _beat_zoom_keys(
                    t1 - t0, drift, shot_beats,
                    cfg.beat_punch_anticip_frac, cfg.beat_punch_anticip_zoom_frac,
                )

        shots.append(
            Shot(
                t0=t0, t1=t1, kind=kind, crop=crop, drift=drift,
                path=path, zoom_keys=zoom_keys,
            )
        )

    return shots
