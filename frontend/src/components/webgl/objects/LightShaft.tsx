'use client';

import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

/**
 * Volumetric light shaft — a faked "god ray" cone for light streaming
 * through windows or from spotlights. Additive, depth-tested but not
 * depth-written, so it layers over geometry like scattered light in air.
 *
 * The shader fades:
 *   - along the shaft length (bright at the source, dissolving at the foot)
 *   - at the silhouette edge (fresnel-ish, so the cone never reads as a
 *     hard-surfaced mesh)
 *   - with slow animated noise, like drifting dust in the beam
 *
 * Place with `position` at the light origin, aim with `rotation`. The cone
 * extends along local -Y.
 */

interface Props {
  position: [number, number, number];
  rotation?: [number, number, number];
  length: number;
  /** Radius at the origin (narrow end). */
  radiusTop?: number;
  /** Radius at the far end (wide end). */
  radiusBottom: number;
  color: string;
  /** Peak opacity of the beam core, ~0.02–0.2. */
  intensity?: number;
}

const vertexShader = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vWorldPos;
  varying vec3 vNormal;
  void main() {
    vUv = uv;
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorldPos = wp.xyz;
    vNormal = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

const fragmentShader = /* glsl */ `
  uniform vec3 uColor;
  uniform float uIntensity;
  uniform float uTime;
  varying vec2 vUv;
  varying vec3 vWorldPos;
  varying vec3 vNormal;

  // Cheap value noise for dust drift.
  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
  }
  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
      mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x),
      f.y
    );
  }

  void main() {
    // Axial fade: strongest just below the source, gone at the foot.
    float axial = smoothstep(0.0, 0.15, vUv.y) * pow(vUv.y, 1.6);

    // Silhouette fade: surface normal vs. view direction. Facing the
    // camera head-on = beam core (opaque-ish); grazing = edge (transparent).
    vec3 viewDir = normalize(cameraPosition - vWorldPos);
    float facing = abs(dot(normalize(vNormal), viewDir));
    float edge = pow(facing, 2.2);

    // Slow drifting dust bands along the beam.
    float dust = 0.75 + 0.25 * noise(vec2(vUv.x * 6.0, vUv.y * 3.0 - uTime * 0.05));

    float a = uIntensity * axial * edge * dust;
    gl_FragColor = vec4(uColor, a);
  }
`;

export function LightShaft({
  position,
  rotation = [0, 0, 0],
  length,
  radiusTop = 0.25,
  radiusBottom,
  color,
  intensity = 0.08,
}: Props) {
  const matRef = useRef<THREE.ShaderMaterial>(null);

  const uniforms = useMemo(
    () => ({
      uColor: { value: new THREE.Color(color) },
      uIntensity: { value: intensity },
      uTime: { value: 0 },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  // Keep uniforms in sync if props change without remounting.
  useMemo(() => {
    uniforms.uColor.value.set(color);
    uniforms.uIntensity.value = intensity;
  }, [uniforms, color, intensity]);

  useFrame((state) => {
    if (matRef.current) {
      matRef.current.uniforms.uTime.value = state.clock.elapsedTime;
    }
  });

  return (
    <group position={position} rotation={rotation}>
      {/* Open-ended cone, offset so the narrow end sits at the group origin
          and the beam extends downward along local -Y. uv.y = 1 at the top
          (the source end). */}
      <mesh position={[0, -length / 2, 0]}>
        <cylinderGeometry
          args={[radiusTop, radiusBottom, length, 24, 8, true]}
        />
        <shaderMaterial
          ref={matRef}
          vertexShader={vertexShader}
          fragmentShader={fragmentShader}
          uniforms={uniforms}
          transparent
          depthWrite={false}
          blending={THREE.AdditiveBlending}
          side={THREE.DoubleSide}
        />
      </mesh>
    </group>
  );
}
