'use client';

import * as THREE from 'three';
import { usePBRMaterial } from '../pbr';
import { GrandPiano } from '../objects/GrandPiano';

/**
 * 18th-century aristocratic salon. Short reverb (~0.6s), intimate scale.
 * Key identifiers: parquet de Versailles floor, wood-paneled walls with
 * gilt mouldings, chamber-music layout (harpsichord + 4 chairs in a semi-
 * circle), tall mirror between candelabra on one wall, beamed ceiling.
 */

const ROOM_W = 14;
const ROOM_D = 16;
const ROOM_H = 5.5;

export function Salon() {
  const floorMat = usePBRMaterial('wood_floor_worn', {
    repeat: [ROOM_W / 1.2, ROOM_D / 1.2],
    color: '#7a5230',
  });

  // Parquet pattern: alternating diagonal squares.
  const parquetTiles: JSX.Element[] = [];
  const tile = 1.2;
  for (let x = -ROOM_W / 2; x < ROOM_W / 2; x += tile) {
    for (let z = -ROOM_D / 2; z < ROOM_D / 2; z += tile) {
      const light = (Math.floor(x / tile) + Math.floor(z / tile)) % 2 === 0;
      parquetTiles.push(
        <mesh
          key={`tile-${x.toFixed(2)}-${z.toFixed(2)}`}
          position={[x + tile / 2, 0.01, z + tile / 2]}
          rotation={[-Math.PI / 2, 0, Math.PI / 4]}
        >
          <planeGeometry args={[tile * 0.9, tile * 0.9]} />
          <meshStandardMaterial
            color={light ? '#8a6238' : '#5a3a20'}
            roughness={0.45}
            metalness={0.1}
          />
        </mesh>,
      );
    }
  }

  // Wainscot: lower wall paneling with gilt frames.
  const wainscots: JSX.Element[] = [];
  const panelColor = '#d7c7a8';
  const giltColor = '#c89a55';
  const wallConfigs = [
    { axis: 'x' as const, sign: -1, len: ROOM_D },
    { axis: 'x' as const, sign: 1, len: ROOM_D },
    { axis: 'z' as const, sign: -1, len: ROOM_W },
    { axis: 'z' as const, sign: 1, len: ROOM_W },
  ];
  wallConfigs.forEach((w, wi) => {
    const panels = 4;
    for (let i = 0; i < panels; i++) {
      const t = (i + 0.5) / panels - 0.5;
      const offset = t * w.len;
      const posX = w.axis === 'x' ? (w.sign * ROOM_W) / 2 - w.sign * 0.06 : offset;
      const posZ = w.axis === 'z' ? (w.sign * ROOM_D) / 2 - w.sign * 0.06 : offset;
      const rotY =
        w.axis === 'x' ? (w.sign > 0 ? -Math.PI / 2 : Math.PI / 2) : w.sign > 0 ? Math.PI : 0;
      // Gilt frame (slightly larger)
      wainscots.push(
        <mesh
          key={`frame-${wi}-${i}`}
          position={[posX, 1.8, posZ]}
          rotation={[0, rotY, 0]}
        >
          <planeGeometry args={[w.len / panels - 0.2, 2.4]} />
          <meshStandardMaterial color={giltColor} roughness={0.35} metalness={0.55} />
        </mesh>,
      );
      // Panel inset
      wainscots.push(
        <mesh
          key={`panel-${wi}-${i}`}
          position={[posX + (w.axis === 'x' ? -w.sign * 0.02 : 0), 1.8, posZ + (w.axis === 'z' ? -w.sign * 0.02 : 0)]}
          rotation={[0, rotY, 0]}
        >
          <planeGeometry args={[w.len / panels - 0.5, 2.0]} />
          <meshStandardMaterial color={panelColor} roughness={0.55} metalness={0.05} />
        </mesh>,
      );
    }
  });

  // Ceiling beams.
  const beams: JSX.Element[] = [];
  for (let i = -2; i <= 2; i++) {
    beams.push(
      <mesh key={`beam-${i}`} position={[i * 2.6, ROOM_H - 0.3, 0]} castShadow>
        <boxGeometry args={[0.35, 0.4, ROOM_D]} />
        <meshStandardMaterial color="#3a2818" roughness={0.75} />
      </mesh>,
    );
  }

  return (
    <group>
      {/* PBR parquet floor (real wood normal/roughness maps) */}
      <mesh position={[0, 0.01, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[ROOM_W, ROOM_D]} />
        <primitive object={floorMat} attach="material" />
      </mesh>
      {parquetTiles}

      {/* Walls — upper plaster + wainscot frames */}
      {wallConfigs.map((w, i) => {
        const posX = w.axis === 'x' ? (w.sign * ROOM_W) / 2 : 0;
        const posZ = w.axis === 'z' ? (w.sign * ROOM_D) / 2 : 0;
        const rotY =
          w.axis === 'x' ? (w.sign > 0 ? -Math.PI / 2 : Math.PI / 2) : w.sign > 0 ? Math.PI : 0;
        return (
          <mesh
            key={`wall-${i}`}
            position={[posX, ROOM_H / 2, posZ]}
            rotation={[0, rotY, 0]}
            receiveShadow
          >
            <planeGeometry args={[w.len, ROOM_H]} />
            <meshStandardMaterial color="#e8d9b4" roughness={0.8} />
          </mesh>
        );
      })}
      {wainscots}

      {/* Coffered cream ceiling */}
      <mesh position={[0, ROOM_H, 0]} rotation={[Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[ROOM_W, ROOM_D]} />
        <meshStandardMaterial color="#ddcda5" roughness={0.85} />
      </mesh>
      {beams}

      {/* Grand piano at the front of the salon — keyboard faces the
           seating area (audience side is +z), tail into the back corner. */}
      <GrandPiano
        position={[-1, 0, -1]}
        rotation={[0, Math.PI * 1.1, 0]}
        scale={1.0}
      />

      {/* Four chairs in a loose arc */}
      {[
        [2, 0, -1],
        [2.5, 0, 1],
        [1, 0, 2.5],
        [-1, 0, 2.8],
      ].map(([x, , z], i) => (
        <group key={`chair-${i}`} position={[x, 0, z]} rotation={[0, -Math.atan2(z, x), 0]}>
          <mesh position={[0, 0.4, 0]} castShadow>
            <boxGeometry args={[0.55, 0.1, 0.55]} />
            <meshStandardMaterial color="#8a3232" roughness={0.75} />
          </mesh>
          <mesh position={[0, 0.85, 0.22]} castShadow>
            <boxGeometry args={[0.55, 0.9, 0.08]} />
            <meshStandardMaterial color="#5a1f1f" roughness={0.75} />
          </mesh>
          {[
            [-0.23, -0.23],
            [0.23, -0.23],
            [-0.23, 0.23],
            [0.23, 0.23],
          ].map(([lx, lz], k) => (
            <mesh key={`leg-${i}-${k}`} position={[lx, 0.2, lz]} castShadow>
              <cylinderGeometry args={[0.04, 0.04, 0.4, 6]} />
              <meshStandardMaterial color="#2a1608" />
            </mesh>
          ))}
        </group>
      ))}

      {/* Tall pier mirror on one wall */}
      <mesh position={[0, 2.6, ROOM_D / 2 - 0.12]} rotation={[0, Math.PI, 0]}>
        <planeGeometry args={[1.4, 3.2]} />
        <meshStandardMaterial
          color="#c8d2da"
          roughness={0.15}
          metalness={0.9}
          emissive="#2a2f36"
          emissiveIntensity={0.15}
        />
      </mesh>

      {/* Two candelabra flanking the mirror */}
      {[-2.2, 2.2].map((x, i) => (
        <group key={`cand-${i}`} position={[x, 2.2, ROOM_D / 2 - 0.2]}>
          <mesh>
            <cylinderGeometry args={[0.05, 0.05, 0.8, 8]} />
            <meshStandardMaterial color="#c89a55" metalness={0.6} roughness={0.3} />
          </mesh>
          {[-0.25, 0, 0.25].map((ox, k) => (
            <mesh key={`flame-${k}`} position={[ox, 0.5, 0]}>
              <sphereGeometry args={[0.05, 8, 8]} />
              <meshStandardMaterial
                color="#ffe8b4"
                emissive="#ffc773"
                emissiveIntensity={4}
              />
            </mesh>
          ))}
          <pointLight position={[0, 0.5, 0]} intensity={2.5} distance={5} color="#ffc77a" />
        </group>
      ))}

      {/* Lighting: candlelight is warm, soft, everywhere */}
      <ambientLight intensity={0.3} color="#ffd8a0" />
      <pointLight position={[-1, 4, -1]} intensity={8} distance={9} color="#ffc173" />
      <pointLight position={[3, 3.5, 2]} intensity={5} distance={7} color="#ffbf6f" />
      <directionalLight
        position={[3, 6, 4]}
        intensity={0.4}
        color="#e9d5a0"
        castShadow
      />
    </group>
  );
}
