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
from dataclasses import dataclass

from .config import settings
from .visual import Box, WindowVisual

# Fronteira de shot "snapa" ao beat mais próximo dentro desta tolerância (s).
BEAT_SNAP_TOLERANCE = 0.6
# Zoom do enquadramento central de fallback (sem detecção de pessoas).
CENTER_ZOOM = 1.3
# Margem vertical do enquadramento do DJ: a altura do crop é ~1.9x a altura
# da pessoa detectada (enquadra busto, cabine e um respiro).
DJ_BOX_MARGIN = 1.9
# A cada quantos shots de zoom entra um shot de público (quando existe).
CROWD_EVERY = 3


@dataclass
class Shot:
    """Um trecho do clipe com enquadramento fixo.

    ``crop`` é ``(w, h, x, y)`` em pixels da FONTE (pré-scale), com dimensões
    pares. ``drift`` é o zoom relativo aplicado ao longo do shot pelo zoompan
    (ex.: 0.06 = aproxima 6%; negativo afasta; 0 = estático).
    """

    t0: float
    t1: float
    kind: str  # wide | dj | crowd | center
    crop: tuple[int, int, int, int]
    drift: float = 0.0


def _even(v: float) -> int:
    return max(2, int(round(v / 2)) * 2)


def crop_for_box(
    box: Box | None,
    src_w: int,
    src_h: int,
    zoom: float = 1.5,
) -> tuple[int, int, int, int]:
    """Crop 9:16 (w, h, x, y) em px da fonte para enquadrar ``box``.

    - ``box=None``: crop central wide (o mesmo enquadramento do corte seco).
    - Box de pessoa: enquadra a pessoa com margem (:data:`DJ_BOX_MARGIN`);
      ``zoom`` é o teto de aproximação quando a pessoa é pequena no frame.
    - Box "pontual" (``w=h=0``): zoom puro de ``zoom``× centrado em (cx, cy)
      — usado no enquadramento central de fallback.

    O zoom nunca passa de ``dynamic_zoom_max`` (a saída 1080×1920 já é
    upscale de fonte 1080p; aproximar demais pixelaria).
    """
    out_ar = settings.output_width / settings.output_height  # 9/16

    if box is None:
        h = _even(src_h)
        w = _even(min(src_w, src_h * out_ar))
        return w, h, _even((src_w - w) / 2), 0

    zoom = min(max(zoom, 1.0), settings.dynamic_zoom_max)
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
    x_i = max(0, min(_even(x), src_w - w_i))
    y_i = max(0, min(_even(y), src_h - h_i))
    return w_i, h_i, x_i, y_i


def _snap_to_beat(t: float, beats: list[float]) -> float:
    if not beats:
        return t
    nearest = min(beats, key=lambda b: abs(b - t))
    return nearest if abs(nearest - t) <= BEAT_SNAP_TOLERANCE else t


def build_shot_plan(
    wv: WindowVisual | None,
    beats: list[float],
    duration: float,
    src_w: int,
    src_h: int,
    peak_at: float | None = None,
    ai: "AIDirection | None" = None,
) -> list[Shot]:
    """Monta a timeline de shots de um clipe de ``duration`` segundos.

    Invariantes (exigidas pelo concat do renderizador): shots contíguos,
    monotônicos, cobrindo exatamente ``[0, duration]``.

    - Abre em wide; ``peak_at`` (instante do drop, ~pre_roll) força uma
      fronteira com punch-in no protagonista exatamente no drop.
    - ``ai`` (opcional, do :mod:`app.ai_director`) enviesa o enquadramento:
      ``ai.subject`` escolhe o protagonista (``crowd`` prioriza o público,
      ``dj`` o artista) e ``ai.moments`` adicionam fronteiras extras de punch-in
      nos instantes de auge visual (não só no drop musical). ``ai.dj_box`` /
      ``ai.crowd_box`` completam o enquadramento onde o YOLO não achou ninguém
      (balada escura, laser): o box do YOLO, quando existe, sempre vence (é a
      mediana de uma track inteira; o da IA é uma estimativa de cena).
    - Alterna wide ↔ zoom (protagonista), com um shot do secundário a cada
      :data:`CROWD_EVERY` zooms quando houver.
    - Fronteiras snapam ao beat mais próximo; sem beats, grade fixa.
    - Trechos agitados (motion alto) recebem shots mais curtos.
    - Nunca ultrapassa :data:`settings.dynamic_max_shots` (o teto limita a
      largura do `split=N` no filtergraph renderizado, e portanto a memória).
    """
    shot_min = settings.dynamic_shot_min
    shot_max = settings.dynamic_shot_max
    motion = wv.motion_score if wv is not None else 0.5
    max_shots = max(1, settings.dynamic_max_shots)

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

    # Duração-alvo dos shots: cena parada → shots longos; agitada → curtos. O
    # teto reserva espaço para as fronteiras de punch-in já escolhidas.
    base_len = shot_max - (shot_max - shot_min) * min(1.0, motion)
    reserve = min(len(kept_punches), max_shots - 1)
    min_base_len = duration / max(1, max_shots - reserve)
    base_len = max(base_len, min_base_len)

    # ---- Fronteiras: grade regular fundida aos punch-ins ----
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
    bounds = [0.0]
    for b in sorted(set(grid[1:]) | punch_set):
        if b >= duration - shot_min * 0.6:
            continue
        if b - bounds[-1] < shot_min * 0.5 and b not in punch_set:
            continue  # muito colado e não é punch-in → descarta
        bounds.append(b)
    # Teto de shots (largura do split=N): remove as fronteiras não-punch mais
    # coladas até caber, preservando os punch-ins.
    while len(bounds) - 1 > max_shots and len(bounds) > 2:
        gaps = [
            (bounds[i] - bounds[i - 1], i)
            for i in range(1, len(bounds))
            if bounds[i] not in punch_set
        ]
        if not gaps:
            break
        _, idx = min(gaps)
        bounds.pop(idx)
    bounds.append(round(duration, 3))

    # ---- Enquadramentos ----
    # YOLO primeiro (mediana de track, mais preciso); os boxes da IA só
    # preenchem os buracos da detecção local (cena escura, laser, contraluz).
    dj_box = wv.dj_box if wv is not None else None
    crowd_box = wv.crowd_box if wv is not None else None
    if ai is not None:
        if dj_box is None:
            dj_box = ai.dj_box
        if crowd_box is None:
            crowd_box = ai.crowd_box
    wide = crop_for_box(None, src_w, src_h)

    # Protagonista da janela, enviesado pela IA quando disponível.
    subject = ai.subject if ai is not None else "wide"
    have_dj = dj_box is not None
    have_crowd = crowd_box is not None
    if subject == "crowd" and have_crowd:
        primary_kind = "crowd"
        secondary_kind = "dj" if have_dj else "crowd"
    elif subject == "dj" and have_dj:
        primary_kind = "dj"
        secondary_kind = "crowd" if have_crowd else "dj"
    else:  # wide, ou sem os boxes necessários → comportamento original
        primary_kind = "dj" if have_dj else "center"
        secondary_kind = "crowd" if have_crowd else primary_kind

    def crop_for_kind(kind: str, tight: bool) -> tuple[int, int, int, int]:
        if kind == "crowd":
            return crop_for_box(crowd_box, src_w, src_h, zoom=1.35)
        if kind == "dj":
            return crop_for_box(dj_box, src_w, src_h, zoom=1.65 if tight else 1.45)
        # center: zoom puro no centro (box pontual), leve variação de intensidade.
        center = Box(cx=0.5, cy=0.5, w=0.0, h=0.0, conf=1.0)
        return crop_for_box(center, src_w, src_h, zoom=CENTER_ZOOM + (0.15 if tight else 0.0))

    shots: list[Shot] = []
    zooms_done = 0
    drift_sign = 1.0
    for i in range(len(bounds) - 1):
        t0, t1 = bounds[i], bounds[i + 1]
        is_punch = any(math.isclose(t0, p, abs_tol=1e-6) for p in kept_punches)

        if i == 0 and not is_punch:
            kind = "wide"
        elif is_punch:
            kind = primary_kind  # punch-in no protagonista
        elif shots and shots[-1].kind == "wide":
            zooms_done += 1
            if secondary_kind != primary_kind and zooms_done % CROWD_EVERY == 0:
                kind = secondary_kind
            else:
                kind = primary_kind
        else:
            kind = "wide"

        if kind == "wide":
            crop = wide
            drift = 0.0
        else:
            crop = crop_for_kind(kind, tight=is_punch)
            drift = settings.dynamic_drift * drift_sign
            drift_sign = -drift_sign

        shots.append(Shot(t0=t0, t1=t1, kind=kind, crop=crop, drift=drift))

    return shots
