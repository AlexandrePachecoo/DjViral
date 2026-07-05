"""Testes do pré-processamento de baixa luz (CLAHE) em `visual.py`."""
import numpy as np
import pytest

cv2 = pytest.importorskip("cv2")

from app import visual
from app.config import settings


def _dark_frame() -> np.ndarray:
    # Frame quase preto com um pouco de ruído (evita variância zero, que
    # deixaria o CLAHE sem o que realçar).
    rng = np.random.default_rng(0)
    return (rng.integers(0, 20, size=(64, 64, 3))).astype(np.uint8)


def _bright_frame() -> np.ndarray:
    rng = np.random.default_rng(0)
    return (rng.integers(150, 255, size=(64, 64, 3))).astype(np.uint8)


def test_enhance_skips_bright_frame():
    frame = _bright_frame()
    out, is_dark = visual._maybe_enhance_low_light(frame)
    assert is_dark is False
    assert out is frame  # devolve o MESMO objeto, sem cópia/processamento


def test_enhance_processes_dark_frame():
    frame = _dark_frame()
    out, is_dark = visual._maybe_enhance_low_light(frame)
    assert is_dark is True
    assert out.shape == frame.shape
    # CLAHE aumenta o contraste local: desvio-padrão do luma sobe.
    orig_luma = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY).astype(np.float32)
    new_luma = cv2.cvtColor(out, cv2.COLOR_BGR2GRAY).astype(np.float32)
    assert new_luma.std() >= orig_luma.std()


def test_enhance_respects_threshold(monkeypatch):
    frame = _dark_frame()
    monkeypatch.setattr(settings, "visual_low_light_luma_threshold", -1.0)
    out, is_dark = visual._maybe_enhance_low_light(frame)
    assert is_dark is False
    assert out is frame


def test_analyze_window_marks_low_light(monkeypatch):
    dark = _dark_frame()
    frames = [(float(i), dark.copy()) for i in range(6)]
    monkeypatch.setattr(visual, "iter_frames", lambda *a, **k: iter(frames))
    wv = visual.analyze_window("video.mp4", 0.0, 3.0, net=None, fps=2.0)
    assert wv.low_light is True


def test_analyze_window_bright_scene_not_low_light(monkeypatch):
    bright = _bright_frame()
    frames = [(float(i), bright.copy()) for i in range(6)]
    monkeypatch.setattr(visual, "iter_frames", lambda *a, **k: iter(frames))
    wv = visual.analyze_window("video.mp4", 0.0, 3.0, net=None, fps=2.0)
    assert wv.low_light is False


def test_analyze_window_low_light_disabled_by_config(monkeypatch):
    dark = _dark_frame()
    frames = [(float(i), dark.copy()) for i in range(6)]
    monkeypatch.setattr(visual, "iter_frames", lambda *a, **k: iter(frames))
    monkeypatch.setattr(settings, "visual_low_light_enabled", False)
    wv = visual.analyze_window("video.mp4", 0.0, 3.0, net=None, fps=2.0)
    assert wv.low_light is False


# ---- Detecção de rosto (sinal de ancoragem, Fase 6) ----


@pytest.fixture(autouse=True)
def _reset_face_model_cache():
    visual._face_net = None
    visual._face_net_failed = False
    yield
    visual._face_net = None
    visual._face_net_failed = False


def test_load_face_model_missing_file_returns_none(monkeypatch):
    monkeypatch.setattr(settings, "face_model_path", "models/does_not_exist.onnx")
    assert visual.load_face_model() is None


def test_load_face_model_disabled_returns_none(monkeypatch):
    monkeypatch.setattr(settings, "face_enabled", False)
    assert visual.load_face_model() is None


def test_load_face_model_loads_real_model():
    # O modelo real está commitado em backend/models/ — carrega de verdade.
    net = visual.load_face_model()
    assert net is not None


def test_detect_face_in_region_rejects_tiny_region():
    net = visual.load_face_model()
    frame = np.zeros((100, 100, 3), dtype=np.uint8)
    box = visual.Box(cx=0.5, cy=0.5, w=0.01, h=0.01, conf=0.9)
    assert visual.detect_face_in_region(net, frame, box) is None


def test_detect_face_in_region_none_net_returns_none():
    frame = np.zeros((100, 100, 3), dtype=np.uint8)
    box = visual.Box(cx=0.5, cy=0.3, w=0.4, h=0.6, conf=0.9)
    assert visual.detect_face_in_region(None, frame, box) is None


def test_face_bias_y_none_without_faces():
    box = visual.Box(cx=0.5, cy=0.5, w=0.2, h=0.4, conf=0.9)
    pairs = [(0, box)]
    assert visual._face_bias_y(pairs, {}) is None


def test_face_bias_y_median_of_available_faces():
    box_a = visual.Box(cx=0.5, cy=0.5, w=0.2, h=0.4, conf=0.9)
    box_b = visual.Box(cx=0.5, cy=0.5, w=0.2, h=0.4, conf=0.9)
    face_a = visual.Box(cx=0.5, cy=0.4, w=0.05, h=0.08, conf=0.9)  # acima do centro
    faces = {id(box_a): face_a, id(box_b): None}
    pairs = [(0, box_a), (1, box_b)]
    bias = visual._face_bias_y(pairs, faces)
    assert bias == pytest.approx((0.4 - 0.5) / 0.4)
