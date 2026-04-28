'use client';

import * as THREE from 'three';
import { usePBRMaterial } from '../pbr';
import { GrandPiano } from '../objects/GrandPiano';
import { PeriodFigure } from '../objects/PeriodFigure';
import { VelvetSeats, type SeatTransform } from '../objects/VelvetSeats';

/**
 * 19th-century "shoebox" concert hall. Medium reverb (~1.8s).
 * Key identifiers: rectangular plan, coffered ceiling, two balcony tiers
 * along the side walls, a raised stage at the front with a stage shell.
 * Warm incandescent stage light, cooler hall ambience.
 */

const HALL_LENGTH = 38;
const HALL_WIDTH = 18;
const HALL_HEIGHT = 14;
const BALCONY_FRONT = HALL_WIDTH / 2 - 3;

export function ConcertHall() {
  const floorMat = usePBRMaterial('wood_floor_worn', {
    repeat: [HALL_WIDTH / 3, HALL_LENGTH / 3],
    color: '#8c6a42',
  });
  const wallMat = usePBRMaterial('concrete_wall_008', {
    repeat: [HALL_LENGTH / 4, HALL_HEIGHT / 4],
    color: '#8e7046',
    roughnessBoost: 0.85,
  });

  // Coffered ceiling panels.
  const cofferGrid: JSX.Element[] = [];
  const cols = 5;
  const rows = 9;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = (c / (cols - 1) - 0.5) * (HALL_WIDTH - 2);
      const z = (r / (rows - 1) - 0.5) * (HALL_LENGTH - 2);
      cofferGrid.push(
        <mesh
          key={`coffer-${r}-${c}`}
          position={[x, HALL_HEIGHT - 0.4, z]}
          rotation={[Math.PI / 2, 0, 0]}
        >
          <boxGeometry args={[2.8, 3.6, 0.8]} />
          <meshStandardMaterial color="#a88752" roughness={0.5} metalness={0.2} />
        </mesh>,
      );
      // Rosette in the middle of each coffer.
      cofferGrid.push(
        <mesh
          key={`rosette-${r}-${c}`}
          position={[x, HALL_HEIGHT - 0.1, z]}
          rotation={[-Math.PI / 2, 0, 0]}
        >
          <circleGeometry args={[0.4, 16]} />
          <meshStandardMaterial
            color="#d7b56a"
            emissive="#d7b56a"
            emissiveIntensity={0.15}
            roughness={0.4}
            metalness={0.35}
          />
        </mesh>,
      );
    }
  }

  // Seats — curved-silhouette velvet theater chairs, built as an
  // InstancedMesh bank so 120 chairs cost 8 draw calls instead of 600+.
  // VelvetSeats convention: with yaw=0, the backrest sits at +z relative
  // to the seat center (so the chair faces -z). Stage is at -z, so yaw=0
  // is exactly what we want — chairs face the stage.
  const seatTransforms: SeatTransform[] = [];
  const seatRows = 12;
  const seatsPerRow = 10;
  for (let r = 0; r < seatRows; r++) {
    for (let s = 0; s < seatsPerRow; s++) {
      const z = -HALL_LENGTH / 2 + 10 + r * 1.6;
      const x = (s - (seatsPerRow - 1) / 2) * 1.3;
      seatTransforms.push({ position: [x, 0, z], yaw: 0 });
    }
  }

  return (
    <group>
      {/* Parquet floor */}
      <mesh position={[0, 0, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[HALL_WIDTH, HALL_LENGTH]} />
        <primitive object={floorMat} attach="material" />
      </mesh>

      {/* Side walls */}
      {[-1, 1].map((side) => (
        <group key={`sidewall-${side}`}>
          <mesh
            position={[side * HALL_WIDTH / 2, HALL_HEIGHT / 2, 0]}
            rotation={[0, side > 0 ? -Math.PI / 2 : Math.PI / 2, 0]}
            receiveShadow
          >
            <planeGeometry args={[HALL_LENGTH, HALL_HEIGHT]} />
            <primitive object={wallMat} attach="material" />
          </mesh>
          {/* Vertical gilt pilasters every ~4m */}
          {[-14, -7, 0, 7, 14].map((z, i) => (
            <mesh
              key={`pilaster-${side}-${i}`}
              position={[side * (HALL_WIDTH / 2 - 0.35), HALL_HEIGHT / 2, z]}
            >
              <boxGeometry args={[0.25, HALL_HEIGHT - 1.2, 0.5]} />
              <meshStandardMaterial color="#c89a55" roughness={0.35} metalness={0.4} />
            </mesh>
          ))}
          {/* Balcony front — a long horizontal band */}
          <mesh
            position={[side * BALCONY_FRONT, 5.2, 0]}
          >
            <boxGeometry args={[0.8, 0.9, HALL_LENGTH - 6]} />
            <meshStandardMaterial color="#8a6a40" roughness={0.55} metalness={0.3} />
          </mesh>
          {/* Balcony underside bracket */}
          <mesh position={[side * BALCONY_FRONT, 4.7, 0]}>
            <boxGeometry args={[1.4, 0.2, HALL_LENGTH - 6]} />
            <meshStandardMaterial color="#6a4a2a" roughness={0.6} />
          </mesh>
        </group>
      ))}

      {/* Ceiling as a single plank */}
      <mesh position={[0, HALL_HEIGHT, 0]} rotation={[Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[HALL_WIDTH, HALL_LENGTH]} />
        <meshStandardMaterial color="#3a2a1a" roughness={0.8} />
      </mesh>
      {cofferGrid}

      {/* End walls (front = stage, back = entrance) */}
      <mesh
        position={[0, HALL_HEIGHT / 2, HALL_LENGTH / 2]}
        rotation={[0, Math.PI, 0]}
      >
        <planeGeometry args={[HALL_WIDTH, HALL_HEIGHT]} />
        <meshStandardMaterial color="#5a3a22" roughness={0.85} />
      </mesh>

      {/* Stage platform + shell */}
      <mesh position={[0, 0.5, -HALL_LENGTH / 2 + 5]} castShadow receiveShadow>
        <boxGeometry args={[HALL_WIDTH - 3, 1, 8]} />
        <meshStandardMaterial color="#6a4a28" roughness={0.6} metalness={0.1} />
      </mesh>
      {/* Curved stage shell behind the stage: a half-cylinder */}
      <mesh
        position={[0, 6, -HALL_LENGTH / 2 + 1.2]}
        rotation={[0, 0, 0]}
      >
        <cylinderGeometry args={[8, 8, 11, 48, 1, true, -Math.PI / 2, Math.PI]} />
        <meshStandardMaterial
          color="#8a6238"
          roughness={0.45}
          metalness={0.15}
          side={THREE.DoubleSide}
        />
      </mesh>

      {/* ——— Grand pipe organ behind the stage ——————————————————————————
          Classical three-tower façade: central flat "great" division flanked
          by two outer towers. Horizontal "chamade" trumpet pipes fan out
          over the top. The whole thing tucks into the back of the stage
          shell so it reads as a wall of gilded pipes from the audience. */}
      {(() => {
        const organZ = -HALL_LENGTH / 2 + 0.3;
        const organBaseY = 2.5;
        const pipeCol = '#d9b463';
        const darkCol = '#3a2410';
        const giltCol = '#c89a55';
        const pipeEmissive = '#8a6820';

        return (
          <group position={[0, organBaseY, organZ]}>
            {/* Dark oak case backing the whole instrument */}
            <mesh position={[0, 4.5, -0.3]}>
              <boxGeometry args={[14, 9, 0.5]} />
              <meshStandardMaterial color={darkCol} roughness={0.75} metalness={0.15} />
            </mesh>

            {/* Carved base plinth running the full width */}
            <mesh position={[0, 0.2, 0.05]}>
              <boxGeometry args={[14.2, 0.5, 0.6]} />
              <meshStandardMaterial color="#5a3a1c" roughness={0.6} metalness={0.25} />
            </mesh>
            {/* Gilt moulding strip above the plinth */}
            <mesh position={[0, 0.48, 0.15]}>
              <boxGeometry args={[14.1, 0.12, 0.65]} />
              <meshStandardMaterial
                color={giltCol}
                metalness={0.7}
                roughness={0.3}
                emissive={pipeEmissive}
                emissiveIntensity={0.3}
              />
            </mesh>

            {/* Central flat division — 15 pipes, pyramid profile (tallest in middle) */}
            {Array.from({ length: 15 }).map((_, i) => {
              const xLocal = (i - 7) * 0.42;
              const dist = Math.abs(i - 7);
              const h = 6.5 - dist * 0.32;
              return (
                <mesh key={`org-c-${i}`} position={[xLocal, 0.6 + h / 2, 0.15]}>
                  <cylinderGeometry args={[0.17, 0.19, h, 32]} />
                  <meshStandardMaterial
                    color={pipeCol}
                    metalness={0.88}
                    roughness={0.22}
                    emissive={pipeEmissive}
                    emissiveIntensity={0.35}
                  />
                </mesh>
              );
            })}
            {/* Central division pipe-mouths (the decorative lip) */}
            {Array.from({ length: 15 }).map((_, i) => {
              const xLocal = (i - 7) * 0.42;
              const dist = Math.abs(i - 7);
              const h = 6.5 - dist * 0.32;
              return (
                <mesh
                  key={`org-c-mouth-${i}`}
                  position={[xLocal, 0.6 + h - 0.4, 0.22]}
                >
                  <boxGeometry args={[0.28, 0.12, 0.02]} />
                  <meshStandardMaterial
                    color="#3a2a14"
                    roughness={0.7}
                    metalness={0.3}
                  />
                </mesh>
              );
            })}

            {/* Left tower — 7 large pipes on a raised pedestal, arched top */}
            {[0, 1].map((mirror) => {
              const sideX = mirror === 0 ? -5.4 : 5.4;
              return (
                <group key={`tower-${mirror}`} position={[sideX, 0, 0.25]}>
                  {/* Raised pedestal */}
                  <mesh position={[0, 1.3, 0]}>
                    <boxGeometry args={[3.2, 1.4, 0.7]} />
                    <meshStandardMaterial
                      color="#4a2f18"
                      roughness={0.55}
                      metalness={0.2}
                    />
                  </mesh>
                  {/* Gilt band on the pedestal */}
                  <mesh position={[0, 1.88, 0.38]}>
                    <boxGeometry args={[3.1, 0.15, 0.05]} />
                    <meshStandardMaterial
                      color={giltCol}
                      metalness={0.75}
                      roughness={0.28}
                      emissive={pipeEmissive}
                      emissiveIntensity={0.35}
                    />
                  </mesh>
                  {/* 7 pipes, tallest in the middle — "mitre" profile */}
                  {Array.from({ length: 7 }).map((_, i) => {
                    const xLocal = (i - 3) * 0.4;
                    const dist = Math.abs(i - 3);
                    const h = 7.5 - dist * 0.55;
                    return (
                      <mesh
                        key={`tp-${i}`}
                        position={[xLocal, 2.0 + h / 2, 0.0]}
                      >
                        <cylinderGeometry args={[0.23, 0.26, h, 32]} />
                        <meshStandardMaterial
                          color={pipeCol}
                          metalness={0.88}
                          roughness={0.22}
                          emissive={pipeEmissive}
                          emissiveIntensity={0.35}
                        />
                      </mesh>
                    );
                  })}
                  {/* Decorative pipe tops (rounded caps) */}
                  {Array.from({ length: 7 }).map((_, i) => {
                    const xLocal = (i - 3) * 0.4;
                    const dist = Math.abs(i - 3);
                    const h = 7.5 - dist * 0.55;
                    return (
                      <mesh
                        key={`tp-cap-${i}`}
                        position={[xLocal, 2.0 + h, 0.0]}
                      >
                        <sphereGeometry args={[0.26, 24, 16, 0, Math.PI * 2, 0, Math.PI / 2]} />
                        <meshStandardMaterial
                          color={giltCol}
                          metalness={0.85}
                          roughness={0.25}
                          emissive={pipeEmissive}
                          emissiveIntensity={0.4}
                        />
                      </mesh>
                    );
                  })}
                  {/* Tower arched canopy — torus arc linking the tallest caps */}
                  <mesh position={[0, 9.6, 0]} rotation={[Math.PI / 2, 0, 0]}>
                    <torusGeometry args={[1.6, 0.1, 12, 48, Math.PI]} />
                    <meshStandardMaterial
                      color={giltCol}
                      metalness={0.85}
                      roughness={0.25}
                      emissive={pipeEmissive}
                      emissiveIntensity={0.4}
                    />
                  </mesh>
                </group>
              );
            })}

            {/* Horizontal "chamade" trumpet pipes — fan out over the
                central division, 11 pipes flaring outward like a pipe
                bouquet. Each has a flared trumpet bell at the tip. */}
            {Array.from({ length: 11 }).map((_, i) => {
              const angle = (i - 5) * 0.11; // ±0.55 rad fan
              const yCenter = 8.4 + Math.cos(angle) * 0.2;
              const length = 2.2;
              return (
                <group
                  key={`chamade-${i}`}
                  position={[0, yCenter, 0.5]}
                  rotation={[0, 0, angle]}
                >
                  {/* Pipe body */}
                  <mesh position={[length / 2, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
                    <cylinderGeometry args={[0.08, 0.1, length, 24]} />
                    <meshStandardMaterial
                      color={pipeCol}
                      metalness={0.88}
                      roughness={0.22}
                      emissive={pipeEmissive}
                      emissiveIntensity={0.35}
                    />
                  </mesh>
                  {/* Flared trumpet bell */}
                  <mesh position={[length + 0.15, 0, 0]} rotation={[0, 0, -Math.PI / 2]}>
                    <coneGeometry args={[0.22, 0.5, 24, 1, true]} />
                    <meshStandardMaterial
                      color={giltCol}
                      metalness={0.9}
                      roughness={0.2}
                      emissive={pipeEmissive}
                      emissiveIntensity={0.45}
                      side={THREE.DoubleSide}
                    />
                  </mesh>
                </group>
              );
            })}

            {/* Upper decorative entablature with a carved shield in the center */}
            <mesh position={[0, 9.5, 0.15]}>
              <boxGeometry args={[13.5, 0.6, 0.4]} />
              <meshStandardMaterial
                color="#5a3a1c"
                roughness={0.55}
                metalness={0.25}
              />
            </mesh>
            <mesh position={[0, 9.85, 0.3]}>
              <boxGeometry args={[13.3, 0.15, 0.08]} />
              <meshStandardMaterial
                color={giltCol}
                metalness={0.78}
                roughness={0.25}
                emissive={pipeEmissive}
                emissiveIntensity={0.4}
              />
            </mesh>
            {/* Central cartouche — a carved shield with gilt laurel */}
            <mesh position={[0, 10.15, 0.4]}>
              <cylinderGeometry args={[0.6, 0.5, 0.2, 6]} />
              <meshStandardMaterial
                color={giltCol}
                metalness={0.9}
                roughness={0.2}
                emissive={pipeEmissive}
                emissiveIntensity={0.6}
              />
            </mesh>
            {/* Laurel wreath flanking it (two torus halves) */}
            {[-1, 1].map((side) => (
              <mesh
                key={`laurel-${side}`}
                position={[side * 0.75, 10.15, 0.4]}
                rotation={[0, 0, side > 0 ? -0.2 : 0.2]}
              >
                <torusGeometry args={[0.35, 0.06, 12, 32, Math.PI]} />
                <meshStandardMaterial
                  color={giltCol}
                  metalness={0.8}
                  roughness={0.3}
                  emissive={pipeEmissive}
                  emissiveIntensity={0.4}
                />
              </mesh>
            ))}

            {/* Soft warm backlight so the pipes read against the shell */}
            <pointLight
              position={[0, 5, 1.5]}
              intensity={20}
              distance={14}
              color="#ffd48a"
            />
            <pointLight position={[-5, 7, 1]} intensity={8} distance={8} color="#ffc880" />
            <pointLight position={[5, 7, 1]} intensity={8} distance={8} color="#ffc880" />
          </group>
        );
      })()}
      {/* Grand piano on stage — keyboard faces the audience (+z), so the
           tail points toward the stage shell (-z). We rotate 180° from the
           GrandPiano's default orientation (which has the keyboard at -z). */}
      <GrandPiano
        position={[0, 1, -HALL_LENGTH / 2 + 6.5]}
        rotation={[0, Math.PI, 0]}
        scale={1.35}
      />

      {/* Soloist figure — 19th-century tailcoat silhouette, standing beside
           the piano on stage and facing the audience (+z). Sits directly
           under the warm stage spotlight so the top-hat silhouette reads
           cleanly against the stage shell. */}
      <PeriodFigure
        variant="romantic"
        position={[2.3, 1, -HALL_LENGTH / 2 + 7.3]}
        rotation={[0, -0.1, 0]}
        phase={0}
        sway={0.7}
      />

      {/* Cello on a stand — stage left */}
      <group position={[-4, 1, -HALL_LENGTH / 2 + 5.5]} rotation={[0, 0.3, 0]}>
        {/* Body */}
        <mesh position={[0, 0.9, 0]} rotation={[Math.PI / 2.3, 0, 0]}>
          <cylinderGeometry args={[0.38, 0.34, 1.3, 32]} />
          <meshStandardMaterial color="#7a3a18" roughness={0.4} metalness={0.2} />
        </mesh>
        {/* Upper bout */}
        <mesh position={[0, 1.45, 0.15]} rotation={[Math.PI / 2.1, 0, 0]}>
          <sphereGeometry args={[0.3, 24, 16]} />
          <meshStandardMaterial color="#6a3010" roughness={0.4} metalness={0.2} />
        </mesh>
        {/* Neck */}
        <mesh position={[0, 2.0, 0.32]} rotation={[0.5, 0, 0]}>
          <boxGeometry args={[0.06, 0.8, 0.08]} />
          <meshStandardMaterial color="#1a0a04" roughness={0.3} />
        </mesh>
        {/* Scroll/peghead */}
        <mesh position={[0, 2.45, 0.55]}>
          <sphereGeometry args={[0.08, 16, 16]} />
          <meshStandardMaterial color="#2a1408" roughness={0.4} />
        </mesh>
        {/* Endpin */}
        <mesh position={[0, 0.1, -0.1]}>
          <cylinderGeometry args={[0.015, 0.015, 0.3, 8]} />
          <meshStandardMaterial color="#181818" metalness={0.7} roughness={0.3} />
        </mesh>
      </group>

      {/* Two violin stands — stage right, angled toward the center */}
      {[
        { x: 4, z: -HALL_LENGTH / 2 + 5, rot: -0.3 },
        { x: 5, z: -HALL_LENGTH / 2 + 7, rot: -0.1 },
      ].map((s, i) => (
        <group key={`vio-${i}`} position={[s.x, 0, s.z]} rotation={[0, s.rot, 0]}>
          {/* Stand tripod */}
          {[0, 1, 2].map((k) => {
            const a = (k / 3) * Math.PI * 2;
            return (
              <mesh
                key={`leg-${k}`}
                position={[Math.cos(a) * 0.2, 0.4, Math.sin(a) * 0.2]}
                rotation={[0, 0, 0.15 * (k - 1)]}
              >
                <cylinderGeometry args={[0.015, 0.02, 0.8, 8]} />
                <meshStandardMaterial color="#1a1a1a" metalness={0.6} roughness={0.4} />
              </mesh>
            );
          })}
          {/* Cradle */}
          <mesh position={[0, 0.85, 0]}>
            <cylinderGeometry args={[0.12, 0.14, 0.08, 24]} />
            <meshStandardMaterial color="#1a1a1a" roughness={0.5} />
          </mesh>
          {/* Violin body */}
          <group position={[0, 1.25, 0]} rotation={[Math.PI / 2.2, 0, 0.1]}>
            <mesh>
              <cylinderGeometry args={[0.16, 0.14, 0.55, 28]} />
              <meshStandardMaterial color="#7a3818" roughness={0.35} metalness={0.25} />
            </mesh>
            <mesh position={[0, 0.28, 0.05]}>
              <sphereGeometry args={[0.14, 20, 14]} />
              <meshStandardMaterial color="#6a3010" roughness={0.35} metalness={0.25} />
            </mesh>
            {/* Neck */}
            <mesh position={[0, 0.55, 0.05]}>
              <boxGeometry args={[0.04, 0.4, 0.04]} />
              <meshStandardMaterial color="#1a0a04" roughness={0.3} />
            </mesh>
          </group>
        </group>
      ))}

      {/* Stage music stands — three, for the string trio ensemble */}
      {[
        [-2.2, -HALL_LENGTH / 2 + 7],
        [0, -HALL_LENGTH / 2 + 8.5],
        [2.2, -HALL_LENGTH / 2 + 7],
      ].map(([x, z], i) => (
        <group key={`stand-${i}`} position={[x, 0, z]}>
          {[0, 1, 2].map((k) => {
            const a = (k / 3) * Math.PI * 2;
            return (
              <mesh
                key={`ml-${k}`}
                position={[Math.cos(a) * 0.15, 0.55, Math.sin(a) * 0.15]}
                rotation={[0, 0, 0.12 * (k - 1)]}
              >
                <cylinderGeometry args={[0.015, 0.02, 1.1, 8]} />
                <meshStandardMaterial color="#1a1a1a" metalness={0.5} roughness={0.5} />
              </mesh>
            );
          })}
          <mesh position={[0, 1.1, 0]}>
            <cylinderGeometry args={[0.015, 0.015, 0.4, 8]} />
            <meshStandardMaterial color="#1a1a1a" metalness={0.5} roughness={0.5} />
          </mesh>
          <mesh position={[0, 1.35, 0]} rotation={[-0.25, 0, 0]}>
            <boxGeometry args={[0.55, 0.38, 0.02]} />
            <meshStandardMaterial color="#0a0a0a" roughness={0.8} />
          </mesh>
          {/* Sheet music — emissive cream */}
          <mesh position={[0, 1.35, 0.015]} rotation={[-0.25, 0, 0]}>
            <planeGeometry args={[0.45, 0.3]} />
            <meshStandardMaterial
              color="#f4ead5"
              emissive="#e8d4a2"
              emissiveIntensity={0.15}
              roughness={0.7}
            />
          </mesh>
        </group>
      ))}

      <VelvetSeats seats={seatTransforms} />


      {/* Large central chandelier — 3 tiers of crystals instead of 1 ring.
          Segment counts bumped everywhere. */}
      <group position={[0, HALL_HEIGHT - 2.5, 0]}>
        {/* Core light orb */}
        <mesh>
          <sphereGeometry args={[0.4, 48, 32]} />
          <meshStandardMaterial
            color="#ffe199"
            emissive="#ffd27a"
            emissiveIntensity={3.5}
          />
        </mesh>
        {/* Gilt frame ring */}
        <mesh rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[1.5, 0.06, 16, 64]} />
          <meshStandardMaterial color="#c89a55" metalness={0.85} roughness={0.25} />
        </mesh>
        {/* Upper ring candles — 12 */}
        {Array.from({ length: 12 }).map((_, i) => {
          const a = (i / 12) * Math.PI * 2;
          return (
            <group
              key={`up-c-${i}`}
              position={[Math.cos(a) * 1.5, -0.2, Math.sin(a) * 1.5]}
            >
              <mesh>
                <cylinderGeometry args={[0.04, 0.04, 0.25, 12]} />
                <meshStandardMaterial color="#fff5d6" />
              </mesh>
              <mesh position={[0, 0.18, 0]}>
                <sphereGeometry args={[0.1, 16, 16]} />
                <meshStandardMaterial
                  color="#ffeaaf"
                  emissive="#ffd27a"
                  emissiveIntensity={2.8}
                />
              </mesh>
            </group>
          );
        })}
        {/* Lower tier — 16 small crystal drops */}
        {Array.from({ length: 16 }).map((_, i) => {
          const a = (i / 16) * Math.PI * 2;
          return (
            <mesh
              key={`drop-${i}`}
              position={[Math.cos(a) * 0.95, -0.7, Math.sin(a) * 0.95]}
            >
              <octahedronGeometry args={[0.14, 1]} />
              <meshStandardMaterial
                color="#f4e8bf"
                emissive="#ffd27a"
                emissiveIntensity={1.6}
                metalness={0.3}
                roughness={0.1}
              />
            </mesh>
          );
        })}
        {/* Central teardrop at the bottom */}
        <mesh position={[0, -1.1, 0]}>
          <coneGeometry args={[0.25, 0.7, 24]} />
          <meshStandardMaterial
            color="#f4e8bf"
            emissive="#ffd27a"
            emissiveIntensity={2.2}
            metalness={0.4}
            roughness={0.15}
          />
        </mesh>
        {/* Chain up to the ceiling */}
        <mesh position={[0, 1.25, 0]}>
          <cylinderGeometry args={[0.025, 0.025, 2.5, 8]} />
          <meshStandardMaterial color="#8a6820" metalness={0.7} roughness={0.35} />
        </mesh>
      </group>

      {/* Side chandeliers — smaller, one per balcony side */}
      {[-1, 1].map((side) => (
        <group key={`sch-${side}`} position={[side * 6, HALL_HEIGHT - 3, 0]}>
          <mesh>
            <sphereGeometry args={[0.22, 32, 24]} />
            <meshStandardMaterial
              color="#ffe199"
              emissive="#ffd27a"
              emissiveIntensity={2.5}
            />
          </mesh>
          {Array.from({ length: 6 }).map((_, i) => {
            const a = (i / 6) * Math.PI * 2;
            return (
              <mesh
                key={`sc-${i}`}
                position={[Math.cos(a) * 0.7, -0.2, Math.sin(a) * 0.7]}
              >
                <sphereGeometry args={[0.08, 16, 12]} />
                <meshStandardMaterial
                  color="#ffeaaf"
                  emissive="#ffd27a"
                  emissiveIntensity={2.2}
                />
              </mesh>
            );
          })}
          <pointLight intensity={18} distance={14} color="#ffd27a" />
        </group>
      ))}

      {/* Velvet curtains flanking the stage shell — deep red with gilt tieback */}
      {[-1, 1].map((side) => (
        <group
          key={`curt-${side}`}
          position={[side * (HALL_WIDTH / 2 - 0.6), 6, -HALL_LENGTH / 2 + 2]}
        >
          <mesh rotation={[0, 0, side * 0.08]}>
            <boxGeometry args={[1.4, 11, 0.15]} />
            <meshStandardMaterial color="#4a1010" roughness={0.9} />
          </mesh>
          {/* Curtain folds — three vertical ridges */}
          {[-0.4, 0, 0.4].map((cx, ci) => (
            <mesh key={`fold-${ci}`} position={[cx, 0, 0.1]}>
              <cylinderGeometry args={[0.08, 0.08, 10.8, 12]} />
              <meshStandardMaterial color="#5a1818" roughness={0.85} />
            </mesh>
          ))}
          {/* Gilt tieback rope */}
          <mesh position={[0, -1.5, 0.25]}>
            <torusGeometry args={[0.25, 0.04, 12, 24]} />
            <meshStandardMaterial
              color="#d6a745"
              metalness={0.8}
              roughness={0.3}
              emissive="#8a6820"
              emissiveIntensity={0.4}
            />
          </mesh>
        </group>
      ))}

      {/* Lighting: warm stage key light + cool house ambient + chandelier fill */}
      <ambientLight intensity={0.22} color="#d6c0a0" />
      <spotLight
        position={[0, 8, -HALL_LENGTH / 2 + 8]}
        target-position={[0, 1, -HALL_LENGTH / 2 + 5]}
        angle={Math.PI / 5}
        penumbra={0.5}
        intensity={180}
        distance={30}
        color="#ffd48a"
        castShadow
      />
      <pointLight
        position={[0, HALL_HEIGHT - 2.5, 0]}
        intensity={40}
        distance={25}
        color="#ffd27a"
      />
      <pointLight
        position={[0, 5, HALL_LENGTH / 2 - 3]}
        intensity={8}
        distance={18}
        color="#c8b48a"
      />
    </group>
  );
}
