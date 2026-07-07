'use client';

import { useMemo } from 'react';
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { RoundedBox } from '@react-three/drei';
import { usePBRMaterial } from '../pbr';
import { LightShaft } from '../objects/LightShaft';
import { PeriodFigure } from '../objects/PeriodFigure';

/**
 * Gothic cathedral: long nave, pointed-arch arcades, a real pointed barrel
 * vault with transverse + diagonal ribs, architecturally structured bay
 * elevations (blind arcade → string course → clerestory with recessed
 * stained glass), compound piers with lathe-turned bases and capitals,
 * volumetric god-rays, and a rose window behind the listener.
 *
 * No external meshes — everything is parametric geometry with PBR materials.
 * Every unique geometry/material is created exactly ONCE at module level (or
 * once per hook) and reused across all bays, so the whole interior stays a
 * few hundred draw calls and well under the triangle budget.
 */

const NAVE_LENGTH = 60;
const NAVE_HALF_WIDTH = 6;
const AISLE_WIDTH = 3;
const PILLAR_HEIGHT = 14;
const WALL_HEIGHT = 28;
const BAY_COUNT = 8;
const BAY_LENGTH = NAVE_LENGTH / BAY_COUNT;
const WALL_X = NAVE_HALF_WIDTH + AISLE_WIDTH; // 9 — outer wall plane

// Pointed-arch math (equilateral): arcs of radius = opening width whose
// curvature centers sit at the OPPOSITE springing point.
const VAULT_SPRING = PILLAR_HEIGHT + 0.85;
const VAULT_APEX_Y = VAULT_SPRING + NAVE_HALF_WIDTH * Math.sqrt(3); // ≈ 25.24
const ARCADE_TOP = 19.2; // top of the lower wall slab (blind arcade + band)

/* ————————————————————————— shared plain materials ————————————————————— */

const mouldingMat = new THREE.MeshStandardMaterial({ color: '#a8977a', roughness: 0.6 });
const ribMat = new THREE.MeshStandardMaterial({ color: '#958467', roughness: 0.7 });
const capitalMat = new THREE.MeshStandardMaterial({ color: '#b6a482', roughness: 0.55 });
const baseMat = new THREE.MeshStandardMaterial({ color: '#8a7a5e', roughness: 0.7 });
const bossMat = new THREE.MeshStandardMaterial({
  color: '#c8b894',
  roughness: 0.6,
  metalness: 0.1,
});
const mullionMat = new THREE.MeshStandardMaterial({ color: '#9c8c6e', roughness: 0.78 });
const darkStoneMat = new THREE.MeshStandardMaterial({
  color: '#5a4d3b',
  roughness: 0.9,
  side: THREE.DoubleSide,
});
const darkStoneMat2 = new THREE.MeshStandardMaterial({
  color: '#4a3d2b',
  roughness: 0.9,
  side: THREE.DoubleSide,
});
const brassMat = new THREE.MeshStandardMaterial({
  color: '#d9b463',
  metalness: 0.78,
  roughness: 0.26,
});
const brassPipeMat = new THREE.MeshStandardMaterial({
  color: '#d9b463',
  metalness: 0.85,
  roughness: 0.22,
  emissive: '#8a6820',
  emissiveIntensity: 0.28,
});
const waxMat = new THREE.MeshStandardMaterial({ color: '#fff5d6', roughness: 0.7 });
const flameMat = new THREE.MeshStandardMaterial({
  color: '#fff1b0',
  emissive: '#ffb14a',
  emissiveIntensity: 5,
});
const clothMat = new THREE.MeshStandardMaterial({
  color: '#7a1a1a',
  roughness: 0.88,
  side: THREE.DoubleSide,
});
const clothTrimMat = new THREE.MeshStandardMaterial({
  color: '#d6a745',
  emissive: '#d6a745',
  emissiveIntensity: 0.35,
  roughness: 0.3,
  metalness: 0.7,
  side: THREE.DoubleSide,
});
const stepMat = new THREE.MeshStandardMaterial({
  color: '#c8b590',
  roughness: 0.55,
  metalness: 0.08,
});
const altarTopMat = new THREE.MeshStandardMaterial({
  color: '#e4d6b5',
  roughness: 0.45,
  metalness: 0.1,
});
const woodMat = new THREE.MeshStandardMaterial({
  color: '#8c6a40',
  roughness: 0.5,
  metalness: 0.15,
});
const goldInlayMat = new THREE.MeshStandardMaterial({
  color: '#e6c36a',
  emissive: '#d6a745',
  emissiveIntensity: 0.6,
  metalness: 0.85,
  roughness: 0.2,
});
const tripodMat = new THREE.MeshStandardMaterial({
  color: '#4a3820',
  metalness: 0.5,
  roughness: 0.5,
});
const organCaseMat = new THREE.MeshStandardMaterial({ color: '#3a2a18', roughness: 0.8 });
const corniceMat = new THREE.MeshStandardMaterial({
  color: '#8a6820',
  metalness: 0.5,
  roughness: 0.4,
});
const roseHubMat = new THREE.MeshStandardMaterial({
  color: '#ffe2a3',
  emissive: '#ffc56b',
  emissiveIntensity: 2.4,
  side: THREE.DoubleSide,
});

/* ————————————————————————— shared geometries ——————————————————————————— */

/** Pointed (equilateral) arch outline: opening `w` wide, jambs from y0 up to
 *  the springing ys, arcs of radius w meeting at apex ys + w·√3/2. */
function pointedArchShape(w: number, y0: number, ys: number): THREE.Shape {
  const s = new THREE.Shape();
  s.moveTo(-w / 2, y0);
  s.lineTo(-w / 2, ys);
  s.absarc(w / 2, ys, w, Math.PI, (2 * Math.PI) / 3, true);
  s.absarc(-w / 2, ys, w, Math.PI / 3, 0, true);
  s.lineTo(w / 2, y0);
  s.closePath();
  return s;
}

/** Wall slab with an optional arched hole, extruded with a bevel so every
 *  opening gets a chamfered/splayed stone reveal for free. UVs are in
 *  world-meters (extrude uses shape coords), so pair with a material whose
 *  repeat is ~1/tile-size. */
function panelGeometry(
  width: number,
  height: number,
  hole: THREE.Shape | THREE.Path | null,
  depth: number,
): THREE.ExtrudeGeometry {
  const shape = new THREE.Shape();
  shape.moveTo(-width / 2, 0);
  shape.lineTo(width / 2, 0);
  shape.lineTo(width / 2, height);
  shape.lineTo(-width / 2, height);
  shape.closePath();
  if (hole) shape.holes.push(hole as THREE.Path);
  return new THREE.ExtrudeGeometry(shape, {
    depth,
    steps: 1,
    bevelEnabled: true,
    bevelThickness: 0.14,
    bevelSize: 0.12,
    bevelSegments: 2,
    curveSegments: 22,
  });
}

// Per-bay elevation: blind pointed-arch recess at ground level…
const LOWER_BAY_GEO = panelGeometry(
  BAY_LENGTH,
  ARCADE_TOP,
  pointedArchShape(4.2, 0.8, 5.5),
  0.55,
);
// …and a clerestory slab with the stained-glass opening (local y 0..8.8).
const CLERE_BAY_GEO = panelGeometry(
  BAY_LENGTH,
  WALL_HEIGHT - ARCADE_TOP,
  pointedArchShape(2.6, 0.8, 3.6),
  0.55,
);

// End walls: rear pierced by the rose oculus, front by a grand blind arch.
const REAR_WALL_GEO = (() => {
  const hole = new THREE.Path();
  hole.absarc(0, WALL_HEIGHT - 10, 5.0, 0, Math.PI * 2, true);
  return panelGeometry(WALL_X * 2, WALL_HEIGHT, hole, 0.6);
})();
const FRONT_WALL_GEO = panelGeometry(
  WALL_X * 2,
  WALL_HEIGHT,
  pointedArchShape(7, 0, 8),
  0.6,
);

// Recess back panels (plane-UV pieces, textured with panelMat).
const RECESS_PANEL_GEO = new THREE.PlaneGeometry(4.6, 9.4);
const APSE_PANEL_GEO = new THREE.PlaneGeometry(7.8, 14.6);
const AISLE_CAP_GEO = new THREE.PlaneGeometry(AISLE_WIDTH, NAVE_LENGTH);

// Stained glass sheet — pointed-arch shaped, slightly inset from the reveal.
const GLASS_GEO = new THREE.ShapeGeometry(pointedArchShape(2.45, 0.88, 3.6), 24);
const MULLION_GEO = new THREE.BoxGeometry(0.1, 3.1, 0.16);
// Quatrefoil (four-lobed) light above the lancets — a single shape mesh.
const QUATREFOIL_GEO = (() => {
  const r = 0.17;
  const q = new THREE.Shape();
  q.absarc(r, 0, r, -Math.PI / 2, Math.PI / 2, false);
  q.absarc(0, r, r, 0, Math.PI, false);
  q.absarc(-r, 0, r, Math.PI / 2, (3 * Math.PI) / 2, false);
  q.absarc(0, -r, r, Math.PI, 2 * Math.PI, false);
  q.closePath();
  return new THREE.ShapeGeometry(q, 16);
})();
const QUATRE_RING_GEO = new THREE.TorusGeometry(0.38, 0.06, 10, 28);

// Wall trim reused along every bay boundary + horizontal string courses.
const PILASTER_GEO = new THREE.BoxGeometry(0.85, 20.4, 0.6);
const STRING_COURSE_GEO = new THREE.BoxGeometry(0.55, 0.42, NAVE_LENGTH + 0.6);

/* — vault: pointed barrel surface swept along z (custom BufferGeometry) —— */

const VAULT_GEO = (() => {
  const P = 64; // profile points (across the nave)
  const L = 64; // length segments (along z)
  const R = NAVE_HALF_WIDTH * 2;
  const half = P / 2;
  const profile: { x: number; y: number }[] = [];
  // Left arc: center (+halfW, spring), θ from π (left springing) to 2π/3 (apex)
  for (let i = 0; i <= half; i++) {
    const th = Math.PI - (i / half) * (Math.PI / 3);
    profile.push({
      x: NAVE_HALF_WIDTH + R * Math.cos(th),
      y: VAULT_SPRING + R * Math.sin(th),
    });
  }
  // Right arc: center (−halfW, spring), θ from π/3 (apex) down to 0
  for (let i = 1; i <= half; i++) {
    const th = Math.PI / 3 - (i / half) * (Math.PI / 3);
    profile.push({
      x: -NAVE_HALF_WIDTH + R * Math.cos(th),
      y: VAULT_SPRING + R * Math.sin(th),
    });
  }
  const arcLength = 2 * R * (Math.PI / 3); // ≈ 25.1 m across the profile
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  for (let j = 0; j <= L; j++) {
    const z = -NAVE_LENGTH / 2 + (j / L) * NAVE_LENGTH;
    for (let i = 0; i <= P; i++) {
      const p = profile[i];
      positions.push(p.x, p.y, z);
      // UVs in meters so the brick material's small `repeat` tiles correctly.
      uvs.push((i / P) * arcLength, (j / L) * NAVE_LENGTH);
    }
  }
  for (let j = 0; j < L; j++) {
    for (let i = 0; i < P; i++) {
      const a = j * (P + 1) + i;
      const b = a + 1;
      const c = a + (P + 1);
      const d = c + 1;
      // Wound so face normals point DOWN into the nave.
      indices.push(a, b, c, b, d, c);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setIndex(indices);
  g.computeVertexNormals();
  return g;
})();

// Transverse pointed arch (also the arcade arch): 60° torus arc, radius =
// nave width, centered on the opposite pillar top.
const ARCH_TORUS_GEO = new THREE.TorusGeometry(NAVE_HALF_WIDTH * 2, 0.32, 20, 56, Math.PI / 3);
const RIDGE_RIB_GEO = new THREE.CylinderGeometry(0.13, 0.13, NAVE_LENGTH, 12);
const BOSS_GEO = new THREE.SphereGeometry(0.42, 24, 24);

// Diagonal ribs: quadratic tube from a bay corner up to the bay-center boss,
// bowed upward so it hugs the vault. Two mirrored geometries cover all four
// corners of every bay via 180° rotations.
function diagRibGeometry(x0: number, z0: number): THREE.TubeGeometry {
  const start = new THREE.Vector3(x0, VAULT_SPRING, z0);
  const end = new THREE.Vector3(0, VAULT_APEX_Y - 0.18, 0);
  const mid = new THREE.Vector3(
    x0 * 0.42,
    VAULT_SPRING + (VAULT_APEX_Y - VAULT_SPRING) * 0.72,
    z0 * 0.42,
  );
  return new THREE.TubeGeometry(
    new THREE.QuadraticBezierCurve3(start, mid, end),
    24,
    0.15,
    10,
    false,
  );
}
const DIAG_RIB_A = diagRibGeometry(-NAVE_HALF_WIDTH, -BAY_LENGTH / 2);
const DIAG_RIB_B = diagRibGeometry(NAVE_HALF_WIDTH, -BAY_LENGTH / 2);

/* — compound pier: clustered shafts merged into ONE geometry + lathe trim — */

const PIER_GEO = (() => {
  const parts: THREE.BufferGeometry[] = [
    new THREE.CylinderGeometry(0.8, 0.85, PILLAR_HEIGHT, 48),
  ];
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2;
    const shaft = new THREE.CylinderGeometry(0.18, 0.18, PILLAR_HEIGHT, 20);
    shaft.translate(Math.cos(a) * 0.78, 0, Math.sin(a) * 0.78);
    parts.push(shaft);
  }
  const merged = mergeGeometries(parts);
  for (const p of parts) p.dispose();
  return merged ?? new THREE.CylinderGeometry(0.85, 0.9, PILLAR_HEIGHT, 48);
})();

function lathe(pts: [number, number][], segments = 48): THREE.LatheGeometry {
  return new THREE.LatheGeometry(
    pts.map(([x, y]) => new THREE.Vector2(x, y)),
    segments,
  );
}

// Capital: bell → necking → ovolo → abacus, closed on top.
const CAPITAL_GEO = lathe([
  [0.86, 0],
  [0.98, 0.08],
  [0.9, 0.18],
  [0.94, 0.34],
  [1.08, 0.52],
  [1.22, 0.64],
  [1.18, 0.7],
  [1.36, 0.78],
  [1.46, 0.88],
  [1.46, 1.0],
  [0, 1.0],
]);
// Base: plinth → double torus mouldings → shaft fillet.
const PIER_BASE_GEO = lathe([
  [1.5, 0],
  [1.5, 0.2],
  [1.36, 0.26],
  [1.24, 0.32],
  [1.28, 0.44],
  [1.14, 0.52],
  [1.18, 0.58],
  [1.02, 0.7],
  [0.92, 0.82],
  [0.9, 0.95],
]);

// Baroque candlestick profile — reused (scaled up) for the floor candelabra.
const CANDLESTICK_GEO = lathe(
  [
    [0.17, 0],
    [0.17, 0.04],
    [0.09, 0.1],
    [0.13, 0.2],
    [0.06, 0.28],
    [0.055, 0.5],
    [0.095, 0.57],
    [0.055, 0.64],
    [0.05, 0.78],
    [0.1, 0.84],
    [0.115, 0.9],
    [0.05, 0.92],
  ],
  32,
);

/* — altar cloth: parametric plane with sagging folds baked into z ————————— */

function clothOffset(x: number, t: number): number {
  // t: 0 at the (tucked) top edge, 1 at the free-hanging hem.
  return (
    t * (0.05 * Math.sin(x * 5.8 + 0.4) + 0.018 * Math.sin(x * 11.3 + 2.0)) +
    0.02 * Math.cos((x / 3.3) * Math.PI)
  );
}
const CLOTH_GEO = (() => {
  const g = new THREE.PlaneGeometry(3.3, 0.85, 48, 12);
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const t = (0.425 - pos.getY(i)) / 0.85;
    pos.setZ(i, clothOffset(x, t));
  }
  g.computeVertexNormals();
  return g;
})();
// Gold trim band displaced with the SAME fold function so it rides the cloth.
const CLOTH_TRIM_GEO = (() => {
  const g = new THREE.PlaneGeometry(3.3, 0.09, 48, 2);
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    // Trim sits at cloth-local y = −0.27; recover the global fold parameter.
    const t = (0.695 - pos.getY(i)) / 0.85;
    pos.setZ(i, clothOffset(x, t) + 0.008);
  }
  g.computeVertexNormals();
  return g;
})();

// Rose window spokes + organ pipe unit cylinder (scaled per pipe).
const ROSE_SPOKE_GEO = new THREE.BoxGeometry(0.12, 2.1, 0.1);
const UNIT_PIPE_GEO = new THREE.CylinderGeometry(1, 1, 1, 24);

/* ————————————————————————— sub-assemblies ————————————————————————————— */

interface WallBayProps {
  side: number;
  z: number;
  glassMat: THREE.MeshStandardMaterial;
  panelMat: THREE.Material;
  wallMat: THREE.Material;
}

/** One structural bay of the side elevation: blind arcade recess below,
 *  clerestory slab with recessed stained glass + tracery above. All geometry
 *  is shared module-level; only transforms differ per bay. */
function WallBay({ side, z, glassMat, panelMat, wallMat }: WallBayProps) {
  return (
    <group
      position={[side * WALL_X, 0, z]}
      rotation={[0, side > 0 ? Math.PI / 2 : -Math.PI / 2, 0]}
    >
      {/* Ground-level slab with blind pointed-arch recess */}
      <mesh geometry={LOWER_BAY_GEO} material={wallMat} receiveShadow />
      {/* Recess back panel — darker stone, real depth behind the arch */}
      <mesh
        geometry={RECESS_PANEL_GEO}
        material={panelMat}
        position={[0, 4.9, 0.45]}
        rotation={[0, Math.PI, 0]}
        receiveShadow
      />
      {/* Clerestory slab with splayed window reveal */}
      <mesh
        geometry={CLERE_BAY_GEO}
        material={wallMat}
        position={[0, ARCADE_TOP, 0]}
        receiveShadow
      />
      {/* Stained glass sheet set back into the reveal */}
      <mesh geometry={GLASS_GEO} material={glassMat} position={[0, ARCADE_TOP, 0.3]} />
      {/* Stone mullions dividing the lancets */}
      {[-0.42, 0.42].map((mx) => (
        <mesh
          key={`mul-${mx}`}
          geometry={MULLION_GEO}
          material={mullionMat}
          position={[mx, ARCADE_TOP + 2.35, 0.32]}
        />
      ))}
      {/* Quatrefoil light in the arch head, ringed in stone */}
      <mesh
        geometry={QUATREFOIL_GEO}
        material={glassMat}
        position={[0, ARCADE_TOP + 4.4, 0.34]}
      />
      <mesh
        geometry={QUATRE_RING_GEO}
        material={mullionMat}
        position={[0, ARCADE_TOP + 4.4, 0.34]}
      />
    </group>
  );
}

/* ————————————————————————————— scene ——————————————————————————————————— */

export function Cathedral() {
  const bayPositions = useMemo(
    () =>
      Array.from({ length: BAY_COUNT }, (_, i) =>
        -NAVE_LENGTH / 2 + (i + 0.5) * BAY_LENGTH,
      ),
    [],
  );

  // PBR materials. Extruded walls + the vault carry world-meter UVs, so their
  // repeat is ~1/tile-size; plane-UV surfaces (floor, panels) use per-surface
  // repeats as usual.
  const floorMat = usePBRMaterial('medieval_blocks_03', {
    repeat: [6, 16],
    color: '#4a4036',
    aoIntensity: 1,
    displacementScale: 0.05,
  });
  const wallMat = usePBRMaterial('castle_brick_07', {
    repeat: [0.32, 0.32],
    color: '#6a5a48',
    aoIntensity: 1,
  });
  // Lighter lime-washed webbing between the ribs — real Gothic vaults are
  // plastered pale, and the bounce keeps the ceiling readable at 25m.
  const vaultMat = usePBRMaterial('castle_brick_07', {
    repeat: [0.35, 0.35],
    color: '#a89a82',
    aoIntensity: 1,
  });
  const panelMat = usePBRMaterial('castle_brick_07', {
    repeat: [1.4, 2.8],
    color: '#544738',
    aoIntensity: 1,
  });
  const pillarMat = usePBRMaterial('castle_brick_07', {
    repeat: [1.5, 6],
    color: '#cdbd9f',
    roughnessBoost: 0.9,
    aoIntensity: 1,
  });
  // The vault is a single-sided sweep; render both sides so it never reads
  // as a hole when glimpsed from the aisles.
  vaultMat.side = THREE.DoubleSide;

  // Stained-glass tints: one emissive material per bay hue, reused by the
  // lancet sheet AND the quatrefoil of both sides of that bay.
  const glassMats = useMemo(
    () =>
      bayPositions.map((_, bi) => {
        const hue = (bi * 47) % 360;
        return new THREE.MeshStandardMaterial({
          color: `hsl(${hue}, 58%, 55%)`,
          emissive: `hsl(${hue}, 70%, 45%)`,
          emissiveIntensity: 1.4,
          roughness: 0.35,
          side: THREE.DoubleSide,
        });
      }),
    [bayPositions],
  );

  // Rose window: each segment a different saturated hue.
  const roseColors = ['#a23b2a', '#2f4d8a', '#d6a745', '#2f7a45', '#7a2a6b', '#c4521b'];

  return (
    <group>
      {/* Flagstone floor — dense grid so the displacement map gives the
          stones real relief instead of a flat photo. */}
      <mesh position={[0, 0, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[WALL_X * 2, NAVE_LENGTH, 160, 220]} />
        <primitive object={floorMat} attach="material" />
      </mesh>

      {/* Side elevations — one structured module per bay per side */}
      {bayPositions.map((z, bi) => (
        <group key={`elev-${bi}`}>
          {[-1, 1].map((side) => (
            <WallBay
              key={`bay-${side}`}
              side={side}
              z={z}
              glassMat={glassMats[bi]}
              panelMat={panelMat}
              wallMat={wallMat}
            />
          ))}
        </group>
      ))}

      {/* Pilaster strips at bay boundaries (also hide module seams) */}
      {Array.from({ length: BAY_COUNT - 1 }, (_, i) => -NAVE_LENGTH / 2 + (i + 1) * BAY_LENGTH).map(
        (zb) =>
          [-1, 1].map((side) => (
            <mesh
              key={`pil-${side}-${zb}`}
              geometry={PILASTER_GEO}
              material={mouldingMat}
              position={[side * (WALL_X - 0.24), 10.2, zb]}
              castShadow
              receiveShadow
            />
          )),
      )}

      {/* Horizontal string-course mouldings: above the blind arcade and at
          the clerestory sill (covers the slab seam). */}
      {[-1, 1].map((side) =>
        [10.7, ARCADE_TOP + 0.05].map((y) => (
          <mesh
            key={`sc-${side}-${y}`}
            geometry={STRING_COURSE_GEO}
            material={mouldingMat}
            position={[side * (WALL_X - 0.18), y, 0]}
          />
        )),
      )}

      {/* End walls: rear pierced by the rose oculus (bevelled reveal),
          front with a grand blind arch behind the baldachin. */}
      <mesh
        geometry={REAR_WALL_GEO}
        material={wallMat}
        position={[0, 0, NAVE_LENGTH / 2]}
        receiveShadow
      />
      <mesh
        geometry={FRONT_WALL_GEO}
        material={wallMat}
        position={[0, 0, -NAVE_LENGTH / 2]}
        rotation={[0, Math.PI, 0]}
        receiveShadow
      />
      <mesh
        geometry={APSE_PANEL_GEO}
        material={panelMat}
        position={[0, 7.2, -NAVE_LENGTH / 2 - 0.45]}
        receiveShadow
      />

      {/* Aisle slot caps high above (so no sky shows over the aisles) */}
      {[-1, 1].map((side) => (
        <mesh
          key={`cap-${side}`}
          geometry={AISLE_CAP_GEO}
          material={panelMat}
          position={[side * (NAVE_HALF_WIDTH + AISLE_WIDTH / 2), WALL_HEIGHT - 0.1, 0]}
          rotation={[Math.PI / 2, 0, 0]}
        />
      ))}

      {/* Bays: compound piers with lathe bases/capitals + pointed arcade
          arches. Every geometry here is a shared module-level singleton. */}
      {bayPositions.map((z, i) => (
        <group key={`bay-${i}`}>
          {[-1, 1].map((side) => (
            <group key={`pier-${side}`} position={[side * NAVE_HALF_WIDTH, 0, z]}>
              <mesh
                geometry={PIER_GEO}
                position={[0, PILLAR_HEIGHT / 2, 0]}
                castShadow
                receiveShadow
              >
                <primitive object={pillarMat} attach="material" />
              </mesh>
              <mesh geometry={PIER_BASE_GEO} material={baseMat} castShadow receiveShadow />
              <mesh
                geometry={CAPITAL_GEO}
                material={capitalMat}
                position={[0, PILLAR_HEIGHT - 0.1, 0]}
                castShadow
              />
            </group>
          ))}

          {/* Pointed transverse arch: two 60° torus arcs whose curvature
              centers sit at the OPPOSITE pillar top, springing exactly from
              the capitals and meeting at the vault apex. */}
          <mesh
            geometry={ARCH_TORUS_GEO}
            material={mouldingMat}
            position={[NAVE_HALF_WIDTH, VAULT_SPRING, z]}
            rotation={[0, Math.PI, 0]}
          />
          <mesh
            geometry={ARCH_TORUS_GEO}
            material={mouldingMat}
            position={[-NAVE_HALF_WIDTH, VAULT_SPRING, z]}
          />

          {/* Diagonal ribs: four quarter-ribs from bay corners to the boss.
              Two mirrored geometries + 180° rotations cover all corners. */}
          <group position={[0, 0, z]}>
            <mesh geometry={DIAG_RIB_A} material={ribMat} />
            <mesh geometry={DIAG_RIB_A} material={ribMat} rotation={[0, Math.PI, 0]} />
            <mesh geometry={DIAG_RIB_B} material={ribMat} />
            <mesh geometry={DIAG_RIB_B} material={ribMat} rotation={[0, Math.PI, 0]} />
          </group>

          {/* Keystone boss at the crossing of the ribs */}
          <mesh geometry={BOSS_GEO} material={bossMat} position={[0, VAULT_APEX_Y - 0.15, z]} />
        </group>
      ))}

      {/* The vault itself — a real pointed barrel surface spanning the nave,
          with the ribs sitting proud of it. */}
      <mesh geometry={VAULT_GEO} receiveShadow>
        <primitive object={vaultMat} attach="material" />
      </mesh>
      {/* Longitudinal ridge rib along the apex */}
      <mesh
        geometry={RIDGE_RIB_GEO}
        material={ribMat}
        position={[0, VAULT_APEX_Y - 0.12, 0]}
        rotation={[Math.PI / 2, 0, 0]}
      />

      {/* ——— Altar area at the front of the nave (toward -z) ————————————— */}
      <group position={[0, 0, -NAVE_LENGTH / 2 + 4]}>
        {/* Three-step platform — bevelled treads instead of naked boxes */}
        {[0, 1, 2].map((step) => (
          <RoundedBox
            key={`step-${step}`}
            args={[9 - step * 1.2, 0.34, 3 - step * 0.6]}
            radius={0.06}
            smoothness={3}
            position={[0, 0.15 + step * 0.3, step * 0.6]}
            castShadow
            receiveShadow
          >
            <primitive object={stepMat} attach="material" />
          </RoundedBox>
        ))}

        {/* Altar table — chamfered mensa slab */}
        <RoundedBox
          args={[3.2, 0.22, 1.4]}
          radius={0.05}
          smoothness={3}
          position={[0, 1.35, 1.4]}
          castShadow
          receiveShadow
        >
          <primitive object={altarTopMat} attach="material" />
        </RoundedBox>
        {/* Altar frontal beneath the mensa */}
        <RoundedBox
          args={[2.8, 1.4, 1.3]}
          radius={0.05}
          smoothness={3}
          position={[0, 0.75, 1.4]}
          receiveShadow
        >
          <primitive object={capitalMat} attach="material" />
        </RoundedBox>

        {/* Altar cloth — parametric drape with sagging sine folds, plus a
            gold trim band displaced by the same fold function. */}
        <mesh geometry={CLOTH_GEO} material={clothMat} position={[0, 0.95, 1.42]} />
        <mesh geometry={CLOTH_TRIM_GEO} material={clothTrimMat} position={[0, 0.68, 1.42]} />

        {/* Two lathe-turned brass candlesticks on the altar */}
        {[-1.1, 1.1].map((x, i) => (
          <group key={`candle-alt-${i}`} position={[x, 1.45, 1.4]}>
            <mesh
              geometry={CANDLESTICK_GEO}
              material={brassMat}
              position={[0, -0.45, 0]}
              scale={[1, 2.0, 1]}
              castShadow
            />
            <mesh position={[0, 1.5, 0]} material={waxMat}>
              <cylinderGeometry args={[0.04, 0.04, 0.24, 12]} />
            </mesh>
            <mesh position={[0, 1.68, 0]} material={flameMat} scale={[1, 1.5, 1]}>
              <sphereGeometry args={[0.055, 12, 12]} />
            </mesh>
            <pointLight position={[0, 1.7, 0]} intensity={3.5} distance={5} color="#ffb14a" />
          </group>
        ))}

        {/* Crucifix — bevelled beams with a gold boss at the crossing */}
        <group position={[0, 4.2, 0.2]}>
          <RoundedBox args={[0.25, 3.6, 0.2]} radius={0.04} smoothness={3} castShadow>
            <primitive object={woodMat} attach="material" />
          </RoundedBox>
          <RoundedBox
            args={[1.8, 0.25, 0.2]}
            radius={0.04}
            smoothness={3}
            position={[0, 0.6, 0]}
            castShadow
          >
            <primitive object={woodMat} attach="material" />
          </RoundedBox>
          <mesh position={[0, 0.6, 0.12]} material={goldInlayMat}>
            <boxGeometry args={[0.4, 0.4, 0.03]} />
          </mesh>
        </group>

        {/* Baldachin: brass corner posts with sphere finials + bevelled top */}
        {[
          [-1.9, 0.8],
          [1.9, 0.8],
          [-1.9, 2.1],
          [1.9, 2.1],
        ].map(([px, pz], i) => (
          <group key={`post-${i}`}>
            <mesh position={[px, 3, pz]} material={brassMat} castShadow>
              <cylinderGeometry args={[0.09, 0.11, 6, 24]} />
            </mesh>
            <mesh position={[px, 6.12, pz]} material={brassMat}>
              <sphereGeometry args={[0.15, 16, 16]} />
            </mesh>
          </group>
        ))}
        <RoundedBox
          args={[4.2, 0.2, 1.6]}
          radius={0.05}
          smoothness={3}
          position={[0, 6.05, 1.45]}
          castShadow
        >
          <primitive object={corniceMat} attach="material" />
        </RoundedBox>

        {/* Warm key light on the altar — shadow caster #1 */}
        <spotLight
          position={[0, 9, 6]}
          target-position={[0, 1.5, 1.4]}
          angle={Math.PI / 6}
          penumbra={0.6}
          intensity={160}
          distance={20}
          color="#ffd89a"
          castShadow
        />
        {/* Subtle fill from the sides */}
        <pointLight position={[-3, 3, 2]} intensity={7} distance={9} color="#ffd089" />
        <pointLight position={[3, 3, 2]} intensity={7} distance={9} color="#ffd089" />
      </group>

      {/* ——— Chorister figures in procession before the altar ——————————
          Three medieval choristers in cassock + surplice, hooded so faces
          are never resolved. A shallow arc facing the altar (-z direction),
          lit from behind by the altar spot and from above by the clerestory
          — reads as a living silhouette in a stone vault. */}
      {[
        { x: 0, z: -22.0, r: Math.PI, phase: 0 },
        { x: -1.9, z: -21.3, r: Math.PI - 0.18, phase: 1.2 },
        { x: 1.9, z: -21.3, r: Math.PI + 0.18, phase: 2.4 },
      ].map((f, i) => (
        <PeriodFigure
          key={`chor-${i}`}
          variant="medieval"
          position={[f.x, 0, f.z]}
          rotation={[0, f.r, 0]}
          phase={f.phase}
          sway={0.9}
        />
      ))}

      {/* Rose window in the rear-wall oculus — stone rings, radiating stone
          spokes between the panes, and an inner ring of 12 small lights. */}
      <group position={[0, WALL_HEIGHT - 10, NAVE_LENGTH / 2 - 0.1]}>
        {/* outer stone ring */}
        <mesh material={darkStoneMat}>
          <ringGeometry args={[4, 5, 96]} />
        </mesh>
        {/* inner stone ring divider */}
        <mesh position={[0, 0, 0.02]} material={darkStoneMat2}>
          <ringGeometry args={[1.9, 2.1, 64]} />
        </mesh>
        {/* radiating stone spokes between the panes */}
        {Array.from({ length: 12 }).map((_, i) => {
          const a = (i / 12) * Math.PI * 2 + Math.PI / 12;
          return (
            <mesh
              key={`spoke-${i}`}
              geometry={ROSE_SPOKE_GEO}
              material={darkStoneMat}
              position={[Math.cos(a) * 3.05, Math.sin(a) * 3.05, 0.03]}
              rotation={[0, 0, a - Math.PI / 2]}
            />
          );
        })}
        {/* stained-glass outer petals */}
        {roseColors.map((c, i) => {
          const a = (i / roseColors.length) * Math.PI * 2;
          return (
            <mesh
              key={`pane-${i}`}
              position={[Math.cos(a) * 2.9, Math.sin(a) * 2.9, 0.05]}
              rotation={[0, 0, a]}
            >
              <circleGeometry args={[1.3, 48]} />
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
            <mesh key={`inner-pane-${i}`} position={[Math.cos(a) * 1.35, Math.sin(a) * 1.35, 0.04]}>
              <circleGeometry args={[0.45, 32]} />
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
        {/* Central rosette with a stone hub ring */}
        <mesh position={[0, 0, 0.08]} material={roseHubMat}>
          <circleGeometry args={[1.2, 64]} />
        </mesh>
        <mesh position={[0, 0, 0.1]} material={darkStoneMat2}>
          <ringGeometry args={[1.12, 1.26, 64]} />
        </mesh>
      </group>

      {/* Pipe organ: a rank of brass pipes flanking the rose window on the
          rear wall gallery. Two side towers + a lower central rank — one
          shared unit cylinder scaled per pipe. */}
      <group position={[0, WALL_HEIGHT - 15, NAVE_LENGTH / 2 - 1.6]}>
        <mesh position={[0, 0, -0.2]} material={organCaseMat}>
          <boxGeometry args={[13, 7, 0.4]} />
        </mesh>
        {/* Central flat rank — 11 medium pipes */}
        {Array.from({ length: 11 }).map((_, i) => {
          const x = (i - 5) * 0.55;
          const h = 4 + Math.abs(i - 5) * 0.15;
          return (
            <mesh
              key={`pipe-c-${i}`}
              geometry={UNIT_PIPE_GEO}
              material={brassPipeMat}
              position={[x, -0.5 + h / 2, 0]}
              scale={[0.23, h, 0.23]}
            />
          );
        })}
        {/* Side towers — 6 larger pipes each, mirrored */}
        {Array.from({ length: 6 }).map((_, i) => {
          const h = 6 - Math.abs(i - 2.5) * 0.3;
          return [-1, 1].map((side) => (
            <mesh
              key={`pipe-${side}-${i}`}
              geometry={UNIT_PIPE_GEO}
              material={brassPipeMat}
              position={[side * (4.8 - i * 0.4), -0.2 + h / 2, 0]}
              scale={[0.31, h, 0.31]}
            />
          ));
        })}
        {/* Decorative top cornice */}
        <mesh position={[0, 3.8, 0.1]} material={corniceMat}>
          <boxGeometry args={[13.2, 0.5, 0.5]} />
        </mesh>
      </group>

      {/* Tall floor candelabra along the nave — lathe-turned brass stems,
          2 per alternate bay, each with its own warm pointLight. */}
      {bayPositions
        .filter((_, i) => i % 2 === 0)
        .map((z, bi) => (
          <group key={`fl-cand-${bi}`}>
            {[-1, 1].map((side) => (
              <group key={`fc-${side}`} position={[side * (NAVE_HALF_WIDTH - 1.6), 0, z]}>
                <mesh position={[0, 0.1, 0]} material={tripodMat}>
                  <cylinderGeometry args={[0.35, 0.45, 0.2, 24]} />
                </mesh>
                <mesh
                  geometry={CANDLESTICK_GEO}
                  material={brassMat}
                  position={[0, 0.18, 0]}
                  scale={[2.0, 2.5, 2.0]}
                  castShadow
                />
                <mesh position={[0, 2.62, 0]} material={waxMat}>
                  <cylinderGeometry args={[0.06, 0.06, 0.3, 16]} />
                </mesh>
                <mesh position={[0, 2.85, 0]} material={flameMat} scale={[1, 1.4, 1]}>
                  <sphereGeometry args={[0.075, 12, 12]} />
                </mesh>
                <pointLight position={[0, 2.9, 0]} intensity={5} distance={7} color="#ffb066" />
              </group>
            ))}
          </group>
        ))}

      {/* ——— Volumetric god-rays ————————————————————————————————————————
          Cool shafts slanting down from the (sunlit, +x) clerestory windows
          into the nave, one grand warm shaft from the rose window toward the
          altar, and a soft warm column above the altar candles. Angles are
          chosen so each beam clears the vault edge and lands on the floor. */}
      {[-18.75, -3.75, 3.75, 18.75].map((z, i) => (
        <LightShaft
          key={`shaft-${i}`}
          position={[8.6, 21.5, z]}
          rotation={[0, 0, -0.36]}
          length={23.5}
          radiusTop={1.1}
          radiusBottom={3.2}
          color="#e8eefc"
          intensity={0.05}
        />
      ))}
      <LightShaft
        position={[0, 17.5, NAVE_LENGTH / 2 - 0.6]}
        rotation={[1.28, 0, 0]}
        length={56}
        radiusTop={2.8}
        radiusBottom={6.5}
        color="#ffd9a0"
        intensity={0.07}
      />
      <LightShaft
        position={[0, 9.5, -24.6]}
        length={8.8}
        radiusTop={0.7}
        radiusBottom={2.4}
        color="#ffc98a"
        intensity={0.045}
      />

      {/* Cathedral lighting — same design as before, intensities eased so the
          displaced/AO'd stone doesn't blow out. Exactly TWO shadow casters:
          the rose-window spot and the altar spot. */}
      {/* Ground color is the floor-bounce that lights the vault webbing —
          down-facing surfaces sample it, so near-black there = black vault. */}
      <hemisphereLight args={['#d6dfe9', '#57493a', 1.05]} />
      <ambientLight intensity={0.42} color="#e8dfcc" />

      {/* Vault wash — unshadowed uplights so the stone ceiling reads instead
          of dissolving to black. One every other bay is enough. */}
      {bayPositions.filter((_, i) => i % 2 === 0).map((z, i) => (
        <pointLight
          key={`vault-wash-${i}`}
          position={[0, PILLAR_HEIGHT + 6, z]}
          intensity={85}
          distance={34}
          color="#cfc4ad"
        />
      ))}

      {/* Daylight streaming through clerestory windows on both sides. */}
      {bayPositions.map((z, i) => (
        <group key={`clerestory-${i}`}>
          {[-1, 1].map((side) => (
            <spotLight
              key={`cl-${side}`}
              position={[side * (WALL_X - 0.5), WALL_HEIGHT - 4, z]}
              target-position={[side * -2, 2, z]}
              angle={Math.PI / 5}
              penumbra={0.9}
              intensity={48}
              distance={34}
              color="#f3e9d2"
            />
          ))}
        </group>
      ))}

      {/* Warm cone from the rose window — shadow caster #2. */}
      <spotLight
        position={[0, WALL_HEIGHT - 9, NAVE_LENGTH / 2 - 2]}
        target-position={[0, 2, 0]}
        angle={Math.PI / 3.5}
        penumbra={0.7}
        intensity={140}
        distance={NAVE_LENGTH}
        color="#ffd6a0"
        castShadow
      />

      {/* Candle pointLights along the nave — warm fill at ground level. */}
      {bayPositions.map((z, i) => (
        <pointLight
          key={`candle-${i}`}
          position={[0, 4, z]}
          intensity={8}
          distance={14}
          color="#ffb066"
        />
      ))}
    </group>
  );
}
