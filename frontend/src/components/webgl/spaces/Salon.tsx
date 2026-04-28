'use client';

import * as THREE from 'three';
import { usePBRMaterial } from '../pbr';
import { GrandPiano } from '../objects/GrandPiano';
import { PeriodFigure } from '../objects/PeriodFigure';
import { SalonChair } from '../objects/SalonChair';

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
    repeat: [ROOM_W / 0.9, ROOM_D / 0.9],
    color: '#6a4525',
  });

  // Parquet — we rely entirely on the PBR wood_floor_worn texture (which
  // already has plank grain and grout) rather than layering colored planes
  // on top. Overlapping two floor planes at the same y caused z-fighting
  // shimmer that polygonOffset couldn't reliably hide.
  const parquetTiles: JSX.Element[] = [];

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

      {/* Singer figure — 18th-century court-dress silhouette (wide panniers,
           gilt stomacher, powdered wig), standing beside the piano as if
           performing the evening's aria. Faces the chair arc (+z). The
           warm candelabra + window light picks out the drape folds and the
           gilt trim reads against the deep plum robe. */}
      <PeriodFigure
        variant="baroque"
        position={[1.4, 0, 0.4]}
        rotation={[0, 0.2, 0]}
        phase={0.6}
        sway={0.85}
      />

      {/* Four Louis XV cabriole-legged salon chairs in a loose arc facing
           the piano. Each chair turns so its back faces outward — yaw
           computed from the position vector so chairs face center (0,0). */}
      {[
        [2, 0, -1],
        [2.5, 0, 1],
        [1, 0, 2.5],
        [-1, 0, 2.8],
      ].map(([x, , z], i) => (
        <SalonChair
          key={`chair-${i}`}
          position={[x as number, 0, z as number]}
          rotation={[0, Math.atan2(-(x as number), -(z as number)), 0]}
        />
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

      {/* Two candelabra flanking the mirror — 5-arm branches with higher detail */}
      {[-2.2, 2.2].map((x, i) => (
        <group key={`cand-${i}`} position={[x, 2.2, ROOM_D / 2 - 0.2]}>
          {/* Central shaft */}
          <mesh>
            <cylinderGeometry args={[0.05, 0.05, 0.8, 24]} />
            <meshStandardMaterial color="#c89a55" metalness={0.6} roughness={0.3} />
          </mesh>
          {/* Decorative knop midway */}
          <mesh position={[0, 0.15, 0]}>
            <sphereGeometry args={[0.09, 24, 16]} />
            <meshStandardMaterial color="#d6a745" metalness={0.7} roughness={0.3} />
          </mesh>
          {/* Five curved arms holding candles */}
          {[-0.32, -0.16, 0, 0.16, 0.32].map((ox, k) => (
            <group key={`arm-${k}`} position={[ox, 0.42, 0]}>
              {/* Arm curl */}
              <mesh rotation={[Math.PI / 2, 0, 0]}>
                <torusGeometry args={[0.08, 0.012, 10, 20, Math.PI]} />
                <meshStandardMaterial color="#c89a55" metalness={0.6} roughness={0.3} />
              </mesh>
              {/* Candle */}
              <mesh position={[0, 0.08, 0]}>
                <cylinderGeometry args={[0.025, 0.025, 0.14, 12]} />
                <meshStandardMaterial color="#fff5d6" />
              </mesh>
              {/* Flame */}
              <mesh position={[0, 0.22, 0]}>
                <sphereGeometry args={[0.055, 16, 16]} />
                <meshStandardMaterial
                  color="#ffe8b4"
                  emissive="#ffc773"
                  emissiveIntensity={4}
                />
              </mesh>
            </group>
          ))}
          <pointLight position={[0, 0.5, 0]} intensity={3.5} distance={6} color="#ffc77a" />
        </group>
      ))}

      {/* Tall French windows on the long wall — opposite the mirror.
          Emissive cream glass to simulate the cool outdoor light. */}
      {[-3.5, 0, 3.5].map((x, i) => (
        <group key={`win-${i}`} position={[x, 2.8, -ROOM_D / 2 + 0.12]}>
          {/* Frame */}
          <mesh>
            <planeGeometry args={[1.8, 3.5]} />
            <meshStandardMaterial color="#d7c7a8" roughness={0.6} metalness={0.15} />
          </mesh>
          {/* Glass panes (2x4 grid) */}
          {Array.from({ length: 8 }).map((_, k) => {
            const col = k % 2;
            const row = Math.floor(k / 2);
            return (
              <mesh
                key={`pane-${k}`}
                position={[(col - 0.5) * 0.7, (row - 1.5) * 0.7, 0.02]}
              >
                <planeGeometry args={[0.62, 0.62]} />
                <meshStandardMaterial
                  color="#c8d8e4"
                  emissive="#a8c0d4"
                  emissiveIntensity={0.8}
                  roughness={0.2}
                  metalness={0.15}
                />
              </mesh>
            );
          })}
          {/* Mullions */}
          <mesh position={[0, 0, 0.03]}>
            <boxGeometry args={[0.04, 3.5, 0.03]} />
            <meshStandardMaterial color="#5a4530" roughness={0.6} />
          </mesh>
          {[-1.05, -0.35, 0.35, 1.05].map((y, mi) => (
            <mesh key={`hm-${mi}`} position={[0, y, 0.03]}>
              <boxGeometry args={[1.8, 0.04, 0.03]} />
              <meshStandardMaterial color="#5a4530" roughness={0.6} />
            </mesh>
          ))}
          {/* Light spilling in */}
          <pointLight position={[0, 0, 0.8]} intensity={6} distance={9} color="#a8c0d4" />
        </group>
      ))}

      {/* Velvet drapes on either side of each window */}
      {[-4.5, -2.5, -1.0, 1.0, 2.5, 4.5].map((x, i) => (
        <mesh key={`drape-${i}`} position={[x, 2.8, -ROOM_D / 2 + 0.22]}>
          <boxGeometry args={[0.2, 3.8, 0.1]} />
          <meshStandardMaterial color="#6a1a1a" roughness={0.9} />
        </mesh>
      ))}

      {/* Porcelain vase with flowers on a side table near the windows */}
      <group position={[-4, 0, -5]}>
        {/* Side table top */}
        <mesh position={[0, 0.85, 0]} castShadow>
          <cylinderGeometry args={[0.4, 0.4, 0.05, 32]} />
          <meshStandardMaterial color="#4a2818" roughness={0.5} metalness={0.15} />
        </mesh>
        {/* Table leg */}
        <mesh position={[0, 0.42, 0]} castShadow>
          <cylinderGeometry args={[0.04, 0.08, 0.85, 16]} />
          <meshStandardMaterial color="#2a1608" roughness={0.6} />
        </mesh>
        {/* Tripod base */}
        {[0, 1, 2].map((k) => {
          const a = (k / 3) * Math.PI * 2;
          return (
            <mesh
              key={`tb-${k}`}
              position={[Math.cos(a) * 0.15, 0.05, Math.sin(a) * 0.15]}
              rotation={[0, a, 0]}
            >
              <boxGeometry args={[0.25, 0.04, 0.05]} />
              <meshStandardMaterial color="#2a1608" roughness={0.6} />
            </mesh>
          );
        })}
        {/* Vase body — porcelain blue-and-white */}
        <mesh position={[0, 1.08, 0]}>
          <sphereGeometry args={[0.12, 32, 24]} />
          <meshStandardMaterial color="#e8f0f8" roughness={0.2} metalness={0.15} />
        </mesh>
        <mesh position={[0, 1.25, 0]}>
          <cylinderGeometry args={[0.06, 0.09, 0.1, 24]} />
          <meshStandardMaterial color="#e8f0f8" roughness={0.2} metalness={0.15} />
        </mesh>
        {/* Flower stems (just colored spheres — stylized) */}
        {[
          ['#c8442a', 0.04, 0.18],
          ['#e8c060', -0.06, 0.14],
          ['#a8285a', 0.03, 0.22],
          ['#d88a6a', -0.04, 0.17],
          ['#5a6ac8', 0.06, 0.12],
        ].map(([c, dx, dy], k) => (
          <mesh key={`flr-${k}`} position={[dx as number, 1.3 + (dy as number), 0]}>
            <sphereGeometry args={[0.05, 16, 12]} />
            <meshStandardMaterial
              color={c as string}
              emissive={c as string}
              emissiveIntensity={0.2}
              roughness={0.7}
            />
          </mesh>
        ))}
      </group>

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
