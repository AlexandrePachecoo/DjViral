"""Núcleo de análise de áudio com Librosa.

Recebe um arquivo de áudio/vídeo, extrai três sinais (RMS = energia/volume,
onset strength = impacto dos beats e contraste de energia pré/pós drop),
combina-os num único "score de viralidade" e devolve os timestamps dos picos
mais intensos — cada um é um candidato a clipe viral (drop, virada). Também
estima o BPM global do set.

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

# Janela (em segundos) usada para medir o contraste de energia em torno de um
# drop: comparamos a energia média logo depois vs. logo antes de cada frame.
CONTRAST_WINDOW_SECONDS = 4


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


def _energy_contrast(energy: np.ndarray, window: int) -> np.ndarray:
    """Contraste de energia: média à frente menos média atrás de cada frame.

    Um drop é energia baixa (buildup/silêncio) seguida de uma explosão, então
    esse delta é alto justamente nos drops. Quedas de energia (delta negativo)
    são zeradas — não interessam como candidatas a corte.
    """
    if window < 1 or len(energy) == 0:
        return np.zeros_like(energy)
    # Média móvel (box filter) e a comparamos deslocada ~uma janela para cada
    # lado, medindo o salto de energia em torno do frame.
    kernel = np.ones(window) / window
    smoothed = np.convolve(energy, kernel, mode="same")
    behind = np.roll(smoothed, window)
    ahead = np.roll(smoothed, -window)
    return np.clip(ahead - behind, 0, None)


def analyze(path: str, top_n: int = 30) -> tuple[list[Peak], int]:
    """Analisa o áudio em ``path`` e retorna ``(picos, bpm)``.

    Devolve os até ``top_n`` picos mais virais (ordenados por score, maior
    primeiro) e o BPM global estimado do set. Librosa usa FFmpeg/audioread por
    baixo, então arquivos mp4 funcionam diretamente — o áudio é extraído sem
    precisarmos demuxar à parte.
    """
    y, sr = librosa.load(path, sr=SAMPLE_RATE, mono=True)

    # Sinal 1: energia (volume médio ao longo do tempo).
    rms = librosa.feature.rms(y=y, hop_length=HOP_LENGTH)[0]
    # Sinal 2: força dos onsets (o quanto algo "bate" no áudio).
    onset_env = librosa.onset.onset_strength(y=y, sr=sr, hop_length=HOP_LENGTH)

    # onset_env e rms podem diferir em 1 frame; alinha pelo menor comprimento.
    n = min(len(rms), len(onset_env))
    rms, onset_env = rms[:n], onset_env[:n]

    # BPM global do set (reaproveita o onset_env já calculado, sem recarregar).
    tempo = librosa.beat.beat_track(
        onset_envelope=onset_env, sr=sr, hop_length=HOP_LENGTH
    )[0]
    bpm = int(round(float(np.atleast_1d(tempo)[0])))

    frames_per_second = sr / HOP_LENGTH

    # Sinal 3: contraste de energia pré/pós drop.
    contrast_window = max(1, int(CONTRAST_WINDOW_SECONDS * frames_per_second))
    contrast = _energy_contrast(rms, contrast_window)

    # Combina os três sinais normalizados. Um bom corte é alto em energia E em
    # impacto E vem logo após um buildup (contraste alto = drop).
    score = (
        0.4 * _normalize(rms)
        + 0.3 * _normalize(onset_env)
        + 0.3 * _normalize(contrast)
    )

    # find_peaks trabalha em índices de frame. Convertemos a distância mínima
    # (segundos) para frames: 1 frame ≈ HOP_LENGTH amostras.
    min_distance = max(1, int(MIN_GAP_SECONDS * frames_per_second))

    peak_idx, _ = find_peaks(
        score,
        height=float(np.mean(score) * 1.5),
        distance=min_distance,
    )

    if len(peak_idx) == 0:
        return [], bpm

    # Ordena os picos encontrados pelo score (maior primeiro) e pega top_n.
    peak_idx = peak_idx[np.argsort(score[peak_idx])[::-1]][:top_n]

    times = librosa.frames_to_time(peak_idx, sr=sr, hop_length=HOP_LENGTH)
    peaks = [
        Peak(start_sec=float(t), score=float(score[i]))
        for t, i in zip(times, peak_idx)
    ]
    return peaks, bpm
