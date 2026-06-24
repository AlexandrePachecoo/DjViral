"""Núcleo de análise de áudio com Librosa.

Recebe um arquivo de áudio/vídeo, extrai dois sinais (RMS = energia/volume e
onset strength = impacto dos beats), combina-os num único "score de viralidade"
e devolve os timestamps dos picos mais intensos — cada um é um candidato a
clipe viral (drop, virada).

Este módulo é puro (sem dependência de FastAPI/Supabase) e pode ser testado
isoladamente.
"""
from dataclasses import dataclass

import librosa
import numpy as np
from scipy.signal import find_peaks

# Taxa de amostragem alvo. Mono em 22050 Hz é suficiente para detectar energia e
# onsets, e mantém o uso de memória aceitável mesmo em sets longos.
SAMPLE_RATE = 22050
HOP_LENGTH = 512  # default do librosa para rms/onset; usado para converter frames

# Distância mínima entre dois picos, em segundos, para não gerar clipes
# sobrepostos.
MIN_GAP_SECONDS = 30


@dataclass
class Peak:
    """Um candidato a clipe: instante (em segundos) e score de viralidade."""

    start_sec: float
    score: float


def _normalize(x: np.ndarray) -> np.ndarray:
    """Normaliza um array para o intervalo [0, 1]. Vetor constante vira zeros."""
    ptp = np.ptp(x)
    if ptp == 0:
        return np.zeros_like(x)
    return (x - x.min()) / ptp


def analyze(path: str, top_n: int = 5) -> list[Peak]:
    """Analisa o áudio em ``path`` e retorna os ``top_n`` picos mais virais.

    Os picos são ordenados por score (maior primeiro). Librosa usa
    FFmpeg/audioread por baixo, então arquivos mp4 funcionam diretamente — o
    áudio é extraído sem precisarmos demuxar à parte.
    """
    y, sr = librosa.load(path, sr=SAMPLE_RATE, mono=True)

    # Sinal 1: energia (volume médio ao longo do tempo).
    rms = librosa.feature.rms(y=y, hop_length=HOP_LENGTH)[0]
    # Sinal 2: força dos onsets (o quanto algo "bate" no áudio).
    onset_env = librosa.onset.onset_strength(y=y, sr=sr, hop_length=HOP_LENGTH)

    # onset_env e rms podem diferir em 1 frame; alinha pelo menor comprimento.
    n = min(len(rms), len(onset_env))
    rms, onset_env = rms[:n], onset_env[:n]

    # Combina os dois sinais normalizados. Um bom drop é alto em energia E em
    # impacto, então a média favorece picos que satisfazem ambos.
    score = 0.5 * _normalize(rms) + 0.5 * _normalize(onset_env)

    # find_peaks trabalha em índices de frame. Convertemos a distância mínima
    # (segundos) para frames: 1 frame ≈ HOP_LENGTH amostras.
    frames_per_second = sr / HOP_LENGTH
    min_distance = max(1, int(MIN_GAP_SECONDS * frames_per_second))

    peak_idx, _ = find_peaks(
        score,
        height=float(np.mean(score) * 1.5),
        distance=min_distance,
    )

    if len(peak_idx) == 0:
        return []

    # Ordena os picos encontrados pelo score (maior primeiro) e pega top_n.
    peak_idx = peak_idx[np.argsort(score[peak_idx])[::-1]][:top_n]

    times = librosa.frames_to_time(peak_idx, sr=sr, hop_length=HOP_LENGTH)
    return [
        Peak(start_sec=float(t), score=float(score[i]))
        for t, i in zip(times, peak_idx)
    ]
