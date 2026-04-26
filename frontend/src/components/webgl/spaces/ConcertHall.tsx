'use client';

import * as THREE from 'three';
import { usePBRMaterial } from '../pbr';
import { GrandPiano } from '../objects/GrandPiano';

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

  // Seats — rows of dark-red velvet chairs.
  const seats: JSX.Element[] = [];
  const seatRows = 12;
  const seatsPerRow = 10;
  for (let r = 0; r < seatRows; r++) {
    for (let s = 0; s < seatsPerRow; s++) {
      const z = -HALL_LENGTH / 2 + 10 + r * 1.6;
      const x = (s - (seatsPerRow - 1) / 2) * 1.3;
      seats.push(
        <mesh key={`seat-${r}-${s}`} position={[x, 0.45, z]} castShadow>
          <boxGeometry args={[0.9, 0.9, 1.0]} />
          <meshStandardMaterial color="#5a1f1f" roughness={0.8} />
        </mesh>,
      );
      seats.push(
        <mesh key={`back-${r}-${s}`} position={[x, 1.3, z + 0.4]} castShadow>
          <boxGeometry args={[0.9, 1.4, 0.15]} />
          <meshStandardMaterial color="#4a1818" roughness={0.8} />
        </mesh>,
      );
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
      {/* Grand piano on stage — keyboard faces the audience (+z), so the
           tail points toward the stage shell (-z). We rotate 180° from the
           GrandPiano's default orientation (which has the keyboard at -z). */}
      <GrandPiano
        position={[0, 1, -HALL_LENGTH / 2 + 6.5]}
        rotation={[0, Math.PI, 0]}
        scale={1.35}
      />

      {seats}

      {/* Chandelier in the center */}
      <group position={[0, HALL_HEIGHT - 2.5, 0]}>
        <mesh>
          <sphereGeometry args={[0.4, 12, 12]} />
          <meshStandardMaterial
            color="#ffe199"
            emissive="#ffd27a"
            emissiveIntensity={3.5}
          />
        </mesh>
        {Array.from({ length: 8 }).map((_, i) => {
          const a = (i / 8) * Math.PI * 2;
          return (
            <mesh
              key={`candle-${i}`}
              position={[Math.cos(a) * 1.4, -0.3, Math.sin(a) * 1.4]}
            >
              <sphereGeometry args={[0.12, 8, 8]} />
              <meshStandardMaterial
                color="#ffeaaf"
                emissive="#ffd27a"
                emissiveIntensity={2.8}
              />
            </mesh>
          );
        })}
      </group>

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
