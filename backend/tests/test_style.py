"""Testes do estilo de edição: saneamento, filtros, legendas e o 2º passe."""
import os
import shutil
import subprocess

import pytest

from app import captions, clipper, pipeline
from app.style import (
    StyleContext,
    build_captions,
    build_video_filters,
    coerce_style,
)


def test_coerce_none_and_garbage():
    assert coerce_style(None) is None
    assert coerce_style({}) is None
    assert coerce_style("hype") is None


def test_coerce_keeps_valid_fields_and_drops_invalid():
    st = coerce_style({
        "transition": "flash", "color": "sepia-inexistente", "beat_pulse": 7,
        "drop_fx": "shake", "unknown": 1,
        "captions": {"hook": True, "color": "red", "size": "xl", "handle": "  @dj   fulano "},
    })
    assert st.transition == "flash" and st.drop_fx == "shake"
    assert st.color == "none"  # inválido → default, sem derrubar o resto
    assert st.beat_pulse == 1.0  # clampado
    assert st.captions.hook is True
    assert st.captions.color == "#FFFFFF" and st.captions.size == "m"
    assert st.captions.handle == "@dj fulano"


def test_noop_style():
    assert coerce_style({"transition": "cut"}).is_noop()
    assert not coerce_style({"color": "bw"}).is_noop()
    assert not coerce_style({"captions": {"handle": "@x"}}).is_noop()


def _ctx(**kw):
    base = dict(duration=20.0, cuts=[0.0, 5.0, 10.0, 19.99], drop=5.0,
                beat_period=0.5, beat_phase=0.1)
    base.update(kw)
    return StyleContext(**base)


def test_filters_flash_only_on_inner_cuts():
    f = build_video_filters(coerce_style({"transition": "flash"}), _ctx())
    assert len(f) == 1 and f[0].startswith("eq=brightness=")
    assert "t-5.000" in f[0] and "t-10.000" in f[0]
    assert "t-0.000" not in f[0] and "19.99" not in f[0]  # bordas do clipe fora


def test_filters_beat_pulse_needs_known_period():
    st = coerce_style({"beat_pulse": 0.5})
    assert build_video_filters(st, _ctx(beat_period=0.0)) == []
    assert "mod(" in build_video_filters(st, _ctx())[0]


def test_filters_drop_fx_skipped_without_drop():
    st = coerce_style({"drop_fx": "shake"})
    assert build_video_filters(st, _ctx(drop=None)) == []
    assert any(f.startswith("crop=") for f in build_video_filters(st, _ctx()))


def test_filters_glitch_and_grade():
    f = build_video_filters(
        coerce_style({"transition": "glitch", "color": "bw", "grain": True}), _ctx()
    )
    assert f[0] == "hue=s=0"
    assert any(x.startswith("rgbashift=") and "enable=" in x for x in f)
    assert f[-1].startswith("noise=")


def test_captions_hook_teaser_handle():
    st = coerce_style({"captions": {
        "hook": True, "teaser_text": "espera o drop 👀", "handle": "@djFulano",
    }})
    caps = build_captions(st, _ctx(), "quando o drop bateu 🔥")
    hook, teaser, handle = caps
    assert hook.text == "QUANDO O DROP BATEU" and hook.t0 == 0.0  # sem emoji
    assert teaser.text == "ESPERA O DROP" and teaser.t1 == 5.0
    assert teaser.position == "center"  # não disputa o topo com o hook
    assert handle.text == "@djFulano" and handle.small and handle.t1 == 20.0


def test_captions_hook_needs_real_title_and_teaser_needs_drop():
    st = coerce_style({"captions": {"hook": True, "teaser_text": "vai"}})
    assert build_captions(st, _ctx(drop=None), None) == []


@pytest.mark.skipif(
    shutil.which("ffmpeg") is None or not captions.available(),
    reason="precisa de ffmpeg + Pillow + fonte",
)
def test_apply_style_end_to_end(tmp_path):
    src, out = str(tmp_path / "in.mp4"), str(tmp_path / "out.mp4")
    subprocess.run(
        ["ffmpeg", "-y", "-loglevel", "error",
         "-f", "lavfi", "-i", "testsrc2=size=270x480:rate=15:duration=6",
         "-f", "lavfi", "-i", "sine=frequency=220:duration=6",
         "-pix_fmt", "yuv420p", "-shortest", src],
        check=True,
    )
    st = coerce_style({
        "transition": "flash", "color": "cinematic", "vignette": True,
        "beat_pulse": 0.6, "drop_fx": "shake",
        "captions": {"hook": True, "teaser_text": "espera", "handle": "@dj"},
    })
    ctx = StyleContext(duration=6.0, cuts=[2.0, 4.0], drop=3.0,
                       beat_period=0.5, beat_phase=0.0)
    assert clipper.apply_style(src, out, st, ctx, "um título qualquer") is True
    probe = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries",
         "format=duration:stream=codec_type,width,height", "-of", "csv=p=0", out],
        capture_output=True, text=True, check=True,
    ).stdout
    assert "video,270,480" in probe and "audio" in probe
    assert abs(float(probe.strip().splitlines()[-1]) - 6.0) < 0.3


def test_apply_style_returns_false_when_nothing_to_do(tmp_path):
    st = coerce_style({"captions": {"hook": True}})  # hook sem título → nada
    assert clipper.apply_style("x.mp4", str(tmp_path / "o.mp4"), st, _ctx(), None) is False


# ---- pipeline._apply_edit_style: nunca perde o clipe ----


def test_pipeline_style_replaces_clip_on_success(monkeypatch, tmp_path):
    clip = tmp_path / "c.mp4"
    clip.write_bytes(b"orig")
    seen = {}

    def _fake_apply(inp, outp, style, ctx, title):
        seen["ctx"] = ctx
        with open(outp, "wb") as fh:
            fh.write(b"styled")
        return True

    monkeypatch.setattr(clipper, "apply_style", _fake_apply)
    shots = [type("S", (), {"t0": t})() for t in (0.0, 4.0, 9.0)]
    pipeline._apply_edit_style(
        "v.mp4", str(clip), coerce_style({"transition": "flash"}), 100.0, 20.0,
        shots=shots, beats=[0.2, 0.7, 1.2, 1.7], drop=5.0, bpm=120,
    )
    assert clip.read_bytes() == b"styled"
    assert seen["ctx"].cuts == [4.0, 9.0]
    assert seen["ctx"].beat_period == pytest.approx(0.5)
    assert seen["ctx"].beat_phase == pytest.approx(0.2)


def test_pipeline_style_keeps_clip_on_failure(monkeypatch, tmp_path):
    clip = tmp_path / "c.mp4"
    clip.write_bytes(b"orig")

    def _boom(*a, **k):
        raise RuntimeError("ffmpeg morreu")

    monkeypatch.setattr(clipper, "apply_style", _boom)
    pipeline._apply_edit_style(
        "v.mp4", str(clip), coerce_style({"color": "bw"}), 0.0, 20.0
    )
    assert clip.read_bytes() == b"orig"
    assert os.listdir(tmp_path) == ["c.mp4"]


def test_pipeline_style_skips_noop_and_none(monkeypatch, tmp_path):
    called = []
    monkeypatch.setattr(clipper, "apply_style", lambda *a, **k: called.append(1))
    pipeline._apply_edit_style("v.mp4", "c.mp4", None, 0.0, 20.0)
    pipeline._apply_edit_style("v.mp4", "c.mp4", coerce_style({"transition": "cut"}), 0.0, 20.0)
    assert called == []
