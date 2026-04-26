'use client';

import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { AudioEngine } from '@/lib/audio';

/**
 * Particle cloud that responds to treble energy.
 * Each particle has a slow upward drift and randomized starting radius;
 * high-frequency energy brightens and expands the cloud.
 */

const vertexShader = /* glsl */ `
uniform float uTime;
uniform float uTreble;
uniform float uSize;
uniform float uHeight;
attribute float aSeed;
attribute float aLifetime;
varying float vIntensity;

void main() {
  vec3 pos = position;
  // Slow vertical drift, seeded per particle.
  float t = mod(uTime * 0.35 + aLifetime, 1.0);
  pos.y += t * uHeight;
  // Gentle swirl in xz plane.
  float s = sin(uTime * 0.4 + aSeed * 6.28);
  float c = cos(uTime * 0.4 + aSeed * 6.28);
  pos.xz = mat2(c, -s, s, c) * pos.xz * (1.0 + uTreble * 0.25);

  vec4 mv = modelViewMatrix * vec4(pos, 1.0);
  vIntensity = (1.0 - t) * (0.35 + uTreble * 1.5);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = uSize * (0.6 + uTreble * 2.2) * (12.0 / -mv.z);
}
`;

const fragmentShader = /* glsl */ `
uniform vec3 uColor;
varying float vIntensity;

void main() {
  // Soft circular sprite.
  vec2 c = gl_PointCoord - 0.5;
  float d = length(c);
  float alpha = smoothstep(0.5, 0.0, d) * vIntensity;
  if (alpha < 0.01) discard;
  gl_FragColor = vec4(uColor, alpha);
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

  const uniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uTreble: { value: 0 },
      uSize: { value: 22 },
      uHeight: { value: height },
      uColor: { value: color.clone() },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [height],
  );

  const pointsRef = useRef<THREE.Points>(null);

  useFrame((_, delta) => {
    uniforms.uTime.value += delta;
    uniforms.uColor.value.lerp(color, 0.06);
    if (engine) {
      const f = engine.sample();
      uniforms.uTreble.value = THREE.MathUtils.lerp(
        uniforms.uTreble.value,
        f.trebleLevel,
        0.15,
      );
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
