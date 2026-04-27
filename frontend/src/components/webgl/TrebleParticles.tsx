'use client';

import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { AudioEngine } from '@/lib/audio';

/**
 * Audio-reactive particle cloud. Despite the name, it now dances to all
 * three bands:
 *   - bass  drives vertical bounce + size pulse (kick-like)
 *   - mid   drives lateral swirl speed
 *   - treble drives brightness + radial expansion
 * A beat-gate pulse adds a short burst whenever RMS spikes, so the cloud
 * visibly "kicks" on downbeats even when the running band levels are low.
 */

const vertexShader = /* glsl */ `
uniform float uTime;
uniform float uBass;
uniform float uMid;
uniform float uTreble;
uniform float uPulse;
uniform float uSize;
uniform float uHeight;
attribute float aSeed;
attribute float aLifetime;
varying float vIntensity;

void main() {
  vec3 pos = position;

  // Lifetime-based vertical drift. Bass accelerates it (particles bounce
  // upward harder on low-frequency hits), pulse kicks the phase forward.
  float t = mod(uTime * (0.35 + uBass * 0.8) + aLifetime + uPulse * 0.1, 1.0);
  pos.y += t * uHeight;
  // A per-particle vertical bob synced to bass — gives the cloud a visible
  // thump on each kick.
  pos.y += sin(uTime * 2.0 + aSeed * 12.56) * uBass * 0.6;

  // Mid frequencies drive the swirl rate; treble expands the radius.
  float swirl = uTime * (0.4 + uMid * 1.2) + aSeed * 6.28;
  float s = sin(swirl);
  float c = cos(swirl);
  float radiusScale = 1.0 + uTreble * 0.35 + uPulse * 0.4;
  pos.xz = mat2(c, -s, s, c) * pos.xz * radiusScale;

  vec4 mv = modelViewMatrix * vec4(pos, 1.0);
  // Intensity: base fade plus a big punch on pulses.
  vIntensity = (1.0 - t) * (0.35 + uTreble * 1.4 + uBass * 0.6 + uPulse * 1.8);
  gl_Position = projectionMatrix * mv;
  // Size pulses with bass + beat; treble gives a constant sparkle bump.
  float sizeMul = 0.6 + uTreble * 1.6 + uBass * 1.4 + uPulse * 2.2;
  gl_PointSize = uSize * sizeMul * (12.0 / -mv.z);
}
`;

const fragmentShader = /* glsl */ `
uniform vec3 uColor;
uniform vec3 uPulseColor;
uniform float uPulse;
varying float vIntensity;

void main() {
  // Soft circular sprite with a hot core when the pulse fires.
  vec2 c = gl_PointCoord - 0.5;
  float d = length(c);
  float alpha = smoothstep(0.5, 0.0, d) * vIntensity;
  if (alpha < 0.01) discard;
  vec3 col = mix(uColor, uPulseColor, clamp(uPulse * 1.4, 0.0, 1.0));
  gl_FragColor = vec4(col, alpha);
}
`;

interface Props {
  engine: AudioEngine | null;
  color: THREE.Color;
  radius?: number;
  height?: number;
  density?: number;
}

export function TrebleParticles({
  engine,
  color,
  radius = 32,
  height = 14,
  density = 1500,
}: Props) {
  const geom = useMemo(() => {
    const g = new THREE.BufferGeometry();
    const positions = new Float32Array(density * 3);
    const seeds = new Float32Array(density);
    const lifetimes = new Float32Array(density);
    for (let i = 0; i < density; i++) {
      const r = 2 + Math.random() * radius;
      const theta = Math.random() * Math.PI * 2;
      positions[i * 3 + 0] = Math.cos(theta) * r;
      positions[i * 3 + 1] = Math.random() * height * 0.3;
      positions[i * 3 + 2] = Math.sin(theta) * r;
      seeds[i] = Math.random();
      lifetimes[i] = Math.random();
    }
    g.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    g.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1));
    g.setAttribute('aLifetime', new THREE.BufferAttribute(lifetimes, 1));
    return g;
  }, [radius, height, density]);

  // Uniforms live in a ref so the reference survives preset changes.
  // useMemo with deps would create a NEW uniforms object when height
  // changed, but the <shaderMaterial> below captures the object at mount
  // time — the stale reference is what the GPU keeps reading, so our
  // useFrame writes would silently go to a detached object and the
  // animation would freeze. Keep the same object forever; mutate fields.
  const uniformsRef = useRef<{ [k: string]: { value: unknown } } | null>(null);
  if (uniformsRef.current === null) {
    uniformsRef.current = {
      uTime: { value: 0 },
      uBass: { value: 0 },
      uMid: { value: 0 },
      uTreble: { value: 0 },
      uPulse: { value: 0 },
      uSize: { value: 22 },
      uHeight: { value: height },
      uColor: { value: color.clone() },
      uPulseColor: { value: new THREE.Color('#ffeccc') },
    };
  }
  const uniforms = uniformsRef.current;

  // Update `uHeight` when the preset changes without recreating the uniforms.
  useEffect(() => {
    (uniforms.uHeight as { value: number }).value = height;
  }, [height, uniforms]);

  const pointsRef = useRef<THREE.Points>(null);
  const rmsHistoryRef = useRef<number>(0);

  useFrame((_, delta) => {
    const u = uniforms as {
      uTime: { value: number };
      uBass: { value: number };
      uMid: { value: number };
      uTreble: { value: number };
      uPulse: { value: number };
      uColor: { value: THREE.Color };
    };
    u.uTime.value += delta;
    u.uColor.value.lerp(color, 0.06);
    if (engine) {
      const f = engine.sample();
      u.uBass.value = THREE.MathUtils.lerp(u.uBass.value, f.bassLevel, 0.2);
      u.uMid.value = THREE.MathUtils.lerp(u.uMid.value, f.midLevel, 0.15);
      u.uTreble.value = THREE.MathUtils.lerp(u.uTreble.value, f.trebleLevel, 0.15);

      // Beat gate: detect an RMS jump beyond the running average. A positive
      // derivative above a threshold fires a short pulse; the pulse then
      // decays via exponential smoothing each frame.
      const rms = f.rms;
      const prev = rmsHistoryRef.current;
      const jump = rms - prev;
      rmsHistoryRef.current = prev * 0.85 + rms * 0.15;
      if (jump > 0.06) {
        u.uPulse.value = Math.min(1, u.uPulse.value + jump * 3);
      }
      u.uPulse.value *= Math.pow(0.12, delta); // ~0.12/sec decay
    }
  });

  return (
    <points ref={pointsRef} geometry={geom}>
      <shaderMaterial
        uniforms={uniforms}
        vertexShader={vertexShader}
        fragmentShader={fragmentShader}
        transparent
        depthWrite={false}
        blending={THREE.AdditiveBlending}
      />
    </points>
  );
}
