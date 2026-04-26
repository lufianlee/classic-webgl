"""Tests for analysis.py.

These generate real audio (not mocks) and verify that librosa's feature
extraction produces values in the expected ranges. No `expect(true)` tests.
"""
from __future__ import annotations

from pathlib import Path

import numpy as np
import pytest
import soundfile as sf

from .analysis import PITCH_CLASSES, analyze_audio


def _write_tone(path: Path, freq: float, sr: int = 22050, duration: float = 4.0) -> None:
    t = np.linspace(0, duration, int(sr * duration), endpoint=False)
    # Add a slight amplitude envelope so RMS isn't perfectly flat.
    env = 0.5 + 0.5 * np.sin(2 * np.pi * 2.0 * t)
    y = 0.4 * env * np.sin(2 * np.pi * freq * t)
    sf.write(str(path), y.astype(np.float32), sr)


def _write_beat_track(path: Path, bpm: float, sr: int = 22050, duration: float = 10.0) -> None:
    """Synthesize a percussive click track with sharp onsets.

    Each click is a short pitched burst with a fast attack and exponential
    decay — this mimics real percussion and gives librosa strong onsets to
    track. Pure sine pulses don't work: no transient, no beat detection.
    """
    n = int(sr * duration)
    y = np.zeros(n, dtype=np.float32)
    period = 60.0 / bpm
    click_dur = 0.08  # 80 ms percussive hit
    click_len = int(sr * click_dur)
    tt = np.arange(click_len) / sr
    decay = np.exp(-tt * 40.0)  # fast exponential decay
    tone = np.sin(2 * np.pi * 1000.0 * tt)  # audible pitch for the onset
    click = (decay * tone).astype(np.float32) * 0.9
    t = 0.0
    while t < duration:
        start = int(t * sr)
        end = min(n, start + click_len)
        y[start:end] += click[: end - start]
        t += period
    sf.write(str(path), y, sr)


def _write_c_major_chord(path: Path, sr: int = 22050, duration: float = 4.0) -> None:
    """Synthesize a sustained C major triad: C4 (261.63), E4 (329.63), G4 (392.00)."""
    t = np.linspace(0, duration, int(sr * duration), endpoint=False)
    y = (
        np.sin(2 * np.pi * 261.63 * t)
        + np.sin(2 * np.pi * 329.63 * t)
        + np.sin(2 * np.pi * 392.00 * t)
    )
    y = 0.3 * y / np.max(np.abs(y))
    sf.write(str(path), y.astype(np.float32), sr)


def test_analyze_returns_valid_ranges(tmp_path: Path) -> None:
    """Every field in the analysis result must be in its declared range."""
    audio = tmp_path / "tone.wav"
    _write_tone(audio, freq=440.0)

    result = analyze_audio(audio)

    # Basic metadata.
    assert 3.5 < result.duration < 4.5, "4s file should report ~4s duration"
    assert result.sample_rate == 22050
    # tempo may be 0 for a pure sine tone (no onsets); just check it's finite.
    assert result.tempo >= 0

    # Key is one of the 12 pitch classes, mode is major or minor.
    assert result.key in PITCH_CLASSES
    assert result.mode in {"major", "minor"}
    assert 0.0 <= result.key_confidence <= 1.0

    # Spectrogram: list of frames, each of length n_mels (default 64).
    assert len(result.spectrogram) > 0
    assert all(len(frame) == 64 for frame in result.spectrogram)
    flat = np.array(result.spectrogram).ravel()
    assert flat.min() >= 0.0 and flat.max() <= 1.0

    # Time axis lines up with the number of frames.
    assert len(result.spectrogram_times) == len(result.spectrogram)

    # Envelopes share the same length as envelope_times.
    assert (
        len(result.bass_envelope)
        == len(result.mid_envelope)
        == len(result.treble_envelope)
        == len(result.envelope_times)
    )
    for env in (result.bass_envelope, result.mid_envelope, result.treble_envelope):
        arr = np.array(env)
        assert arr.min() >= 0.0 and arr.max() <= 1.0

    # Chroma is 12 dims, normalized so max == 1 when any energy exists.
    assert len(result.chroma) == 12
    assert max(result.chroma) == pytest.approx(1.0, abs=1e-6)


def test_a440_concentrates_mid_band_energy(tmp_path: Path) -> None:
    """A 440 Hz tone lives in the mid band (250..2000 Hz) — not bass, not treble."""
    audio = tmp_path / "a440.wav"
    _write_tone(audio, freq=440.0)

    r = analyze_audio(audio)
    mid_mean = float(np.mean(r.mid_envelope))
    bass_mean = float(np.mean(r.bass_envelope))
    treble_mean = float(np.mean(r.treble_envelope))

    assert mid_mean > bass_mean, (
        f"A440 mid ({mid_mean:.3f}) should exceed bass ({bass_mean:.3f})"
    )
    assert mid_mean > treble_mean, (
        f"A440 mid ({mid_mean:.3f}) should exceed treble ({treble_mean:.3f})"
    )


def test_low_tone_concentrates_bass_energy(tmp_path: Path) -> None:
    """An 80 Hz tone must register in the bass band, not the treble band."""
    audio = tmp_path / "low.wav"
    _write_tone(audio, freq=80.0)

    r = analyze_audio(audio)
    bass_mean = float(np.mean(r.bass_envelope))
    treble_mean = float(np.mean(r.treble_envelope))

    assert bass_mean > treble_mean, (
        f"80 Hz bass ({bass_mean:.3f}) should exceed treble ({treble_mean:.3f})"
    )


def test_tempo_estimation_reasonable(tmp_path: Path) -> None:
    """120 BPM click track should be detected within 15% of the target."""
    audio = tmp_path / "click.wav"
    _write_beat_track(audio, bpm=120.0)

    r = analyze_audio(audio)
    # librosa can estimate half/double tempo — accept those multiples.
    candidates = [120.0, 60.0, 240.0]
    best_err = min(abs(r.tempo - c) / c for c in candidates)
    assert best_err < 0.15, f"Detected tempo {r.tempo:.1f} far from 120/60/240"
    assert len(r.beats) > 0, "Beat list should be non-empty for a click track"


def test_key_detection_c_major(tmp_path: Path) -> None:
    """A sustained C-E-G triad should be classified as C major."""
    audio = tmp_path / "cmaj.wav"
    _write_c_major_chord(audio)

    r = analyze_audio(audio)
    # Chroma bin for C should dominate.
    chroma = np.array(r.chroma)
    # C is index 0; E is 4; G is 7 — these three should be the top values.
    top3 = set(np.argsort(chroma)[-3:].tolist())
    assert {0, 4, 7}.issubset(top3), f"Expected C/E/G to dominate; got chroma={chroma}"
    assert r.key == "C", f"Expected key=C, got {r.key}"
    assert r.mode == "major", f"Expected major, got {r.mode}"


def test_silence_produces_zero_envelopes(tmp_path: Path) -> None:
    """Silent audio must not produce phantom energy."""
    audio = tmp_path / "silent.wav"
    sr = 22050
    sf.write(str(audio), np.zeros(sr * 2, dtype=np.float32), sr)

    r = analyze_audio(audio)
    assert max(r.bass_envelope) == 0.0
    assert max(r.mid_envelope) == 0.0
    assert max(r.treble_envelope) == 0.0
    assert r.rms_peak == 0.0
    assert r.key_confidence == 0.0


def test_spectrogram_frame_cap_respected(tmp_path: Path) -> None:
    """Long files must be downsampled to at most max_frames."""
    sr = 22050
    duration = 60.0
    t = np.linspace(0, duration, int(sr * duration), endpoint=False)
    y = 0.3 * np.sin(2 * np.pi * 440.0 * t).astype(np.float32)
    audio = tmp_path / "long.wav"
    sf.write(str(audio), y, sr)

    r = analyze_audio(audio, max_frames=200)
    assert len(r.spectrogram) <= 200
    assert len(r.spectrogram_times) == len(r.spectrogram)
