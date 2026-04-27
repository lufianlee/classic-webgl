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
              {/* Clustered column — a cluster of 8 shafts around a central drum.
                  Radial segments bumped to 48 for smooth silhouettes. */}
              <mesh
                position={[side * NAVE_HALF_WIDTH, PILLAR_HEIGHT / 2, z]}
                castShadow
                receiveShadow
              >
                <cylinderGeometry args={[0.8, 0.85, PILLAR_HEIGHT, 48]} />
                <primitive object={pillarMat} attach="material" />
              </mesh>
              {Array.from({ length: 8 }).map((_, k) => {
                const a = (k / 8) * Math.PI * 2;
                return (
                  <mesh
                    key={`shaft-${k}`}
                    position={[
                      side * NAVE_HALF_WIDTH + Math.cos(a) * 0.78,
                      PILLAR_HEIGHT / 2,
                      z + Math.sin(a) * 0.78,
                    ]}
                    castShadow
                  >
                    <cylinderGeometry
                      args={[0.18, 0.18, PILLAR_HEIGHT, 24]}
                    />
                    <meshStandardMaterial
                      color="#d6c8aa"
                      roughness={0.6}
                      metalness={0.05}
                    />
                  </mesh>
                );
              })}
              {/* Capital — two-tier moulding */}
              <mesh
                position={[side * NAVE_HALF_WIDTH, PILLAR_HEIGHT + 0.25, z]}
                castShadow
              >
                <cylinderGeometry args={[1.3, 0.95, 0.5, 48]} />
                <meshStandardMaterial color="#b6a482" roughness={0.55} />
              </mesh>
              <mesh
                position={[side * NAVE_HALF_WIDTH, PILLAR_HEIGHT + 0.62, z]}
                castShadow
              >
                <cylinderGeometry args={[1.45, 1.25, 0.25, 48]} />
                <meshStandardMaterial color="#c8b894" roughness={0.5} />
              </mesh>
              {/* Base moulding at the floor */}
              <mesh
                position={[side * NAVE_HALF_WIDTH, 0.3, z]}
                castShadow
              >
                <cylinderGeometry args={[1.15, 1.25, 0.6, 48]} />
                <meshStandardMaterial color="#8a7a5e" roughness={0.7} />
              </mesh>
            </group>
          ))}

          {/* Pointed (Gothic) transverse arch — two 60° torus arcs whose
              curvature centers are at the OPPOSITE pillar top, so the arc
              endpoints land exactly on the near pillar top and the apex.
              Radius = nave width; apex y = PILLAR_HEIGHT + NAVE_HALF_WIDTH·√3
              ≈ pillar_top + 10.4 m. */}
          {/* Left half-arch (center of curvature at +NAVE_HALF_WIDTH) */}
          <mesh
            position={[NAVE_HALF_WIDTH, PILLAR_HEIGHT + 0.85, z]}
            rotation={[0, Math.PI, 0]}
          >
            <torusGeometry
              args={[NAVE_HALF_WIDTH * 2, 0.35, 24, 56, Math.PI / 3]}
            />
            <meshStandardMaterial color="#a8977a" roughness={0.6} />
          </mesh>
          {/* Right half-arch (center of curvature at -NAVE_HALF_WIDTH) */}
          <mesh position={[-NAVE_HALF_WIDTH, PILLAR_HEIGHT + 0.85, z]}>
            <torusGeometry
              args={[NAVE_HALF_WIDTH * 2, 0.35, 24, 56, Math.PI / 3]}
            />
            <meshStandardMaterial color="#a8977a" roughness={0.6} />
          </mesh>
        </group>
      ))}

      {/* Ribbed vault: transverse ribs overhead spring from the same pillar
          tops as the arches and meet at an apex higher up. Same pointed-arch
          math as below — center of curvature at opposite pillar top. */}
      {bayPositions.map((z, i) => (
        <group key={`vault-${i}`}>
          {/* Left transverse rib */}
          <mesh
            position={[NAVE_HALF_WIDTH, PILLAR_HEIGHT + 0.85, z]}
            rotation={[0, Math.PI, 0]}
          >
            <torusGeometry
              args={[NAVE_HALF_WIDTH * 2, 0.22, 16, 48, Math.PI / 3]}
            />
            <meshStandardMaterial color="#958467" roughness={0.7} />
          </mesh>
          {/* Right transverse rib */}
          <mesh position={[-NAVE_HALF_WIDTH, PILLAR_HEIGHT + 0.85, z]}>
            <torusGeometry
              args={[NAVE_HALF_WIDTH * 2, 0.22, 16, 48, Math.PI / 3]}
            />
            <meshStandardMaterial color="#958467" roughness={0.7} />
          </mesh>
          {/* Boss at the vault apex (keystone) */}
          <mesh
            position={[0, PILLAR_HEIGHT + 0.85 + NAVE_HALF_WIDTH * Math.sqrt(3), z]}
          >
            <sphereGeometry args={[0.38, 24, 24]} />
            <meshStandardMaterial color="#c8b894" roughness={0.6} metalness={0.1} />
          </mesh>
        </group>
      ))}

      {/* Clerestory windows: tall pointed-arch stained glass above the arcade.
          One per bay, both sides. Emissive so they read even in shadow. */}
      {bayPositions.map((z, bi) => {
        const hue = (bi * 47) % 360;
        return (
          <group key={`clere-${bi}`}>
            {[-1, 1].map((side) => (
              <group
                key={`cw-${side}`}
                position={[
                  side * (NAVE_HALF_WIDTH + AISLE_WIDTH - 0.15),
                  VAULT_APEX - 6,
                  z,
                ]}
                rotation={[0, side > 0 ? -Math.PI / 2 : Math.PI / 2, 0]}
              >
                <mesh>
                  <planeGeometry args={[2.4, 4.2]} />
                  <meshStandardMaterial
                    color={`hsl(${hue}, 58%, 55%)`}
                    emissive={`hsl(${hue}, 70%, 45%)`}
                    emissiveIntensity={1.4}
                    side={THREE.DoubleSide}
                  />
                </mesh>
                {/* Lead tracery — three narrow vertical mullions */}
                {[-0.7, 0, 0.7].map((mx, mi) => (
                  <mesh key={`mul-${mi}`} position={[mx, 0, 0.02]}>
                    <boxGeometry args={[0.08, 4.2, 0.04]} />
                    <meshStandardMaterial color="#1a1208" roughness={0.7} />
                  </mesh>
                ))}
              </group>
            ))}
          </group>
        );
      })}

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

      {/* Rose window at the rear wall — segment counts bumped, plus a
          second inner ring of 12 smaller panes for density. */}
      <group position={[0, VAULT_APEX - 10, NAVE_LENGTH / 2 - 0.1]}>
        {/* outer stone ring */}
        <mesh>
          <ringGeometry args={[4, 5, 64]} />
          <meshStandardMaterial color="#5a4d3b" roughness={0.9} side={THREE.DoubleSide} />
        </mesh>
        {/* inner stone ring divider */}
        <mesh position={[0, 0, 0.02]}>
          <ringGeometry args={[1.9, 2.1, 48]} />
          <meshStandardMaterial color="#4a3d2b" roughness={0.9} side={THREE.DoubleSide} />
        </mesh>
        {/* stained-glass outer spokes */}
        {roseColors.map((c, i) => {
          const a = (i / roseColors.length) * Math.PI * 2;
          return (
            <mesh
              key={`pane-${i}`}
              position={[Math.cos(a) * 2.9, Math.sin(a) * 2.9, 0.05]}
              rotation={[0, 0, a]}
            >
              <circleGeometry args={[1.3, 32]} />
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
        {/* inner ring of 12 small panes */}
        {Array.from({ length: 12 }).map((_, i) => {
          const a = (i / 12) * Math.PI * 2;
          const c = roseColors[i % roseColors.length];
          return (
            <mesh
              key={`inner-pane-${i}`}
              position={[Math.cos(a) * 1.35, Math.sin(a) * 1.35, 0.04]}
            >
              <circleGeometry args={[0.45, 24]} />
              <meshStandardMaterial
                color={c}
                emissive={c}
                emissiveIntensity={2.0}
                roughness={0.35}
                side={THREE.DoubleSide}
              />
            </mesh>
          );
        })}
        {/* Central rosette */}
        <mesh position={[0, 0, 0.08]}>
          <circleGeometry args={[1.2, 48]} />
          <meshStandardMaterial
            color="#ffe2a3"
            emissive="#ffc56b"
            emissiveIntensity={2.4}
            side={THREE.DoubleSide}
          />
        </mesh>
      </group>

      {/* Pipe organ: a rank of brass pipes flanking the rose window on the
          rear wall gallery. Two side towers + a lower central rank = 23 pipes
          across. Emissive highlights to catch the rose-window light. */}
      <group position={[0, VAULT_APEX - 15, NAVE_LENGTH / 2 - 1.6]}>
        {/* Organ case backdrop */}
        <mesh position={[0, 0, -0.2]}>
          <boxGeometry args={[13, 7, 0.4]} />
          <meshStandardMaterial color="#3a2a18" roughness={0.8} />
        </mesh>
        {/* Central flat rank — 11 medium pipes */}
        {Array.from({ length: 11 }).map((_, i) => {
          const x = (i - 5) * 0.55;
          const h = 4 + Math.abs(i - 5) * 0.15;
          return (
            <mesh key={`pipe-c-${i}`} position={[x, -0.5 + h / 2, 0]}>
              <cylinderGeometry args={[0.22, 0.24, h, 28]} />
              <meshStandardMaterial
                color="#d9b463"
                metalness={0.85}
                roughness={0.22}
                emissive="#8a6820"
                emissiveIntensity={0.25}
              />
            </mesh>
          );
        })}
        {/* Left tower — 6 larger pipes */}
        {Array.from({ length: 6 }).map((_, i) => {
          const x = -4.8 + i * 0.4;
          const h = 6 - Math.abs(i - 2.5) * 0.3;
          return (
            <mesh key={`pipe-l-${i}`} position={[x, -0.2 + h / 2, 0]}>
              <cylinderGeometry args={[0.3, 0.33, h, 28]} />
              <meshStandardMaterial
                color="#d9b463"
                metalness={0.85}
                roughness={0.22}
                emissive="#8a6820"
                emissiveIntensity={0.3}
              />
            </mesh>
          );
        })}
        {/* Right tower — mirrored */}
        {Array.from({ length: 6 }).map((_, i) => {
          const x = 4.8 - i * 0.4;
          const h = 6 - Math.abs(i - 2.5) * 0.3;
          return (
            <mesh key={`pipe-r-${i}`} position={[x, -0.2 + h / 2, 0]}>
              <cylinderGeometry args={[0.3, 0.33, h, 28]} />
              <meshStandardMaterial
                color="#d9b463"
                metalness={0.85}
                roughness={0.22}
                emissive="#8a6820"
                emissiveIntensity={0.3}
              />
            </mesh>
          );
        })}
        {/* Decorative top cornice */}
        <mesh position={[0, 3.8, 0.1]}>
          <boxGeometry args={[13.2, 0.5, 0.5]} />
          <meshStandardMaterial color="#8a6820" metalness={0.5} roughness={0.4} />
        </mesh>
      </group>

      {/* Tall floor candelabra along the nave — 2 per bay between the pillars.
          Adds warm point-light punctuation the length of the church. */}
      {bayPositions.filter((_, i) => i % 2 === 0).map((z, bi) => (
        <group key={`fl-cand-${bi}`}>
          {[-1, 1].map((side) => (
            <group
              key={`fc-${side}`}
              position={[side * (NAVE_HALF_WIDTH - 1.6), 0, z]}
            >
              {/* Tripod base */}
              <mesh position={[0, 0.1, 0]}>
                <cylinderGeometry args={[0.35, 0.45, 0.2, 24]} />
                <meshStandardMaterial color="#4a3820" metalness={0.5} roughness={0.5} />
              </mesh>
              {/* Shaft */}
              <mesh position={[0, 1.2, 0]} castShadow>
                <cylinderGeometry args={[0.07, 0.09, 2.2, 24]} />
                <meshStandardMaterial
                  color="#d9b463"
                  metalness={0.8}
                  roughness={0.25}
                />
              </mesh>
              {/* Cup at top */}
              <mesh position={[0, 2.35, 0]}>
                <cylinderGeometry args={[0.18, 0.1, 0.12, 24]} />
                <meshStandardMaterial color="#d9b463" metalness={0.8} roughness={0.25} />
              </mesh>
              {/* Candle */}
              <mesh position={[0, 2.55, 0]}>
                <cylinderGeometry args={[0.06, 0.06, 0.3, 16]} />
                <meshStandardMaterial color="#fff5d6" roughness={0.7} />
              </mesh>
              {/* Flame */}
              <mesh position={[0, 2.78, 0]}>
                <sphereGeometry args={[0.08, 16, 16]} />
                <meshStandardMaterial
                  color="#fff1b0"
                  emissive="#ffb14a"
                  emissiveIntensity={5}
                />
              </mesh>
              <pointLight
                position={[0, 2.8, 0]}
                intensity={5}
                distance={7}
                color="#ffb066"
              />
            </group>
          ))}
        </group>
      ))}

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
