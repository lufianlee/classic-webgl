'use client';

import { Canvas } from '@react-three/fiber';
import { Suspense, useMemo } from 'react';
import {
  Bloom,
  EffectComposer,
  SMAA,
  Vignette,
} from '@react-three/postprocessing';
import * as THREE from 'three';
import { TrebleParticles } from './TrebleParticles';
import { Cathedral } from './spaces/Cathedral';
import { ConcertHall } from './spaces/ConcertHall';
import { Salon } from './spaces/Salon';
import { WalkControls } from './WalkControls';
import type { AudioEngine } from '@/lib/audio';
import type { SpacePreset } from '@/lib/api';
import type { RealtimeFeatures } from '@/lib/realtime';
import { keyToColor } from '@/lib/store';

interface Props {
  engine: AudioEngine | null;
  preset: SpacePreset;
  /** Ref-based accessor: reads the current frame's features, no re-render. */
  getRealtime: () => RealtimeFeatures;
  /** Throttled features for color-palette re-computation (~10 Hz). */
  features: RealtimeFeatures;
  fallbackKey: string;
  fallbackMode: 'major' | 'minor';
}

function hslColor(h: number, s: number, l: number): THREE.Color {
  const c = new THREE.Color();
  c.setHSL(h / 360, s, l);
  return c;
}

const WALK_BOUNDS: Record<SpacePreset, { radius: number }> = {
  cathedral: { radius: 28 },
  concert_hall: { radius: 16 },
  salon: { radius: 6.5 },
};

export function SpatialScene({
  engine,
  preset,
  getRealtime,
  features,
  fallbackKey,
  fallbackMode,
}: Props) {
  // Use real-time key if confident, otherwise fall back to the backend's
  // whole-track estimate so colors don't swing wildly during silence.
  const activeKey =
    features.keyConfidence > 0.1 ? features.key : (fallbackKey as typeof features.key);
  const activeMode = features.keyConfidence > 0.1 ? features.mode : fallbackMode;

  const palette = useMemo(() => {
    const { hue, saturation, lightness } = keyToColor(activeKey, activeMode);
    return {
      accent: hslColor(hue, saturation, lightness),
      soft: hslColor((hue + 30) % 360, saturation * 0.5, lightness * 0.35),
    };
  }, [activeKey, activeMode]);

  const fogConfig = useMemo(() => {
    if (preset === 'cathedral') return { color: '#0c0a12', near: 14, far: 70 };
    if (preset === 'concert_hall') return { color: '#140e08', near: 10, far: 40 };
    return { color: '#1a120a', near: 6, far: 22 };
  }, [preset]);

  const cameraStart = useMemo(() => {
    if (preset === 'cathedral') return [0, 1.7, 22] as const;
    if (preset === 'concert_hall') return [0, 1.7, 12] as const;
    return [0, 1.6, 4] as const;
  }, [preset]);

  return (
    <Canvas
      shadows
      camera={{ fov: preset === 'salon' ? 58 : 68, near: 0.05, far: 200, position: cameraStart }}
      gl={{
        antialias: false, // postprocessing SMAA handles it
        alpha: false,
        powerPreference: 'high-performance',
        toneMapping: THREE.ACESFilmicToneMapping,
      }}
      onCreated={({ gl }) => {
        gl.toneMappingExposure = 1.05;
      }}
      style={{ position: 'absolute', inset: 0 }}
    >
      <color attach="background" args={[fogConfig.color]} />
      <fog attach="fog" args={[fogConfig.color, fogConfig.near, fogConfig.far]} />

      <Suspense fallback={null}>
        {preset === 'cathedral' && <Cathedral />}
        {preset === 'concert_hall' && <ConcertHall />}
        {preset === 'salon' && <Salon />}

        {/* Particles are scaled per-space so they don't overpower smaller rooms.
            Keyed by preset so switching spaces fully re-mounts the points +
            shaderMaterial — keeps the uniform refs the GPU reads from in sync
            with the useFrame closure writing to them. */}
        <TrebleParticles
          key={preset}
          engine={engine}
          color={palette.accent}
          radius={WALK_BOUNDS[preset].radius * 0.8}
          height={preset === 'cathedral' ? 24 : preset === 'concert_hall' ? 12 : 5}
          density={preset === 'cathedral' ? 3300 : preset === 'concert_hall' ? 1800 : 750}
        />
      </Suspense>

      <WalkControls
        engine={engine}
        getRealtime={getRealtime}
        bounds={WALK_BOUNDS[preset].radius}
      />

      {/* Postprocessing: Bloom on emissive highlights (candles, stained glass,
           chandelier, particles); Vignette darkens the edges for focus;
           SMAA cleans up the jaggies from the sharp brick/parquet normals. */}
      <EffectComposer multisampling={0}>
        <Bloom
          intensity={preset === 'cathedral' ? 0.9 : preset === 'salon' ? 0.6 : 0.55}
          luminanceThreshold={0.5}
          luminanceSmoothing={0.25}
          mipmapBlur
        />
        <Vignette eskil={false} offset={0.15} darkness={0.85} />
        <SMAA />
      </EffectComposer>
    </Canvas>
  );
}
