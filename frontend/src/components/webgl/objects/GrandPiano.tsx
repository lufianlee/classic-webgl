'use client';

import * as THREE from 'three';

/**
 * Stylized grand piano — low-poly but recognizable from any angle.
 * Origin sits at the floor under the keyboard edge; the instrument extends
 * in +z (the curved "tail") and the keyboard points in -z.
 *
 *   keyboard (-z) ─────────────────▶ tail (+z)
 *
 * Parent components place + rotate this group however they like.
 */
interface Props {
  scale?: number;
  position?: [number, number, number];
  rotation?: [number, number, number];
  /** Open the lid on its prop stick. Default true. */
  lidOpen?: boolean;
}

export function GrandPiano({
  scale = 1,
  position = [0, 0, 0],
  rotation = [0, 0, 0],
  lidOpen = true,
}: Props) {
  // Case is ~1.5m wide, 2m deep, 1m tall to the music desk. Real concert
  // grands are ~2.7m deep; we scale per-space to taste.
  return (
    <group position={position} rotation={rotation} scale={scale}>
      {/* Legs — three: front-left, front-right, back (under the tail curve). */}
      {([
        [-0.7, 0, -0.05],
        [0.7, 0, -0.05],
        [0, 0, 1.55],
      ] as [number, number, number][]).map(([x, , z], i) => (
        <mesh key={`leg-${i}`} position={[x, 0.45, z]} castShadow>
          <cylinderGeometry args={[0.06, 0.09, 0.9, 10]} />
          <meshStandardMaterial color="#0a0806" roughness={0.3} metalness={0.15} />
        </mesh>
      ))}

      {/* Underside frame between the legs — keeps the piano from looking
          hollow when seen from the side. */}
      <mesh position={[0, 0.85, 0.75]}>
        <boxGeometry args={[1.55, 0.08, 2.1]} />
        <meshStandardMaterial color="#090704" roughness={0.5} />
      </mesh>

      {/* Main body curve. We approximate the "wing" shape with a box that
          has a quarter-cylinder glued to its far edge on the bass side. */}
      <mesh position={[0, 1.0, 0.6]} castShadow receiveShadow>
        <boxGeometry args={[1.55, 0.22, 1.5]} />
        <meshStandardMaterial color="#0b0906" roughness={0.28} metalness={0.35} />
      </mesh>
      {/* Tail curve: half cylinder on the bass (left) side. */}
      <mesh
        position={[-0.05, 1.0, 1.45]}
        rotation={[0, 0, 0]}
        castShadow
        receiveShadow
      >
        <cylinderGeometry args={[0.75, 0.75, 0.22, 32, 1, false, Math.PI, Math.PI]} />
        <meshStandardMaterial color="#0b0906" roughness={0.28} metalness={0.35} />
      </mesh>
      {/* Narrow treble tail: smaller half on the right that tapers into the body. */}
      <mesh position={[0.5, 1.0, 1.4]} castShadow receiveShadow>
        <boxGeometry args={[0.55, 0.22, 0.9]} />
        <meshStandardMaterial color="#0b0906" roughness={0.28} metalness={0.35} />
      </mesh>

      {/* Lid — same footprint as the body, tilted open on its hinge along +x.
          A fully-open concert lid sits ~75° from horizontal. */}
      <group position={[-0.775, 1.12, 0.6]}>
        <mesh
          rotation={[0, 0, lidOpen ? -Math.PI / 2.6 : 0]}
          position={[0.775, 0, 0]}
          castShadow
          receiveShadow
        >
          <boxGeometry args={[1.55, 0.05, 1.5]} />
          <meshStandardMaterial color="#0a0806" roughness={0.15} metalness={0.5} />
        </mesh>
        {/* The curved tail of the lid */}
        <mesh
          rotation={[0, 0, lidOpen ? -Math.PI / 2.6 : 0]}
          position={[0.725, 0, 0.85]}
          castShadow
          receiveShadow
        >
          <cylinderGeometry args={[0.75, 0.75, 0.05, 32, 1, false, Math.PI, Math.PI]} />
          <meshStandardMaterial color="#0a0806" roughness={0.15} metalness={0.5} />
        </mesh>
      </group>

      {/* Prop stick holding the lid open */}
      {lidOpen && (
        <mesh position={[0, 1.45, 0.2]} rotation={[0.15, 0, 0.35]} castShadow>
          <cylinderGeometry args={[0.015, 0.015, 1.1, 6]} />
          <meshStandardMaterial color="#b68a3d" metalness={0.7} roughness={0.3} />
        </mesh>
      )}

      {/* Keyboard: white keys as a single slab, thin black-key stripes on top. */}
      <group position={[0, 1.11, -0.35]}>
        <mesh castShadow receiveShadow>
          <boxGeometry args={[1.45, 0.05, 0.32]} />
          <meshStandardMaterial color="#f4ead5" roughness={0.3} metalness={0.05} />
        </mesh>
        {/* Sharp/flat keys */}
        {Array.from({ length: 35 }, (_, i) => {
          // Pattern of black keys in an octave: positions relative to 7 whites.
          // A simple approximation — skip E–F and B–C gaps.
          const octave = Math.floor(i / 5);
          const within = i % 5;
          const xBase = -0.7 + (octave * 7 + [0, 1, 3, 4, 5][within]) * 0.04;
          return (
            <mesh
              key={`bk-${i}`}
              position={[xBase, 0.03, -0.06]}
            >
              <boxGeometry args={[0.025, 0.025, 0.18]} />
              <meshStandardMaterial color="#060403" roughness={0.4} />
            </mesh>
          );
        })}
      </group>

      {/* Key cheek blocks at each end of the keyboard */}
      {[-0.77, 0.77].map((x, i) => (
        <mesh key={`cheek-${i}`} position={[x, 1.11, -0.32]} castShadow>
          <boxGeometry args={[0.06, 0.08, 0.4]} />
          <meshStandardMaterial color="#0a0806" roughness={0.35} metalness={0.2} />
        </mesh>
      ))}

      {/* Fall-board (the folding keyboard cover, partially raised) */}
      <mesh
        position={[0, 1.25, -0.2]}
        rotation={[-Math.PI / 3, 0, 0]}
        castShadow
      >
        <boxGeometry args={[1.55, 0.04, 0.32]} />
        <meshStandardMaterial color="#0b0906" roughness={0.2} metalness={0.45} />
      </mesh>

      {/* Pedal lyre */}
      <mesh position={[0, 0.35, -0.1]}>
        <boxGeometry args={[0.18, 0.7, 0.08]} />
        <meshStandardMaterial color="#0a0806" roughness={0.45} />
      </mesh>
      {[-0.08, 0, 0.08].map((dx, i) => (
        <mesh key={`pedal-${i}`} position={[dx, 0.12, -0.15]} castShadow>
          <boxGeometry args={[0.05, 0.015, 0.18]} />
          <meshStandardMaterial
            color="#d9b463"
            metalness={0.8}
            roughness={0.25}
          />
        </mesh>
      ))}

      {/* Bench */}
      <group position={[0, 0, -1.3]}>
        <mesh position={[0, 0.48, 0]} castShadow receiveShadow>
          <boxGeometry args={[1.2, 0.1, 0.45]} />
          <meshStandardMaterial color="#2a1a12" roughness={0.6} />
        </mesh>
        {[-0.5, 0.5].map((x, i) => (
          <mesh key={`b-leg-${i}`} position={[x, 0.24, 0]} castShadow>
            <boxGeometry args={[0.08, 0.46, 0.42]} />
            <meshStandardMaterial color="#0a0806" roughness={0.5} />
          </mesh>
        ))}
      </group>
    </group>
  );
}
