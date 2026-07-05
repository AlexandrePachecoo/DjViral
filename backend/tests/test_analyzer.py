"""Testes do scoring de áudio adaptativo (baseline local + dedup de picos)."""
import numpy as np

from app.analyzer import _dedup_peaks, _pick_peaks
from app.config import settings


def test_dedup_merges_peaks_on_sustained_plateau():
    # Dois picos próximos (dentro da janela de dedup) com um vale raso entre
    # eles (mesmo platô sustentado) — funde no mais alto.
    score = np.zeros(200)
    score[50] = 0.8
    score[51:70] = 0.75  # vale raso (>= 0.85 * 0.8)
    score[70] = 0.9
    peak_idx = np.array([50, 70])
    kept = _dedup_peaks(peak_idx, score, frames_per_second=10.0)
    assert list(kept) == [70]


def test_dedup_keeps_distinct_drops():
    # Vale profundo entre os dois picos (< 0.85 * menor pico) — são momentos
    # distintos, mantém os dois.
    score = np.zeros(200)
    score[50] = 0.8
    score[51:70] = 0.1  # vale fundo
    score[70] = 0.9
    peak_idx = np.array([50, 70])
    kept = _dedup_peaks(peak_idx, score, frames_per_second=10.0)
    assert list(kept) == [50, 70]


def test_dedup_ignores_peaks_far_apart():
    score = np.zeros(500)
    score[10] = 0.5
    score[400] = 0.6
    peak_idx = np.array([10, 400])
    # Janela de dedup pequena (em frames) não alcança picos distantes.
    kept = _dedup_peaks(peak_idx, score, frames_per_second=1.0)
    assert list(kept) == [10, 400]


def test_dedup_single_peak_passthrough():
    score = np.array([0.0, 0.5, 0.0])
    kept = _dedup_peaks(np.array([1]), score, frames_per_second=10.0)
    assert list(kept) == [1]


# ---- _pick_peaks: baseline local detecta picos que um limiar global perderia ----

def test_pick_peaks_finds_bump_in_quiet_section(monkeypatch):
    # Simula um set com uma seção alta (loud) e uma seção quieta (intro), com
    # um "mini-drop" na seção quieta cujo valor absoluto fica bem abaixo da
    # média GLOBAL do set (o antigo limiar `mean*1.5` nunca o pegaria).
    fps = 10.0
    quiet = np.full(300, 0.05)
    quiet[150] = 0.15  # bump local: 3x a base da seção quieta
    loud = np.full(300, 0.8)
    loud[150] += 0.1
    score = np.concatenate([quiet, loud])

    monkeypatch.setattr(settings, "analyzer_baseline_window_seconds", 20)
    monkeypatch.setattr(settings, "analyzer_min_gap_seconds", 5)

    # O limiar global antigo (mean*1.5) não pegaria o bump da seção quieta.
    global_threshold = float(np.mean(score) * 1.5)
    assert 0.15 < global_threshold

    peak_idx = _pick_peaks(score, fps)
    assert 150 in set(int(i) for i in peak_idx)  # bump da seção quieta detectado
    assert 450 in set(int(i) for i in peak_idx)  # pico da seção alta também


def test_pick_peaks_respects_min_gap(monkeypatch):
    fps = 10.0
    score = np.zeros(500)
    score[100] = 1.0
    score[110] = 0.9  # a 1s de distância, dentro do min_gap default (30s)
    monkeypatch.setattr(settings, "analyzer_min_gap_seconds", 30)
    peak_idx = _pick_peaks(score, fps)
    assert len(peak_idx) == 1
