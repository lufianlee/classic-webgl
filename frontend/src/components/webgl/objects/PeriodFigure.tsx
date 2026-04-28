'use client';

import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

/**
 * Stylized period-dress figure. Identity is expressed entirely through
 * costume silhouette — no facial features, no gendered anatomy, no skin
 * detail. The head is a hooded/abstracted form; bodies are drapes,
 * bodices, tailcoats etc. built from primitives.
 *
 * Variants:
 *   - medieval : cassock + surplice + cowl (choir / chorister)
 *   - romantic : tailcoat + breeches (19th-century concert performer)
 *   - baroque  : wide-pannier court robe + bodice (18th-century salon)
 *
 * A LatheGeometry is used for the lower-body drape/skirt so it reads as a
 * flowing garment rather than a box. Subtle time-based sway (breathing +
 * shoulder rock) keeps the figure from feeling like a mannequin.
 *
 * Pose is always ~neutral standing; the figure is best read at 6–12m
 * distance as a lit silhouette with rim highlights picking out the
 * costume folds. These are props in the room, not characters.
 */

export type FigureVariant = 'medieval' | 'romantic' | 'baroque';

interface Props {
  variant: FigureVariant;
  position?: [number, number, number];
  rotation?: [number, number, number];
  /** Per-instance phase offset so grouped figures don't breathe in sync. */
  phase?: number;
  /** Multiplier on the sway (0 = perfectly still). */
  sway?: number;
  /** Slight color tint — defaults chosen per-variant for period accuracy. */
  robeColor?: string;
  accentColor?: string;
}

interface Palette {
  robe: string;
  robeSecondary: string;
  accent: string; // gilt trim / stole / sash
  skin: string; // hands only — very muted, not a face tone
  hood: string;
  sheen: number; // metalness for the accent material
}

const PALETTES: Record<FigureVariant, Palette> = {
  medieval: {
    robe: '#1b1710', // black cassock
    robeSecondary: '#e8dfcc', // surplice over the cassock
    accent: '#a8823a', // muted gold stole
    skin: '#3a2a1e', // effectively unlit — hands in deep shadow
    hood: '#12100a',
    sheen: 0.25,
  },
  romantic: {
    robe: '#0e0a08', // black tailcoat
    robeSecondary: '#f4eadf', // cravat / shirt front
    accent: '#8a6420', // dull brass buttons
    skin: '#4a3828',
    hood: '#0a0806', // top hat silhouette
    sheen: 0.4,
  },
  baroque: {
    robe: '#2a1f3a', // deep plum court dress
    robeSecondary: '#d6c087', // pale gold underskirt panel
    accent: '#c89a55', // gilt trim
    skin: '#4a3828',
    hood: '#2a1f3a',
    sheen: 0.55,
  },
};

export function PeriodFigure({
  variant,
  position = [0, 0, 0],
  rotation = [0, 0, 0],
  phase = 0,
  sway = 1,
  robeColor,
  accentColor,
}: Props) {
  const groupRef = useRef<THREE.Group>(null);
  const torsoRef = useRef<THREE.Group>(null);
  const headRef = useRef<THREE.Group>(null);

  const palette = useMemo(() => {
    const base = PALETTES[variant];
    return {
      ...base,
      robe: robeColor ?? base.robe,
      accent: accentColor ?? base.accent,
    };
  }, [variant, robeColor, accentColor]);

  // Skirt profile (LatheGeometry). Points go from hem up to the waist.
  // The wide-to-narrow taper gives the silhouette its period-specific flare.
  const skirtGeom = useMemo(() => {
    let points: THREE.Vector2[];
    if (variant === 'baroque') {
      // Panniers: very wide at hip, flaring outward then dropping to the hem.
      points = [
        new THREE.Vector2(0.02, 0.0),
        new THREE.Vector2(0.85, 0.02),
        new THREE.Vector2(1.05, 0.25),
        new THREE.Vector2(1.1, 0.55),
        new THREE.Vector2(0.95, 0.85),
        new THREE.Vector2(0.7, 1.0),
        new THREE.Vector2(0.45, 1.1),
        new THREE.Vector2(0.3, 1.18),
      ];
    } else if (variant === 'medieval') {
      // Cassock: straight column, minimal flare.
      points = [
        new THREE.Vector2(0.02, 0.0),
        new THREE.Vector2(0.5, 0.05),
        new THREE.Vector2(0.55, 0.5),
        new THREE.Vector2(0.48, 1.0),
        new THREE.Vector2(0.35, 1.15),
        new THREE.Vector2(0.28, 1.2),
      ];
    } else {
      // Romantic: breeches + tailcoat hem — narrow, with a slight split at
      // the back of the coat (approximated by a single lathe).
      points = [
        new THREE.Vector2(0.02, 0.0),
        new THREE.Vector2(0.2, 0.05),
        new THREE.Vector2(0.24, 0.35),
        new THREE.Vector2(0.32, 0.55),
        new THREE.Vector2(0.34, 0.85),
        new THREE.Vector2(0.3, 1.05),
        new THREE.Vector2(0.26, 1.15),
      ];
    }
    const g = new THREE.LatheGeometry(points, 48);
    g.computeVertexNormals();
    return g;
  }, [variant]);

  // Same silhouette logic, slightly offset inward, for the under-layer
  // (surplice lining / underskirt).
  const underSkirtGeom = useMemo(() => {
    if (variant !== 'baroque') return null;
    const points = [
      new THREE.Vector2(0.02, 0.0),
      new THREE.Vector2(0.55, 0.02),
      new THREE.Vector2(0.7, 0.3),
      new THREE.Vector2(0.72, 0.6),
      new THREE.Vector2(0.55, 0.9),
      new THREE.Vector2(0.38, 1.05),
    ];
    const g = new THREE.LatheGeometry(points, 40);
    g.computeVertexNormals();
    return g;
  }, [variant]);

  // Surplice (the white over-robe worn by medieval choristers). Wider sleeves,
  // shorter than the cassock beneath.
  const surpliceGeom = useMemo(() => {
    if (variant !== 'medieval') return null;
    const points = [
      new THREE.Vector2(0.02, 0.0),
      new THREE.Vector2(0.6, 0.01),
      new THREE.Vector2(0.62, 0.35),
      new THREE.Vector2(0.55, 0.6),
      new THREE.Vector2(0.45, 0.72),
      new THREE.Vector2(0.38, 0.78),
    ];
    const g = new THREE.LatheGeometry(points, 40);
    g.computeVertexNormals();
    return g;
  }, [variant]);

  useFrame((state) => {
    const t = state.clock.getElapsedTime() + phase;
    // Breathing: vertical micro-scale on torso; shoulder rock: tiny z-tilt.
    if (torsoRef.current) {
      const breath = Math.sin(t * 1.1) * 0.015 * sway;
      torsoRef.current.scale.y = 1 + breath;
      torsoRef.current.rotation.z = Math.sin(t * 0.42) * 0.015 * sway;
    }
    // Head: very slow drift — a considered, listening pose.
    if (headRef.current) {
      headRef.current.rotation.y = Math.sin(t * 0.27) * 0.08 * sway;
      headRef.current.rotation.x = Math.sin(t * 0.19 + 1.3) * 0.03 * sway;
    }
    // Whole-body micro sway so the silhouette never locks.
    if (groupRef.current) {
      groupRef.current.position.y =
        position[1] + Math.sin(t * 0.5) * 0.01 * sway;
    }
  });

  // --- Render ----------------------------------------------------------
  return (
    <group ref={groupRef} position={position} rotation={rotation}>
      {/* Lower body / skirt */}
      <mesh geometry={skirtGeom} position={[0, 0, 0]} castShadow receiveShadow>
        <meshStandardMaterial
          color={palette.robe}
          roughness={0.85}
          metalness={0.02}
          side={THREE.DoubleSide}
        />
      </mesh>

      {/* Baroque underskirt — a pale-gold panel showing through the outer drape */}
      {underSkirtGeom && (
        <mesh
          geometry={underSkirtGeom}
          position={[0, 0.02, 0.01]}
          receiveShadow
        >
          <meshStandardMaterial
            color={palette.robeSecondary}
            roughness={0.65}
            metalness={0.18}
            side={THREE.DoubleSide}
          />
        </mesh>
      )}

      {/* Medieval surplice over the cassock */}
      {surpliceGeom && (
        <mesh
          geometry={surpliceGeom}
          position={[0, 0.25, 0]}
          castShadow
          receiveShadow
        >
          <meshStandardMaterial
            color={palette.robeSecondary}
            roughness={0.9}
            metalness={0.0}
            side={THREE.DoubleSide}
          />
        </mesh>
      )}

      {/* Torso — the sway pivot */}
      <group ref={torsoRef} position={[0, 1.2, 0]}>
        {variant === 'baroque' ? (
          <>
            {/* Corseted bodice — narrow at waist, flaring up to shoulders */}
            <mesh castShadow>
              <cylinderGeometry args={[0.26, 0.2, 0.55, 24]} />
              <meshStandardMaterial
                color={palette.robe}
                roughness={0.65}
                metalness={palette.sheen}
              />
            </mesh>
            {/* Stomacher — decorative gilt inverted-triangle panel down the front */}
            <mesh position={[0, -0.02, 0.2]}>
              <coneGeometry args={[0.12, 0.48, 4]} />
              <meshStandardMaterial
                color={palette.accent}
                metalness={0.75}
                roughness={0.3}
                emissive={palette.accent}
                emissiveIntensity={0.18}
              />
            </mesh>
            {/* Décolletage edge — a horizontal gilt trim at the top of the bodice */}
            <mesh position={[0, 0.24, 0.18]}>
              <torusGeometry args={[0.22, 0.02, 10, 32, Math.PI]} />
              <meshStandardMaterial
                color={palette.accent}
                metalness={0.8}
                roughness={0.25}
              />
            </mesh>
          </>
        ) : variant === 'medieval' ? (
          <>
            {/* Cassock torso — continues the black column upward */}
            <mesh castShadow>
              <cylinderGeometry args={[0.28, 0.28, 0.75, 20]} />
              <meshStandardMaterial
                color={palette.robe}
                roughness={0.85}
                metalness={0.03}
              />
            </mesh>
            {/* Stole — long gold band draped over the shoulders, hanging down */}
            {[-1, 1].map((side) => (
              <mesh
                key={`stole-${side}`}
                position={[side * 0.08, -0.1, 0.22]}
                rotation={[0.1, 0, side * 0.04]}
              >
                <boxGeometry args={[0.08, 0.9, 0.02]} />
                <meshStandardMaterial
                  color={palette.accent}
                  metalness={0.55}
                  roughness={0.45}
                  emissive={palette.accent}
                  emissiveIntensity={0.1}
                />
              </mesh>
            ))}
          </>
        ) : (
          <>
            {/* Romantic tailcoat torso: narrow waist, broader shoulders */}
            <mesh castShadow>
              <cylinderGeometry args={[0.27, 0.23, 0.7, 20]} />
              <meshStandardMaterial
                color={palette.robe}
                roughness={0.6}
                metalness={palette.sheen}
              />
            </mesh>
            {/* Cravat / shirt front */}
            <mesh position={[0, 0.1, 0.23]}>
              <boxGeometry args={[0.22, 0.32, 0.02]} />
              <meshStandardMaterial
                color={palette.robeSecondary}
                roughness={0.7}
                metalness={0.02}
              />
            </mesh>
            {/* Three brass buttons down the coat front */}
            {[-0.15, 0.0, 0.15].map((y, i) => (
              <mesh key={`btn-${i}`} position={[0, y, 0.26]}>
                <sphereGeometry args={[0.022, 12, 8]} />
                <meshStandardMaterial
                  color={palette.accent}
                  metalness={0.9}
                  roughness={0.2}
                />
              </mesh>
            ))}
          </>
        )}

        {/* Shoulders — small rounded caps to break the cylinder silhouette */}
        {[-1, 1].map((side) => (
          <mesh
            key={`shoulder-${side}`}
            position={[side * 0.27, 0.26, 0]}
            castShadow
          >
            <sphereGeometry
              args={[0.11, 16, 12, 0, Math.PI * 2, 0, Math.PI / 2]}
            />
            <meshStandardMaterial
              color={palette.robe}
              roughness={0.75}
              metalness={palette.sheen * 0.6}
            />
          </mesh>
        ))}

        {/* Arms — stylized drape tubes hanging at the sides; slight outward
            angle for baroque (panniers force the arms wide). */}
        {[-1, 1].map((side) => {
          const armOffset = variant === 'baroque' ? 0.38 : 0.32;
          const armAngle = variant === 'baroque' ? side * 0.2 : side * 0.08;
          return (
            <group
              key={`arm-${side}`}
              position={[side * armOffset, 0.1, 0]}
              rotation={[0, 0, armAngle]}
            >
              {/* Upper + forearm as one tapering cylinder — reads as a draped
                  sleeve rather than an anatomical arm */}
              <mesh position={[0, -0.38, 0]} castShadow>
                <cylinderGeometry args={[0.08, 0.06, 0.78, 14]} />
                <meshStandardMaterial
                  color={palette.robe}
                  roughness={0.8}
                  metalness={palette.sheen * 0.4}
                />
              </mesh>
              {/* Cuff — paler band at the wrist */}
              <mesh position={[0, -0.78, 0]}>
                <cylinderGeometry args={[0.07, 0.07, 0.06, 14]} />
                <meshStandardMaterial
                  color={
                    variant === 'medieval'
                      ? palette.robeSecondary
                      : variant === 'romantic'
                        ? palette.robeSecondary
                        : palette.accent
                  }
                  roughness={0.7}
                  metalness={variant === 'baroque' ? 0.6 : 0.05}
                />
              </mesh>
              {/* Hand — muted, not a face-tone rendering. Just a small sphere
                  in near-shadow values so it reads as a silhouette tip. */}
              <mesh position={[0, -0.86, 0]}>
                <sphereGeometry args={[0.045, 12, 10]} />
                <meshStandardMaterial
                  color={palette.skin}
                  roughness={0.95}
                  metalness={0.0}
                />
              </mesh>
            </group>
          );
        })}
      </group>

      {/* Head group — sits on top of the torso pivot */}
      <group ref={headRef} position={[0, 1.78, 0]}>
        {variant === 'medieval' ? (
          <>
            {/* Hood/cowl — pulled up, face is deep shadow. A cone with a
                slight forward tilt, plus a small occluder disk inside where
                the face would be. */}
            <mesh castShadow>
              <coneGeometry args={[0.2, 0.45, 24, 1, true]} />
              <meshStandardMaterial
                color={palette.hood}
                roughness={0.9}
                metalness={0.0}
                side={THREE.DoubleSide}
              />
            </mesh>
            {/* Inside-of-hood shadow disk (unlit black) — guarantees no face
                is ever visible under any lighting */}
            <mesh position={[0, -0.02, 0.08]} rotation={[Math.PI / 2.3, 0, 0]}>
              <circleGeometry args={[0.13, 24]} />
              <meshBasicMaterial color="#000000" />
            </mesh>
            {/* Tonsure crown — optional small sphere peeking at the top */}
            <mesh position={[0, 0.15, 0]}>
              <sphereGeometry args={[0.06, 12, 10]} />
              <meshStandardMaterial color={palette.hood} roughness={0.9} />
            </mesh>
          </>
        ) : variant === 'romantic' ? (
          <>
            {/* Tall silk top hat — the 19th-century concertgoer silhouette.
                No face beneath; a dark rounded plaque fills the would-be
                face volume. */}
            <mesh position={[0, 0.22, 0]} castShadow>
              <cylinderGeometry args={[0.12, 0.13, 0.32, 24]} />
              <meshStandardMaterial
                color={palette.hood}
                roughness={0.35}
                metalness={0.25}
              />
            </mesh>
            {/* Hat brim */}
            <mesh position={[0, 0.06, 0]}>
              <cylinderGeometry args={[0.22, 0.22, 0.03, 28]} />
              <meshStandardMaterial
                color={palette.hood}
                roughness={0.4}
                metalness={0.25}
              />
            </mesh>
            {/* Hat band — subtle gilt stripe */}
            <mesh position={[0, 0.1, 0]}>
              <cylinderGeometry args={[0.122, 0.122, 0.03, 28]} />
              <meshStandardMaterial
                color={palette.accent}
                roughness={0.5}
                metalness={0.5}
              />
            </mesh>
            {/* Face-volume occluder — deep shadow sphere */}
            <mesh position={[0, -0.05, 0]}>
              <sphereGeometry args={[0.12, 20, 14]} />
              <meshStandardMaterial
                color="#05040a"
                roughness={1.0}
                metalness={0.0}
              />
            </mesh>
            {/* High starched collar rim peeking out beneath */}
            <mesh position={[0, -0.2, 0.02]}>
              <cylinderGeometry args={[0.14, 0.16, 0.08, 20]} />
              <meshStandardMaterial
                color={palette.robeSecondary}
                roughness={0.7}
                metalness={0.02}
              />
            </mesh>
          </>
        ) : (
          <>
            {/* Baroque powdered wig — tall, rounded, pale. Two side curls and
                a top dome. Replaces the face entirely. */}
            <mesh position={[0, 0.08, 0]} castShadow>
              <sphereGeometry args={[0.19, 28, 20]} />
              <meshStandardMaterial
                color="#e8dcc7"
                roughness={0.95}
                metalness={0.0}
              />
            </mesh>
            {/* Two side curls (the classic "buckles") */}
            {[-1, 1].map((side) => (
              <mesh
                key={`curl-${side}`}
                position={[side * 0.19, -0.02, 0.02]}
                rotation={[0, 0, side * -0.3]}
              >
                <torusGeometry args={[0.07, 0.05, 12, 20]} />
                <meshStandardMaterial
                  color="#e8dcc7"
                  roughness={0.95}
                  metalness={0.0}
                />
              </mesh>
            ))}
            {/* Queue — a black silk ribbon at the back of the wig */}
            <mesh position={[0, 0.0, -0.16]}>
              <boxGeometry args={[0.08, 0.12, 0.04]} />
              <meshStandardMaterial color="#14110a" roughness={0.4} />
            </mesh>
            {/* Face-volume occluder (baroque wigs frame the face; we fill
                the frame with near-black so no features resolve) */}
            <mesh position={[0, -0.03, 0.1]}>
              <sphereGeometry args={[0.1, 20, 14]} />
              <meshStandardMaterial
                color="#1a1410"
                roughness={1.0}
                metalness={0.0}
              />
            </mesh>
          </>
        )}
      </group>

      {/* Rim-light accent: a very small soft pointlight at chest height, tinted
          warm, so the silhouette always has a soft edge-glow pickup even when
          the surrounding scene light rotates. Intensity is deliberately low. */}
      <pointLight
        position={[0, 1.2, 0.35]}
        intensity={0.8}
        distance={1.8}
        color={palette.accent}
      />
    </group>
  );
}
