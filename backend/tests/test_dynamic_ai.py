"""Testes de `build_shot_plan` com a direção de IA (subject + moments)."""
import math

from app.ai_director import AIDirection
from app.dynamic import build_shot_plan
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
