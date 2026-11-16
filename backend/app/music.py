"""Vibe da música de um corte, lida do áudio da própria janela.

O corte dinâmico reage à música em vez de aplicar o mesmo zoom em tudo. Em
música eletrônica a pista mais confiável é o GRAVE: no drop o bumbo/baixo está
cheio; no breakdown e no build-up ele some. A partir do envelope de graves a
janela é dividida em três vibes:

- ``drop``  — grave cheio (o groove/drop): zoom pulsa na batida;
- ``build`` — os segundos sem grave que antecedem um drop: a câmera vai
  fechando sem parar até a virada;
- ``calm``  — sem grave e sem drop à vista (breakdown, intro): movimento lento.

Módulo puro: recebe um vídeo, devolve um :class:`MusicProfile`. Qualquer falha
devolve um perfil vazio — o planejador cai no zoom padrão.
"""
import logging
import os
import statistics
import subprocess
import tempfile
from dataclasses import dataclass, field

import numpy as np

logger = logging.getLogger("djviral.music")

# Resolução (s) do envelope de vibe.
HOP_SECONDS = 0.25
# Frequência de corte (Hz) do passa-baixas que isola bumbo/baixo.
BASS_CUTOFF_HZ = 150.0
# Fração do nível de grave "cheio" da janela acima da qual o trecho é drop.
DROP_LEVEL = 0.5
# A janela só tem drop se o grave pesar pelo menos isto do volume total —
# senão um trecho inteiro sem bumbo pareceria "drop" por normalização.
MIN_BASS_SHARE = 0.25
# Trecho de vibe mais curto que isto é ruído (fill, virada): absorvido.
MIN_SECTION_SECONDS = 2.0
# Quantos segundos sem grave antes de um drop contam como build-up.
BUILD_SECONDS = 8.0


@dataclass
class MusicProfile:
    """Batidas e vibe ao longo de uma janela (tempos em s relativos a ela)."""

    beats: list[float] = field(default_factory=list)
    period: float = 0.0  # intervalo entre batidas (s); 0 = desconhecido
    vibes: list[str] = field(default_factory=list)  # uma por HOP_SECONDS

    def vibe_at(self, t0: float, t1: float) -> str | None:
        """Vibe predominante no trecho; ``None`` sem perfil."""
        lo = max(0, int(t0 / HOP_SECONDS))
        hi = max(lo + 1, int(round(t1 / HOP_SECONDS)))
        span = self.vibes[lo:hi]
        if not span:
            return None
        return max(("drop", "build", "calm"), key=span.count)

    def drop_starts(self) -> list[float]:
        """Instantes em que o grave ENTRA (a virada para o drop)."""
        return [
            round(i * HOP_SECONDS, 3)
            for i in range(1, len(self.vibes))
            if self.vibes[i] == "drop" and self.vibes[i - 1] != "drop"
        ]


def _smooth_sections(flags: list[bool]) -> list[bool]:
    """Funde trechos mais curtos que MIN_SECTION_SECONDS no vizinho anterior."""
    min_len = max(1, int(round(MIN_SECTION_SECONDS / HOP_SECONDS)))
    out = list(flags)
    i = 0
    while i < len(out):
        j = i
        while j < len(out) and out[j] == out[i]:
            j += 1
        if j - i < min_len and i > 0:
            out[i:j] = [out[i - 1]] * (j - i)
        i = j
    return out


def classify_vibes(bass: np.ndarray, full: np.ndarray) -> list[str]:
    """Vibe por hop a partir dos envelopes RMS de graves e do sinal inteiro."""
    if len(bass) == 0:
        return []
    bass_ref = float(np.percentile(bass, 90))
    full_ref = float(np.percentile(full, 90))
    if full_ref <= 1e-6 or bass_ref / full_ref < MIN_BASS_SHARE:
        return ["calm"] * len(bass)  # janela sem bumbo/baixo relevante
    drop = _smooth_sections([float(b) >= DROP_LEVEL * bass_ref for b in bass])
    vibes = ["drop" if d else "calm" for d in drop]
    build_hops = int(round(BUILD_SECONDS / HOP_SECONDS))
    for i in range(1, len(vibes)):
        if vibes[i] == "drop" and vibes[i - 1] != "drop":
            j = i - 1
            while j >= 0 and vibes[j] == "calm" and i - j <= build_hops:
                vibes[j] = "build"
                j -= 1
    return vibes


def get_music_profile(
    video_path: str, start_sec: float, duration: float, bpm_hint: int = 0
) -> MusicProfile:
    """Extrai o áudio da janela e devolve batidas + vibe. Nunca levanta exceção."""
    import librosa
    import soundfile as sf
    from scipy.signal import butter, sosfilt

    fd, wav_path = tempfile.mkstemp(suffix=".wav")
    os.close(fd)
    try:
        cmd = [
            "ffmpeg", "-y", "-v", "error",
            "-ss", str(max(0.0, start_sec)),
            "-i", video_path,
            "-t", str(duration),
            "-vn", "-ac", "1", "-ar", "22050", "-c:a", "pcm_s16le",
            wav_path,
        ]
        result = subprocess.run(cmd, capture_output=True, text=True)
        if result.returncode != 0 or not os.path.getsize(wav_path):
            return MusicProfile()
        y, sr = sf.read(wav_path, dtype="float32")
        if y.ndim > 1:
            y = y.mean(axis=1)
        y = np.nan_to_num(y, nan=0.0, posinf=0.0, neginf=0.0)

        _, beat_frames = librosa.beat.beat_track(
            y=y, sr=sr, start_bpm=float(bpm_hint) if bpm_hint else 120.0
        )
        beats = [float(t) for t in np.atleast_1d(librosa.frames_to_time(beat_frames, sr=sr))]
        gaps = [b - a for a, b in zip(beats, beats[1:]) if b - a > 0.2]
        period = statistics.median(gaps) if gaps else (60.0 / bpm_hint if bpm_hint else 0.0)

        hop = int(sr * HOP_SECONDS)
        n = len(y) // hop
        low = sosfilt(butter(4, BASS_CUTOFF_HZ, btype="low", fs=sr, output="sos"), y)

        def _rms(sig: np.ndarray) -> np.ndarray:
            return np.sqrt((sig[: n * hop].reshape(n, hop) ** 2).mean(axis=1))

        vibes = classify_vibes(_rms(low), _rms(y)) if n else []
        return MusicProfile(beats=beats, period=float(period), vibes=vibes)
    except Exception:  # noqa: BLE001 - sem perfil → zoom padrão no chamador
        logger.exception("Falha ao ler a vibe da música (%.1fs)", start_sec)
        return MusicProfile()
    finally:
        if os.path.exists(wav_path):
            os.remove(wav_path)
