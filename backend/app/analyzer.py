"""Núcleo de análise de áudio com Librosa.

Recebe um arquivo de áudio/vídeo, extrai três sinais (RMS = energia/volume,
onset strength = impacto dos beats e contraste de energia pré/pós drop),
combina-os num único "score de viralidade" e devolve os timestamps dos picos
mais intensos — cada um é um candidato a clipe viral (drop, virada). Também
estima o BPM global do set.

A análise roda em **streaming**: o áudio é extraído para um WAV temporário via
FFmpeg e lido em blocos (`librosa.stream`), então o pico de memória é constante
(~dezenas de MB) mesmo para sets de 3 horas — só os vetores de features (um
valor por frame, poucos MB no total) ficam residentes.

Este módulo é puro (sem dependência de FastAPI/Supabase) e pode ser testado
isoladamente.
"""
import os
import subprocess
import tempfile
from dataclasses import dataclass

import librosa
import numpy as np
import soundfile as sf
from scipy.signal import find_peaks

# Taxa de amostragem alvo. Mono em 22050 Hz é suficiente para detectar energia e
# onsets, e mantém o uso de memória aceitável mesmo em sets longos.
SAMPLE_RATE = 22050
HOP_LENGTH = 512  # default do librosa para rms/onset; usado para converter frames
FRAME_LENGTH = 2048  # janela do RMS e n_fft do espectrograma mel

# Frames por bloco do streaming: 4096 frames ≈ 95 s de áudio por vez. Cada
# bloco custa ~100 MB entre sinal e espectrograma, independente da duração
# total do set.
BLOCK_LENGTH = 4096

# O BPM global é estimado em janelas curtas (mediana de 3 janelas em 25%, 50%
# e 75% do set). O tempograma do librosa cresce linearmente com o áudio
# analisado (~740 MB para 10 min!), então janelas curtas são obrigatórias.
TEMPO_WINDOW_SECONDS = 60

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


def _extract_audio(path: str) -> str:
    """Extrai o áudio de ``path`` para um WAV mono 22.05 kHz temporário.

    Decodificar direto com o FFmpeg é mais rápido que via audioread e produz
    um arquivo que o soundfile consegue ler em blocos — pré-requisito do
    streaming. O chamador é responsável por remover o WAV.
    """
    fd, wav_path = tempfile.mkstemp(suffix=".wav")
    os.close(fd)
    cmd = [
        "ffmpeg",
        "-y",
        "-i", path,
        "-vn",
        "-ac", "1",
        "-ar", str(SAMPLE_RATE),
        "-c:a", "pcm_s16le",
        wav_path,
    ]
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0 or not os.path.getsize(wav_path):
        if os.path.exists(wav_path):
            os.remove(wav_path)
        raise RuntimeError(
            f"FFmpeg falhou ao extrair o áudio: {result.stderr[-2000:]}"
        )
    return wav_path


def _streamed_features(wav_path: str) -> tuple[np.ndarray, np.ndarray, int]:
    """Calcula RMS e onset strength (fluxo espectral) lendo o WAV em blocos.

    Retorna ``(rms, onset_env, sr)``, um valor por frame de ``HOP_LENGTH``.
    O fluxo espectral (diferença positiva do mel em dB entre frames vizinhos,
    média nas bandas) é o mesmo sinal do ``librosa.onset.onset_strength``; o
    último frame de cada bloco é carregado para o seguinte, então não há
    descontinuidade nas emendas.
    """
    sr = sf.info(wav_path).samplerate
    rms_parts: list[np.ndarray] = []
    flux_parts: list[np.ndarray] = []
    prev_frame: np.ndarray | None = None

    # Lemos o WAV em blocos hop-alinhados direto pelo soundfile em vez de
    # `librosa.stream`: cada bloco rende BLOCK_LENGTH frames com center=False e
    # a emenda entre blocos continua contínua (blocksize/overlap reproduzem o
    # que o stream fazia internamente). Fazemos isso para poder SANEAR cada
    # bloco (np.nan_to_num) ANTES de qualquer feature — sets com um trecho de
    # áudio corrompido/decodificado torto podem trazer amostras não-finitas
    # (NaN/Inf), e o `librosa.stream` valida o bloco e derruba o job inteiro
    # com "Audio buffer is not finite everywhere" antes de a gente conseguir
    # limpar. Um pico ruim vira silêncio (0) em vez de abortar todo o corte.
    block_samples = (BLOCK_LENGTH - 1) * HOP_LENGTH + FRAME_LENGTH
    overlap_samples = FRAME_LENGTH - HOP_LENGTH
    blocks = sf.blocks(
        wav_path,
        blocksize=block_samples,
        overlap=overlap_samples,
        dtype="float32",
        always_2d=False,
    )
    for block in blocks:
        if block.ndim > 1:  # segurança: colapsa p/ mono (ffmpeg já força -ac 1)
            block = block.mean(axis=1)
        block = np.nan_to_num(block, nan=0.0, posinf=0.0, neginf=0.0)
        if len(block) < FRAME_LENGTH:
            continue  # sobra final menor que uma janela: nenhum frame

        rms_parts.append(
            librosa.feature.rms(
                y=block,
                frame_length=FRAME_LENGTH,
                hop_length=HOP_LENGTH,
                center=False,
            )[0]
        )

        mel = librosa.feature.melspectrogram(
            y=block,
            sr=sr,
            n_fft=FRAME_LENGTH,
            hop_length=HOP_LENGTH,
            center=False,
        )
        mel_db = librosa.power_to_db(mel, ref=1.0)
        if prev_frame is None:
            prev_frame = mel_db[:, :1]  # 1º bloco: diff do 1º frame vira 0
        diff = np.diff(np.concatenate([prev_frame, mel_db], axis=1), axis=1)
        flux_parts.append(np.clip(diff, 0, None).mean(axis=0))
        prev_frame = mel_db[:, -1:]

    if not rms_parts:
        return np.array([]), np.array([]), sr
    return np.concatenate(rms_parts), np.concatenate(flux_parts), sr


def _estimate_bpm(onset_env: np.ndarray, sr: int) -> int:
    """Estima o BPM global pela mediana de até 3 janelas curtas do envelope.

    Janelas em 25%, 50% e 75% do set: robusto a um break/silêncio pontual e
    com custo de memória fixo (uma janela de ``TEMPO_WINDOW_SECONDS`` por vez).
    """
    window = int(TEMPO_WINDOW_SECONDS * sr / HOP_LENGTH)
    if len(onset_env) <= window:
        segments = [onset_env]
    else:
        centers = (len(onset_env) // 4, len(onset_env) // 2, 3 * len(onset_env) // 4)
        segments = [
            onset_env[max(0, c - window // 2) : max(0, c - window // 2) + window]
            for c in centers
        ]

    bpms = []
    for seg in segments:
        if len(seg) == 0:
            continue
        tempo = librosa.feature.tempo(
            onset_envelope=seg, sr=sr, hop_length=HOP_LENGTH
        )
        bpms.append(float(np.atleast_1d(tempo)[0]))
    if not bpms:
        return 0
    return int(round(float(np.median(bpms))))


def analyze(path: str, top_n: int = 30) -> tuple[list[Peak], int]:
    """Analisa o áudio em ``path`` e retorna ``(picos, bpm)``.

    Devolve os até ``top_n`` picos mais virais (ordenados por score, maior
    primeiro) e o BPM global estimado do set. O áudio é extraído com FFmpeg e
    processado em blocos, então o consumo de memória não depende da duração.
    """
    wav_path = _extract_audio(path)
    try:
        rms, onset_env, sr = _streamed_features(wav_path)
    finally:
        if os.path.exists(wav_path):
            os.remove(wav_path)

    if len(rms) == 0:
        return [], 0

    bpm = _estimate_bpm(onset_env, sr)

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
