"""Testes de `build_shot_plan` com a direção de IA (subject + moments)."""
import math

from app.ai_director import AIDirection
from app.dynamic import _pan_path, build_shot_plan
from app.visual import Box, WindowVisual
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


def test_shot_with_path_has_zero_drift_and_keeps_dj_in_frame():
    wv = _wv()
    # Movimento rápido o suficiente para vencer a zona morta dentro de um
    # shot (drift lento fica por conta do recentro por shot, sem pan).
    wv.dj_track = _moving_track(0.1, 0.9, 0.0, 60.0)
    shots = build_shot_plan(wv, beats=[], duration=DURATION, src_w=SRC_W, src_h=SRC_H)
    _assert_invariants(shots)
    panned = [s for s in shots if s.path]
    assert panned, "track em movimento deve gerar pelo menos um shot com pan"
    for s in panned:
        assert s.drift == 0.0  # pan e zoompan não compõem
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
