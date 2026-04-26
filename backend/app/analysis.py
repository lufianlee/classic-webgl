"""Audio analysis using librosa.

Extracts features from an audio file that will drive the WebGL spatial
visualizer on the frontend: tempo (BPM), musical key, beat timestamps,
chroma energy, a downsampled log-mel spectrogram, and per-band energy
envelopes (bass / mids / treble).
"""
from __future__ import annotations

from dataclasses import dataclass, asdict
from pathlib import Path
from typing import Any

import librosa
import numpy as np


# 24 key labels in the Krumhansl-Schmuckler convention (12 major + 12 minor).
PITCH_CLASSES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]

# Krumhansl-Kessler key profiles (empirical key-finding weights).
_KRUMHANSL_MAJOR = np.array(
    [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88]
)
_KRUMHANSL_MINOR = np.array(
    [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17]
)


@dataclass
class AnalysisResult:
    duration: float
    sample_rate: int
    tempo: float
    key: str
    mode: str  # "major" | "minor"
    key_confidence: float
    beats: list[float]
    spectrogram: list[list[float]]  # shape: [time_frames][mel_bins], 0..1
    spectrogram_times: list[float]
    bass_envelope: list[float]
    mid_envelope: list[float]
    treble_envelope: list[float]
    envelope_times: list[float]
    chroma: list[float]  # 12-dim mean chroma, normalized
    rms_peak: float

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


def _estimate_key(chroma: np.ndarray) -> tuple[str, str, float]:
    """Return (tonic, mode, confidence) by correlating mean chroma with
    rotated Krumhansl-Kessler major/minor profiles.
    """
    mean_chroma = chroma.mean(axis=1)
    if mean_chroma.sum() <= 0:
        return "C", "major", 0.0

    scores: list[tuple[float, int, str]] = []
    for tonic in range(12):
        rotated_major = np.roll(_KRUMHANSL_MAJOR, tonic)
        rotated_minor = np.roll(_KRUMHANSL_MINOR, tonic)
        scores.append(
            (float(np.corrcoef(mean_chroma, rotated_major)[0, 1]), tonic, "major")
        )
        scores.append(
            (float(np.corrcoef(mean_chroma, rotated_minor)[0, 1]), tonic, "minor")
        )

    scores.sort(reverse=True, key=lambda s: s[0])
    best_score, best_tonic, best_mode = scores[0]
    second_score = scores[1][0]
    # Confidence: margin between best and 2nd best, clamped to 0..1.
    confidence = float(max(0.0, min(1.0, best_score - second_score)))
    return PITCH_CLASSES[best_tonic], best_mode, confidence


def _band_envelope(
    stft_mag: np.ndarray, freqs: np.ndarray, low: float, high: float
) -> np.ndarray:
    """Return a per-frame energy envelope (0..1 normalized) for a frequency band."""
    mask = (freqs >= low) & (freqs < high)
    if not mask.any():
        return np.zeros(stft_mag.shape[1], dtype=np.float32)
    band = stft_mag[mask].mean(axis=0)
    peak = float(band.max()) if band.size > 0 else 0.0
    if peak <= 1e-8:
        return np.zeros_like(band, dtype=np.float32)
    return (band / peak).astype(np.float32)


def analyze_audio(
    audio_path: Path,
    *,
    target_sr: int = 22050,
    n_mels: int = 64,
    envelope_hop_ms: int = 50,
    max_frames: int = 600,
) -> AnalysisResult:
    """Analyze an audio file and return a serializable feature bundle.

    - target_sr: resample rate for analysis (22.05k is the librosa default and
      preserves everything below 11kHz, more than enough for classical timbre).
    - n_mels: mel-band resolution for the spectrogram the frontend renders.
    - envelope_hop_ms: temporal resolution of the band envelopes.
    - max_frames: cap on frames sent to the client (keeps JSON payload small).
    """
    y, sr = librosa.load(str(audio_path), sr=target_sr, mono=True)
    duration = float(len(y) / sr)

    # Tempo + beats.
    tempo, beat_frames = librosa.beat.beat_track(y=y, sr=sr)
    beat_times = librosa.frames_to_time(beat_frames, sr=sr).tolist()

    # Chroma for key estimation (CQT-based is more robust for classical music
    # than STFT chroma, especially with harpsichord / organ overtones).
    chroma = librosa.feature.chroma_cqt(y=y, sr=sr)
    tonic, mode, key_confidence = _estimate_key(chroma)
    mean_chroma = chroma.mean(axis=1)
    if mean_chroma.max() > 0:
        mean_chroma = mean_chroma / mean_chroma.max()

    # Log-mel spectrogram, downsampled to max_frames columns.
    mel = librosa.feature.melspectrogram(
        y=y, sr=sr, n_mels=n_mels, fmax=sr // 2
    )
    mel_db = librosa.power_to_db(mel, ref=np.max)  # 0 dB = peak, negative below
    # Normalize to 0..1 from an 80 dB floor.
    mel_norm = np.clip((mel_db + 80.0) / 80.0, 0.0, 1.0).astype(np.float32)
    if mel_norm.shape[1] > max_frames:
        idx = np.linspace(0, mel_norm.shape[1] - 1, max_frames).astype(int)
        mel_norm = mel_norm[:, idx]
    spec_times = np.linspace(0.0, duration, mel_norm.shape[1]).tolist()
    # Transpose so JSON shape is [time][bin] — frontend iterates by time.
    spectrogram = mel_norm.T.tolist()

    # Per-band envelopes using a short-hop STFT.
    hop_length = max(1, int(sr * envelope_hop_ms / 1000))
    stft = np.abs(librosa.stft(y, n_fft=2048, hop_length=hop_length))
    freqs = librosa.fft_frequencies(sr=sr, n_fft=2048)
    bass = _band_envelope(stft, freqs, 20, 250)
    mid = _band_envelope(stft, freqs, 250, 2000)
    treble = _band_envelope(stft, freqs, 2000, sr / 2)
    env_times = librosa.frames_to_time(
        np.arange(stft.shape[1]), sr=sr, hop_length=hop_length
    )

    # Downsample envelopes too, matching max_frames*2 for smoother motion.
    env_cap = max_frames * 2
    if bass.size > env_cap:
        idx = np.linspace(0, bass.size - 1, env_cap).astype(int)
        bass = bass[idx]
        mid = mid[idx]
        treble = treble[idx]
        env_times = env_times[idx]

    rms = librosa.feature.rms(y=y)[0]
    rms_peak = float(rms.max()) if rms.size else 0.0

    # librosa may return tempo as array-like — coerce to float.
    tempo_scalar = float(np.asarray(tempo).reshape(-1)[0])

    return AnalysisResult(
        duration=duration,
        sample_rate=sr,
        tempo=tempo_scalar,
        key=tonic,
        mode=mode,
        key_confidence=key_confidence,
        beats=beat_times,
        spectrogram=spectrogram,
        spectrogram_times=spec_times,
        bass_envelope=bass.tolist(),
        mid_envelope=mid.tolist(),
        treble_envelope=treble.tolist(),
        envelope_times=env_times.tolist(),
        chroma=mean_chroma.tolist(),
        rms_peak=rms_peak,
    )
