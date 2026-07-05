"""Testes do render com pan: expressão piecewise do crop e FFmpeg real."""
import math
import os
import shutil
import subprocess
import tempfile

import pytest

from app import clipper
from app.clipper import _pan_expr, _smoothstep, cut_dynamic
from app.dynamic import Shot


def _eval(expr: str, t: float) -> float:
    """Avalia a expressão FFmpeg (if/lt e aritmética) em Python.

    ``if`` é palavra reservada em Python — traduz para funções antes do eval.
    """
    py = expr.replace("if(", "_if(").replace("lt(", "_lt(")

    def _if(cond, a, b):
        return a if cond else b

    def _lt(a, b):
        return 1 if a < b else 0

    return float(eval(py, {"__builtins__": {}}, {"_if": _if, "_lt": _lt, "t": t}))


def test_pan_expr_interpolates_and_holds_edges():
    expr = _pan_expr([(1.0, 100), (3.0, 300), (5.0, 200)])
    assert _eval(expr, 0.0) == 100    # antes do 1º keyframe segura o valor
    assert _eval(expr, 1.0) == 100
    assert _eval(expr, 2.0) == pytest.approx(200)  # meio do 1º segmento
    assert _eval(expr, 4.0) == pytest.approx(250)  # meio do 2º segmento
    assert _eval(expr, 5.0) == 200    # no último keyframe
    assert _eval(expr, 9.0) == 200    # depois do último segura


def test_pan_expr_skips_degenerate_segments():
    # Dois keyframes no mesmo t: o segmento degenerado é pulado e a
    # interpolação segue do par válido (50 → 90 em [0, 2]).
    expr = _pan_expr([(0.0, 10), (0.0, 50), (2.0, 90)])
    assert _eval(expr, 1.0) == pytest.approx(70)
    assert _eval(expr, 3.0) == 90


# ---- _smoothstep: easing (ex-linear) da interpolação de pan/zoom ----

def test_smoothstep_matches_edges_and_midpoint():
    for f, expected in ((0.0, 0.0), (0.5, 0.5), (1.0, 1.0)):
        expr = _smoothstep(str(f))
        assert eval(expr, {"__builtins__": {}}, {}) == pytest.approx(expected)


def test_pan_expr_eases_away_from_linear_off_midpoint():
    # Fora do meio do segmento, o smoothstep se afasta do linear (mais devagar
    # perto das pontas) — é o que tira a sensação de velocidade constante.
    expr = _pan_expr([(0.0, 0), (4.0, 100)])
    linear_at_quarter = 25.0  # 100 * 0.25
    eased_at_quarter = _eval(expr, 1.0)  # t=1.0 é 25% do segmento [0,4]
    assert eased_at_quarter < linear_at_quarter
    assert eased_at_quarter == pytest.approx(100 * (0.25**2) * (3 - 2 * 0.25))


def test_cut_dynamic_combines_pan_and_drift_in_same_branch(monkeypatch):
    # Shot com path E drift: o filtergraph deve conter TANTO o crop com x/y
    # animado (pan) QUANTO um zoompan (zoom) na mesma branch — Ken Burns.
    captured: dict = {}

    def _fake_run(cmd, output_path, duration, error_prefix):
        captured["cmd"] = cmd

    monkeypatch.setattr(clipper, "_run_ffmpeg", _fake_run)
    shots = [
        Shot(
            t0=0.0, t1=4.0, kind="dj", crop=(150, 266, 100, 40), drift=0.06,
            path=[(0.0, 100, 40), (2.0, 300, 60), (4.0, 400, 80)],
        ),
    ]
    cut_dynamic(
        input_file="src.mp4",
        start_sec=0.0,
        output_path="out.mp4",
        shots=shots,
        duration=4,
        pre_roll=0,
        fps=30.0,
    )
    filter_complex = captured["cmd"][captured["cmd"].index("-filter_complex") + 1]
    assert "crop=150:266:x='" in filter_complex
    assert "zoompan=" in filter_complex


def test_cut_dynamic_force_static_drops_zoompan_but_keeps_pan(monkeypatch):
    captured: dict = {}

    def _fake_run(cmd, output_path, duration, error_prefix):
        captured["cmd"] = cmd

    monkeypatch.setattr(clipper, "_run_ffmpeg", _fake_run)
    shots = [
        Shot(
            t0=0.0, t1=4.0, kind="dj", crop=(150, 266, 100, 40), drift=0.06,
            path=[(0.0, 100, 40), (2.0, 300, 60), (4.0, 400, 80)],
        ),
    ]
    cut_dynamic(
        input_file="src.mp4",
        start_sec=0.0,
        output_path="out.mp4",
        shots=shots,
        duration=4,
        pre_roll=0,
        fps=30.0,
        force_static=True,
    )
    filter_complex = captured["cmd"][captured["cmd"].index("-filter_complex") + 1]
    assert "crop=150:266:x='" in filter_complex
    assert "zoompan=" not in filter_complex


@pytest.mark.skipif(shutil.which("ffmpeg") is None, reason="ffmpeg ausente")
def test_cut_dynamic_renders_shots_with_pan(monkeypatch):
    """Renderiza um clipe sintético com um shot de pan e valida o resultado.

    Exercita a expressão x/y do crop num FFmpeg REAL (sintaxe inválida
    derrubaria o filtergraph) nos dois níveis: com zoompan e force_static.
    """
    from app.config import settings

    monkeypatch.setattr(settings, "output_width", 270)
    monkeypatch.setattr(settings, "output_height", 480)

    tmp = tempfile.mkdtemp()
    src = os.path.join(tmp, "src.mp4")
    subprocess.run(
        [
            "ffmpeg", "-y", "-v", "error",
            "-f", "lavfi", "-i", "testsrc2=size=640x360:rate=30:duration=8",
            "-f", "lavfi", "-i", "sine=frequency=440:duration=8",
            "-c:v", "libx264", "-preset", "ultrafast", "-c:a", "aac",
            src,
        ],
        check=True,
    )

    shots = [
        Shot(t0=0.0, t1=4.0, kind="wide", crop=(202, 360, 220, 0)),
        Shot(
            t0=4.0, t1=8.0, kind="dj", crop=(150, 266, 100, 40),
            path=[(0.0, 100, 40), (2.0, 300, 60), (4.0, 400, 80)],
        ),
    ]
    for force_static, name in ((False, "pan.mp4"), (True, "pan_static.mp4")):
        out = os.path.join(tmp, name)
        cut_dynamic(
            input_file=src,
            start_sec=0.0,
            output_path=out,
            shots=shots,
            duration=8,
            pre_roll=0,
            fps=30.0,
            force_static=force_static,
        )
        assert os.path.exists(out) and os.path.getsize(out) > 0
        probe = subprocess.run(
            [
                "ffprobe", "-v", "error", "-show_entries", "format=duration",
                "-of", "csv=p=0", out,
            ],
            capture_output=True,
            text=True,
            check=True,
        )
        assert math.isclose(float(probe.stdout.strip()), 8.0, abs_tol=0.5)
