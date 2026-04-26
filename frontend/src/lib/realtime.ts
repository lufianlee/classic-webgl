/**
 * Real-time musical feature extraction from an AnalyserNode.
 *
 * We sample the analyser each frame and derive:
 *   - chroma: 12-bin pitch-class energy (A..G#)
 *   - key, mode, keyConfidence: Krumhansl–Kessler profile correlation
 *   - bpm, beatPhase: onset detection (spectral flux) → IOI histogram
 *
 * Everything runs at frame rate (~60 Hz) with smoothing/hysteresis so the
 * UI doesn't flicker on transient noise. Heavy-weight analyses (CQT, beat
 * tracking on the full waveform) stay on the backend; this is the "live
 * conductor" that reacts within a few beats.
 */

export const PITCH_CLASSES = [
  'C',
  'C#',
  'D',
  'D#',
  'E',
  'F',
  'F#',
  'G',
  'G#',
  'A',
  'A#',
  'B',
] as const;
export type PitchClass = (typeof PITCH_CLASSES)[number];

// Krumhansl–Kessler major/minor profiles (same as backend).
const PROFILE_MAJOR = [
  6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88,
];
const PROFILE_MINOR = [
  6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17,
];

function pearson(a: number[], b: number[]): number {
  const n = a.length;
  let sumA = 0;
  let sumB = 0;
  for (let i = 0; i < n; i++) {
    sumA += a[i];
    sumB += b[i];
  }
  const meanA = sumA / n;
  const meanB = sumB / n;
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < n; i++) {
    const x = a[i] - meanA;
    const y = b[i] - meanB;
    num += x * y;
    da += x * x;
    db += y * y;
  }
  const denom = Math.sqrt(da * db);
  return denom === 0 ? 0 : num / denom;
}

function rotate<T>(arr: T[], n: number): T[] {
  const len = arr.length;
  const k = ((n % len) + len) % len;
  return arr.slice(k).concat(arr.slice(0, k));
}

export interface RealtimeFeatures {
  chroma: number[]; // 12 bins, normalized to peak = 1 (or all zero)
  key: PitchClass;
  mode: 'major' | 'minor';
  keyConfidence: number; // 0..1, margin between top-2 hypotheses
  bpm: number; // 0 if not confident
  beatPhase: number; // 0..1, position within the current beat
  onsetStrength: number; // instantaneous spectral flux, 0..1-ish
  rms: number; // 0..1
}

const EMPTY_FEATURES: RealtimeFeatures = {
  chroma: new Array(12).fill(0),
  key: 'C',
  mode: 'major',
  keyConfidence: 0,
  bpm: 0,
  beatPhase: 0,
  onsetStrength: 0,
  rms: 0,
};

export class RealtimeAnalyzer {
  private readonly analyser: AnalyserNode;
  private readonly sampleRate: number;

  // FFT state
  private freqData: Uint8Array;
  private prevFreqMagnitude: Float32Array;
  private binFreqs: Float32Array;

  // Smoothed chroma over ~2 seconds so we get stable key tracking
  // without being completely frozen on modulations.
  private chromaSmoothed: number[] = new Array(12).fill(0);
  private readonly chromaTau = 1.8; // seconds

  // Onset / tempo state
  private onsetHistory: { t: number; strength: number }[] = [];
  private readonly onsetHistoryWindow = 8; // seconds
  private lastBeatTime = 0;
  private currentBpm = 0;
  private bpmConfidence = 0;

  // Key hysteresis — we commit to a new key only when a better candidate
  // dominates for several frames, otherwise flickering between relative
  // major / minor becomes visually noisy.
  private keyCommitTimer = 0;
  private pendingKey: PitchClass = 'C';
  private pendingMode: 'major' | 'minor' = 'major';
  private committedKey: PitchClass = 'C';
  private committedMode: 'major' | 'minor' = 'major';
  private committedConfidence = 0;

  private lastSampleTime = 0;

  constructor(analyser: AnalyserNode, sampleRate: number) {
    this.analyser = analyser;
    this.sampleRate = sampleRate;
    this.freqData = new Uint8Array(analyser.frequencyBinCount);
    this.prevFreqMagnitude = new Float32Array(analyser.frequencyBinCount);

    this.binFreqs = new Float32Array(analyser.frequencyBinCount);
    const binStep = sampleRate / 2 / analyser.frequencyBinCount;
    for (let i = 0; i < analyser.frequencyBinCount; i++) {
      this.binFreqs[i] = (i + 0.5) * binStep;
    }
  }

  /** Return current features. Call once per animation frame. */
  update(now: number, timeDomain?: Uint8Array): RealtimeFeatures {
    this.analyser.getByteFrequencyData(this.freqData);

    const dt = this.lastSampleTime > 0 ? Math.max(0.001, now - this.lastSampleTime) : 1 / 60;
    this.lastSampleTime = now;

    // --- Chroma -----------------------------------------------------------
    // Only tonal range: 65 Hz (C2) .. 2100 Hz (C7). Higher bins dominated by
    // overtones/noise and muddy the key estimate.
    const chroma = new Array(12).fill(0);
    let chromaSum = 0;
    for (let i = 0; i < this.freqData.length; i++) {
      const f = this.binFreqs[i];
      if (f < 65 || f > 2100) continue;
      const mag = this.freqData[i] / 255;
      if (mag < 0.03) continue;
      // MIDI note number; A4=440Hz = MIDI 69.
      const midi = 69 + 12 * Math.log2(f / 440);
      const pc = ((Math.round(midi) % 12) + 12) % 12;
      // Weight by magnitude squared so prominent peaks dominate over noise.
      const w = mag * mag;
      chroma[pc] += w;
      chromaSum += w;
    }
    if (chromaSum > 0) {
      for (let i = 0; i < 12; i++) chroma[i] /= chromaSum;
    }
    // Exponential moving average toward this frame's chroma.
    const alpha = 1 - Math.exp(-dt / this.chromaTau);
    for (let i = 0; i < 12; i++) {
      this.chromaSmoothed[i] = this.chromaSmoothed[i] + alpha * (chroma[i] - this.chromaSmoothed[i]);
    }

    const chromaDisplay = [...this.chromaSmoothed];
    const maxC = Math.max(...chromaDisplay);
    if (maxC > 0) for (let i = 0; i < 12; i++) chromaDisplay[i] /= maxC;

    // --- Key estimation ----------------------------------------------------
    let bestScore = -Infinity;
    let secondScore = -Infinity;
    let bestTonic = 0;
    let bestMode: 'major' | 'minor' = 'major';

    const chromaArr = this.chromaSmoothed;
    const totalChroma = chromaArr.reduce((s, v) => s + v, 0);

    if (totalChroma > 1e-4) {
      for (let tonic = 0; tonic < 12; tonic++) {
        const maj = pearson(chromaArr, rotate(PROFILE_MAJOR, tonic));
        const min = pearson(chromaArr, rotate(PROFILE_MINOR, tonic));
        if (maj > bestScore) {
          secondScore = bestScore;
          bestScore = maj;
          bestTonic = tonic;
          bestMode = 'major';
        } else if (maj > secondScore) secondScore = maj;
        if (min > bestScore) {
          secondScore = bestScore;
          bestScore = min;
          bestTonic = tonic;
          bestMode = 'minor';
        } else if (min > secondScore) secondScore = min;
      }
    }

    const rawConfidence = Math.max(0, Math.min(1, bestScore - secondScore));

    // Hysteresis: commit to a new key only if it's held for ~1 second.
    const candidateKey = PITCH_CLASSES[bestTonic];
    if (candidateKey === this.pendingKey && bestMode === this.pendingMode) {
      this.keyCommitTimer += dt;
    } else {
      this.pendingKey = candidateKey;
      this.pendingMode = bestMode;
      this.keyCommitTimer = 0;
    }
    if (this.keyCommitTimer > 0.8 && rawConfidence > 0.05) {
      this.committedKey = this.pendingKey;
      this.committedMode = this.pendingMode;
      this.committedConfidence = rawConfidence;
    }

    // --- Spectral flux onset + BPM ----------------------------------------
    let flux = 0;
    for (let i = 0; i < this.freqData.length; i++) {
      const m = this.freqData[i] / 255;
      const prev = this.prevFreqMagnitude[i];
      const diff = m - prev;
      if (diff > 0) flux += diff;
      this.prevFreqMagnitude[i] = m;
    }
    flux /= this.freqData.length; // ~0..1

    this.onsetHistory.push({ t: now, strength: flux });
    // Trim to window.
    while (this.onsetHistory.length && now - this.onsetHistory[0].t > this.onsetHistoryWindow) {
      this.onsetHistory.shift();
    }

    // Adaptive threshold: local flux > 1.3 * local median = onset.
    let beatPhase = 0;
    if (this.onsetHistory.length > 30) {
      const strengths = this.onsetHistory.map((o) => o.strength).slice().sort();
      const median = strengths[Math.floor(strengths.length / 2)];
      const threshold = Math.max(0.008, median * 1.5);

      if (flux > threshold && now - this.lastBeatTime > 0.22) {
        // Peak detected → log an inter-onset interval.
        if (this.lastBeatTime > 0) {
          const ioi = now - this.lastBeatTime;
          if (ioi > 0.25 && ioi < 1.5) {
            // Update running BPM estimate toward 60/ioi; blend 80/20.
            const inst = 60 / ioi;
            if (this.currentBpm === 0) {
              this.currentBpm = inst;
            } else {
              // Snap to closest multiple (handle half/double time).
              const candidates = [inst, inst * 2, inst / 2];
              let best = inst;
              let bestErr = Math.abs(this.currentBpm - inst);
              for (const c of candidates) {
                const err = Math.abs(this.currentBpm - c);
                if (err < bestErr) {
                  best = c;
                  bestErr = err;
                }
              }
              this.currentBpm = this.currentBpm * 0.78 + best * 0.22;
            }
            this.bpmConfidence = Math.min(1, this.bpmConfidence + 0.15);
          }
        }
        this.lastBeatTime = now;
      } else {
        // Slow decay of confidence when onsets stop.
        this.bpmConfidence = Math.max(0, this.bpmConfidence - dt * 0.1);
      }
    }

    // Beat phase — where are we between the last detected beat and the next.
    if (this.currentBpm > 0 && this.lastBeatTime > 0) {
      const period = 60 / this.currentBpm;
      beatPhase = Math.min(1, (now - this.lastBeatTime) / period);
    }

    // --- RMS --------------------------------------------------------------
    let rms = 0;
    if (timeDomain) {
      let acc = 0;
      for (let i = 0; i < timeDomain.length; i++) {
        const v = (timeDomain[i] - 128) / 128;
        acc += v * v;
      }
      rms = Math.sqrt(acc / timeDomain.length);
    }

    return {
      chroma: chromaDisplay,
      key: this.committedKey,
      mode: this.committedMode,
      keyConfidence: this.committedConfidence,
      bpm: this.bpmConfidence > 0.3 ? Math.round(this.currentBpm) : 0,
      beatPhase,
      onsetStrength: Math.min(1, flux * 8),
      rms,
    };
  }

  static empty(): RealtimeFeatures {
    return { ...EMPTY_FEATURES, chroma: new Array(12).fill(0) };
  }
}
