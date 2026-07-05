"""Testes do render com pan: expressão piecewise do crop e FFmpeg real."""
import math
import os
import shutil
import subprocess
import tempfile

import pytest

from app.clipper import _pan_expr, cut_dynamic
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
