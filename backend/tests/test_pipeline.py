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
    result = pipeline._score_candidates("video.mp4", peaks, "basic", ai_tier="off")
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
    result = pipeline._score_candidates("video.mp4", peaks, "basic", ai_tier="full")
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
        "video.mp4", [peak_a, peak_b], "basic", ai_tier="full"
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
        "video.mp4", [peak_hi, peak_lo], "basic", ai_tier="full"
    )
    # Só o de maior score ajustado (peak_hi) recebeu a chamada de direção.
    assert len(calls) == 1
    assert calls[0] == max(0.0, peak_hi.start_sec - settings.pre_roll)
    hi_result = next(r for r in result if r[0] is peak_hi)
    assert hi_result[2] is not None  # AIDirection aproveitada
    lo_result = next(r for r in result if r[0] is peak_lo)
    assert lo_result[2] is None


# ---- tiers de IA: 'lite' faz triagem sem direção profunda ----

def test_lite_tier_runs_triage_but_not_deep_direction(monkeypatch):
    monkeypatch.setattr(settings, "visual_enabled", True)
    monkeypatch.setattr(settings, "anthropic_api_key", "fake-key")
    monkeypatch.setattr(settings, "ai_director_enabled", True)
    monkeypatch.setattr(pipeline.visual, "load_model", lambda: None)
    monkeypatch.setattr(
        pipeline.visual, "analyze_window", lambda *a, **k: _fake_wv(0.0)
    )

    triage_calls: list = []
    direct_calls: list = []
    monkeypatch.setattr(
        ai_director,
        "triage_group",
        lambda vp, w: (triage_calls.append(w) or {}),
    )
    monkeypatch.setattr(
        ai_director, "direct", lambda *a, **k: direct_calls.append(a)
    )

    pipeline._score_candidates(
        "video.mp4", [Peak(start_sec=1.0, score=0.8)], "basic", ai_tier="lite"
    )
    assert triage_calls  # a triagem (barata) rodou no tier lite
    assert direct_calls == []  # a direção profunda (cara) NÃO rodou


def test_off_tier_runs_no_ai_at_all(monkeypatch):
    monkeypatch.setattr(settings, "visual_enabled", True)
    monkeypatch.setattr(settings, "anthropic_api_key", "fake-key")
    monkeypatch.setattr(settings, "ai_director_enabled", True)
    monkeypatch.setattr(pipeline.visual, "load_model", lambda: None)
    monkeypatch.setattr(
        pipeline.visual, "analyze_window", lambda *a, **k: _fake_wv(0.0)
    )

    triage_calls: list = []
    monkeypatch.setattr(
        ai_director, "triage_group", lambda vp, w: (triage_calls.append(w) or {})
    )
    pipeline._score_candidates(
        "video.mp4", [Peak(start_sec=1.0, score=0.8)], "basic", ai_tier="off"
    )
    assert triage_calls == []  # nenhum estágio de IA no tier off


# ---- títulos virais: gating por tier ----

def test_generate_titles_off_tier_skips_ai(monkeypatch):
    monkeypatch.setattr(settings, "anthropic_api_key", "fake-key")
    monkeypatch.setattr(settings, "ai_director_enabled", True)
    called: list = []
    monkeypatch.setattr(
        ai_director, "title_group", lambda vp, w: called.append(w) or {"x": "y"}
    )
    cands = [(Peak(start_sec=1.0, score=0.9), None, None, 0.9)]
    assert pipeline._generate_titles("video.mp4", cands, "off") == {}
    assert called == []  # tier off nunca chama a IA de títulos


def test_generate_titles_lite_tier_calls_title_group(monkeypatch):
    monkeypatch.setattr(settings, "anthropic_api_key", "fake-key")
    monkeypatch.setattr(settings, "ai_director_enabled", True)
    peak = Peak(start_sec=10.0, score=0.9)
    monkeypatch.setattr(
        ai_director, "title_group", lambda vp, windows: {windows[0][0]: "hook 🔥"}
    )
    cands = [(peak, None, None, 0.9)]
    out = pipeline._generate_titles("video.mp4", cands, "lite")
    assert out == {id(peak): "hook 🔥"}


def test_generate_titles_reuses_triage_titles(monkeypatch):
    # Título que a triagem já deu não gera chamada extra; só o corte sem
    # título passa pelo title_group.
    monkeypatch.setattr(settings, "anthropic_api_key", "fake-key")
    monkeypatch.setattr(settings, "ai_director_enabled", True)
    has, lacks = Peak(start_sec=10.0, score=0.9), Peak(start_sec=90.0, score=0.8)
    asked: list = []

    def _title_group(vp, windows):
        asked.extend(w[0] for w in windows)
        return {windows[0][0]: "fallback"}

    monkeypatch.setattr(ai_director, "title_group", _title_group)
    cands = [(has, None, None, 0.9), (lacks, None, None, 0.8)]
    out = pipeline._generate_titles(
        "video.mp4", cands, "lite", known={id(has): "da triagem 🔥"}
    )
    assert asked == [id(lacks)]
    assert out == {id(has): "da triagem 🔥", id(lacks): "fallback"}


# ---- funil: triagem antes da análise visual pesada ----

def test_visual_analysis_runs_only_on_triage_shortlist(monkeypatch):
    monkeypatch.setattr(settings, "visual_enabled", True)
    monkeypatch.setattr(settings, "anthropic_api_key", "fake-key")
    monkeypatch.setattr(settings, "ai_director_enabled", True)
    monkeypatch.setattr(settings, "visual_shortlist_factor", 1.0)
    monkeypatch.setattr(settings, "score_hype_lite_weight", 0.5)
    monkeypatch.setattr(pipeline.visual, "load_model", lambda: None)
    analyzed: list = []
    monkeypatch.setattr(
        pipeline.visual,
        "analyze_window",
        lambda vp, start, *a, **k: analyzed.append(start) or _fake_wv(0.0),
    )
    # 4 candidatos com música parecida; a triagem só vê hype no 2º e no 4º.
    peaks = [Peak(start_sec=100.0 * (i + 1), score=0.5) for i in range(4)]
    hot = {id(peaks[1]), id(peaks[3])}
    monkeypatch.setattr(
        ai_director,
        "triage_group",
        lambda vp, windows: {
            key: ai_director.Triage(hype=0.9 if key in hot else 0.1, title=f"t{key}")
            for key, _s, _d in windows
        },
    )
    titles: dict = {}
    result = pipeline._score_candidates(
        "video.mp4", peaks, "basic", ai_tier="lite", n_final=2, titles_out=titles
    )
    # YOLO só nas 2 janelas da shortlist; as outras 2 nem são decodificadas.
    assert sorted(analyzed) == [195.0, 395.0]
    assert {id(r[0]) for r in result[:2]} == hot
    assert len(result) == 4 and all(r[1] is None for r in result[2:])
    assert set(titles) == {id(p) for p in peaks}


def test_without_triage_every_candidate_gets_visual_analysis(monkeypatch):
    # IA desligada: sem shortlist, comportamento antigo (todos analisados).
    monkeypatch.setattr(settings, "visual_enabled", True)
    monkeypatch.setattr(pipeline.visual, "load_model", lambda: None)
    analyzed: list = []
    monkeypatch.setattr(
        pipeline.visual,
        "analyze_window",
        lambda vp, start, *a, **k: analyzed.append(start) or _fake_wv(0.5),
    )
    peaks = [Peak(start_sec=100.0 * (i + 1), score=0.5) for i in range(4)]
    pipeline._score_candidates("video.mp4", peaks, "basic", ai_tier="off", n_final=2)
    assert len(analyzed) == 4
