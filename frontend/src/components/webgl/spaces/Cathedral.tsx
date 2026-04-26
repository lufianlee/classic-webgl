'use client';

import { useMemo } from 'react';
import * as THREE from 'three';
import { usePBRMaterial } from '../pbr';

/**
 * Gothic cathedral: long nave, pointed-arch arcades, ribbed vault ceiling,
 * stained-glass rose window behind the listener, flagstone floor, cool light.
 *
 * No external meshes — everything is parametric geometry with PBR materials.
 * The scale is deliberately vast (60m nave, 28m ceiling) so that you feel
 * small inside it.
 */

const NAVE_LENGTH = 60;
const NAVE_HALF_WIDTH = 6;
const AISLE_WIDTH = 3;
const PILLAR_HEIGHT = 14;
const VAULT_APEX = 28;
const BAY_COUNT = 8;

export function Cathedral() {
  const bayPositions = useMemo(
    () =>
      Array.from({ length: BAY_COUNT }, (_, i) =>
        -NAVE_LENGTH / 2 + (i + 0.5) * (NAVE_LENGTH / BAY_COUNT),
      ),
    [],
  );

  // PBR materials: flagstone floor + castle-brick walls / pillars.
  const floorMat = usePBRMaterial('medieval_blocks_03', {
    repeat: [6, 16],
    color: '#4a4036',
  });
  const wallMat = usePBRMaterial('castle_brick_07', {
    repeat: [5, 3],
    color: '#6a5a48',
  });
  const pillarMat = usePBRMaterial('castle_brick_07', {
    repeat: [1.5, 6],
    color: '#cdbd9f',
    roughnessBoost: 0.9,
  });

  // Stained-glass tint: each rose-window segment a different saturated hue.
  const roseColors = ['#a23b2a', '#2f4d8a', '#d6a745', '#2f7a45', '#7a2a6b', '#c4521b'];

  return (
    <group>
      {/* Flagstone floor */}
      <mesh position={[0, 0, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[NAVE_HALF_WIDTH * 2 + AISLE_WIDTH * 2, NAVE_LENGTH]} />
        <primitive object={floorMat} attach="material" />
      </mesh>

      {/* Side walls — brick */}
      {[-1, 1].map((side) => (
        <mesh
          key={`wall-${side}`}
          position={[side * (NAVE_HALF_WIDTH + AISLE_WIDTH), VAULT_APEX / 2, 0]}
          rotation={[0, side > 0 ? -Math.PI / 2 : Math.PI / 2, 0]}
          receiveShadow
        >
          <planeGeometry args={[NAVE_LENGTH, VAULT_APEX]} />
          <primitive object={wallMat} attach="material" />
        </mesh>
      ))}

      {/* Bays: each has a pillar on each side plus a pointed arch between them */}
      {bayPositions.map((z, i) => (
        <group key={`bay-${i}`}>
          {[-1, 1].map((side) => (
            <group key={`col-${side}`}>
              {/* Clustered column — a cluster of 4 shafts around a central drum */}
              <mesh
                position={[side * NAVE_HALF_WIDTH, PILLAR_HEIGHT / 2, z]}
                castShadow
                receiveShadow
              >
                <cylinderGeometry args={[0.8, 0.85, PILLAR_HEIGHT, 24]} />
                <primitive object={pillarMat} attach="material" />
              </mesh>
              {[0, 1, 2, 3].map((k) => {
                const a = (k / 4) * Math.PI * 2;
                return (
                  <mesh
                    key={`shaft-${k}`}
                    position={[
                      side * NAVE_HALF_WIDTH + Math.cos(a) * 0.75,
                      PILLAR_HEIGHT / 2,
                      z + Math.sin(a) * 0.75,
                    ]}
                    castShadow
                  >
                    <cylinderGeometry
                      args={[0.22, 0.22, PILLAR_HEIGHT, 12]}
                    />
                    <meshStandardMaterial
                      color="#d6c8aa"
                      roughness={0.6}
                      metalness={0.05}
                    />
                  </mesh>
                );
              })}
              {/* Capital */}
              <mesh
                position={[side * NAVE_HALF_WIDTH, PILLAR_HEIGHT + 0.3, z]}
                castShadow
              >
                <cylinderGeometry args={[1.3, 0.95, 0.6, 24]} />
                <meshStandardMaterial color="#b6a482" roughness={0.55} />
              </mesh>
            </group>
          ))}

          {/* Pointed arch across the bay: two torus halves meeting at an apex */}
          {[-1, 1].map((side) => (
            <mesh
              key={`arch-${side}`}
              position={[side * (NAVE_HALF_WIDTH * 0.55), PILLAR_HEIGHT + 0.8, z]}
              rotation={[0, 0, side > 0 ? -Math.PI / 6 : Math.PI / 6]}
            >
              <torusGeometry args={[NAVE_HALF_WIDTH * 0.8, 0.32, 12, 20, Math.PI / 2]} />
              <meshStandardMaterial color="#a8977a" roughness={0.6} />
            </mesh>
          ))}
        </group>
      ))}

      {/* Ribbed vault: a series of pointed-arch rings overhead */}
      {bayPositions.map((z, i) => (
        <group key={`vault-${i}`}>
          {[-1, 1].map((side) => (
            <mesh
              key={`rib-${side}`}
              position={[0, VAULT_APEX - 6, z]}
              rotation={[Math.PI / 2, 0, side > 0 ? Math.PI / 5 : -Math.PI / 5]}
            >
              <torusGeometry
                args={[NAVE_HALF_WIDTH + 2, 0.2, 8, 16, Math.PI / 2]}
              />
              <meshStandardMaterial color="#958467" roughness={0.7} />
            </mesh>
          ))}
        </group>
      ))}

      {/* ——— Altar area at the front of the nave (toward -z) ————————————— */}
      <group position={[0, 0, -NAVE_LENGTH / 2 + 4]}>
        {/* Three-step platform */}
        {[0, 1, 2].map((step) => (
          <mesh
            key={`step-${step}`}
            position={[0, 0.15 + step * 0.3, step * 0.6]}
            castShadow
            receiveShadow
          >
            <boxGeometry args={[9 - step * 1.2, 0.3, 3 - step * 0.6]} />
            <meshStandardMaterial color="#c8b590" roughness={0.55} metalness={0.08} />
          </mesh>
        ))}

        {/* Altar table */}
        <mesh position={[0, 1.35, 1.4]} castShadow receiveShadow>
          <boxGeometry args={[3.2, 0.2, 1.4]} />
          <meshStandardMaterial color="#e4d6b5" roughness={0.45} metalness={0.1} />
        </mesh>
        {/* Altar cloth — red drapery hanging down front and sides */}
        <mesh position={[0, 0.95, 1.42]}>
          <boxGeometry args={[3.25, 0.8, 0.02]} />
          <meshStandardMaterial color="#7a1a1a" roughness={0.85} />
        </mesh>
        {/* Gold trim across the cloth */}
        <mesh position={[0, 0.58, 1.44]}>
          <boxGeometry args={[3.25, 0.08, 0.01]} />
          <meshStandardMaterial
            color="#d6a745"
            emissive="#d6a745"
            emissiveIntensity={0.4}
            roughness={0.3}
            metalness={0.7}
          />
        </mesh>

        {/* Altar base / frontal */}
        <mesh position={[0, 0.75, 1.4]}>
          <boxGeometry args={[2.8, 1.4, 1.3]} />
          <meshStandardMaterial color="#b6a482" roughness={0.55} metalness={0.05} />
        </mesh>

        {/* Two tall candlesticks on the altar */}
        {[-1.1, 1.1].map((x, i) => (
          <group key={`candle-alt-${i}`} position={[x, 1.45, 1.4]}>
            <mesh castShadow>
              <cylinderGeometry args={[0.06, 0.08, 0.9, 10]} />
              <meshStandardMaterial
                color="#d9b463"
                metalness={0.75}
                roughness={0.28}
              />
            </mesh>
            <mesh position={[0, 0.55, 0]}>
              <cylinderGeometry args={[0.04, 0.04, 0.2, 8]} />
              <meshStandardMaterial color="#fff5d6" />
            </mesh>
            {/* Flame */}
            <mesh position={[0, 0.72, 0]}>
              <sphereGeometry args={[0.06, 8, 8]} />
              <meshStandardMaterial
                color="#fff1b0"
                emissive="#ffb14a"
                emissiveIntensity={5}
              />
            </mesh>
            <pointLight
              position={[0, 0.72, 0]}
              intensity={3.5}
              distance={5}
              color="#ffb14a"
            />
          </group>
        ))}

        {/* Crucifix — a simple cross behind the altar */}
        <group position={[0, 4.2, 0.2]}>
          {/* Vertical beam */}
          <mesh castShadow>
            <boxGeometry args={[0.25, 3.6, 0.2]} />
            <meshStandardMaterial
              color="#8c6a40"
              roughness={0.5}
              metalness={0.15}
            />
          </mesh>
          {/* Horizontal beam */}
          <mesh position={[0, 0.6, 0]} castShadow>
            <boxGeometry args={[1.8, 0.25, 0.2]} />
            <meshStandardMaterial
              color="#8c6a40"
              roughness={0.5}
              metalness={0.15}
            />
          </mesh>
          {/* Gold inlay at the intersection */}
          <mesh position={[0, 0.6, 0.12]}>
            <boxGeometry args={[0.4, 0.4, 0.03]} />
            <meshStandardMaterial
              color="#e6c36a"
              emissive="#d6a745"
              emissiveIntensity={0.6}
              metalness={0.85}
              roughness={0.2}
            />
          </mesh>
        </group>

        {/* Baldachin / canopy: four corner posts + flat top */}
        {[
          [-1.9, 0.8],
          [1.9, 0.8],
          [-1.9, 2.1],
          [1.9, 2.1],
        ].map(([x, z], i) => (
          <mesh key={`post-${i}`} position={[x, 3, z]} castShadow>
            <cylinderGeometry args={[0.09, 0.11, 6, 12]} />
            <meshStandardMaterial
              color="#d6a745"
              metalness={0.75}
              roughness={0.3}
            />
          </mesh>
        ))}
        <mesh position={[0, 6.05, 1.45]} castShadow>
          <boxGeometry args={[4.2, 0.2, 1.6]} />
          <meshStandardMaterial
            color="#b68a3d"
            metalness={0.65}
            roughness={0.35}
          />
        </mesh>

        {/* Warm key light on the altar */}
        <spotLight
          position={[0, 9, 6]}
          target-position={[0, 1.5, 1.4]}
          angle={Math.PI / 6}
          penumbra={0.6}
          intensity={180}
          distance={20}
          color="#ffd89a"
          castShadow
        />
        {/* Subtle fill from the sides */}
        <pointLight position={[-3, 3, 2]} intensity={8} distance={9} color="#ffd089" />
        <pointLight position={[3, 3, 2]} intensity={8} distance={9} color="#ffd089" />
      </group>

      {/* Rose window at the rear wall */}
      <group position={[0, VAULT_APEX - 10, NAVE_LENGTH / 2 - 0.1]}>
        {/* outer stone ring */}
        <mesh>
          <ringGeometry args={[4, 5, 32]} />
          <meshStandardMaterial color="#5a4d3b" roughness={0.9} side={THREE.DoubleSide} />
        </mesh>
        {/* stained-glass spokes */}
        {roseColors.map((c, i) => {
          const a = (i / roseColors.length) * Math.PI * 2;
          return (
            <mesh
              key={`pane-${i}`}
              position={[Math.cos(a) * 2.5, Math.sin(a) * 2.5, 0.05]}
              rotation={[0, 0, a]}
            >
              <circleGeometry args={[1.3, 16]} />
              <meshStandardMaterial
                color={c}
                emissive={c}
                emissiveIntensity={2.2}
                roughness={0.3}
                side={THREE.DoubleSide}
              />
            </mesh>
          );
        })}
        {/* Central rosette */}
        <mesh position={[0, 0, 0.08]}>
          <circleGeometry args={[1.2, 24]} />
          <meshStandardMaterial
            color="#ffe2a3"
            emissive="#ffc56b"
            emissiveIntensity={2.4}
            side={THREE.DoubleSide}
          />
        </mesh>
      </group>

      {/* Rear & front walls */}
      {[-1, 1].map((side) => (
        <mesh
          key={`endwall-${side}`}
          position={[0, VAULT_APEX / 2, side * (NAVE_LENGTH / 2)]}
          rotation={[0, side > 0 ? Math.PI : 0, 0]}
          receiveShadow
        >
          <planeGeometry
            args={[NAVE_HALF_WIDTH * 2 + AISLE_WIDTH * 2, VAULT_APEX]}
          />
          <primitive object={wallMat} attach="material" />
        </mesh>
      ))}

      {/* Cathedral lighting — overall brighter so the stone reads.
           Clerestory windows (high side windows) cast cool daylight down
           into the nave; rose-window cone adds warm key light from behind.
           Candle pointLights pick up warmth at ground level. */}
      <hemisphereLight args={['#d6dfe9', '#2a241c', 0.75]} />
      <ambientLight intensity={0.35} color="#e8dfcc" />

      {/* Daylight streaming through clerestory windows on both sides. */}
      {bayPositions.map((z, i) => (
        <group key={`clerestory-${i}`}>
          {[-1, 1].map((side) => (
            <spotLight
              key={`cl-${side}`}
              position={[side * (NAVE_HALF_WIDTH + AISLE_WIDTH - 0.5), VAULT_APEX - 4, z]}
              target-position={[side * -2, 2, z]}
              angle={Math.PI / 5}
              penumbra={0.9}
              intensity={40}
              distance={30}
              color="#f3e9d2"
            />
          ))}
        </group>
      ))}

      {/* Warm cone from the rose window. */}
      <spotLight
        position={[0, VAULT_APEX - 9, NAVE_LENGTH / 2 - 2]}
        target-position={[0, 2, 0]}
        angle={Math.PI / 3.5}
        penumbra={0.7}
        intensity={160}
        distance={NAVE_LENGTH}
        color="#ffd6a0"
        castShadow
      />

      {/* Candle pointLights along the nave — now more of them, warmer fill. */}
      {bayPositions.map((z, i) => (
        <pointLight
          key={`candle-${i}`}
          position={[0, 4, z]}
          intensity={9}
          distance={14}
          color="#ffb066"
        />
      ))}
    </group>
  );
}
