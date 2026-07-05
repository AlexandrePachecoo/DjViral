"""Testes do diretor de IA (visão) — parsing, coerção e fallback.

Não batem na API real: injetam um cliente fake e frames fake, verificando que a
resposta do modelo vira um :class:`AIDirection` saneado e que qualquer falha
degrada para ``None`` (a IA nunca derruba o job).
"""
import types

import pytest

from app import ai_director
from app.ai_director import AIDirection, _coerce, _parse_json


# ---- _parse_json: tolerante a cercas/ruído ----

def test_parse_json_plain():
    assert _parse_json('{"hype": 0.5, "subject": "dj"}') == {
        "hype": 0.5,
        "subject": "dj",
    }


def test_parse_json_fenced():
    text = 'Claro!\n```json\n{"hype": 0.9, "subject": "crowd", "moments": [3.0]}\n```'
    out = _parse_json(text)
    assert out["hype"] == 0.9 and out["subject"] == "crowd"


def test_parse_json_garbage_returns_none():
    assert _parse_json("desculpe, não consigo") is None
    assert _parse_json("") is None


# ---- _coerce: clamp/normaliza/filtra ----

def test_coerce_clamps_and_filters():
    out = _coerce(
        {
            "hype": 1.7,
            "subject": "PALCO",  # inválido → wide
            "moments": [-2, 5.0, 5.2, 61.0, "x", 40.0],
            "worthy": False,
        },
        duration=60.0,
    )
    assert out.hype_score == 1.0
    assert out.subject == "wide"
    # 5.0 e 5.2 colam (<0.5s) → 1 só; -2 e 61 fora da janela; "x" ignorado.
    assert out.moments == [5.0, 40.0]
    assert out.worthy is False


def test_coerce_defaults_on_missing_keys():
    out = _coerce({}, duration=60.0)
    assert out.hype_score == 0.0
    assert out.subject == "wide"
    assert out.moments == []
    assert out.worthy is True  # default otimista


def test_coerce_nan_hype():
    out = _coerce({"hype": float("nan"), "subject": "dj"}, duration=60.0)
    assert out.hype_score == 0.0
    assert out.subject == "dj"


# ---- direct(): integração com cliente/frames fake ----

def _fake_client(text: str):
    """Cliente Anthropic fake cujo messages.create devolve um bloco de texto."""
    block = types.SimpleNamespace(type="text", text=text)
    message = types.SimpleNamespace(content=[block])
    messages = types.SimpleNamespace(create=lambda **kw: message)
    return types.SimpleNamespace(messages=messages)


@pytest.fixture(autouse=True)
def _reset_client():
    # Zera o cache do cliente entre testes.
    ai_director._client = None
    ai_director._client_failed = False
    yield
    ai_director._client = None
    ai_director._client_failed = False


def test_direct_happy_path(monkeypatch):
    monkeypatch.setattr(ai_director, "_get_client", lambda: _fake_client(
        '{"hype": 0.82, "subject": "crowd", "moments": [12.5], "worthy": true}'
    ))
    monkeypatch.setattr(
        ai_director, "_sample_frames", lambda *a, **k: [(0.0, "Zm9v"), (30.0, "YmFy")]
    )
    out = ai_director.direct("video.mp4", 0.0, 60.0)
    assert isinstance(out, AIDirection)
    assert out.hype_score == pytest.approx(0.82)
    assert out.subject == "crowd"
    assert out.moments == [12.5]
    assert out.worthy is True


def test_direct_no_client_returns_none(monkeypatch):
    monkeypatch.setattr(ai_director, "_get_client", lambda: None)
    assert ai_director.direct("video.mp4", 0.0, 60.0) is None


def test_direct_no_frames_returns_none(monkeypatch):
    monkeypatch.setattr(ai_director, "_get_client", lambda: _fake_client("{}"))
    monkeypatch.setattr(ai_director, "_sample_frames", lambda *a, **k: [])
    assert ai_director.direct("video.mp4", 0.0, 60.0) is None


def test_direct_api_exception_returns_none(monkeypatch):
    def _boom(**kw):
        raise RuntimeError("timeout")

    client = types.SimpleNamespace(
        messages=types.SimpleNamespace(create=_boom)
    )
    monkeypatch.setattr(ai_director, "_get_client", lambda: client)
    monkeypatch.setattr(ai_director, "_sample_frames", lambda *a, **k: [(0.0, "x")])
    assert ai_director.direct("video.mp4", 0.0, 60.0) is None


def test_direct_invalid_json_returns_none(monkeypatch):
    monkeypatch.setattr(
        ai_director, "_get_client", lambda: _fake_client("não sei dizer")
    )
    monkeypatch.setattr(ai_director, "_sample_frames", lambda *a, **k: [(0.0, "x")])
    assert ai_director.direct("video.mp4", 0.0, 60.0) is None


def test_sample_frames_swallows_ffmpeg_failure(monkeypatch):
    # Se a amostragem (ex.: ffmpeg/ffprobe ausente) explode, degrada para [] em
    # vez de propagar — a IA nunca pode derrubar o job.
    def _boom(*a, **k):
        raise FileNotFoundError("ffprobe")

    monkeypatch.setattr(ai_director.visual, "iter_frames", _boom)
    assert ai_director._sample_frames("video.mp4", 0.0, 60.0, 5) == []


def test_direct_returns_none_when_sampling_raises(monkeypatch):
    # direct() não pode propagar exceção da amostragem.
    monkeypatch.setattr(ai_director, "_get_client", lambda: _fake_client("{}"))

    def _boom(*a, **k):
        raise RuntimeError("pipe morto")

    monkeypatch.setattr(ai_director.visual, "iter_frames", _boom)
    assert ai_director.direct("video.mp4", 0.0, 60.0) is None
