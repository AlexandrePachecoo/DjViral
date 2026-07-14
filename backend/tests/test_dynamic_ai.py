"""Testes de `build_shot_plan` com a direção de IA (subject + moments)."""
import math

import pytest

from app.ai_director import AIDirection
from app.dynamic import _pan_path, build_shot_plan
from app.visual import Box, FrameSample, WindowVisual
from app.config import settings


def _wv() -> WindowVisual:
    wv = WindowVisual()
    wv.detected = True
    wv.motion_score = 0.5
    wv.dj_box = Box(cx=0.5, cy=0.4, w=0.12, h=0.35, conf=0.9)
    wv.crowd_box = Box(cx=0.5, cy=0.75, w=0.8, h=0.4, conf=1.0)
    return wv


SRC_W, SRC_H = 1920, 1080
DURATION = 60.0


def _assert_invariants(shots):
    assert shots, "shot plan não pode ser vazio"
    assert shots[0].t0 == 0.0
    assert math.isclose(shots[-1].t1, DURATION, abs_tol=1e-6)
    for a, b in zip(shots, shots[1:]):
        assert math.isclose(a.t1, b.t0, abs_tol=1e-6)  # contíguos
    assert len(shots) <= settings.dynamic_max_shots


def test_no_ai_matches_legacy_dj_focus():
    # Sem IA: com dj_box presente o protagonista (primeiro zoom) é o DJ; o
    # público entra só como shot secundário a cada CROWD_EVERY zooms (original).
    shots = build_shot_plan(_wv(), beats=[], duration=DURATION, src_w=SRC_W, src_h=SRC_H)
    _assert_invariants(shots)
    kinds = {s.kind for s in shots}
    assert "dj" in kinds
    first_zoom = next(s for s in shots if s.kind != "wide")
    assert first_zoom.kind == "dj"


def test_ai_crowd_subject_prioritizes_crowd():
    ai = AIDirection(hype_score=0.9, subject="crowd", moments=[], worthy=True)
    shots = build_shot_plan(
        _wv(), beats=[], duration=DURATION, src_w=SRC_W, src_h=SRC_H, ai=ai
    )
    _assert_invariants(shots)
    kinds = [s.kind for s in shots]
    assert "crowd" in kinds  # público virou protagonista
    # O primeiro zoom após o wide de abertura é o protagonista (crowd).
    first_zoom = next(s for s in shots if s.kind != "wide")
    assert first_zoom.kind == "crowd"


def test_ai_moments_add_punch_in_boundaries():
    ai = AIDirection(hype_score=0.8, subject="crowd", moments=[20.0, 40.0], worthy=True)
    shots = build_shot_plan(
        _wv(), beats=[], duration=DURATION, src_w=SRC_W, src_h=SRC_H, ai=ai
    )
    _assert_invariants(shots)
    starts = [s.t0 for s in shots]
    # Cada momento vira uma fronteira de shot (punch-in), com zoom no protagonista.
    for m in (20.0, 40.0):
        hit = [s for s in shots if math.isclose(s.t0, m, abs_tol=1e-6)]
        assert hit, f"esperava uma fronteira em t={m}"
        assert hit[0].kind == "crowd"


def test_ai_dj_subject_keeps_dj():
    ai = AIDirection(hype_score=0.7, subject="dj", moments=[30.0], worthy=True)
    shots = build_shot_plan(
        _wv(), beats=[], duration=DURATION, src_w=SRC_W, src_h=SRC_H, ai=ai
    )
    _assert_invariants(shots)
    punch = next(s for s in shots if math.isclose(s.t0, 30.0, abs_tol=1e-6))
    assert punch.kind == "dj"


def test_moments_out_of_range_ignored():
    # Momentos fora de [shot_min*0.5, duration-shot_min] não viram fronteiras.
    ai = AIDirection(hype_score=0.5, subject="dj", moments=[0.1, 59.9], worthy=True)
    shots = build_shot_plan(
        _wv(), beats=[], duration=DURATION, src_w=SRC_W, src_h=SRC_H, ai=ai
    )
    _assert_invariants(shots)


def test_ai_boxes_fill_in_when_yolo_missed():
    # YOLO rodou e não achou ninguém (cena escura) mas a IA localizou o DJ e o
    # público: os boxes da IA viram o enquadramento (não cai no zoom central).
    wv = WindowVisual()
    wv.detected = True
    wv.motion_score = 0.5
    ai = AIDirection(
        hype_score=0.7,
        subject="dj",
        worthy=True,
        dj_box=Box(cx=0.3, cy=0.4, w=0.2, h=0.45, conf=0.5),
        crowd_box=Box(cx=0.6, cy=0.8, w=0.7, h=0.35, conf=0.5),
    )
    shots = build_shot_plan(
        wv, beats=[], duration=DURATION, src_w=SRC_W, src_h=SRC_H, ai=ai
    )
    _assert_invariants(shots)
    kinds = {s.kind for s in shots}
    assert "dj" in kinds and "center" not in kinds
    # O crop do DJ segue o box da IA (à esquerda do frame), não o centro.
    dj_shot = next(s for s in shots if s.kind == "dj")
    w, _h, x, _y = dj_shot.crop
    assert x + w / 2 < SRC_W / 2  # centrado em cx=0.3, não em 0.5


def test_yolo_box_wins_over_ai_box():
    # Quando o YOLO tem box, o da IA não substitui (mediana de track > estimativa).
    wv = _wv()  # dj_box em cx=0.5
    ai = AIDirection(
        hype_score=0.7,
        subject="dj",
        worthy=True,
        dj_box=Box(cx=0.1, cy=0.1, w=0.1, h=0.1, conf=0.5),
    )
    shots = build_shot_plan(
        wv, beats=[], duration=DURATION, src_w=SRC_W, src_h=SRC_H, ai=ai
    )
    _assert_invariants(shots)
    dj_shot = next(s for s in shots if s.kind == "dj")
    w, _h, x, _y = dj_shot.crop
    # Centro do crop ~no centro do frame (box do YOLO), não no canto da IA.
    assert abs((x + w / 2) - SRC_W / 2) < SRC_W * 0.15


def test_ai_crowd_box_enables_crowd_subject_without_yolo():
    # Sem nenhum box do YOLO, subject=crowd da IA + crowd_box da IA fazem o
    # público virar protagonista (antes: caía no zoom central).
    wv = WindowVisual()
    wv.detected = True
    wv.motion_score = 0.6
    ai = AIDirection(
        hype_score=0.9,
        subject="crowd",
        worthy=True,
        crowd_box=Box(cx=0.5, cy=0.75, w=0.8, h=0.4, conf=0.5),
    )
    shots = build_shot_plan(
        wv, beats=[], duration=DURATION, src_w=SRC_W, src_h=SRC_H, ai=ai
    )
    _assert_invariants(shots)
    first_zoom = next(s for s in shots if s.kind != "wide")
    assert first_zoom.kind == "crowd"


def test_weak_yolo_track_defers_to_ai_box():
    # Track do YOLO intermitente (flicker em cena escura): o box da IA assume
    # o enquadramento mesmo com dj_box do YOLO presente.
    wv = _wv()  # dj_box em cx=0.5
    wv.dj_track_ratio = 0.1
    ai = AIDirection(
        hype_score=0.7,
        subject="dj",
        worthy=True,
        dj_box=Box(cx=0.2, cy=0.4, w=0.2, h=0.45, conf=0.5),
    )
    shots = build_shot_plan(
        wv, beats=[], duration=DURATION, src_w=SRC_W, src_h=SRC_H, ai=ai
    )
    _assert_invariants(shots)
    dj_shot = next(s for s in shots if s.kind == "dj")
    w, _h, x, _y = dj_shot.crop
    assert x + w / 2 < SRC_W * 0.35  # centrado no box da IA (cx=0.2)


def test_dj_shots_follow_track_per_shot():
    # O DJ muda de lado no meio da janela: os shots de zoom da 1ª metade
    # enquadram a esquerda e os da 2ª metade a direita (não a mediana global).
    wv = _wv()
    left = Box(cx=0.2, cy=0.4, w=0.12, h=0.35, conf=0.9)
    right = Box(cx=0.8, cy=0.4, w=0.12, h=0.35, conf=0.9)
    wv.dj_track = [(float(t), left if t < 30 else right) for t in range(0, 60, 2)]
    shots = build_shot_plan(wv, beats=[], duration=DURATION, src_w=SRC_W, src_h=SRC_H)
    _assert_invariants(shots)
    early = [s for s in shots if s.kind == "dj" and s.t1 <= 30.0]
    late = [s for s in shots if s.kind == "dj" and s.t0 >= 30.0]
    assert early and late
    for s in early:
        w, _h, x, _y = s.crop
        assert x + w / 2 < SRC_W * 0.45
    for s in late:
        w, _h, x, _y = s.crop
        assert x + w / 2 > SRC_W * 0.55


def test_wide_shot_anchored_on_subject():
    # DJ no canto esquerdo do palco: o wide (crop 9:16 de altura cheia) é
    # ancorado nele, não no centro do frame (que o deixaria fora do quadro).
    wv = _wv()
    wv.dj_box = Box(cx=0.2, cy=0.4, w=0.12, h=0.35, conf=0.9)
    shots = build_shot_plan(wv, beats=[], duration=DURATION, src_w=SRC_W, src_h=SRC_H)
    wide = next(s for s in shots if s.kind == "wide")
    w, _h, x, _y = wide.crop
    assert x + w / 2 < SRC_W * 0.35


def test_punch_in_always_zooms_in():
    shots = build_shot_plan(
        _wv(), beats=[], duration=DURATION, src_w=SRC_W, src_h=SRC_H, peak_at=30.0
    )
    punch = next(s for s in shots if math.isclose(s.t0, 30.0, abs_tol=1e-6))
    assert punch.kind == "dj"
    assert punch.drift > 0  # aproxima no drop, nunca afasta


def test_no_flash_shot_next_to_punch():
    # Fronteira da grade colada a um punch-in é removida — nenhum shot fica
    # mais curto que shot_min/2.
    ai = AIDirection(
        hype_score=0.8, subject="dj", moments=[20.0, 40.0], worthy=True
    )
    shots = build_shot_plan(
        _wv(), beats=[], duration=DURATION, src_w=SRC_W, src_h=SRC_H,
        peak_at=30.0, ai=ai,
    )
    _assert_invariants(shots)
    assert min(s.t1 - s.t0 for s in shots) >= settings.dynamic_shot_min * 0.5 - 1e-6


def test_respects_max_shots_with_many_moments():
    ai = AIDirection(
        hype_score=0.9,
        subject="crowd",
        moments=[10.0, 20.0, 30.0],  # coerce já limita a 3
        worthy=True,
    )
    wv = _wv()
    wv.motion_score = 1.0  # agitado → shots curtos → mais fronteiras
    shots = build_shot_plan(
        wv, beats=[], duration=DURATION, src_w=SRC_W, src_h=SRC_H,
        peak_at=5.0, ai=ai,
    )
    _assert_invariants(shots)  # inclui o teto de max_shots


# ---- Pan contínuo dentro do shot (a câmera segue o DJ) ----

def _moving_track(cx0=0.3, cx1=0.7, t0=0.0, t1=60.0, step=1.0, cy=0.4):
    """Track sintética: DJ anda de cx0 até cx1 em [t0, t1], 1 detecção/s."""
    track = []
    t = t0
    while t <= t1 + 1e-6:
        f = (t - t0) / (t1 - t0)
        box = Box(cx=cx0 + (cx1 - cx0) * f, cy=cy, w=0.12, h=0.35, conf=0.9)
        track.append((round(t, 3), box))
        t += step
    return track


def test_pan_path_follows_moving_track():
    track = _moving_track(0.3, 0.7, 0.0, 10.0)
    path = _pan_path(track, 0.0, 10.0, crop_w=420, crop_h=746, src_w=SRC_W, src_h=SRC_H)
    assert path is not None and len(path) >= 2
    xs = [x for _, x, _ in path]
    assert xs[-1] > xs[0]  # a câmera acompanha o deslocamento p/ a direita
    ts = [t for t, _, _ in path]
    assert ts == sorted(ts) and 0.0 <= ts[0] and ts[-1] <= 10.0


def test_pan_path_none_when_dj_still():
    # Jitter abaixo da zona morta: a câmera não se move (sem micro-tremor).
    track = [
        (float(t), Box(cx=0.5 + (0.005 if t % 2 else -0.005), cy=0.4, w=0.12, h=0.35, conf=0.9))
        for t in range(0, 11)
    ]
    assert _pan_path(track, 0.0, 10.0, 420, 746, SRC_W, SRC_H) is None


def test_pan_path_respects_setting(monkeypatch):
    monkeypatch.setattr(settings, "dynamic_pan", False)
    track = _moving_track(0.2, 0.8, 0.0, 10.0)
    assert _pan_path(track, 0.0, 10.0, 420, 746, SRC_W, SRC_H) is None


def test_pan_path_limits_speed():
    # DJ "teleporta" (0.2 → 0.8 em 1s): o pan anda no máximo max_speed/s.
    track = [
        (0.0, Box(cx=0.2, cy=0.4, w=0.12, h=0.35, conf=0.9)),
        (0.5, Box(cx=0.2, cy=0.4, w=0.12, h=0.35, conf=0.9)),
        (1.0, Box(cx=0.8, cy=0.4, w=0.12, h=0.35, conf=0.9)),
        (1.5, Box(cx=0.8, cy=0.4, w=0.12, h=0.35, conf=0.9)),
    ]
    path = _pan_path(track, 0.0, 8.0, 420, 746, SRC_W, SRC_H)
    assert path is not None
    for (ta, xa, _), (tb, xb, _) in zip(path, path[1:]):
        if tb > ta:
            speed = abs(xb - xa) / (tb - ta) / SRC_W  # fração do frame/s
            assert speed <= settings.dynamic_pan_max_speed + 1e-6


def test_shot_with_path_also_keeps_drift_and_dj_in_frame():
    wv = _wv()
    # Movimento rápido o suficiente para vencer a zona morta dentro de um
    # shot (drift lento fica por conta do recentro por shot, sem pan).
    wv.dj_track = _moving_track(0.1, 0.9, 0.0, 60.0)
    shots = build_shot_plan(wv, beats=[], duration=DURATION, src_w=SRC_W, src_h=SRC_H)
    _assert_invariants(shots)
    panned = [s for s in shots if s.path]
    assert panned, "track em movimento deve gerar pelo menos um shot com pan"
    for s in panned:
        assert s.drift > 0.0  # pan e zoom coexistem (Ken Burns)
        cw, ch, _cx, _cy = s.crop
        for tr, x, y in s.path:
            # No instante do keyframe, o centro do DJ (track crua) está dentro
            # do crop [x, x+w] × [y, y+h].
            t_abs = s.t0 + tr
            _t, box = min(wv.dj_track, key=lambda p: abs(p[0] - t_abs))
            assert x <= box.cx * SRC_W <= x + cw
            assert y <= box.cy * SRC_H <= y + ch
    # Shots de zoom estáticos continuam com push-in.
    static_zooms = [s for s in shots if s.kind not in ("wide",) and not s.path]
    for s in static_zooms:
        assert s.drift >= 0


# ---- Narrativa: story da IA e rotação com dançarino ----

def test_ai_story_drives_shot_sequence():
    ai = AIDirection(
        hype_score=0.8,
        subject="dj",
        worthy=True,
        story=[(0.0, "wide"), (12.0, "dj"), (24.0, "crowd"), (40.0, "dj")],
    )
    shots = build_shot_plan(
        _wv(), beats=[], duration=DURATION, src_w=SRC_W, src_h=SRC_H, ai=ai
    )
    _assert_invariants(shots)
    # Cada passo da story vira fronteira e comanda o kind até o próximo passo.
    for t, kind in ((12.0, "dj"), (24.0, "crowd"), (40.0, "dj")):
        hit = [s for s in shots if math.isclose(s.t0, t, abs_tol=1e-6)]
        assert hit, f"esperava fronteira da story em t={t}"
        assert hit[0].kind == kind
    assert shots[0].kind == "wide"
    for s in shots:
        if 24.0 - 1e-6 <= s.t0 < 40.0 - 1e-6:
            assert s.kind == "crowd"


def test_story_dancer_falls_back_without_box():
    # Story pede "dancer" mas ninguém dançando foi localizado → degrada para
    # o que a cena tem (crowd), nunca um kind sem box.
    ai = AIDirection(
        hype_score=0.8,
        subject="dj",
        worthy=True,
        story=[(0.0, "dj"), (20.0, "dancer")],
    )
    shots = build_shot_plan(
        _wv(), beats=[], duration=DURATION, src_w=SRC_W, src_h=SRC_H, ai=ai
    )
    _assert_invariants(shots)
    assert all(s.kind != "dancer" for s in shots)
    hit = next(s for s in shots if math.isclose(s.t0, 20.0, abs_tol=1e-6))
    assert hit.kind == "crowd"


def test_dancer_joins_post_drop_rotation():
    wv = _wv()
    wv.dancer_box = Box(cx=0.75, cy=0.65, w=0.1, h=0.3, conf=0.8)
    wv.dancer_track = _moving_track(0.7, 0.8, 0.0, 60.0, cy=0.65)
    shots = build_shot_plan(
        wv, beats=[], duration=DURATION, src_w=SRC_W, src_h=SRC_H, peak_at=5.0
    )
    _assert_invariants(shots)
    kinds = [s.kind for s in shots]
    assert "dancer" in kinds  # o dançarino entra na rotação pós-drop
    # E o dançarino nunca aparece antes do drop.
    drop = next(s for s in shots if math.isclose(s.t0, 5.0, abs_tol=1e-6))
    assert drop.kind == "dj"
    for s in shots:
        if s.t1 <= 5.0 + 1e-6:
            assert s.kind != "dancer"


# ---- Continuidade de câmera entre shots do mesmo kind ----

def _continuity_wv() -> WindowVisual:
    wv = WindowVisual()
    wv.detected = True
    wv.motion_score = 0.3
    left = Box(cx=0.3, cy=0.4, w=0.12, h=0.35, conf=0.9)
    right = Box(cx=0.7, cy=0.4, w=0.12, h=0.35, conf=0.9)
    # Track em dois clusters CONSTANTES (sem movimento dentro de cada shot,
    # então sem pan próprio) — um antes do corte pra "crowd", outro depois.
    wv.dj_track = [(float(t), left) for t in range(0, 10)] + [
        (float(t), right) for t in range(20, 30)
    ]
    wv.dj_box = left
    wv.crowd_box = Box(cx=0.5, cy=0.75, w=0.8, h=0.4, conf=1.0)
    return wv


def _continuity_shots():
    ai = AIDirection(
        hype_score=0.5,
        subject="dj",
        worthy=True,
        story=[(0.0, "dj"), (10.0, "crowd"), (20.0, "dj")],
    )
    shots = build_shot_plan(
        _continuity_wv(), beats=[], duration=DURATION, src_w=SRC_W, src_h=SRC_H, ai=ai
    )
    _assert_invariants(shots)
    # Pega o 1º shot do cluster "esquerdo" (t<10, box cx=0.3) e o 1º shot do
    # cluster "direito" (t>=20, box cx=0.7) — ambos "dj", mas com o alvo bruto
    # da track em posições bem diferentes.
    first_dj = next(s for s in shots if s.kind == "dj" and s.t0 < 10.0)
    second_dj = next(s for s in shots if s.kind == "dj" and s.t0 >= 20.0)
    return first_dj, second_dj


def test_camera_continuity_pulls_static_shot_toward_previous_position():
    _first_dj, second_dj = _continuity_shots()
    w, _h, x2, _y2 = second_dj.crop
    cx2 = (x2 + w / 2) / SRC_W
    # Sem continuidade o 2º cluster centraria perto de cx=0.7 (alvo bruto da
    # track); com a continuidade (peso default) puxando em direção ao fim do
    # 1º cluster (perto de cx=0.3), o resultado fica visivelmente abaixo disso.
    assert cx2 < 0.68


def test_camera_continuity_disabled_matches_raw_target(monkeypatch):
    monkeypatch.setattr(settings, "dynamic_camera_continuity", 0.0)
    _first_dj, second_dj = _continuity_shots()
    w, _h, x2, _y2 = second_dj.crop
    cx2 = (x2 + w / 2) / SRC_W
    assert cx2 == pytest.approx(0.7, abs=0.03)


# ---- Rosto: nudge de centralização + bônus de zoom limitado (Fase 6) ----

def test_face_anchor_only_touches_cy():
    from app.dynamic import _face_anchor

    box = Box(cx=0.4, cy=0.5, w=0.2, h=0.4, conf=0.9)
    biased = _face_anchor(box, face_bias_y=-0.3)
    assert biased.cx == box.cx and biased.w == box.w and biased.h == box.h
    assert biased.cy < box.cy  # rosto acima do centro → puxa cy pra cima


def test_face_anchor_none_bias_is_noop():
    from app.dynamic import _face_anchor

    box = Box(cx=0.4, cy=0.5, w=0.2, h=0.4, conf=0.9)
    assert _face_anchor(box, None) == box


def test_face_anchor_disabled_by_config(monkeypatch):
    from app.dynamic import _face_anchor

    monkeypatch.setattr(settings, "face_enabled", False)
    box = Box(cx=0.4, cy=0.5, w=0.2, h=0.4, conf=0.9)
    assert _face_anchor(box, -0.3) == box


def _small_dj_wv() -> WindowVisual:
    # Box de pessoa pequena o bastante pro TETO de zoom (não a margem do
    # corpo) ser o fator limitante da altura do crop — só assim o bônus de
    # zoom do rosto (que só desloca o teto) fica visível no crop resultante.
    wv = WindowVisual()
    wv.detected = True
    wv.motion_score = 0.5
    wv.dj_box = Box(cx=0.5, cy=0.4, w=0.08, h=0.15, conf=0.9)
    wv.crowd_box = Box(cx=0.5, cy=0.75, w=0.8, h=0.4, conf=1.0)
    return wv


def test_no_face_zoom_bonus_without_face_bias():
    no_face = _small_dj_wv()
    no_face.dj_face_bias_y = None  # sem rosto detectado

    with_face = _small_dj_wv()
    with_face.dj_face_bias_y = -0.2  # rosto detectado na track

    shots_no_face = build_shot_plan(
        no_face, beats=[], duration=DURATION, src_w=SRC_W, src_h=SRC_H, peak_at=30.0
    )
    shots_with_face = build_shot_plan(
        with_face, beats=[], duration=DURATION, src_w=SRC_W, src_h=SRC_H, peak_at=30.0
    )
    punch_no_face = next(s for s in shots_no_face if math.isclose(s.t0, 30.0, abs_tol=1e-6))
    punch_with_face = next(s for s in shots_with_face if math.isclose(s.t0, 30.0, abs_tol=1e-6))
    _w1, h1, _x1, _y1 = punch_no_face.crop
    _w2, h2, _x2, _y2 = punch_with_face.crop
    assert h2 < h1  # só o com rosto detectado ganha o bônus (crop menor = mais zoom)


# ---- Respiro reativo à ação (imagem parada → wide) e take fechado ----

def _samples(motion_fn, fps: float = 2.0) -> list[FrameSample]:
    """Samples sintéticos ao longo de [0, DURATION] com motion dado por t."""
    n = int(DURATION * fps)
    return [FrameSample(t=i / fps, motion=motion_fn(i / fps), persons=None) for i in range(n)]


def test_still_person_shot_becomes_wide():
    # Set agitado com um trecho que "morre" no fim (dançou e parou): nenhum
    # shot de pessoa deve segurar na região parada — vira wide de respiro.
    wv = _wv()
    wv.samples = _samples(lambda t: 0.05 if t < 40.0 else 0.001)
    shots = build_shot_plan(
        wv, beats=[], duration=DURATION, src_w=SRC_W, src_h=SRC_H, peak_at=5.0
    )
    _assert_invariants(shots)
    # Bem dentro da região morta (sem punch aqui) só cabe wide.
    dead = [s for s in shots if s.t0 >= 45.0]
    assert dead, "esperava shots na região morta"
    assert all(s.kind == "wide" for s in dead)
    # A região agitada ainda mostra o protagonista.
    assert any(s.kind == "dj" for s in shots if s.t1 <= 40.0)


def test_still_degradation_disabled_keeps_person(monkeypatch):
    # O respiro reativo tem DUAS guardas independentes: o ratio relativo (vs. a
    # atividade dos vizinhos) e o piso absoluto (trecho essencialmente
    # congelado). Desligar as duas segura o zoom em pessoa mesmo num trecho
    # parado.
    monkeypatch.setattr(settings, "dynamic_still_activity_ratio", 0.0)
    monkeypatch.setattr(settings, "dynamic_still_activity_floor", 0.0)
    wv = _wv()
    wv.samples = _samples(lambda t: 0.05 if t < 40.0 else 0.001)
    shots = build_shot_plan(
        wv, beats=[], duration=DURATION, src_w=SRC_W, src_h=SRC_H, peak_at=5.0
    )
    _assert_invariants(shots)
    # Sem o respiro reativo, a região parada volta a segurar zoom em pessoa.
    assert any(s.kind in ("dj", "crowd") for s in shots if s.t0 >= 45.0)


def test_no_samples_leaves_kinds_untouched():
    # Sem análise de movimento (visual off), nada de respiro reativo: a rotação
    # segue igual à heurística pura.
    wv = _wv()  # samples vazios
    shots = build_shot_plan(
        wv, beats=[], duration=DURATION, src_w=SRC_W, src_h=SRC_H, peak_at=5.0
    )
    _assert_invariants(shots)
    assert any(s.kind == "dj" for s in shots)


def test_high_activity_gives_tighter_take():
    # Punch-in num trecho MUITO agitado fecha mais que o mesmo punch num
    # trecho calmo (crop menor = mais zoom). Pessoa pequena → o teto de zoom é
    # o fator limitante, então o bônus fica visível no crop.
    calm = _small_dj_wv()
    calm.samples = _samples(lambda t: 0.03)
    hot = _small_dj_wv()
    hot.samples = _samples(lambda t: 0.12 if 28.0 <= t <= 40.0 else 0.03)

    shots_calm = build_shot_plan(
        calm, beats=[], duration=DURATION, src_w=SRC_W, src_h=SRC_H, peak_at=30.0
    )
    shots_hot = build_shot_plan(
        hot, beats=[], duration=DURATION, src_w=SRC_W, src_h=SRC_H, peak_at=30.0
    )
    punch_calm = next(s for s in shots_calm if math.isclose(s.t0, 30.0, abs_tol=1e-6))
    punch_hot = next(s for s in shots_hot if math.isclose(s.t0, 30.0, abs_tol=1e-6))
    _wc, hc, _xc, _yc = punch_calm.crop
    _wh, hh, _xh, _yh = punch_hot.crop
    assert hh < hc  # trecho agitado fecha mais


def test_solo_protagonist_still_gets_wide_breather():
    # Só o DJ (sem público nem dançarino): a rotação ainda intercala um wide
    # de respiro, em vez de ficar 100% colada nele.
    wv = WindowVisual()
    wv.detected = True
    wv.motion_score = 0.4
    wv.dj_box = Box(cx=0.5, cy=0.4, w=0.12, h=0.35, conf=0.9)
    shots = build_shot_plan(
        wv, beats=[], duration=DURATION, src_w=SRC_W, src_h=SRC_H
    )
    _assert_invariants(shots)
    kinds = {s.kind for s in shots}
    assert "dj" in kinds and "wide" in kinds


def test_ai_dancer_box_fills_in_without_yolo_dancer():
    # Sem dançarino do YOLO, o dancer_box da IA habilita o shot "dancer".
    ai = AIDirection(
        hype_score=0.8,
        subject="dj",
        worthy=True,
        story=[(0.0, "dj"), (20.0, "dancer")],
        dancer_box=Box(cx=0.8, cy=0.7, w=0.1, h=0.3, conf=0.5),
    )
    shots = build_shot_plan(
        _wv(), beats=[], duration=DURATION, src_w=SRC_W, src_h=SRC_H, ai=ai
    )
    _assert_invariants(shots)
    hit = next(s for s in shots if math.isclose(s.t0, 20.0, abs_tol=1e-6))
    assert hit.kind == "dancer"
    w, _h, x, _y = hit.crop
    assert x + w / 2 > SRC_W * 0.6  # enquadra o box da IA à direita


# ---- Guarda de PRESENÇA per-shot (track fraca/intermitente → troca sujeito) ----

def test_weak_dj_track_in_shot_degrades_subject():
    # dj_box existe (globalmente) mas a track só tem detecções na 1ª metade da
    # janela; na 2ª metade (buraco longo) o DJ "sumiu" — os shots de lá não
    # devem segurar zoom no DJ. Há crowd_box, então degrada para crowd/wide,
    # nunca dj.
    wv = _wv()
    left = Box(cx=0.5, cy=0.4, w=0.12, h=0.35, conf=0.9)
    wv.dj_track = [(float(t), left) for t in range(0, 28, 2)]  # só até ~28s
    shots = build_shot_plan(wv, beats=[], duration=DURATION, src_w=SRC_W, src_h=SRC_H)
    _assert_invariants(shots)
    late_dj = [s for s in shots if s.kind == "dj" and s.t0 >= 40.0]
    assert not late_dj, "DJ não deve ser enquadrado onde a track tem buraco longo"


def test_low_confidence_track_degrades_subject(monkeypatch):
    # Track presente o tempo todo mas com confiança baixa (detecções ruins de
    # cena escura): abaixo do mínimo, o kind de pessoa degrada.
    monkeypatch.setattr(settings, "dynamic_min_shot_conf", 0.5)
    wv = WindowVisual()
    wv.detected = True
    wv.motion_score = 0.5
    wv.dj_box = Box(cx=0.5, cy=0.4, w=0.12, h=0.35, conf=0.2)
    faint = Box(cx=0.5, cy=0.4, w=0.12, h=0.35, conf=0.2)  # < 0.5
    wv.dj_track = [(float(t), faint) for t in range(0, 60, 1)]
    shots = build_shot_plan(wv, beats=[], duration=DURATION, src_w=SRC_W, src_h=SRC_H)
    _assert_invariants(shots)
    # Sem crowd/dancer, dj degrada para center — nenhum shot "dj".
    assert not any(s.kind == "dj" for s in shots)


def test_ai_scene_box_skips_presence_guard():
    # Box de cena única da IA (sem track por frame): a guarda de presença é
    # pulada (não há o que medir) e o DJ continua enquadrado.
    ai = AIDirection(
        hype_score=0.8, subject="dj", worthy=True,
        dj_box=Box(cx=0.3, cy=0.4, w=0.12, h=0.35, conf=0.5),
    )
    wv = WindowVisual()  # sem dj_box/track do YOLO
    wv.detected = True
    wv.motion_score = 0.5
    shots = build_shot_plan(
        wv, beats=[], duration=DURATION, src_w=SRC_W, src_h=SRC_H,
        peak_at=30.0, ai=ai,
    )
    _assert_invariants(shots)
    assert any(s.kind == "dj" for s in shots)


def test_absolute_floor_forces_wide_in_uniformly_dead_window():
    # Janela inteira de baixa energia: o baseline relativo também é baixo, então
    # só o PISO absoluto pega o trecho congelado no fim (motion ~0).
    wv = _wv()
    wv.samples = _samples(lambda t: 0.03 if t < 40.0 else 0.0005)
    shots = build_shot_plan(
        wv, beats=[], duration=DURATION, src_w=SRC_W, src_h=SRC_H, peak_at=5.0
    )
    _assert_invariants(shots)
    dead = [s for s in shots if s.t0 >= 45.0]
    assert dead and all(s.kind == "wide" for s in dead)


# ---- Níveis de intensidade (cut_intensity) ----

def _assert_contiguous(shots):
    assert shots and shots[0].t0 == 0.0
    assert math.isclose(shots[-1].t1, DURATION, abs_tol=1e-6)
    for a, b in zip(shots, shots[1:]):
        assert math.isclose(a.t1, b.t0, abs_tol=1e-6)


def test_intensity_intense_cuts_more_than_subtle():
    wv = _wv()
    subtle = build_shot_plan(
        wv, beats=[], duration=DURATION, src_w=SRC_W, src_h=SRC_H,
        peak_at=30.0, intensity="subtle",
    )
    intense = build_shot_plan(
        wv, beats=[], duration=DURATION, src_w=SRC_W, src_h=SRC_H,
        peak_at=30.0, intensity="intense",
    )
    # Cada nível respeita SEU teto de shots (subtle=6, intense=14) — não o
    # default global; por isso a contiguidade é checada à parte.
    _assert_contiguous(subtle)
    _assert_contiguous(intense)
    assert len(subtle) <= 6
    assert len(intense) <= 14
    assert len(intense) > len(subtle)


def test_intensity_medium_matches_default():
    wv = _wv()
    default = build_shot_plan(
        wv, beats=[], duration=DURATION, src_w=SRC_W, src_h=SRC_H, peak_at=30.0
    )
    medium = build_shot_plan(
        wv, beats=[], duration=DURATION, src_w=SRC_W, src_h=SRC_H,
        peak_at=30.0, intensity="medium",
    )
    assert [(s.t0, s.t1, s.kind) for s in default] == [
        (s.t0, s.t1, s.kind) for s in medium
    ]


def test_unknown_intensity_falls_back_to_default():
    wv = _wv()
    unknown = build_shot_plan(
        wv, beats=[], duration=DURATION, src_w=SRC_W, src_h=SRC_H,
        peak_at=30.0, intensity="bogus",
    )
    _assert_invariants(unknown)


# ---- Zoom de antecipação de batida (zoom_keys) ----

def test_beat_punch_populates_zoom_keys_on_beat_shots():
    wv = _wv()
    beats = [float(b) for b in range(0, 60)]  # 1 beat/s → beats em todo shot
    shots = build_shot_plan(
        wv, beats=beats, duration=DURATION, src_w=SRC_W, src_h=SRC_H,
        peak_at=30.0, intensity="intense",
    )
    zoom_shots = [s for s in shots if s.drift and s.kind != "wide"]
    assert zoom_shots
    assert any(s.zoom_keys for s in zoom_shots)
    for s in zoom_shots:
        if s.zoom_keys:
            ts = [t for t, _z in s.zoom_keys]
            zs = [z for _t, z in s.zoom_keys]
            assert ts == sorted(ts)               # crescentes em t
            assert zs[0] == 1.0                    # começa sem zoom
            assert max(zs) <= 1.0 + abs(s.drift) + 1e-6  # teto = 1+drift


def test_beat_punch_disabled_in_subtle():
    wv = _wv()
    beats = [float(b) for b in range(0, 60)]
    shots = build_shot_plan(
        wv, beats=beats, duration=DURATION, src_w=SRC_W, src_h=SRC_H,
        peak_at=30.0, intensity="subtle",
    )
    assert all(s.zoom_keys is None for s in shots)
