/**
 * Rendering quality profiles.
 *
 * Three tiers targeted at different hardware classes:
 *   - performance : integrated GPU / low-power laptop. Everything expensive
 *     is off; DPR clamped to 1.
 *   - balanced    : modern dedicated GPU (GTX 1660 / M1 Pro class). PCF soft
 *     shadows + IBL + bloom + SMAA. No AO, no DOF.
 *   - exhibition  : exhibition-booth PC with a beefy GPU (RTX 3060+ / M2
 *     Max). Full pipeline: high-res VSM shadows, IBL, N8AO, DOF, film grain,
 *     chromatic aberration, full-native DPR.
 *
 * Numeric settings are consumed by SpatialScene; presence flags gate the
 * postprocessing EffectComposer children.
 */

import * as THREE from 'three';

export type QualityTier = 'performance' | 'balanced' | 'exhibition';

export interface QualityProfile {
  id: QualityTier;
  label: string;
  shortLabel: string;
  description: string;

  /** Device-pixel-ratio clamp. 'native' = use devicePixelRatio as-is. */
  dpr: [number, number] | 'native';
  /** MSAA samples for the main WebGL context (only effective on WebGL2). */
  msaa: 0 | 2 | 4 | 8;
  /** ACES tone mapping exposure. */
  exposure: number;

  shadows: {
    enabled: boolean;
    type: typeof THREE.PCFShadowMap | typeof THREE.PCFSoftShadowMap | typeof THREE.VSMShadowMap;
    mapSize: number; // per-light shadow map resolution
  };

  /** Image-based lighting from a procedural RoomEnvironment PMREM. */
  ibl: {
    enabled: boolean;
    intensity: number;
  };

  /** Horizon-based AO (N8AO). */
  ao: {
    enabled: boolean;
    aoRadius: number;
    intensity: number;
    aoSamples: number;
    denoiseSamples: number;
    quality: 'low' | 'medium' | 'high' | 'ultra';
    halfRes: boolean;
  };

  bloom: {
    enabled: boolean;
    intensity: number;
    luminanceThreshold: number;
    mipmapBlur: boolean;
  };

  /** Depth of field — focuses on the camera-forward focal distance. */
  dof: {
    enabled: boolean;
    focusDistance: number; // 0..1, normalized
    focalLength: number;
    bokehScale: number;
  };

  /** Cinematic film grain. */
  grain: {
    enabled: boolean;
    opacity: number;
  };

  /** Subtle chromatic aberration at the frame edges. */
  chromaticAberration: {
    enabled: boolean;
    offset: number;
  };

  /** Multiplier on TrebleParticles particle counts. */
  particleDensityScale: number;

  /** Whether to rely on postprocessing SMAA. Always on if msaa is 0. */
  smaa: boolean;
}

export const QUALITY_PROFILES: Record<QualityTier, QualityProfile> = {
  performance: {
    id: 'performance',
    label: 'Performance',
    shortLabel: 'Perf',
    description: 'Low-power GPU / laptop. Smooth framerate, reduced effects.',
    dpr: [1, 1],
    msaa: 0,
    exposure: 1.05,
    shadows: {
      enabled: true,
      type: THREE.PCFShadowMap,
      mapSize: 1024,
    },
    ibl: {
      enabled: false,
      intensity: 0.35,
    },
    ao: {
      enabled: false,
      aoRadius: 2.5,
      intensity: 2.0,
      aoSamples: 16,
      denoiseSamples: 4,
      quality: 'low',
      halfRes: true,
    },
    bloom: {
      enabled: true,
      intensity: 0.6,
      luminanceThreshold: 0.55,
      mipmapBlur: false,
    },
    dof: {
      enabled: false,
      focusDistance: 0.02,
      focalLength: 0.05,
      bokehScale: 3,
    },
    grain: {
      enabled: false,
      opacity: 0.18,
    },
    chromaticAberration: {
      enabled: false,
      offset: 0.0004,
    },
    particleDensityScale: 0.5,
    smaa: true,
  },
  balanced: {
    id: 'balanced',
    label: 'Balanced',
    shortLabel: 'Bal',
    description: 'Modern dedicated GPU. Soft shadows + IBL + bloom.',
    dpr: [1, 1.5],
    msaa: 4,
    exposure: 1.1,
    shadows: {
      enabled: true,
      type: THREE.PCFSoftShadowMap,
      mapSize: 2048,
    },
    ibl: {
      enabled: true,
      intensity: 0.55,
    },
    ao: {
      enabled: true,
      aoRadius: 3.0,
      intensity: 2.4,
      aoSamples: 24,
      denoiseSamples: 4,
      quality: 'medium',
      halfRes: true,
    },
    bloom: {
      enabled: true,
      intensity: 0.85,
      luminanceThreshold: 0.5,
      mipmapBlur: true,
    },
    dof: {
      enabled: false,
      focusDistance: 0.02,
      focalLength: 0.05,
      bokehScale: 4,
    },
    grain: {
      enabled: true,
      opacity: 0.12,
    },
    chromaticAberration: {
      enabled: false,
      offset: 0.0004,
    },
    particleDensityScale: 1.0,
    smaa: true,
  },
  exhibition: {
    id: 'exhibition',
    label: 'Exhibition',
    shortLabel: 'Exhib',
    description: 'Max quality for exhibition PCs. Full cinematic pipeline.',
    dpr: 'native',
    msaa: 8,
    exposure: 1.15,
    shadows: {
      enabled: true,
      type: THREE.VSMShadowMap,
      mapSize: 4096,
    },
    ibl: {
      enabled: true,
      intensity: 0.75,
    },
    ao: {
      enabled: true,
      aoRadius: 3.5,
      intensity: 2.8,
      aoSamples: 36,
      denoiseSamples: 8,
      quality: 'ultra',
      halfRes: false,
    },
    bloom: {
      enabled: true,
      intensity: 1.05,
      luminanceThreshold: 0.45,
      mipmapBlur: true,
    },
    dof: {
      enabled: true,
      focusDistance: 0.018,
      focalLength: 0.055,
      bokehScale: 5,
    },
    grain: {
      enabled: true,
      opacity: 0.1,
    },
    chromaticAberration: {
      enabled: true,
      offset: 0.00055,
    },
    particleDensityScale: 1.4,
    smaa: true,
  },
};

export const DEFAULT_QUALITY: QualityTier = 'balanced';
