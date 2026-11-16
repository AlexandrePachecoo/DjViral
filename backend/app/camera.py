"""Shot plan do corte dinâmico dirigido pela IA.

O :mod:`app.ai_director` devolve, por keyframe do trecho, o que a câmera deve
enquadrar e onde aquilo está (``AIDirection.frames``). Este módulo só traduz
essa direção em shots renderizáveis: onde cortar (trocas de foco e auges,
alinhados aos beats), quanto aproximar e para onde panoramizar. Não há
detecção local, tracking nem heurística de atividade — quem olha a cena é o
modelo.

Gravações multicâmera/editadas trocam de ângulo no meio do trecho
(``AIDirection.cuts``). Cada TOMADA é planejada sozinha — um box só vale no
ângulo em que foi visto e nenhum pan atravessa uma troca. Quando a gravação
já é picotada demais para caber shots próprios, o clipe vira um
reenquadramento: crop fixo que se recentra na ação a cada tomada.

Devolve a mesma :class:`app.dynamic.Shot` que ``clipper.cut_dynamic`` já
renderiza (shots contíguos cobrindo ``[0, duration]``).
"""
import math
import statistics

from .dynamic import (
    CENTER_ZOOM,
    _even_pos,
    Shot,
    _beat_zoom_keys,
    _pan_path,
    _resolve_cfg,
    _snap_to_beat,
    crop_for_box,
)
from .visual import Box

# Quanto um shot "tight" (auge / segunda metade de um plano longo) aproxima a
# mais que o shot normal do mesmo alvo.
TIGHT_ZOOM_STEP = 0.3
# Folga em volta do box da IA num shot normal de pessoa (dj/dançarino): o crop
# tem 2x a altura do box. No shot "tight" o crop é o próprio box.
PERSON_MARGIN = 2.0

Frame = tuple[float, str, Box | None]


def _median_box(boxes: list[Box]) -> Box:
    return Box(
        cx=statistics.median(b.cx for b in boxes),
        cy=statistics.median(b.cy for b in boxes),
        w=statistics.median(b.w for b in boxes),
        h=statistics.median(b.h for b in boxes),
        conf=boxes[0].conf,
    )


def _boundaries(
    frames: list[Frame],
    beats: list[float],
    span: tuple[float, float],
    punches: list[float],
    cfg,
    limit: int,
) -> list[tuple[float, bool]]:
    """Instantes de corte ``(t, é_auge)`` dentro da tomada ``span``, em ordem.

    Prioridade: auges (drop + ``moments`` da IA), depois trocas de foco entre
    frames vizinhos, depois divisões de planos mais longos que ``shot_max``.
    Um corte só entra se ficar a ``shot_min`` de todos os já aceitos e das
    bordas da tomada, e até ``limit`` cortes.
    """
    start, end = span
    shot_min, shot_max = cfg.dynamic_shot_min, cfg.dynamic_shot_max
    accepted: list[tuple[float, bool]] = []

    def _add(t: float, punch: bool) -> None:
        t = round(_snap_to_beat(t, beats), 3)
        if len(accepted) >= limit or not start + shot_min <= t <= end - shot_min:
            return
        if all(abs(t - other) >= shot_min for other, _ in accepted):
            accepted.append((t, punch))

    for t in punches:
        _add(t, True)
    for (t_prev, f_prev, _), (t_cur, f_cur, _) in zip(frames, frames[1:]):
        if f_cur != f_prev:
            _add((t_prev + t_cur) / 2, False)
    # Planos longos demais: divide em partes iguais (o zoom alterna entre elas).
    edges = [start] + sorted(t for t, _ in accepted) + [end]
    for t0, t1 in zip(edges, edges[1:]):
        parts = math.ceil((t1 - t0) / shot_max)
        for i in range(1, parts):
            _add(t0 + (t1 - t0) * i / parts, False)
    return sorted(accepted)


def _focus_in_span(frames: list[Frame], t0: float, t1: float) -> str:
    """Foco pedido pela IA no trecho: o mais frequente entre os frames dele."""
    if not frames:
        return "wide"  # tomada que a IA não viu: plano aberto, sem supor nada
    inside = [f for t, f, _ in frames if t0 <= t < t1]
    if not inside:
        mid = (t0 + t1) / 2
        return min(frames, key=lambda fr: abs(fr[0] - mid))[1]
    return max(set(inside), key=inside.count)


def _box_for(frames: list[Frame], focus: str, t0: float, t1: float) -> Box | None:
    """Onde o alvo ``focus`` está no trecho: mediana dos boxes dos frames dele;
    sem frame no trecho, o box do frame mais próximo com aquele foco."""
    boxes = [b for t, f, b in frames if f == focus and b is not None and t0 <= t < t1]
    if boxes:
        return _median_box(boxes)
    mid = (t0 + t1) / 2
    near = [(abs(t - mid), b) for t, f, b in frames if f == focus and b is not None]
    return min(near, key=lambda item: item[0])[1] if near else None


def _box_at(frames: list[Frame], focus: str, t: float) -> Box | None:
    """Box do alvo em ``t``, interpolado entre dois frames VIZINHOS com aquele
    foco. ``None`` se ``t`` não está entre dois frames assim (ex.: a IA trocou
    de foco no meio — não dá para supor onde o alvo estava)."""
    for (ta, fa, ba), (tb, fb, bb) in zip(frames, frames[1:]):
        if ta <= t <= tb and fa == fb == focus and ba is not None and bb is not None:
            k = (t - ta) / (tb - ta) if tb > ta else 0.0
            return Box(
                cx=ba.cx + (bb.cx - ba.cx) * k,
                cy=ba.cy + (bb.cy - ba.cy) * k,
                w=ba.w + (bb.w - ba.w) * k,
                h=ba.h + (bb.h - ba.h) * k,
                conf=ba.conf,
            )
    return None


def _person_crop(box: Box, tight: bool, src_w: int, src_h: int, cfg):
    """Crop 9:16 de um shot de pessoa: o box da IA com folga (ou justo, no
    shot fechado), nunca além de ``dynamic_zoom_max`` nem maior que o frame."""
    height = box.h * (1.0 if tight else PERSON_MARGIN)
    zoom = 1.0 / min(max(height, 1.0 / cfg.dynamic_zoom_max), 1.0)
    point = Box(cx=box.cx, cy=box.cy, w=0.0, h=0.0, conf=box.conf)
    return crop_for_box(point, src_w, src_h, zoom=zoom, cfg=cfg)


# Tomada da gravação mais curta que isto é absorvida pela anterior (flash,
# efeito, corte-relâmpago): não dá para enquadrar nada em menos tempo.
MIN_TAKE = 1.0


def _takes(cuts: list[float], duration: float) -> list[tuple[float, float]]:
    """Tomadas ``(t0, t1)`` da gravação dentro do clipe, a partir das trocas."""
    edges = [0.0]
    for c in sorted(cuts):
        if c - edges[-1] >= MIN_TAKE and duration - c >= MIN_TAKE:
            edges.append(round(float(c), 3))
    edges.append(duration)
    return list(zip(edges, edges[1:]))


def _reframe(
    frames: list[Frame], takes: list[tuple[float, float]], duration: float,
    src_w: int, src_h: int, cfg,
) -> list[Shot]:
    """Gravação já picotada: um crop de altura cheia que se recentra na ação
    a cada tomada (salto seco junto com o corte da gravação), sem zoom nem
    cortes próprios — a edição original já dá o ritmo."""
    w, h, x_center, _ = crop_for_box(None, src_w, src_h, cfg=cfg)
    xs: list[int] = []
    for t0, t1 in takes:
        boxes = [b for t, _f, b in frames if b is not None and t0 <= t < t1]
        if boxes:
            xs.append(_even_pos(_median_box(boxes).cx * src_w - w / 2, src_w - w))
        else:
            xs.append(x_center)
    path = [(0.0, xs[0], 0)]
    for (t0, _t1), x, x_prev in zip(takes[1:], xs[1:], xs):
        if x != x_prev:
            path += [(round(t0 - 0.03, 3), x_prev, 0), (t0, x, 0)]
    shot = Shot(t0=0.0, t1=duration, kind="reframe", crop=(w, h, xs[0], 0))
    if len(path) > 1:
        shot.path = path
    return [shot]


def build_ai_shot_plan(
    ai,
    beats: list[float],
    duration: float,
    src_w: int,
    src_h: int,
    peak_at: float | None = None,
    intensity: str = "medium",
) -> list[Shot]:
    """Timeline de shots de um clipe a partir da direção por frame da IA.

    ``ai`` é um :class:`app.ai_director.AIDirection` com ``frames``; lista
    vazia se não houver direção (o chamador cai no planejador legado).
    ``peak_at`` (instante do drop no clipe) e ``ai.moments`` viram cortes com
    punch-in. ``ai.cuts`` (trocas de câmera da gravação) dividem o clipe em
    tomadas planejadas separadamente. ``intensity`` aplica os mesmos presets
    do corte dinâmico (duração dos shots, zoom máximo, drift, beat-punch).
    """
    frames: list[Frame] = list(getattr(ai, "frames", None) or [])
    if not frames or duration <= 0:
        return []
    cfg = _resolve_cfg(intensity)
    max_shots = max(1, cfg.dynamic_max_shots)
    takes = _takes(list(getattr(ai, "cuts", None) or []), duration)
    if len(takes) > max_shots or (
        len(takes) > 1
        and statistics.median(b - a for a, b in takes) < cfg.dynamic_shot_min
    ):
        return _reframe(frames, takes, duration, src_w, src_h, cfg)

    punches = [t for t in [peak_at, *ai.moments] if t is not None]
    shots: list[Shot] = []
    for n, (take0, take1) in enumerate(takes):
        take_frames = [fr for fr in frames if take0 <= fr[0] < take1]
        # Cortes próprios que ainda cabem, guardando um shot por tomada restante.
        budget = max_shots - len(shots) - (len(takes) - n)
        cuts = _boundaries(take_frames, beats, (take0, take1), punches, cfg, budget)
        edges = [(take0, False)] + cuts + [(take1, False)]
        prev_focus, prev_tight = None, False
        for (t0, punch), (t1, _) in zip(edges, edges[1:]):
            shot, prev_focus, prev_tight = _shot(
                take_frames, t0, t1, punch, prev_focus, prev_tight,
                beats, src_w, src_h, cfg,
            )
            shots.append(shot)
    return shots


def _shot(
    frames: list[Frame], t0: float, t1: float, punch: bool,
    prev_focus: str | None, prev_tight: bool,
    beats: list[float], src_w: int, src_h: int, cfg,
) -> tuple[Shot, str, bool]:
    """Um shot dentro de uma tomada (``frames`` são só os dela)."""
    focus = _focus_in_span(frames, t0, t1)
    if punch and focus == "wide":
        # Auge pede um plano fechado: no artista se a IA o localizou.
        focus = next(
            (k for k in ("dj", "dancer", "crowd") if _box_for(frames, k, t0, t1)),
            "wide",
        )
    box = _box_for(frames, focus, t0, t1)
    if focus != "wide" and box is None:
        focus = "wide"  # a IA pediu um alvo que não localizou
    # Partes consecutivas do MESMO foco alternam normal → fechado: é o "zoom
    # no beat" dentro de um plano que a IA quis manter.
    tight = punch or (focus == prev_focus and not prev_tight)

    if focus == "wide":
        if tight and box is not None:
            point = Box(cx=box.cx, cy=box.cy, w=0.0, h=0.0, conf=0.0)
            crop = crop_for_box(point, src_w, src_h, zoom=CENTER_ZOOM, cfg=cfg)
        else:
            crop = crop_for_box(
                None, src_w, src_h, anchor_cx=box.cx if box else None, cfg=cfg
            )
    elif focus == "crowd":
        # Público: zoom leve centrado na aglomeração (o box dela costuma ser
        # largo demais para "enquadrar" num 9:16).
        point = Box(cx=box.cx, cy=box.cy, w=0.0, h=0.0, conf=box.conf)
        zoom = CENTER_ZOOM + (TIGHT_ZOOM_STEP if tight else 0.0)
        crop = crop_for_box(point, src_w, src_h, zoom=zoom, cfg=cfg)
    else:
        crop = _person_crop(box, tight, src_w, src_h, cfg)

    shot = Shot(t0=t0, t1=t1, kind=focus, crop=crop, drift=cfg.dynamic_drift)
    if focus != "wide":
        # Pan: a câmera segue o alvo pelas posições que a IA deu (nas pontas
        # do shot, interpoladas entre os frames vizinhos da mesma tomada).
        track = [(t0, _box_at(frames, focus, t0))]
        track += [(t, b) for t, f, b in frames if f == focus and t0 < t < t1]
        track.append((t1, _box_at(frames, focus, t1)))
        track = [(t, b) for t, b in track if b is not None]
        shot.path = _pan_path(track, t0, t1, crop[0], crop[1], src_w, src_h, cfg)
    if shot.drift and cfg.beat_punch_enabled:
        shot.zoom_keys = _beat_zoom_keys(
            t1 - t0,
            shot.drift,
            [b - t0 for b in beats],
            cfg.beat_punch_anticip_frac,
            cfg.beat_punch_anticip_zoom_frac,
        )
    return shot, focus, tight
