"""Testes do re-rank de candidatos em `pipeline._score_candidates`.

Não batem em FFmpeg/YOLO/Supabase reais: `visual.load_model`/`analyze_window`
e `ai_director.triage_group`/`direct` são injetados fake, isolando só a
lógica de composição dos scores (local → triagem → direção profunda).
"""
import types

from app import ai_director, pipeline
from app.analyzer import Peak
from app.config import settings


def _fake_wv(score: float):
    wv = types.SimpleNamespace(visual_score=score)
    return wv


def test_score_candidates_without_ai_matches_local_score(monkeypatch):
    monkeypatch.setattr(settings, "visual_enabled", False)
    peaks = [Peak(start_sec=1.0, score=0.9), Peak(start_sec=2.0, score=0.5)]
    result = pipeline._score_candidates("video.mp4", peaks, "basic", use_ai=False)
    assert [r[3] for r in result] == [0.9, 0.5]
    assert all(r[2] is None for r in result)  # sem AIDirection


def test_score_candidates_no_api_key_skips_ai(monkeypatch):
    monkeypatch.setattr(settings, "visual_enabled", True)
    monkeypatch.setattr(settings, "anthropic_api_key", "")
    monkeypatch.setattr(pipeline.visual, "load_model", lambda: None)
    monkeypatch.setattr(
        pipeline.visual,
        "analyze_window",
        lambda *a, **k: _fake_wv(0.0),
    )
    peaks = [Peak(start_sec=1.0, score=0.8)]
    result = pipeline._score_candidates("video.mp4", peaks, "basic", use_ai=True)
    assert result[0][2] is None


def test_triage_rescues_locally_underranked_candidate(monkeypatch):
    # Candidato B tem score local mais baixo que A, mas a triagem vê muito
    # mais hype nele — deve subir e ultrapassar A no re-rank final.
    monkeypatch.setattr(settings, "visual_enabled", True)
    monkeypatch.setattr(settings, "anthropic_api_key", "fake-key")
    monkeypatch.setattr(settings, "ai_director_enabled", True)
    monkeypatch.setattr(settings, "ai_director_max_calls", 0)  # só triagem, sem direção
    monkeypatch.setattr(settings, "score_hype_lite_weight", 0.9)  # peso alto p/ o teste
    monkeypatch.setattr(pipeline.visual, "load_model", lambda: None)
    monkeypatch.setattr(
        pipeline.visual, "analyze_window", lambda *a, **k: _fake_wv(0.0)
    )

    peak_a = Peak(start_sec=10.0, score=0.9)
    peak_b = Peak(start_sec=70.0, score=0.3)

    def _fake_triage_group(video_path, windows):
        out = {}
        for key, start_sec, _dur in windows:
            if start_sec == max(0.0, peak_a.start_sec - settings.pre_roll):
                out[key] = ai_director.Triage(hype=0.1, worthy=True)
            else:
                out[key] = ai_director.Triage(hype=0.95, worthy=True)
        return out

    monkeypatch.setattr(ai_director, "triage_group", _fake_triage_group)

    result = pipeline._score_candidates(
        "video.mp4", [peak_a, peak_b], "basic", use_ai=True
    )
    # peak_b (hype alto na triagem) deve vir primeiro no re-rank.
    assert result[0][0] is peak_b
    assert result[1][0] is peak_a


def test_deep_direction_runs_on_top_k_by_adjusted_score(monkeypatch):
    monkeypatch.setattr(settings, "visual_enabled", True)
    monkeypatch.setattr(settings, "anthropic_api_key", "fake-key")
    monkeypatch.setattr(settings, "ai_director_enabled", True)
    monkeypatch.setattr(settings, "ai_triage_group_size", 0)  # sem triagem
    monkeypatch.setattr(settings, "ai_director_max_calls", 1)  # só 1 chamada de direção
    monkeypatch.setattr(pipeline.visual, "load_model", lambda: None)
    monkeypatch.setattr(
        pipeline.visual, "analyze_window", lambda *a, **k: _fake_wv(0.0)
    )

    peak_hi = Peak(start_sec=10.0, score=0.9)
    peak_lo = Peak(start_sec=70.0, score=0.1)

    calls = []

    def _fake_direct(video_path, start_sec, duration, wv):
        calls.append(start_sec)
        return ai_director.AIDirection(hype_score=0.5, worthy=True)

    monkeypatch.setattr(ai_director, "direct", _fake_direct)

    result = pipeline._score_candidates(
        "video.mp4", [peak_hi, peak_lo], "basic", use_ai=True
    )
    # Só o de maior score ajustado (peak_hi) recebeu a chamada de direção.
    assert len(calls) == 1
    assert calls[0] == max(0.0, peak_hi.start_sec - settings.pre_roll)
    hi_result = next(r for r in result if r[0] is peak_hi)
    assert hi_result[2] is not None  # AIDirection aproveitada
    lo_result = next(r for r in result if r[0] is peak_lo)
    assert lo_result[2] is None
