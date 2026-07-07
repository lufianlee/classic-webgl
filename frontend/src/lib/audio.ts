/**
 * Audio engine: wraps an HTMLAudioElement with a Web Audio graph that feeds
 * an AnalyserNode (for real-time FFT driving the WebGL scene) and a
 * physically-motivated spatial acoustics chain.
 *
 * Spatial model (per space preset):
 *
 *   source ─▶ analyser                       (feature extraction, silent)
 *   source ─▶ airFilter ─▶ dryGain ─▶ dryPanner (HRTF) ──────────┐
 *   source ─▶ erConvolver ─▶ erGain ─▶ erPanner (HRTF) ──────────┤
 *   source ─▶ lateConvolver ─▶ lateGain ─────────────────────────┤
 *                                                                ▼
 *                                                     destinationGain ─▶ out
 *
 *   - Direct sound (dry) is HRTF-panned and distance-attenuated, with a
 *     distance-driven lowpass modelling air absorption: walk away from the
 *     ensemble and the top end melts off exactly like it does in a real nave.
 *   - Early reflections get their own short convolution and their own HRTF
 *     panner at the source position with a gentler rolloff — early energy
 *     stays directional (you hear *where* the stage is even eyes-closed) but
 *     doesn't die with distance as fast as the direct path.
 *   - The late tail is deliberately NOT panned: a diffuse reverberant field
 *     arrives from everywhere and its level barely changes as you move.
 *     The audible direct-to-reverberant ratio therefore shifts naturally
 *     with listener position — near the source it's dry and present, at the
 *     back of the room it's bathed in the space.
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
  /** Mix levels for the three parallel paths. */
  mix: { dry: number; early: number; late: number };
  /** Distance (units) at which air absorption reaches full effect. */
  farDistance: number;
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
    mix: { dry: 0.55, early: 0.5, late: 1.35 },
    farDistance: 42,
  },
  // Mid-sized shoebox: quicker onset, crisp early reflections from side
  // walls, tail mostly intact to ~4 kHz.
  concert_hall: {
    rt60: 2.0,
    preDelay: 0.028,
    earlyReflections: [0.035, 0.055, 0.078, 0.1, 0.13],
    hfRolloffHz: 6000,
    stereoSpread: 0.55,
    mix: { dry: 0.85, early: 0.45, late: 0.8 },
    farDistance: 26,
  },
  // Small room: almost no pre-delay, reflections packed close, short tail.
  salon: {
    rt60: 0.7,
    preDelay: 0.009,
    earlyReflections: [0.014, 0.021, 0.03, 0.042],
    hfRolloffHz: 7500,
    stereoSpread: 0.3,
    mix: { dry: 1.0, early: 0.35, late: 0.3 },
    farDistance: 9,
  },
};

/**
 * Early-reflection impulse response: pre-delay + a cluster of discrete,
 * per-ear-jittered reflections with a little diffusion between them.
 * No tail — that lives in its own convolver.
 */
function synthesizeEarlyIR(ctx: AudioContext, preset: SpacePreset): AudioBuffer {
  const sr = ctx.sampleRate;
  const spec = SPACE_ACOUSTICS[preset];
  const lastEr = spec.earlyReflections[spec.earlyReflections.length - 1];
  const length = Math.max(1, Math.floor(sr * (spec.preDelay + lastEr + 0.03)));
  const ir = ctx.createBuffer(2, length, sr);
  const decayConstant = Math.log(1000) / spec.rt60;

  for (let ch = 0; ch < 2; ch++) {
    const data = ir.getChannelData(ch);
    for (const erTime of spec.earlyReflections) {
      const jitter = (Math.random() - 0.5) * 0.002 * spec.stereoSpread;
      const idx = Math.floor(
        sr * (spec.preDelay + erTime + (ch === 0 ? -jitter : jitter)),
      );
      if (idx >= 0 && idx < length) {
        const amp =
          0.8 * Math.exp(-decayConstant * erTime) * (0.7 + Math.random() * 0.3);
        data[idx] += (Math.random() < 0.5 ? -1 : 1) * amp;
        // Diffusion: a few quiet scattered taps trailing each reflection,
        // like the reflection shattering on ornament and moulding.
        for (let d = 0; d < 4; d++) {
          const dIdx = idx + Math.floor(sr * (0.001 + Math.random() * 0.006));
          if (dIdx < length) {
            data[dIdx] += (Math.random() * 2 - 1) * amp * 0.22;
          }
        }
      }
    }
  }
  return ir;
}

/**
 * Late-tail impulse response: bandlimited stochastic decay that ramps in
 * where the early cluster ends. Channels use independent noise streams so
 * the tail is wide and enveloping.
 */
function synthesizeLateIR(ctx: AudioContext, preset: SpacePreset): AudioBuffer {
  const sr = ctx.sampleRate;
  const spec = SPACE_ACOUSTICS[preset];
  const length = Math.max(1, Math.floor(sr * (spec.rt60 * 1.1 + spec.preDelay)));
  const ir = ctx.createBuffer(2, length, sr);
  const decayConstant = Math.log(1000) / spec.rt60;
  const lastErSample = Math.floor(
    sr * (spec.preDelay + spec.earlyReflections[spec.earlyReflections.length - 1]),
  );
  const preDelaySamples = Math.floor(sr * spec.preDelay);
  const alpha = Math.exp((-2 * Math.PI * spec.hfRolloffHz) / sr);

  for (let ch = 0; ch < 2; ch++) {
    const data = ir.getChannelData(ch);
    let lpState = 0;
    for (let i = preDelaySamples; i < length; i++) {
      const t = (i - preDelaySamples) / sr;
      const rampIn = Math.min(1, Math.max(0, (i - lastErSample) / (sr * 0.05)));
      const noise = Math.random() * 2 - 1;
      // 1-pole lowpass: y[n] = (1 - α)·x[n] + α·y[n-1]
      lpState = (1 - alpha) * noise + alpha * lpState;
      const tailAmp = Math.exp(-decayConstant * t) * 0.55;
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

/** Smoothing time constant for all per-frame AudioParam moves (seconds). */
const PARAM_SMOOTH = 0.06;

function setPannerPosition(
  panner: PannerNode,
  ctx: AudioContext,
  x: number,
  y: number,
  z: number,
): void {
  const t = ctx.currentTime;
  if (panner.positionX) {
    panner.positionX.setValueAtTime(x, t);
    panner.positionY.setValueAtTime(y, t);
    panner.positionZ.setValueAtTime(z, t);
  } else {
    (panner as unknown as {
      setPosition: (x: number, y: number, z: number) => void;
    }).setPosition(x, y, z);
  }
}

function setPannerOrientation(
  panner: PannerNode,
  ctx: AudioContext,
  x: number,
  y: number,
  z: number,
): void {
  const t = ctx.currentTime;
  if (panner.orientationX) {
    panner.orientationX.setValueAtTime(x, t);
    panner.orientationY.setValueAtTime(y, t);
    panner.orientationZ.setValueAtTime(z, t);
  } else {
    (panner as unknown as {
      setOrientation: (x: number, y: number, z: number) => void;
    }).setOrientation(x, y, z);
  }
}

export class AudioEngine {
  readonly ctx: AudioContext;
  readonly audioEl: HTMLAudioElement;
  readonly analyser: AnalyserNode;
  readonly realtime: RealtimeAnalyzer;

  private source: MediaElementAudioSourceNode | null = null;

  // Direct path
  private airFilter: BiquadFilterNode;
  private dryGain: GainNode;
  private dryPanner: PannerNode;

  // Early-reflection path (directional)
  private erConvolver: ConvolverNode;
  private erGain: GainNode;
  private erPanner: PannerNode;

  // Late diffuse path (non-directional)
  private lateConvolver: ConvolverNode;
  private lateGain: GainNode;

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

    // ——— Direct path ————————————————————————————————————————————————
    // Air absorption: high frequencies die first over distance. Cutoff is
    // driven per-frame from the listener distance in setListener().
    this.airFilter = this.ctx.createBiquadFilter();
    this.airFilter.type = 'lowpass';
    this.airFilter.frequency.value = 20000;
    this.airFilter.Q.value = 0.0001; // no resonant bump, just a gentle knee

    this.dryGain = this.ctx.createGain();

    // HRTF gives front/back + left/right cues. Inverse distance model with
    // refDistance=1.5 ≈ scene units are meters.
    this.dryPanner = this.ctx.createPanner();
    this.dryPanner.panningModel = 'HRTF';
    this.dryPanner.distanceModel = 'inverse';
    this.dryPanner.refDistance = 1.5;
    this.dryPanner.maxDistance = 60;
    this.dryPanner.rolloffFactor = 1.4;
    // Source directivity: an ensemble radiates mostly forward (toward the
    // audience). Walk behind the stage and the direct sound loses presence.
    this.dryPanner.coneInnerAngle = 140;
    this.dryPanner.coneOuterAngle = 320;
    this.dryPanner.coneOuterGain = 0.45;

    // ——— Early reflections (directional, gentler rolloff) ————————————
    this.erConvolver = this.ctx.createConvolver();
    this.erGain = this.ctx.createGain();
    this.erPanner = this.ctx.createPanner();
    this.erPanner.panningModel = 'HRTF';
    this.erPanner.distanceModel = 'inverse';
    this.erPanner.refDistance = 2.5;
    this.erPanner.maxDistance = 80;
    this.erPanner.rolloffFactor = 0.6; // early energy fades slower than direct
    this.erPanner.coneInnerAngle = 360; // reflections wrap around the room
    this.erPanner.coneOuterAngle = 0;
    this.erPanner.coneOuterGain = 0;

    // ——— Late diffuse field ————————————————————————————————————————
    this.lateConvolver = this.ctx.createConvolver();
    this.lateGain = this.ctx.createGain();

    this.destinationGain = this.ctx.createGain();
    this.destinationGain.gain.value = 0.9;

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
      this.source.connect(this.analyser);

      // Direct
      this.source.connect(this.airFilter);
      this.airFilter.connect(this.dryGain);
      this.dryGain.connect(this.dryPanner);
      this.dryPanner.connect(this.destinationGain);

      // Early reflections
      this.source.connect(this.erConvolver);
      this.erConvolver.connect(this.erGain);
      this.erGain.connect(this.erPanner);
      this.erPanner.connect(this.destinationGain);

      // Late tail
      this.source.connect(this.lateConvolver);
      this.lateConvolver.connect(this.lateGain);
      this.lateGain.connect(this.destinationGain);

      this.destinationGain.connect(this.ctx.destination);
    }
  }

  /**
   * Per-frame spatial update: listener pose + all distance-dependent
   * processing. `forward` should include pitch (looking up in the nave
   * genuinely rotates the sound field).
   */
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
    // setTargetAtTime smooths frame-to-frame jumps — no zipper noise even
    // during fast mouse-look.
    if (listener.positionX) {
      listener.positionX.setTargetAtTime(px, t, PARAM_SMOOTH);
      listener.positionY.setTargetAtTime(py, t, PARAM_SMOOTH);
      listener.positionZ.setTargetAtTime(pz, t, PARAM_SMOOTH);
      listener.forwardX.setTargetAtTime(fx, t, PARAM_SMOOTH);
      listener.forwardY.setTargetAtTime(fy, t, PARAM_SMOOTH);
      listener.forwardZ.setTargetAtTime(fz, t, PARAM_SMOOTH);
      listener.upX.setTargetAtTime(ux, t, PARAM_SMOOTH);
      listener.upY.setTargetAtTime(uy, t, PARAM_SMOOTH);
      listener.upZ.setTargetAtTime(uz, t, PARAM_SMOOTH);
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

    // ——— Distance-dependent processing ————————————————————————————
    const spec = SPACE_ACOUSTICS[this.preset];
    const d = this.distanceToSource(position);

    // Air absorption: flat up close, melting to ~4 kHz at the far wall.
    // Perceptually tuned curve — exponent < 1 keeps the mid-field natural.
    const farness = Math.min(1, Math.max(0, d / spec.farDistance));
    const cutoff = 20000 - (20000 - 4200) * Math.pow(farness, 0.85);
    this.airFilter.frequency.setTargetAtTime(cutoff, t, PARAM_SMOOTH);

    // Reverberant field: essentially constant level, but swelling slightly
    // toward the back of the room (in a real hall the tail is a touch
    // stronger far from the source, where direct energy no longer masks it).
    const lateSwell = 0.85 + 0.3 * farness;
    this.lateGain.gain.setTargetAtTime(spec.mix.late * lateSwell, t, PARAM_SMOOTH);
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
    const spec = SPACE_ACOUSTICS[preset];

    this.erConvolver.buffer = synthesizeEarlyIR(this.ctx, preset);
    this.lateConvolver.buffer = synthesizeLateIR(this.ctx, preset);

    const t = this.ctx.currentTime;
    // Ramp the change over 250 ms so preset switches don't click/pop.
    for (const [node, target] of [
      [this.dryGain, spec.mix.dry],
      [this.erGain, spec.mix.early],
      [this.lateGain, spec.mix.late],
    ] as const) {
      node.gain.cancelScheduledValues(t);
      node.gain.linearRampToValueAtTime(target, t + 0.25);
    }

    // Place both directional paths at the ensemble position, radiating
    // toward the audience (+z in every preset's layout).
    const [sx, sy, sz] = SOURCE_POSITION[preset];
    setPannerPosition(this.dryPanner, this.ctx, sx, sy, sz);
    setPannerOrientation(this.dryPanner, this.ctx, 0, 0, 1);
    setPannerPosition(this.erPanner, this.ctx, sx, sy, sz);
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
      this.airFilter.disconnect();
      this.dryGain.disconnect();
      this.dryPanner.disconnect();
      this.erConvolver.disconnect();
      this.erGain.disconnect();
      this.erPanner.disconnect();
      this.lateConvolver.disconnect();
      this.lateGain.disconnect();
      this.destinationGain.disconnect();
      void this.ctx.close();
    } catch {
      // ignore
    }
  }
}
