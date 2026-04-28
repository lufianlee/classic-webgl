'use client';

import { Canvas, useThree } from '@react-three/fiber';
import { Suspense, useEffect, useMemo } from 'react';
import {
  Bloom,
  ChromaticAberration,
  DepthOfField,
  EffectComposer,
  Noise,
  SMAA,
  Vignette,
} from '@react-three/postprocessing';
import { N8AO } from '@react-three/postprocessing';
import { BlendFunction } from 'postprocessing';
import * as THREE from 'three';
import { RoomEnvironment } from 'three-stdlib';
import { TrebleParticles } from './TrebleParticles';
import { Cathedral } from './spaces/Cathedral';
import { ConcertHall } from './spaces/ConcertHall';
import { Salon } from './spaces/Salon';
import { WalkControls } from './WalkControls';
import type { AudioEngine } from '@/lib/audio';
import type { SpacePreset } from '@/lib/api';
import type { RealtimeFeatures } from '@/lib/realtime';
import { keyToColor, useAppStore } from '@/lib/store';
import { QUALITY_PROFILES, type QualityProfile } from '@/lib/quality';

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

/**
 * Procedural image-based lighting. RoomEnvironment generates a lit
 * scene that we bake into a PMREM and assign to scene.environment —
 * instant PBR-correct reflections and soft fill without loading any
 * HDRI asset. Runs once per quality-profile change.
 */
function SceneEnvironment({ intensity }: { intensity: number }) {
  const { scene, gl } = useThree();

  useEffect(() => {
    const pmrem = new THREE.PMREMGenerator(gl);
    pmrem.compileEquirectangularShader();
    // RoomEnvironment in three-stdlib is a factory function, not a class —
    // it builds a small Scene with stylized area lights we bake into PMREM.
    const room = RoomEnvironment();
    const envMap = pmrem.fromScene(room, 0.04).texture;
    scene.environment = envMap;
    scene.environmentIntensity = intensity;

    return () => {
      scene.environment = null;
      envMap.dispose();
      pmrem.dispose();
    };
  }, [scene, gl, intensity]);

  return null;
}

/**
 * Applies imperative renderer settings that don't have R3F JSX props —
 * shadow map type, tone-mapping exposure, output color space.
 */
function RendererTuning({ profile }: { profile: QualityProfile }) {
  const { gl } = useThree();

  useEffect(() => {
    gl.toneMapping = THREE.ACESFilmicToneMapping;
    gl.toneMappingExposure = profile.exposure;
    gl.outputColorSpace = THREE.SRGBColorSpace;
    gl.shadowMap.enabled = profile.shadows.enabled;
    gl.shadowMap.type = profile.shadows.type;
    gl.shadowMap.needsUpdate = true;
  }, [gl, profile]);

  return null;
}

export function SpatialScene({
  engine,
  preset,
  getRealtime,
  features,
  fallbackKey,
  fallbackMode,
}: Props) {
  const quality = useAppStore((s) => s.quality);
  const profile = QUALITY_PROFILES[quality];

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

  // DPR → R3F takes either a single number or [min, max] range. 'native'
  // means "don't clamp — let the browser's devicePixelRatio through" which
  // we implement by reading from window at mount (SSR-safe default = 2).
  const dpr = useMemo((): number | [number, number] => {
    if (profile.dpr === 'native') {
      if (typeof window === 'undefined') return [1, 2];
      return Math.min(window.devicePixelRatio, 3);
    }
    return profile.dpr;
  }, [profile.dpr]);

  // GPU antialiasing for the main render target. We prefer MSAA on the
  // EffectComposer (via `multisampling` below) because SMAA alone can't
  // catch subpixel crawling on the brick normals at exhibition DPR.
  const baseParticleDensity =
    preset === 'cathedral' ? 3300 : preset === 'concert_hall' ? 1800 : 750;
  const particleDensity = Math.round(
    baseParticleDensity * profile.particleDensityScale,
  );

  // React key on the EffectComposer — changing the pipeline shape (e.g.
  // adding/removing DOF) between quality tiers is safest as a full remount.
  const composerKey = `${profile.id}-${preset}`;

  return (
    <Canvas
      shadows
      dpr={dpr}
      camera={{ fov: preset === 'salon' ? 58 : 68, near: 0.05, far: 200, position: cameraStart }}
      gl={{
        antialias: profile.msaa === 0, // only when MSAA is disabled at composer level
        alpha: false,
        powerPreference: 'high-performance',
        toneMapping: THREE.ACESFilmicToneMapping,
        stencil: false,
        depth: true,
      }}
      style={{ position: 'absolute', inset: 0 }}
    >
      <RendererTuning profile={profile} />
      {profile.ibl.enabled && (
        <SceneEnvironment intensity={profile.ibl.intensity} />
      )}

      <color attach="background" args={[fogConfig.color]} />
      <fog attach="fog" args={[fogConfig.color, fogConfig.near, fogConfig.far]} />

      <Suspense fallback={null}>
        {preset === 'cathedral' && <Cathedral />}
        {preset === 'concert_hall' && <ConcertHall />}
        {preset === 'salon' && <Salon />}

        {/* Particles are scaled per-space so they don't overpower smaller rooms.
            Keyed by preset+quality so switching fully re-mounts the points +
            shaderMaterial — keeps the uniform refs the GPU reads from in sync
            with the useFrame closure writing to them. */}
        <TrebleParticles
          key={`${preset}-${profile.id}`}
          engine={engine}
          color={palette.accent}
          radius={WALK_BOUNDS[preset].radius * 0.8}
          height={preset === 'cathedral' ? 24 : preset === 'concert_hall' ? 12 : 5}
          density={particleDensity}
        />
      </Suspense>

      <WalkControls
        engine={engine}
        getRealtime={getRealtime}
        bounds={WALK_BOUNDS[preset].radius}
      />

      {/* Postprocessing stack — shape varies by quality tier.
          Children are collected into an array so we can conditionally
          include each pass; EffectComposer's typing rejects null children
          so we filter falsy entries out. */}
      <EffectComposer
        key={composerKey}
        multisampling={profile.msaa}
        enableNormalPass={profile.ao.enabled}
      >
        {(
          [
            profile.ao.enabled && (
              <N8AO
                key="n8ao"
                aoRadius={profile.ao.aoRadius}
                intensity={profile.ao.intensity}
                aoSamples={profile.ao.aoSamples}
                denoiseSamples={profile.ao.denoiseSamples}
                quality={profile.ao.quality}
                halfRes={profile.ao.halfRes}
              />
            ),
            profile.bloom.enabled && (
              <Bloom
                key="bloom"
                intensity={profile.bloom.intensity}
                luminanceThreshold={profile.bloom.luminanceThreshold}
                luminanceSmoothing={0.25}
                mipmapBlur={profile.bloom.mipmapBlur}
              />
            ),
            profile.dof.enabled && (
              <DepthOfField
                key="dof"
                focusDistance={profile.dof.focusDistance}
                focalLength={profile.dof.focalLength}
                bokehScale={profile.dof.bokehScale}
              />
            ),
            <Vignette key="vig" eskil={false} offset={0.15} darkness={0.85} />,
            profile.chromaticAberration.enabled && (
              <ChromaticAberration
                key="ca"
                offset={
                  new THREE.Vector2(
                    profile.chromaticAberration.offset,
                    profile.chromaticAberration.offset,
                  )
                }
                radialModulation={true}
                modulationOffset={0.35}
              />
            ),
            profile.grain.enabled && (
              <Noise
                key="grain"
                opacity={profile.grain.opacity}
                blendFunction={BlendFunction.OVERLAY}
                premultiply={false}
              />
            ),
            profile.smaa && <SMAA key="smaa" />,
          ].filter(Boolean) as JSX.Element[]
        )}
      </EffectComposer>
    </Canvas>
  );
}
