"""Testes do shot plan dirigido pela IA (`camera.build_ai_shot_plan`)."""
import pytest

from app import ai_director, camera, clipper, music
from app.config import settings
from app.visual import Box

W, H = 1920, 1080


def _box(cx, cy=0.4, w=0.2, h=0.45):
    return Box(cx=cx, cy=cy, w=w, h=h, conf=0.5)


def _direction(frames, moments=(), cuts=(), crowd=()):
    return ai_director.AIDirection(
        hype_score=0.7, frames=list(frames), moments=list(moments),
        cuts=list(cuts), crowd=list(crowd),
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
        # Fechado = o box da IA sem folga, limitado ao que a fonte 1080p
        # aguenta sem borrar (ampliação máxima até a saída).
        min_crop_h = settings.output_height / settings.dynamic_max_upscale
        assert punch.crop[1] == pytest.approx(min_crop_h, abs=2)


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


# ---- resolução: o zoom respeita o que a fonte aguenta ----

def test_zoom_is_capped_by_source_resolution():
    frames = _frames([("dj", _box(0.5, h=0.2))] * 12)
    for src_w, src_h in ((1280, 720), (1920, 1080), (3840, 2160)):
        shots = camera.build_ai_shot_plan(_direction(frames), [], 60.0, src_w, src_h, peak_at=5.0)
        upscale = max(settings.output_height / s.crop[1] for s in shots)
        assert upscale <= max(
            settings.dynamic_max_upscale, settings.output_height / src_h
        ) + 0.02
    # 4K tem pixel de sobra: o plano fechado usa o zoom máximo configurado.
    assert min(s.crop[1] for s in shots) == pytest.approx(
        2160 / settings.dynamic_zoom_max, abs=2
    )


# ---- gravação multicâmera: cada tomada é planejada sozinha ----

def test_source_camera_cuts_split_the_plan_and_boxes_stay_in_their_take():
    # Câmera A (0-20 s): DJ à esquerda. Câmera B (20-60 s): DJ à direita.
    spec = [("dj", _box(0.2))] * 4 + [("dj", _box(0.8))] * 8
    shots = camera.build_ai_shot_plan(
        _direction(_frames(spec), cuts=[20.0]), [], 60.0, W, H
    )
    _assert_valid(shots)
    assert any(s.t1 == 20.0 for s in shots)  # nenhum shot atravessa a troca
    for s in shots:
        center = (s.crop[2] + s.crop[0] / 2) / W
        assert center == pytest.approx(0.2 if s.t1 <= 20.0 else 0.8, abs=0.03)
        # Nenhum pan viaja de um ângulo para o outro.
        if s.path:
            xs = [(x + s.crop[0] / 2) / W for _t, x, _y in s.path]
            assert max(xs) - min(xs) < 0.1


def test_take_the_ai_did_not_see_falls_back_to_a_wide_shot():
    frames = _frames([("dj", _box(0.2))] * 4)  # só há frames até 17.5 s
    shots = camera.build_ai_shot_plan(
        _direction(frames, cuts=[20.0]), [], 60.0, W, H
    )
    _assert_valid(shots)
    assert {s.kind for s in shots if s.t0 >= 20.0} == {"wide"}


def test_heavily_edited_source_becomes_a_reframe_following_each_take():
    # Um corte da gravação a cada 2 s: não cabem shots próprios.
    cuts = [2.0 * i for i in range(1, 30)]
    frames = [(2.0 * i + 1.0, "dj", _box(0.2 if i % 2 else 0.8)) for i in range(30)]
    shots = camera.build_ai_shot_plan(_direction(frames, cuts=cuts), [], 60.0, W, H)
    _assert_valid(shots)
    assert len(shots) == 1 and shots[0].kind == "reframe"
    assert shots[0].crop[1] == H and not shots[0].drift  # altura cheia, sem zoom
    # O crop salta junto com cada troca (um frame de transição, não um pan).
    path = shots[0].path
    jumps = [(b[0] - a[0]) for a, b in zip(path, path[1:]) if a[1] != b[1]]
    assert len(jumps) == 29 and max(jumps) <= 0.04


# ---- planos de reação do público ----

def test_crowd_reaction_shots_appear_even_when_the_ai_stayed_on_the_dj():
    frames = _frames([("dj", _box(0.5))] * 12)
    crowd = [(t, _box(0.3, 0.8, 0.9, 0.3)) for t, _f, _b in frames]
    shots = camera.build_ai_shot_plan(_direction(frames, crowd=crowd), [], 60.0, W, H)
    _assert_valid(shots)
    kinds = [s.kind for s in shots]
    assert kinds.count("crowd") >= len(shots) // 4
    # Nunca mais de CROWD_EVERY shots seguidos sem a pista.
    run = 0
    for k in kinds:
        run = 0 if k == "crowd" else run + 1
        assert run <= camera.CROWD_EVERY
    # O plano de reação mira onde a IA disse que o público está.
    crowd_shot = next(s for s in shots if s.kind == "crowd")
    assert (crowd_shot.crop[2] + crowd_shot.crop[0] / 2) / W == pytest.approx(0.3, abs=0.05)


def test_no_crowd_position_means_no_forced_reaction():
    shots = camera.build_ai_shot_plan(
        _direction(_frames([("dj", _box(0.5))] * 12)), [], 60.0, W, H
    )
    assert "crowd" not in {s.kind for s in shots}


# ---- zoom pela vibe da música ----

def _profile(sections, period=0.47):
    """``sections``: [(segundos, vibe)] → MusicProfile com batidas regulares."""
    vibes = [v for seconds, v in sections for _ in range(int(seconds / music.HOP_SECONDS))]
    total = sum(sec for sec, _v in sections)
    beats = [i * period for i in range(int(total / period))]
    return music.MusicProfile(beats=beats, period=period, vibes=vibes)


def test_zoom_follows_the_music_vibe(monkeypatch):
    # Teto de shots folgado: o que se mede aqui é o ritmo que a vibe pede.
    monkeypatch.setattr(settings, "dynamic_max_shots", 20)
    prof = _profile([(12, "calm"), (8, "build"), (40, "drop")])
    shots = camera.build_ai_shot_plan(
        _direction(_frames([("dj", _box(0.5))] * 12)), prof.beats, 60.0, W, H, music=prof
    )
    _assert_valid(shots)
    by_vibe = {v: [s for s in shots if prof.vibe_at(s.t0, s.t1) == v] for v in ("calm", "build", "drop")}
    assert all(by_vibe.values())
    # Calmo: deriva lenta, sem pulso. Build: fecha mais que o normal e acelera.
    assert all(s.pulse is None and s.drift < settings.dynamic_drift for s in by_vibe["calm"])
    build = by_vibe["build"][-1]
    assert build.drift >= settings.build_zoom and build.pulse is None
    (_t0, z0), (t_mid, z_mid), (t_end, z_end) = build.zoom_keys
    assert (z_mid - z0) / t_mid < (z_end - z_mid) / (t_end - t_mid)
    # Drop: pulso na batida, em fase com um beat do shot.
    for s in by_vibe["drop"]:
        period, phase, amount = s.pulse
        assert amount == settings.beat_pulse_amount
        assert period == pytest.approx(0.47 * settings.beat_pulse_every, abs=0.01)
        assert any(abs((s.t0 + phase) - b) < 0.01 for b in prof.beats)
    # A virada para o drop é um corte com plano fechado no artista.
    drop_cut = next(s for s in shots if abs(s.t0 - 20.0) < 0.5)
    assert drop_cut.kind == "dj"
    assert drop_cut.crop[1] == min(s.crop[1] for s in shots)
    # No drop os planos são mais curtos que no trecho calmo.
    longest = lambda group: max(s.t1 - s.t0 for s in group)  # noqa: E731
    assert longest(by_vibe["drop"]) <= settings.dynamic_shot_max * camera.DROP_SHOT_SCALE + 0.6


def test_build_up_stays_on_the_artist():
    prof = _profile([(30, "calm"), (8, "build"), (22, "drop")])
    frames = _frames([("dj", _box(0.5))] * 12)
    crowd = [(t, _box(0.3, 0.8, 0.9, 0.3)) for t, _f, _b in frames]
    shots = camera.build_ai_shot_plan(
        _direction(frames, crowd=crowd), prof.beats, 60.0, W, H, music=prof
    )
    assert all(s.kind == "dj" for s in shots if prof.vibe_at(s.t0, s.t1) == "build")


def test_intensity_scales_the_beat_pulse():
    prof = _profile([(60, "drop")])
    amounts = {}
    for level in ("subtle", "medium", "intense"):
        shots = camera.build_ai_shot_plan(
            _direction(_frames([("dj", _box(0.5))] * 12)), prof.beats, 60.0, W, H,
            intensity=level, music=prof,
        )
        amounts[level] = max(s.pulse[2] for s in shots if s.pulse)
    assert amounts["subtle"] < amounts["medium"] < amounts["intense"]


def test_pulse_is_rendered_into_the_zoom_expression(monkeypatch, tmp_path):
    captured = {}
    monkeypatch.setattr(
        clipper, "_run_ffmpeg", lambda cmd, *a, **k: captured.setdefault("cmd", cmd)
    )
    shot = camera.Shot(
        t0=0.0, t1=6.0, kind="dj", crop=(608, 1080, 656, 0), drift=0.06,
        pulse=(0.94, 0.2, 0.05),
    )
    clipper.cut_dynamic("in.mp4", 0, str(tmp_path / "o.mp4"), [shot], duration=6, pre_roll=0)
    graph = captured["cmd"][captured["cmd"].index("-filter_complex") + 1]
    assert "+0.0500*exp(-4*mod(on/30-0.200+" in graph and ",0.9400)/0.9400)" in graph
    # No fallback sem zoompan o pulso some junto com o zoom.
    captured.clear()
    clipper.cut_dynamic(
        "in.mp4", 0, str(tmp_path / "o.mp4"), [shot], duration=6, pre_roll=0,
        force_static=True,
    )
    assert "exp(" not in captured["cmd"][captured["cmd"].index("-filter_complex") + 1]
