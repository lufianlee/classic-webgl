'use client';

import { useMemo } from 'react';
import * as THREE from 'three';
import { usePBRMaterial } from '../pbr';
import { LightShaft } from '../objects/LightShaft';
import { GrandPiano } from '../objects/GrandPiano';
import { PeriodFigure } from '../objects/PeriodFigure';
import { SalonChair } from '../objects/SalonChair';

/**
 * 18th-century aristocratic salon. Short reverb (~0.6s), intimate scale.
 * Key identifiers: parquet de Versailles floor, cream boiserie walls with
 * raised panels and gilt moulding beads, plaster ceiling with a central
 * rosette + crystal chandelier, three French windows with daylight shafts,
 * folded velvet drapes, a real pier mirror between wall candelabra, and a
 * chamber-music layout (piano + 4 chairs in a semicircle).
 */

const ROOM_W = 14;
const ROOM_D = 16;
const ROOM_H = 5.5;

/* ------------------------------------------------------------------ */
/* Geometry helpers (pure — called once inside useMemo)                */
/* ------------------------------------------------------------------ */

/** Rectangle-with-rectangular-hole shape, centered at origin. */
function rectFrameShape(w: number, h: number, iw: number, ih: number): THREE.Shape {
  const s = new THREE.Shape();
  s.moveTo(-w / 2, -h / 2);
  s.lineTo(w / 2, -h / 2);
  s.lineTo(w / 2, h / 2);
  s.lineTo(-w / 2, h / 2);
  s.closePath();
  const hole = new THREE.Path();
  hole.moveTo(-iw / 2, -ih / 2);
  hole.lineTo(-iw / 2, ih / 2);
  hole.lineTo(iw / 2, ih / 2);
  hole.lineTo(iw / 2, -ih / 2);
  hole.closePath();
  s.holes.push(hole);
  return s;
}

/** Solid rectangle shape, centered at origin. */
function rectShape(w: number, h: number): THREE.Shape {
  const s = new THREE.Shape();
  s.moveTo(-w / 2, -h / 2);
  s.lineTo(w / 2, -h / 2);
  s.lineTo(w / 2, h / 2);
  s.lineTo(-w / 2, h / 2);
  s.closePath();
  return s;
}

/**
 * Extrude a 2D moulding cross-section (X = depth off the wall, Y = up)
 * along Z for `length` meters, centered on Z. Rotate per-wall so the
 * profile's +X points into the room.
 */
function profileRun(pts: [number, number][], length: number): THREE.ExtrudeGeometry {
  const s = new THREE.Shape();
  s.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) s.lineTo(pts[i][0], pts[i][1]);
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: length, steps: 1, bevelEnabled: false });
  g.translate(0, 0, -length / 2);
  return g;
}

function lathePts(pts: [number, number][]): THREE.Vector2[] {
  return pts.map(([x, y]) => new THREE.Vector2(x, y));
}

interface PanelSet {
  frame: THREE.BufferGeometry;
  bead: THREE.BufferGeometry;
  field: THREE.BufferGeometry;
}

/** One boiserie panel: stepped bevel frame + gilt bead + raised inner field. */
function makePanelSet(w: number, h: number): PanelSet {
  const bw = Math.min(0.16, h * 0.22); // frame border width
  const iw = w - 2 * bw;
  const ih = h - 2 * bw;
  const frame = new THREE.ExtrudeGeometry(rectFrameShape(w, h, iw, ih), {
    depth: 0.03,
    steps: 1,
    bevelEnabled: true,
    bevelThickness: 0.012,
    bevelSize: 0.012,
    bevelSegments: 2,
  });
  const bead = new THREE.ExtrudeGeometry(
    rectFrameShape(iw + 0.06, ih + 0.06, iw - 0.02, ih - 0.02),
    {
      depth: 0.012,
      steps: 1,
      bevelEnabled: true,
      bevelThickness: 0.005,
      bevelSize: 0.005,
      bevelSegments: 2,
    },
  );
  const field = new THREE.ExtrudeGeometry(rectShape(iw - 0.1, ih - 0.1), {
    depth: 0.012,
    steps: 1,
    bevelEnabled: true,
    bevelThickness: 0.01,
    bevelSize: 0.035,
    bevelSegments: 3,
  });
  return { frame, bead, field };
}

/* Moulding cross-sections (X = off the wall, Y = up from the run base). */
const SKIRT_PROFILE: [number, number][] = [
  [0, 0], [0.055, 0], [0.055, 0.12], [0.035, 0.14], [0.035, 0.18], [0.018, 0.2], [0, 0.22],
];
const DADO_PROFILE: [number, number][] = [
  [0, 0], [0.045, 0.008], [0.05, 0.03], [0.03, 0.05], [0.036, 0.07], [0, 0.08],
];
const CORNICE_PROFILE: [number, number][] = [
  [0, 0], [0.03, 0.02], [0.03, 0.08], [0.09, 0.14], [0.08, 0.2],
  [0.16, 0.26], [0.16, 0.3], [0.26, 0.36], [0.26, 0.38], [0, 0.38],
];

type PanelVariant = 'tall' | 'narrow' | 'dado';
interface PanelSpec {
  variant: PanelVariant;
  pos: [number, number, number];
  rotY: number;
}

/* Panel vertical placement */
const TALL_Y = 2.7; // tall panels span 1.4–4.0
const DADO_Y = 0.64; // dado panels span ~0.33–0.95

function buildPanelSpecs(): PanelSpec[] {
  const specs: PanelSpec[] = [];
  const off = 0.015; // proud of the wall plane
  // West wall x=-7 (faces +x) and east wall x=+7 (faces -x)
  const sideZ = [-6.2, -3.1, 0, 3.1, 6.2];
  for (const z of sideZ) {
    specs.push({ variant: 'tall', pos: [-ROOM_W / 2 + off, TALL_Y, z], rotY: Math.PI / 2 });
    specs.push({ variant: 'dado', pos: [-ROOM_W / 2 + off, DADO_Y, z], rotY: Math.PI / 2 });
    specs.push({ variant: 'tall', pos: [ROOM_W / 2 - off, TALL_Y, z], rotY: -Math.PI / 2 });
    specs.push({ variant: 'dado', pos: [ROOM_W / 2 - off, DADO_Y, z], rotY: -Math.PI / 2 });
  }
  // North wall z=-8 (window wall, faces +z): narrow piers between windows.
  for (const x of [-5.7, -1.75, 1.75, 5.7]) {
    specs.push({ variant: 'narrow', pos: [x, TALL_Y, -ROOM_D / 2 + off], rotY: 0 });
  }
  for (const x of [-5.7, -3.5, -1.75, 0, 1.75, 3.5, 5.7]) {
    specs.push({ variant: 'dado', pos: [x, DADO_Y, -ROOM_D / 2 + off], rotY: 0 });
  }
  // South wall z=+8 (mirror wall, faces -z)
  for (const x of [-5.25, -1.75, 1.75, 5.25]) {
    specs.push({ variant: 'tall', pos: [x, TALL_Y, ROOM_D / 2 - off], rotY: Math.PI });
  }
  for (const x of [-5.25, -3.5, -1.75, 0, 1.75, 3.5, 5.25]) {
    specs.push({ variant: 'dado', pos: [x, DADO_Y, ROOM_D / 2 - off], rotY: Math.PI });
  }
  return specs;
}

/* ------------------------------------------------------------------ */

export function Salon() {
  const floorMat = usePBRMaterial('wood_floor_worn', {
    repeat: [ROOM_W / 0.9, ROOM_D / 0.9],
    color: '#6a4525',
    aoIntensity: 1,
    displacementScale: 0.012,
  });

  /* Shared materials — one instance each, reused everywhere. */
  const M = useMemo(
    () => ({
      cream: new THREE.MeshStandardMaterial({ color: '#e7dcc2', roughness: 0.55 }),
      creamField: new THREE.MeshStandardMaterial({ color: '#ece2ca', roughness: 0.55 }),
      plaster: new THREE.MeshStandardMaterial({ color: '#e4d7b6', roughness: 0.72 }),
      gilt: new THREE.MeshStandardMaterial({
        color: '#c9963f', metalness: 0.75, roughness: 0.3, envMapIntensity: 1.3,
      }),
      giltBright: new THREE.MeshStandardMaterial({
        color: '#d9a848', metalness: 0.85, roughness: 0.22, envMapIntensity: 1.6,
      }),
      darkWood: new THREE.MeshStandardMaterial({ color: '#3a2414', roughness: 0.55 }),
      windowPaint: new THREE.MeshStandardMaterial({ color: '#e9e1cd', roughness: 0.5 }),
      glass: new THREE.MeshPhysicalMaterial({
        color: '#cfdde9',
        roughness: 0.05,
        metalness: 0,
        envMapIntensity: 2.0,
        emissive: new THREE.Color('#a8c0d4'),
        emissiveIntensity: 0.55,
      }),
      velvet: new THREE.MeshPhysicalMaterial({
        color: '#4a1212',
        roughness: 0.9,
        sheen: 1.0,
        sheenColor: new THREE.Color('#c98a5a'),
        sheenRoughness: 0.5,
        side: THREE.DoubleSide,
      }),
      mirror: new THREE.MeshStandardMaterial({
        color: '#dfe7ec', metalness: 1.0, roughness: 0.05, envMapIntensity: 1.5,
      }),
      porcelain: new THREE.MeshPhysicalMaterial({
        color: '#eef4f9', roughness: 0.12, clearcoat: 1, clearcoatRoughness: 0.15,
      }),
      cobalt: new THREE.MeshStandardMaterial({ color: '#3a5a9a', roughness: 0.3 }),
      candle: new THREE.MeshStandardMaterial({ color: '#fff3d8', roughness: 0.5 }),
      flame: new THREE.MeshStandardMaterial({
        color: '#ffe8b4', emissive: new THREE.Color('#ffc773'), emissiveIntensity: 5,
      }),
      glow: new THREE.MeshBasicMaterial({
        color: '#ffab4e',
        transparent: true,
        opacity: 0.3,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
      // Glassy, not metallic — full metalness rendered near-black under the
      // soft candlelit IBL. A faint warm emissive keeps facets sparkling.
      crystal: new THREE.MeshStandardMaterial({
        color: '#f6efdd',
        metalness: 0.25,
        roughness: 0.08,
        envMapIntensity: 2.5,
        emissive: '#ffd9a0',
        emissiveIntensity: 0.55,
      }),
      stem: new THREE.MeshStandardMaterial({ color: '#3a5a2a', roughness: 0.7 }),
    }),
    [],
  );

  /* Shared geometries — built once. */
  const G = useMemo(() => {
    // Moulding runs (two lengths: side walls run ROOM_D, end walls ROOM_W)
    const skirtD = profileRun(SKIRT_PROFILE, ROOM_D);
    const skirtW = profileRun(SKIRT_PROFILE, ROOM_W);
    const dadoD = profileRun(DADO_PROFILE, ROOM_D);
    const dadoW = profileRun(DADO_PROFILE, ROOM_W);
    const corniceD = profileRun(CORNICE_PROFILE, ROOM_D);
    const corniceW = profileRun(CORNICE_PROFILE, ROOM_W);

    // Boiserie panel sets (one build, reused for every panel)
    const tall = makePanelSet(2.2, 2.6);
    const narrow = makePanelSet(1.35, 2.6);
    const dado = makePanelSet(1.7, 0.64);

    // Ceiling rosette — lathe with a stepped plaster profile hanging below
    const rosette = new THREE.LatheGeometry(
      lathePts([
        [0.03, -0.14], [0.09, -0.15], [0.14, -0.09], [0.2, -0.12], [0.28, -0.06],
        [0.36, -0.095], [0.46, -0.045], [0.56, -0.07], [0.68, -0.03], [0.82, -0.045],
        [0.95, -0.012], [1.02, 0],
      ]),
      64,
    );

    // Baluster shaft (sconces + chandelier stem)
    const baluster = new THREE.LatheGeometry(
      lathePts([
        [0.02, 0], [0.06, 0.005], [0.065, 0.03], [0.028, 0.06], [0.05, 0.14],
        [0.058, 0.22], [0.026, 0.3], [0.05, 0.36], [0.045, 0.44], [0.02, 0.5],
        [0.04, 0.55], [0.035, 0.6], [0.012, 0.62],
      ]),
      20,
    );

    // Curved sconce arm — tube along a Catmull-Rom S-curve
    const armCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0, 0.45, 0),
      new THREE.Vector3(0.14, 0.4, 0),
      new THREE.Vector3(0.24, 0.42, 0),
      new THREE.Vector3(0.3, 0.55, 0),
    ]);
    const arm = new THREE.TubeGeometry(armCurve, 20, 0.013, 8);

    const candle = new THREE.CylinderGeometry(0.022, 0.025, 0.13, 12);
    const flame = new THREE.SphereGeometry(0.042, 12, 10);
    const glow = new THREE.SphereGeometry(0.085, 12, 10);
    const dripPan = new THREE.CylinderGeometry(0.045, 0.05, 0.014, 16);
    const crystal = new THREE.OctahedronGeometry(0.03, 0);

    // Drape panel — parametric plane with cos-folds, waist gather + bottom flare
    const drape = new THREE.PlaneGeometry(1.0, 4.3, 40, 56);
    {
      const pos = drape.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i);
        const y = pos.getY(i);
        const ny = (y + 2.15) / 4.3; // 0 bottom, 1 top
        const waist = Math.exp(-Math.pow((ny - 0.3) / 0.1, 2)); // tieback gather
        const pinch = (1 - 0.5 * waist) * (1 + 0.14 * Math.pow(1 - ny, 2));
        const amp = (0.055 + 0.05 * (1 - ny)) * (1 - 0.55 * waist);
        const z =
          amp * Math.cos(x * Math.PI * 7 + ny * 2.0) +
          amp * 0.35 * Math.cos(x * Math.PI * 13 - ny * 3.0) +
          0.1 * Math.pow(1 - ny, 1.6);
        pos.setX(i, x * pinch);
        pos.setZ(i, z);
      }
      drape.computeVertexNormals();
    }

    // Valance — scalloped folded strip above each window
    const valance = new THREE.PlaneGeometry(2.3, 0.55, 56, 6);
    {
      const pos = valance.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i);
        const y = pos.getY(i);
        const ny = (y + 0.275) / 0.55;
        const fold = Math.cos((x / 2.3) * Math.PI * 9);
        pos.setZ(i, 0.06 * fold);
        pos.setY(i, y + 0.09 * (1 - ny) * Math.pow(Math.abs(fold), 1.5));
      }
      valance.computeVertexNormals();
    }

    // Pier-mirror gilt frame
    const mirrorFrame = new THREE.ExtrudeGeometry(rectFrameShape(1.74, 3.54, 1.4, 3.2), {
      depth: 0.05,
      steps: 1,
      bevelEnabled: true,
      bevelThickness: 0.018,
      bevelSize: 0.018,
      bevelSegments: 2,
    });

    // French-window architrave (painted surround with reveal depth)
    const architrave = new THREE.ExtrudeGeometry(rectFrameShape(2.15, 3.85, 1.78, 3.48), {
      depth: 0.1,
      steps: 1,
      bevelEnabled: true,
      bevelThickness: 0.015,
      bevelSize: 0.015,
      bevelSegments: 2,
    });

    // Side-table leg + top and porcelain vase (lathe-turned)
    const tableLeg = new THREE.LatheGeometry(
      lathePts([
        [0.03, 0], [0.09, 0.01], [0.08, 0.04], [0.035, 0.08], [0.05, 0.2],
        [0.06, 0.34], [0.03, 0.46], [0.055, 0.56], [0.04, 0.68], [0.06, 0.76],
        [0.065, 0.8], [0.03, 0.82],
      ]),
      24,
    );
    const tableTop = new THREE.LatheGeometry(
      lathePts([[0, 0], [0.36, 0], [0.4, 0.015], [0.41, 0.035], [0.38, 0.05], [0, 0.05]]),
      40,
    );
    const vase = new THREE.LatheGeometry(
      lathePts([
        [0, 0], [0.06, 0.005], [0.105, 0.05], [0.13, 0.14], [0.125, 0.22],
        [0.095, 0.3], [0.055, 0.36], [0.05, 0.42], [0.065, 0.46], [0.075, 0.48],
        [0.06, 0.48],
      ]),
      32,
    );
    const flowerHead = new THREE.IcosahedronGeometry(0.045, 1);
    const chandelierSpoke = new THREE.CylinderGeometry(0.01, 0.01, 0.56, 8);

    return {
      skirtD, skirtW, dadoD, dadoW, corniceD, corniceW,
      panels: { tall, narrow, dado } as Record<PanelVariant, PanelSet>,
      rosette, baluster, arm, candle, flame, glow, dripPan, crystal,
      drape, valance, mirrorFrame, architrave,
      tableLeg, tableTop, vase, flowerHead, chandelierSpoke,
    };
  }, []);

  /* Chandelier crystal instance matrices — rings of hanging octahedra. */
  const crystalMatrices = useMemo(() => {
    const list: THREE.Matrix4[] = [];
    const p = new THREE.Vector3();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    const s = new THREE.Vector3();
    const rings = [
      { r: 0.52, y: 3.72, n: 26, drop: 0.12 },
      { r: 0.34, y: 3.95, n: 18, drop: 0.1 },
      { r: 0.42, y: 3.55, n: 16, drop: 0 },
      { r: 0.28, y: 3.44, n: 12, drop: 0 },
      { r: 0.14, y: 3.35, n: 8, drop: 0 },
    ];
    rings.forEach((ring, ri) => {
      for (let i = 0; i < ring.n; i++) {
        const a = (i / ring.n) * Math.PI * 2 + ri * 0.35;
        const dy = ring.drop * ((i % 3) * 0.5);
        p.set(Math.cos(a) * ring.r, ring.y - dy, Math.sin(a) * ring.r);
        e.set(0.15, a, 0);
        q.setFromEuler(e);
        const sc = 0.8 + ((i * 7 + ri * 3) % 5) * 0.1;
        s.set(sc, sc * 1.8, sc);
        list.push(new THREE.Matrix4().compose(p, q, s));
      }
    });
    // Center drop pendant
    p.set(0, 3.26, 0);
    e.set(0, 0, 0);
    q.setFromEuler(e);
    s.set(1.6, 2.6, 1.6);
    list.push(new THREE.Matrix4().compose(p, q, s));
    return list;
  }, []);

  /* Flower stems — quaternion-aligned cylinders from the vase mouth. */
  const flowers = useMemo(() => {
    const base = new THREE.Vector3(0, 1.34, 0);
    const up = new THREE.Vector3(0, 1, 0);
    const heads: [number, number, number, string][] = [
      [0.09, 1.62, 0.03, '#c8442a'],
      [-0.1, 1.56, -0.05, '#e8c060'],
      [0.04, 1.68, -0.08, '#a8285a'],
      [-0.05, 1.6, 0.09, '#d88a6a'],
      [0.12, 1.53, -0.1, '#5a6ac8'],
      [0, 1.72, 0.02, '#e8e2ee'],
    ];
    return heads.map(([hx, hy, hz, color]) => {
      const head = new THREE.Vector3(hx, hy, hz);
      const dir = head.clone().sub(base);
      const len = dir.length();
      const mid = base.clone().add(dir.clone().multiplyScalar(0.5));
      const quat = new THREE.Quaternion().setFromUnitVectors(up, dir.normalize());
      return {
        color,
        len,
        mid: [mid.x, mid.y, mid.z] as [number, number, number],
        head: [hx, hy, hz] as [number, number, number],
        quat,
      };
    });
  }, []);

  const panelSpecs = useMemo(buildPanelSpecs, []);

  /* Moulding run placements: rotY chosen so the profile faces the room. */
  const runs: { rotY: number; at: (y: number) => [number, number, number]; len: 'D' | 'W' }[] = [
    { rotY: 0, at: (y) => [-ROOM_W / 2, y, 0], len: 'D' },
    { rotY: Math.PI, at: (y) => [ROOM_W / 2, y, 0], len: 'D' },
    { rotY: -Math.PI / 2, at: (y) => [0, y, -ROOM_D / 2], len: 'W' },
    { rotY: Math.PI / 2, at: (y) => [0, y, ROOM_D / 2], len: 'W' },
  ];

  const sconceSpread = [-0.6, -0.3, 0, 0.3, 0.6];
  const windowXs = [-3.5, 0, 3.5];

  return (
    <group>
      {/* ------------------------------------------------ parquet floor */}
      <mesh position={[0, 0.01, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[ROOM_W, ROOM_D, 128, 128]} />
        <primitive object={floorMat} attach="material" />
      </mesh>

      {/* ------------------------------------------------ wall planes */}
      {[
        { pos: [-ROOM_W / 2, ROOM_H / 2, 0] as const, rotY: Math.PI / 2, len: ROOM_D },
        { pos: [ROOM_W / 2, ROOM_H / 2, 0] as const, rotY: -Math.PI / 2, len: ROOM_D },
        { pos: [0, ROOM_H / 2, -ROOM_D / 2] as const, rotY: 0, len: ROOM_W },
        { pos: [0, ROOM_H / 2, ROOM_D / 2] as const, rotY: Math.PI, len: ROOM_W },
      ].map((w, i) => (
        <mesh
          key={`wall-${i}`}
          position={[w.pos[0], w.pos[1], w.pos[2]]}
          rotation={[0, w.rotY, 0]}
          material={M.cream}
          receiveShadow
        >
          <planeGeometry args={[w.len, ROOM_H]} />
        </mesh>
      ))}

      {/* ---------------------------------- boiserie moulding runs */}
      {runs.map((r, i) => (
        <group key={`run-${i}`}>
          <mesh
            geometry={r.len === 'D' ? G.skirtD : G.skirtW}
            material={M.cream}
            position={r.at(0)}
            rotation={[0, r.rotY, 0]}
          />
          <mesh
            geometry={r.len === 'D' ? G.dadoD : G.dadoW}
            material={M.cream}
            position={r.at(1.06)}
            rotation={[0, r.rotY, 0]}
          />
          <mesh
            geometry={r.len === 'D' ? G.corniceD : G.corniceW}
            material={M.plaster}
            position={r.at(ROOM_H - 0.38)}
            rotation={[0, r.rotY, 0]}
          />
        </group>
      ))}

      {/* ---------------------------------- raised panels + gilt beads */}
      {panelSpecs.map((p, i) => {
        const set = G.panels[p.variant];
        return (
          <group key={`panel-${i}`} position={p.pos} rotation={[0, p.rotY, 0]}>
            <mesh geometry={set.frame} material={M.cream} position={[0, 0, 0.014]} />
            <mesh geometry={set.bead} material={M.gilt} position={[0, 0, 0.042]} />
            <mesh
              geometry={set.field}
              material={M.creamField}
              position={[0, 0, 0.02]}
              receiveShadow
            />
          </group>
        );
      })}

      {/* ------------------------------------------------ ceiling */}
      <mesh
        position={[0, ROOM_H, 0]}
        rotation={[Math.PI / 2, 0, 0]}
        material={M.plaster}
        receiveShadow
      >
        <planeGeometry args={[ROOM_W, ROOM_D]} />
      </mesh>
      {/* Perimeter gilt + plaster border bands */}
      {[
        { w: ROOM_W - 2.6, d: 0.07, x: 0, z: ROOM_D / 2 - 1.3, gilt: true },
        { w: ROOM_W - 2.6, d: 0.07, x: 0, z: -(ROOM_D / 2 - 1.3), gilt: true },
        { w: 0.07, d: ROOM_D - 2.6, x: ROOM_W / 2 - 1.3, z: 0, gilt: true },
        { w: 0.07, d: ROOM_D - 2.6, x: -(ROOM_W / 2 - 1.3), z: 0, gilt: true },
        { w: ROOM_W - 3.2, d: 0.045, x: 0, z: ROOM_D / 2 - 1.6, gilt: false },
        { w: ROOM_W - 3.2, d: 0.045, x: 0, z: -(ROOM_D / 2 - 1.6), gilt: false },
        { w: 0.045, d: ROOM_D - 3.2, x: ROOM_W / 2 - 1.6, z: 0, gilt: false },
        { w: 0.045, d: ROOM_D - 3.2, x: -(ROOM_W / 2 - 1.6), z: 0, gilt: false },
      ].map((b, i) => (
        <mesh
          key={`cband-${i}`}
          position={[b.x, ROOM_H - 0.016, b.z]}
          material={b.gilt ? M.gilt : M.cream}
        >
          <boxGeometry args={[b.w, 0.03, b.d]} />
        </mesh>
      ))}
      {/* Central rosette medallion */}
      <mesh geometry={G.rosette} material={M.plaster} position={[0, ROOM_H - 0.001, 0]} />

      {/* ------------------------------------------------ chandelier */}
      <group>
        {/* chain + stem baluster */}
        <mesh material={M.giltBright} position={[0, 4.88, 0]}>
          <cylinderGeometry args={[0.012, 0.012, 0.95, 8]} />
        </mesh>
        <mesh geometry={G.baluster} material={M.giltBright} position={[0, 3.82, 0]} />
        {/* gilt frame rings */}
        <mesh material={M.giltBright} position={[0, 3.8, 0]} rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[0.52, 0.022, 10, 48]} />
        </mesh>
        <mesh material={M.giltBright} position={[0, 4.05, 0]} rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[0.34, 0.018, 10, 40]} />
        </mesh>
        {/* spokes from stem to the big ring */}
        {Array.from({ length: 8 }).map((_, i) => {
          const a = (i / 8) * Math.PI * 2;
          return (
            <group key={`spoke-${i}`} rotation={[0, a, 0]}>
              <mesh
                geometry={G.chandelierSpoke}
                material={M.giltBright}
                position={[0.285, 3.95, 0]}
                rotation={[0, 0, -2.14]}
              />
            </group>
          );
        })}
        {/* candles on the big ring */}
        {Array.from({ length: 8 }).map((_, i) => {
          const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
          const cx = Math.cos(a) * 0.5;
          const cz = Math.sin(a) * 0.5;
          return (
            <group key={`ccandle-${i}`} position={[cx, 0, cz]}>
              <mesh geometry={G.dripPan} material={M.giltBright} position={[0, 3.81, 0]} />
              <mesh geometry={G.candle} material={M.candle} position={[0, 3.885, 0]} />
              <mesh geometry={G.flame} material={M.flame} position={[0, 3.99, 0]} />
              <mesh geometry={G.glow} material={M.glow} position={[0, 3.99, 0]} />
            </group>
          );
        })}
        {/* instanced crystals */}
        <instancedMesh
          args={[G.crystal, M.crystal, crystalMatrices.length]}
          ref={(m: THREE.InstancedMesh | null) => {
            if (!m) return;
            crystalMatrices.forEach((mat, i) => m.setMatrixAt(i, mat));
            m.instanceMatrix.needsUpdate = true;
          }}
        />
        {/* bottom gilt cap */}
        <mesh material={M.giltBright} position={[0, 3.36, 0]}>
          <sphereGeometry args={[0.05, 16, 12]} />
        </mesh>
        <pointLight position={[0, 4.0, 0]} intensity={5} distance={9} color="#ffc27a" />
      </group>

      {/* ------------------------------------------------ furniture */}
      {/* Grand piano at the front of the salon — keyboard faces the
           seating area (audience side is +z), tail into the back corner. */}
      <GrandPiano position={[-1, 0, -1]} rotation={[0, Math.PI * 1.1, 0]} scale={1.0} />

      {/* Singer figure — 18th-century court-dress silhouette (wide panniers,
           gilt stomacher, powdered wig), standing beside the piano as if
           performing the evening's aria. Faces the chair arc (+z). */}
      {/* Tucked in beside the piano's far side, several meters from the
          camera start — at conversational distance the stylized costume
          reads as a person in the room instead of filling the frame. */}
      <PeriodFigure
        variant="baroque"
        position={[0.9, 0, -2.6]}
        rotation={[0, 0.35, 0]}
        phase={0.6}
        sway={0.85}
      />

      {/* Four Louis XV cabriole-legged salon chairs in a loose arc facing
           the piano. */}
      {[
        [2, 0, -1],
        [2.5, 0, 1],
        [1, 0, 2.5],
        [-1, 0, 2.8],
      ].map(([x, , z], i) => (
        <SalonChair
          key={`chair-${i}`}
          position={[x as number, 0, z as number]}
          rotation={[0, -Math.atan2(z as number, x as number), 0]}
        />
      ))}

      {/* ------------------------------------------------ pier mirror */}
      <group position={[0, 2.6, ROOM_D / 2 - 0.06]} rotation={[0, Math.PI, 0]}>
        {/* carved gilt frame */}
        <mesh geometry={G.mirrorFrame} material={M.gilt} />
        {/* mirror glass — IBL metal for believable glints */}
        <mesh material={M.mirror} position={[0, 0, 0.008]}>
          <planeGeometry args={[1.38, 3.18]} />
        </mesh>
        {/* cartouche crest */}
        <mesh material={M.gilt} position={[0, 1.86, 0.03]}>
          <torusGeometry args={[0.2, 0.032, 10, 32, Math.PI]} />
        </mesh>
        <mesh material={M.gilt} position={[0, 2.08, 0.03]}>
          <sphereGeometry args={[0.05, 16, 12]} />
        </mesh>
        {[-0.28, 0.28].map((x, i) => (
          <mesh
            key={`curl-${i}`}
            material={M.gilt}
            position={[x, 1.78, 0.03]}
            rotation={[0, 0, x > 0 ? -0.6 : 0.6 + Math.PI]}
          >
            <torusGeometry args={[0.07, 0.016, 8, 24, Math.PI * 1.5]} />
          </mesh>
        ))}
      </group>

      {/* ------------------------------------------------ wall sconces */}
      {[-2.2, 2.2].map((x, i) => (
        <group key={`sconce-${i}`} position={[x, 1.85, ROOM_D / 2 - 0.22]}>
          {/* wall plate + bracket */}
          <mesh material={M.gilt} position={[0, 0.5, 0.18]} rotation={[Math.PI / 2, 0, 0]}>
            <cylinderGeometry args={[0.07, 0.07, 0.03, 20]} />
          </mesh>
          <mesh material={M.gilt} position={[0, 0.5, 0.09]}>
            <boxGeometry args={[0.04, 0.04, 0.18]} />
          </mesh>
          {/* lathe-turned baluster shaft */}
          <mesh geometry={G.baluster} material={M.gilt} />
          {/* five curved arms fanning into the room (-z) */}
          {sconceSpread.map((spread, k) => {
            const rotY = Math.PI / 2 + spread;
            return (
              <group key={`arm-${k}`} rotation={[0, rotY, 0]}>
                <mesh geometry={G.arm} material={M.gilt} />
                <mesh geometry={G.dripPan} material={M.gilt} position={[0.3, 0.56, 0]} />
                <mesh geometry={G.candle} material={M.candle} position={[0.3, 0.635, 0]} />
                <mesh geometry={G.flame} material={M.flame} position={[0.3, 0.73, 0]} />
                <mesh geometry={G.glow} material={M.glow} position={[0.3, 0.73, 0]} />
              </group>
            );
          })}
          <pointLight position={[0, 0.85, -0.3]} intensity={2.2} distance={5} color="#ffc077" />
        </group>
      ))}

      {/* ------------------------------------------------ French windows */}
      {windowXs.map((wx, i) => (
        <group key={`win-${i}`} position={[wx, 2.8, -ROOM_D / 2]}>
          {/* architrave surround with reveal depth */}
          <mesh geometry={G.architrave} material={M.windowPaint} position={[0, 0, 0.02]} />
          {/* reveal lining */}
          {[-0.89, 0.89].map((rx, k) => (
            <mesh key={`rev-${k}`} material={M.windowPaint} position={[rx, 0, 0.06]}>
              <boxGeometry args={[0.05, 3.48, 0.14]} />
            </mesh>
          ))}
          <mesh material={M.windowPaint} position={[0, 1.72, 0.06]}>
            <boxGeometry args={[1.78, 0.05, 0.14]} />
          </mesh>
          {/* sill */}
          <mesh material={M.windowPaint} position={[0, -1.76, 0.09]}>
            <boxGeometry args={[2.0, 0.06, 0.2]} />
          </mesh>
          {/* glass — physical, cool glow, sharp env glints */}
          <mesh material={M.glass} position={[0, 0, 0.035]}>
            <planeGeometry args={[1.7, 3.42]} />
          </mesh>
          {/* muntins with profile depth: wide back bar + narrow front bead */}
          <mesh material={M.windowPaint} position={[0, 0, 0.06]}>
            <boxGeometry args={[0.05, 3.42, 0.05]} />
          </mesh>
          <mesh material={M.windowPaint} position={[0, 0, 0.095]}>
            <boxGeometry args={[0.024, 3.42, 0.024]} />
          </mesh>
          {[-1.05, -0.35, 0.35, 1.05].map((my, k) => (
            <group key={`mun-${k}`}>
              <mesh material={M.windowPaint} position={[0, my, 0.06]}>
                <boxGeometry args={[1.7, 0.05, 0.05]} />
              </mesh>
              <mesh material={M.windowPaint} position={[0, my, 0.095]}>
                <boxGeometry args={[1.7, 0.024, 0.024]} />
              </mesh>
            </group>
          ))}
          {/* cool daylight spilling in */}
          <pointLight position={[0, 0, 0.8]} intensity={2.8} distance={8} color="#a8c0d4" />
        </group>
      ))}

      {/* volumetric daylight shafts slanting from the windows to the floor */}
      {windowXs.map((wx, i) => (
        <LightShaft
          key={`shaft-${i}`}
          position={[wx, 4.2, -ROOM_D / 2 + 0.45]}
          rotation={[-0.62, 0, 0]}
          length={6.5}
          radiusTop={0.55}
          radiusBottom={1.4}
          color="#cfe0f4"
          intensity={0.05}
        />
      ))}

      {/* ------------------------------------------------ drapes */}
      {windowXs.map((wx, i) => (
        <group key={`drapes-${i}`}>
          {[-1.15, 1.15].map((dx, k) => (
            <group key={`drape-${k}`} position={[wx + dx, 2.5, -ROOM_D / 2 + 0.3]}>
              <mesh
                geometry={G.drape}
                material={M.velvet}
                scale={[k === 0 ? 1 : -1, 1, 1]}
              />
              {/* gilt tieback cord at the waist gather */}
              <mesh
                material={M.gilt}
                position={[0, -0.86, 0.06]}
                rotation={[Math.PI / 2.4, 0, 0]}
                scale={[1, 1, 0.55]}
              >
                <torusGeometry args={[0.15, 0.018, 8, 24]} />
              </mesh>
            </group>
          ))}
          {/* scalloped valance above the window */}
          <mesh
            geometry={G.valance}
            material={M.velvet}
            position={[wx, 4.62, -ROOM_D / 2 + 0.32]}
          />
        </group>
      ))}

      {/* --------------------------------------- side table + vase */}
      <group position={[-4, 0, -5]}>
        <mesh geometry={G.tableTop} material={M.darkWood} position={[0, 0.82, 0]} castShadow />
        <mesh geometry={G.tableLeg} material={M.darkWood} castShadow />
        {/* tripod feet */}
        {[0, 1, 2].map((k) => {
          const a = (k / 3) * Math.PI * 2;
          return (
            <mesh
              key={`foot-${k}`}
              material={M.darkWood}
              position={[Math.cos(a) * 0.15, 0.04, Math.sin(a) * 0.15]}
              rotation={[0, -a, 0]}
            >
              <boxGeometry args={[0.26, 0.05, 0.05]} />
            </mesh>
          );
        })}
        {/* porcelain vase with cobalt band */}
        <mesh geometry={G.vase} material={M.porcelain} position={[0, 0.87, 0]} castShadow />
        <mesh material={M.cobalt} position={[0, 1.03, 0]} rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[0.128, 0.007, 8, 40]} />
        </mesh>
        {/* flowers — icosahedron clusters on thin quaternion-aligned stems */}
        {flowers.map((f, k) => (
          <group key={`flower-${k}`}>
            <mesh material={M.stem} position={f.mid} quaternion={f.quat}>
              <cylinderGeometry args={[0.005, 0.005, f.len, 6]} />
            </mesh>
            <group position={f.head}>
              <mesh geometry={G.flowerHead}>
                <meshStandardMaterial
                  color={f.color}
                  emissive={f.color}
                  emissiveIntensity={0.15}
                  roughness={0.7}
                />
              </mesh>
              <mesh geometry={G.flowerHead} position={[0.03, 0.02, 0.012]} scale={0.55}>
                <meshStandardMaterial color={f.color} roughness={0.75} />
              </mesh>
              <mesh geometry={G.flowerHead} position={[-0.024, 0.026, -0.018]} scale={0.45}>
                <meshStandardMaterial color={f.color} roughness={0.75} />
              </mesh>
            </group>
          </group>
        ))}
      </group>

      {/* ------------------------------------------------ lighting */}
      {/* warm candlelit base */}
      <ambientLight intensity={0.26} color="#ffd9a6" />
      {/* soft warm fill over the performance area */}
      <pointLight position={[-1, 3.2, 0.5]} intensity={2.5} distance={7} color="#ffbf6f" />
      {/* single shadow caster — diffuse daylight raking in from the windows */}
      <directionalLight
        position={[2, 6.5, -5]}
        intensity={0.55}
        color="#e6d8b6"
        castShadow
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
        shadow-camera-left={-10}
        shadow-camera-right={10}
        shadow-camera-top={10}
        shadow-camera-bottom={-10}
        shadow-bias={-0.0003}
        shadow-normalBias={0.02}
      />
    </group>
  );
}
