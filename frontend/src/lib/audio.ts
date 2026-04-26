/**
 * Audio engine: wraps an HTMLAudioElement with a Web Audio graph that feeds
 * an AnalyserNode (for real-time FFT driving the WebGL scene) and a
 * ConvolverNode (for preset-based reverb — cathedral / concert hall / salon).
 */
import type { SpacePreset } from './api';
import { RealtimeAnalyzer, type RealtimeFeatures } from './realtime';

export interface AudioFrame {
  frequencyBins: Uint8Array; // 0..255
  timeDomain: Uint8Array; // 0..255
  bassLevel: number; // 0..1 (20..250 Hz)
  midLevel: number; // 0..1 (250..2000 Hz)
  trebleLevel: number; // 0..1 (2000 Hz..)
  rms: number; // 0..1 overall level
}

const FFT_SIZE = 1024;

interface SpaceAcoustics {
  rt60: number; // seconds to decay 60 dB
  preDelay: number; // seconds before first reflection
  earlyReflections: number[]; // times (s) of discrete early echoes
  /** Lowpass knee (Hz) applied to the late tail — smaller = more "warm/dull". */
  hfRolloffHz: number;
  stereoSpread: number; // 0..1; how decorrelated L/R tails are
}

const SPACE_ACOUSTICS: Record<SpacePreset, SpaceAcoustics> = {
  // Vast cavity: late first reflection, many distinct echoes, air absorbs
  // the very top, long warm tail.
  cathedral: {
    rt60: 5.2,
    preDelay: 0.085,
    earlyReflections: [0.095, 0.13, 0.18, 0.24, 0.31, 0.42],
    hfRolloffHz: 3500,
    stereoSpread: 0.85,
  },
  // Mid-sized shoebox: quicker onset, crisp early reflections from side
  // walls, tail mostly intact to ~4 kHz.
  concert_hall: {
    rt60: 2.0,
    preDelay: 0.028,
    earlyReflections: [0.035, 0.055, 0.078, 0.1, 0.13],
    hfRolloffHz: 6000,
    stereoSpread: 0.55,
  },
  // Small room: almost no pre-delay, reflections packed close, short tail.
  salon: {
    rt60: 0.7,
    preDelay: 0.009,
    earlyReflections: [0.014, 0.021, 0.03, 0.042],
    hfRolloffHz: 7500,
    stereoSpread: 0.3,
  },
};

/**
 * Build a richer impulse response per preset:
 *   1) pre-delay of silence
 *   2) early reflection cluster (discrete impulses, per-ear offsets)
 *   3) stochastic late tail with exponential decay + simple HF rolloff
 *
 * We deliberately do NOT normalize across presets. A cathedral has more
 * total reverb energy than a salon — that's the whole point. Instead we
 * scale by a single factor so the loudest preset doesn't clip.
 */
function synthesizeImpulseResponse(
  ctx: AudioContext,
  preset: SpacePreset,
): AudioBuffer {
  const sr = ctx.sampleRate;
  const spec = SPACE_ACOUSTICS[preset];
  const length = Math.max(1, Math.floor(sr * (spec.rt60 * 1.1 + spec.preDelay)));
  const ir = ctx.createBuffer(2, length, sr);

  const decayConstant = Math.log(1000) / spec.rt60;

  for (let ch = 0; ch < 2; ch++) {
    const data = ir.getChannelData(ch);

    // Early reflections: discrete impulses at listed times, slightly offset
    // between ears for width.
    for (const erTime of spec.earlyReflections) {
      const jitter = (Math.random() - 0.5) * 0.002 * spec.stereoSpread;
      const idx = Math.floor(sr * (spec.preDelay + erTime + (ch === 0 ? -jitter : jitter)));
      if (idx >= 0 && idx < length) {
        const amp =
          0.7 * Math.exp(-decayConstant * erTime) * (0.7 + Math.random() * 0.3);
        data[idx] += (Math.random() < 0.5 ? -1 : 1) * amp;
      }
    }

    // Late tail: bandlimited noise (simple one-pole lowpass) × exp decay.
    const preDelaySamples = Math.floor(sr * spec.preDelay);
    const lastErSample = Math.floor(
      sr * (spec.preDelay + spec.earlyReflections[spec.earlyReflections.length - 1]),
    );
    const alpha = Math.exp(-2 * Math.PI * spec.hfRolloffHz / sr);
    let lpState = 0;
    for (let i = preDelaySamples; i < length; i++) {
      const t = (i - preDelaySamples) / sr;
      // Tail ramps in after the early-reflection cluster.
      const rampIn = Math.min(1, Math.max(0, (i - lastErSample) / (sr * 0.05)));
      const noise = Math.random() * 2 - 1;
      // 1-pole lowpass: y[n] = (1 - α)·x[n] + α·y[n-1]
      lpState = (1 - alpha) * noise + alpha * lpState;
      const tailAmp = Math.exp(-decayConstant * t) * 0.55;
      // Decorrelate the two channels by mixing independent noise streams.
      data[i] += lpState * tailAmp * rampIn;
    }
  }

  return ir;
}

/** Position of the sound source (the ensemble) in each space, in scene units. */
export const SOURCE_POSITION: Record<SpacePreset, [number, number, number]> = {
  // Altar area, deep in the nave.
  cathedral: [0, 2, -22],
  // Stage center, raised.
  concert_hall: [0, 1.2, -14],
  // Harpsichord position from Salon.tsx.
  salon: [-1, 1.0, -1],
};

export class AudioEngine {
  readonly ctx: AudioContext;
  readonly audioEl: HTMLAudioElement;
  readonly analyser: AnalyserNode;
  readonly realtime: RealtimeAnalyzer;

  private source: MediaElementAudioSourceNode | null = null;
  private dryGain: GainNode;
  private wetGain: GainNode;
  private convolver: ConvolverNode;
  private panner: PannerNode;
  private destinationGain: GainNode;

  private freqData: Uint8Array;
  private timeData: Uint8Array;

  // Band split indexes computed from FFT_SIZE and sample rate.
  private bassEnd: number;
  private midEnd: number;

  private preset: SpacePreset = 'cathedral';

  constructor(audioEl: HTMLAudioElement) {
    this.audioEl = audioEl;
    const Ctor =
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext ??
      AudioContext;
    this.ctx = new Ctor();

    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = FFT_SIZE;
    this.analyser.smoothingTimeConstant = 0.72;

    this.dryGain = this.ctx.createGain();
    this.wetGain = this.ctx.createGain();
    this.convolver = this.ctx.createConvolver();
    this.destinationGain = this.ctx.createGain();
    this.destinationGain.gain.value = 0.92;

    // 3D panner: HRTF gives front/back + left/right cues. Inverse distance
    // model with refDistance=1 means "full volume within 1 unit, half at 2,
    // third at 3, …" which maps nicely to scene units (1 unit ≈ 1 meter).
    this.panner = this.ctx.createPanner();
    this.panner.panningModel = 'HRTF';
    this.panner.distanceModel = 'inverse';
    this.panner.refDistance = 1.5;
    this.panner.maxDistance = 60;
    this.panner.rolloffFactor = 1.4;
    // A directional source wouldn't make sense for a whole ensemble, so we
    // leave it omni (coneInnerAngle = 360).
    this.panner.coneInnerAngle = 360;
    this.panner.coneOuterAngle = 0;
    this.panner.coneOuterGain = 0;

    this.freqData = new Uint8Array(this.analyser.frequencyBinCount);
    this.timeData = new Uint8Array(this.analyser.fftSize);

    const nyquist = this.ctx.sampleRate / 2;
    const binsPerHz = this.analyser.frequencyBinCount / nyquist;
    this.bassEnd = Math.floor(250 * binsPerHz);
    this.midEnd = Math.floor(2000 * binsPerHz);

    this.realtime = new RealtimeAnalyzer(this.analyser, this.ctx.sampleRate);

    this.setPreset('cathedral');
  }

  /** Per-frame real-time features (chroma/key/BPM). */
  sampleRealtime(now: number): RealtimeFeatures {
    // Reuse the analyser reads already populated by sample().
    this.analyser.getByteTimeDomainData(this.timeData);
    return this.realtime.update(now, this.timeData);
  }

  async ensureStarted(): Promise<void> {
    if (this.ctx.state === 'suspended') {
      await this.ctx.resume();
    }
    if (!this.source) {
      this.source = this.ctx.createMediaElementSource(this.audioEl);
      // Signal path:
      //   source ┬─▶ analyser (for feature extraction; silent branch)
      //          ├─▶ dryGain ─▶ panner (3D: distance/HRTF) ──┐
      //          └─▶ convolver ─▶ wetGain ────────────────────┤
      //                                                       ▼
      //                                              destinationGain ─▶ out
      // The wet (reverb) bus is *not* panned — reflections arrive from all
      // directions in a real room, which is exactly what a non-spatialized
      // stereo bus approximates. Only the dry direct sound is localized.
      this.source.connect(this.analyser);
      this.source.connect(this.dryGain);
      this.source.connect(this.convolver);
      this.dryGain.connect(this.panner);
      this.panner.connect(this.destinationGain);
      this.convolver.connect(this.wetGain);
      this.wetGain.connect(this.destinationGain);
      this.destinationGain.connect(this.ctx.destination);
    }
  }

  /** Set source position + listener position/orientation each frame. */
  setListener(
    position: [number, number, number],
    forward: [number, number, number],
    up: [number, number, number] = [0, 1, 0],
  ): void {
    const t = this.ctx.currentTime;
    const [px, py, pz] = position;
    const [fx, fy, fz] = forward;
    const [ux, uy, uz] = up;
    const listener = this.ctx.listener;
    // Modern API (Chrome/FF/Safari ≥15): AudioParams on the listener.
    // Older Safari only exposes setPosition/setOrientation — handle both.
    if (listener.positionX) {
      listener.positionX.setValueAtTime(px, t);
      listener.positionY.setValueAtTime(py, t);
      listener.positionZ.setValueAtTime(pz, t);
      listener.forwardX.setValueAtTime(fx, t);
      listener.forwardY.setValueAtTime(fy, t);
      listener.forwardZ.setValueAtTime(fz, t);
      listener.upX.setValueAtTime(ux, t);
      listener.upY.setValueAtTime(uy, t);
      listener.upZ.setValueAtTime(uz, t);
    } else {
      (listener as unknown as {
        setPosition: (x: number, y: number, z: number) => void;
        setOrientation: (
          fx: number, fy: number, fz: number,
          ux: number, uy: number, uz: number,
        ) => void;
      }).setPosition(px, py, pz);
      (listener as unknown as {
        setPosition: (x: number, y: number, z: number) => void;
        setOrientation: (
          fx: number, fy: number, fz: number,
          ux: number, uy: number, uz: number,
        ) => void;
      }).setOrientation(fx, fy, fz, ux, uy, uz);
    }
  }

  /** Distance from the listener to the current sound source, in scene units. */
  distanceToSource(listenerPos: [number, number, number]): number {
    const [sx, sy, sz] = SOURCE_POSITION[this.preset];
    const dx = listenerPos[0] - sx;
    const dy = listenerPos[1] - sy;
    const dz = listenerPos[2] - sz;
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  }

  setPreset(preset: SpacePreset): void {
    this.preset = preset;
    this.convolver.buffer = synthesizeImpulseResponse(this.ctx, preset);
    // Mix levels are calibrated so each space has a distinct character:
    //   - cathedral: wet dominant, soft dry (sound "seems far")
    //   - hall: balanced but rich
    //   - salon: mostly dry, just a faint halo
    // We bump the wet gain substantially because the IR is no longer
    // normalized to a fixed RMS.
    const mix: Record<SpacePreset, { dry: number; wet: number }> = {
      cathedral: { dry: 0.55, wet: 1.6 },
      concert_hall: { dry: 0.85, wet: 0.9 },
      salon: { dry: 1.0, wet: 0.35 },
    };
    const t = this.ctx.currentTime;
    // Ramp the change over 250 ms so preset switches don't click/pop.
    this.dryGain.gain.cancelScheduledValues(t);
    this.wetGain.gain.cancelScheduledValues(t);
    this.dryGain.gain.linearRampToValueAtTime(mix[preset].dry, t + 0.25);
    this.wetGain.gain.linearRampToValueAtTime(mix[preset].wet, t + 0.25);

    // Place the source at the preset-specific spot.
    const [sx, sy, sz] = SOURCE_POSITION[preset];
    if (this.panner.positionX) {
      this.panner.positionX.setValueAtTime(sx, t);
      this.panner.positionY.setValueAtTime(sy, t);
      this.panner.positionZ.setValueAtTime(sz, t);
    } else {
      (this.panner as unknown as {
        setPosition: (x: number, y: number, z: number) => void;
      }).setPosition(sx, sy, sz);
    }
  }

  getPreset(): SpacePreset {
    return this.preset;
  }

  sample(): AudioFrame {
    this.analyser.getByteFrequencyData(this.freqData);
    this.analyser.getByteTimeDomainData(this.timeData);

    let bassSum = 0;
    let midSum = 0;
    let trebleSum = 0;
    for (let i = 0; i < this.freqData.length; i++) {
      if (i < this.bassEnd) bassSum += this.freqData[i];
      else if (i < this.midEnd) midSum += this.freqData[i];
      else trebleSum += this.freqData[i];
    }
    const bassCount = Math.max(1, this.bassEnd);
    const midCount = Math.max(1, this.midEnd - this.bassEnd);
    const trebleCount = Math.max(1, this.freqData.length - this.midEnd);

    let rmsAcc = 0;
    for (let i = 0; i < this.timeData.length; i++) {
      const v = (this.timeData[i] - 128) / 128;
      rmsAcc += v * v;
    }
    const rms = Math.sqrt(rmsAcc / this.timeData.length);

    return {
      frequencyBins: this.freqData,
      timeDomain: this.timeData,
      bassLevel: bassSum / (bassCount * 255),
      midLevel: midSum / (midCount * 255),
      trebleLevel: trebleSum / (trebleCount * 255),
      rms,
    };
  }

  dispose(): void {
    try {
      this.source?.disconnect();
      this.analyser.disconnect();
      this.dryGain.disconnect();
      this.wetGain.disconnect();
      this.convolver.disconnect();
      this.destinationGain.disconnect();
      void this.ctx.close();
    } catch {
      // ignore
    }
  }
}
