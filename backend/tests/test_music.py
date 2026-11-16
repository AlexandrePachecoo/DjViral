"""Testes da leitura de vibe da música (`music.classify_vibes`/`MusicProfile`)."""
import numpy as np

from app import music

H = music.HOP_SECONDS


def _env(sections):
    """``sections``: [(segundos, grave, total)] → envelopes (bass, full)."""
    bass, full = [], []
    for seconds, b, f in sections:
        n = int(seconds / H)
        bass += [b] * n
        full += [f] * n
    return np.array(bass), np.array(full)


def _runs(vibes):
    out = []
    for i, v in enumerate(vibes):
        if not out or out[-1][0] != v:
            out.append([v, i * H])
    return [(v, t) for v, t in out]


def test_breakdown_build_and_drop_are_told_apart():
    # 20 s sem grave, depois o drop: os 8 s finais do trecho sem grave são o
    # build-up; o que vem antes é calmo.
    vibes = music.classify_vibes(*_env([(20, 0.02, 0.3), (30, 0.6, 0.8)]))
    assert _runs(vibes) == [("calm", 0.0), ("build", 12.0), ("drop", 20.0)]


def test_window_without_bass_is_all_calm():
    vibes = music.classify_vibes(*_env([(30, 0.01, 0.5)]))
    assert set(vibes) == {"calm"}


def test_short_fill_does_not_break_the_drop():
    # 1 s sem bumbo no meio do drop (virada) não vira "build".
    vibes = music.classify_vibes(*_env([(20, 0.6, 0.8), (1, 0.02, 0.4), (20, 0.6, 0.8)]))
    assert set(vibes) == {"drop"}


def test_profile_reports_vibe_and_drop_starts():
    vibes = music.classify_vibes(*_env([(10, 0.02, 0.3), (20, 0.6, 0.8), (6, 0.02, 0.3), (10, 0.6, 0.8)]))
    prof = music.MusicProfile(beats=[], period=0.47, vibes=vibes)
    assert prof.drop_starts() == [10.0, 36.0]
    assert prof.vibe_at(0.0, 2.0) == "calm"
    assert prof.vibe_at(4.0, 10.0) == "build"
    assert prof.vibe_at(12.0, 20.0) == "drop"
    assert music.MusicProfile().vibe_at(0.0, 5.0) is None
