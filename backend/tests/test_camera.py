"""Testes do shot plan dirigido pela IA (`camera.build_ai_shot_plan`)."""
import pytest

from app import ai_director, camera
from app.config import settings
from app.visual import Box

W, H = 1920, 1080


def _box(cx, cy=0.4, w=0.2, h=0.45):
    return Box(cx=cx, cy=cy, w=w, h=h, conf=0.5)


def _direction(frames, moments=()):
    return ai_director.AIDirection(
        hype_score=0.7, frames=list(frames), moments=list(moments)
    )


def _frames(spec):
    """``spec``: lista de (focus, box) → um frame a cada 5 s a partir de 2.5 s."""
    return [(2.5 + 5.0 * i, focus, box) for i, (focus, box) in enumerate(spec)]


def _assert_valid(shots, duration=60.0):
    assert shots[0].t0 == 0.0 and shots[-1].t1 == duration
    for a, b in zip(shots, shots[1:]):
        assert a.t1 == b.t0  # contíguos (exigência do concat do render)
    for s in shots:
        w, h, x, y = s.crop
        assert w % 2 == 0 and h % 2 == 0
        assert 0 <= x <= W - w and 0 <= y <= H - h
        assert w / h == pytest.approx(9 / 16, abs=0.01)


def test_no_frames_returns_empty_plan():
    assert camera.build_ai_shot_plan(_direction([]), [], 60.0, W, H) == []


def test_shots_follow_the_focus_the_ai_chose():
    spec = [("wide", None)] * 3 + [("dj", _box(0.3))] * 4 + [("crowd", _box(0.6, 0.8, 0.9, 0.3))] * 5
    shots = camera.build_ai_shot_plan(_direction(_frames(spec)), [], 60.0, W, H)
    _assert_valid(shots)
    kinds = [s.kind for s in shots]
    # A ordem dos focos pedidos é preservada (planos longos só se subdividem).
    assert [k for i, k in enumerate(kinds) if i == 0 or k != kinds[i - 1]] == [
        "wide", "dj", "crowd"
    ]
    # O shot do DJ enquadra onde a IA disse que ele está (x ~0.3 do frame).
    dj = next(s for s in shots if s.kind == "dj")
    assert (dj.crop[2] + dj.crop[0] / 2) / W == pytest.approx(0.3, abs=0.03)


def test_long_single_focus_is_split_and_alternates_zoom():
    shots = camera.build_ai_shot_plan(
        _direction(_frames([("dj", _box(0.5))] * 12)), [], 60.0, W, H
    )
    _assert_valid(shots)
    assert len(shots) >= 60.0 / settings.dynamic_shot_max
    assert all(s.t1 - s.t0 <= settings.dynamic_shot_max + 1e-6 for s in shots)
    # Partes vizinhas alternam normal ↔ fechado (crop menor = mais zoom).
    assert shots[1].crop[1] < shots[0].crop[1]


def test_drop_and_moments_cut_to_a_tight_shot_on_the_artist():
    # A IA pediu wide o tempo todo, mas localizou o DJ num frame: no drop o
    # plano fecha nele.
    spec = [("wide", None)] * 6 + [("dj", _box(0.7))] + [("wide", None)] * 5
    shots = camera.build_ai_shot_plan(
        _direction(_frames(spec), moments=[20.0]), [], 60.0, W, H, peak_at=5.0
    )
    _assert_valid(shots)
    for t in (5.0, 20.0):
        punch = next(s for s in shots if s.t0 == t)
        assert punch.kind == "dj"
        # Fechado = o box da IA sem folga, limitado ao zoom máximo.
        assert punch.crop[1] == pytest.approx(H / settings.dynamic_zoom_max, abs=2)


def test_cuts_snap_to_beats_and_respect_min_shot():
    spec = [("dj", _box(0.4))] * 2 + [("crowd", _box(0.5, 0.8, 0.9, 0.3))] * 10
    beats = [i * 0.5 + 0.2 for i in range(120)]
    shots = camera.build_ai_shot_plan(_direction(_frames(spec)), beats, 60.0, W, H)
    _assert_valid(shots)
    assert shots[1].t0 in [pytest.approx(b) for b in beats]
    assert all(s.t1 - s.t0 >= settings.dynamic_shot_min - 1e-6 for s in shots)
    assert len(shots) <= settings.dynamic_max_shots


def test_focus_without_box_degrades_to_wide():
    shots = camera.build_ai_shot_plan(
        _direction(_frames([("dancer", None)] * 12)), [], 60.0, W, H
    )
    _assert_valid(shots)
    assert {s.kind for s in shots} == {"wide"}


def test_camera_pans_when_the_subject_moves_inside_a_shot():
    spec = [("dj", _box(0.2 + 0.06 * i)) for i in range(12)]
    shots = camera.build_ai_shot_plan(_direction(_frames(spec)), [], 60.0, W, H)
    _assert_valid(shots)
    assert any(s.path for s in shots)
