'use client';

import { useMemo } from 'react';
import * as THREE from 'three';
import { usePBRMaterial } from '../pbr';
import { GrandPiano } from '../objects/GrandPiano';
import { PeriodFigure } from '../objects/PeriodFigure';
import { LightShaft } from '../objects/LightShaft';
import { VelvetSeats, type SeatTransform } from '../objects/VelvetSeats';

/**
 * 19th-century "shoebox" concert hall. Medium reverb (~1.8s).
 * Key identifiers: rectangular plan, deeply coffered ceiling with gilt
 * rosettes, paneled walls with fluted pilasters and a full entablature,
 * side balconies with turned balustrades on carved corbels, a raised
 * stage with a coffered acoustic shell and a gilded pipe organ.
 * Warm incandescent stage light, cooler house ambience.
 *
 * Every repeated ornament (coffer frames, rosettes, flutes, balusters,
 * corbels, crystals, balcony seats) is a single InstancedMesh so the
 * whole hall stays within a mid-GPU 60fps budget.
 */

const HALL_LENGTH = 38;
const HALL_WIDTH = 18;
const HALL_HEIGHT = 14;
const BALCONY_FRONT = HALL_WIDTH / 2 - 3; // x = ±6

// Balcony runs from just clear of the stage shell to the back wall.
const BALCONY_Z_MIN = -9;
const BALCONY_Z_MAX = 17;
const BALCONY_LEN = BALCONY_Z_MAX - BALCONY_Z_MIN; // 26
const BALCONY_Z_MID = (BALCONY_Z_MIN + BALCONY_Z_MAX) / 2; // 4

// Ceiling coffer grid: 5 × 9 cells inside a 16 × 36 field.
const COFFER_COLS = 5;
const COFFER_ROWS = 9;
const CELL_W = 16 / COFFER_COLS; // 3.2
const CELL_L = 36 / COFFER_ROWS; // 4.0
const BEAM_W = 0.6;
const BEAM_DROP = 0.5;

const PILASTER_Z = [-14, -7, 0, 7, 14];
const FLUTES_PER_PILASTER = 8;

/** Rectangular picture-frame shape (outer rect with rect hole). */
function makeFrameShape(outerW: number, outerH: number, border: number): THREE.Shape {
  const w = outerW / 2;
  const h = outerH / 2;
  const iw = w - border;
  const ih = h - border;
  const s = new THREE.Shape();
  s.moveTo(-w, -h);
  s.lineTo(w, -h);
  s.lineTo(w, h);
  s.lineTo(-w, h);
  s.closePath();
  const hole = new THREE.Path();
  hole.moveTo(-iw, -ih);
  hole.lineTo(-iw, ih);
  hole.lineTo(iw, ih);
  hole.lineTo(iw, -ih);
  hole.closePath();
  s.holes.push(hole);
  return s;
}

function makeFrameGeometry(
  outerW: number,
  outerH: number,
  border: number,
  depth: number,
  bevel: number,
): THREE.ExtrudeGeometry {
  return new THREE.ExtrudeGeometry(makeFrameShape(outerW, outerH, border), {
    depth,
    bevelEnabled: bevel > 0,
    bevelThickness: bevel,
    bevelSize: bevel * 0.8,
    bevelSegments: 2,
    curveSegments: 1,
  });
}

/** Chamfered ceiling-beam cross-section (y=0 is the ceiling plane, hangs down). */
function makeBeamProfile(w: number, drop: number): THREE.Shape {
  const hw = w / 2;
  const ch = w * 0.2;
  const s = new THREE.Shape();
  s.moveTo(-hw, 0);
  s.lineTo(-hw, -(drop - ch));
  s.lineTo(-hw + ch, -drop);
  s.lineTo(hw - ch, -drop);
  s.lineTo(hw, -(drop - ch));
  s.lineTo(hw, 0);
  s.closePath();
  return s;
}

/** Classical stepped entablature/cornice cross-section, extruded along walls.
 *  x = protrusion from the wall face, y = height above the profile base. */
function makeCorniceProfile(): THREE.Shape {
  const s = new THREE.Shape();
  s.moveTo(0, 0);
  s.lineTo(0.1, 0);
  s.lineTo(0.1, 0.14);
  s.lineTo(0.22, 0.14);
  s.lineTo(0.22, 0.3);
  s.lineTo(0.3, 0.3);
  s.lineTo(0.34, 0.42); // cove slope
  s.lineTo(0.46, 0.42);
  s.lineTo(0.46, 0.65);
  s.lineTo(0, 0.65);
  s.closePath();
  return s;
}

/** Curved-front balcony parapet cross-section: bellies out toward the hall. */
function makeParapetProfile(): THREE.Shape {
  const s = new THREE.Shape();
  s.moveTo(0, 0);
  s.quadraticCurveTo(0.35, 0.22, 0.04, 0.45);
  s.lineTo(-0.18, 0.45);
  s.lineTo(-0.18, 0);
  s.closePath();
  return s;
}

function setInstances(mesh: THREE.InstancedMesh | null, mats: THREE.Matrix4[]): void {
  if (!mesh) return;
  for (let i = 0; i < mats.length; i++) mesh.setMatrixAt(i, mats[i]);
  mesh.instanceMatrix.needsUpdate = true;
  mesh.count = mats.length;
  mesh.computeBoundingSphere();
}

function compose(
  px: number,
  py: number,
  pz: number,
  rx = 0,
  ry = 0,
  rz = 0,
  sx = 1,
  sy = sx,
  sz = sx,
): THREE.Matrix4 {
  return new THREE.Matrix4().compose(
    new THREE.Vector3(px, py, pz),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)),
    new THREE.Vector3(sx, sy, sz),
  );
}

export function ConcertHall() {
  const floorMat = usePBRMaterial('wood_floor_worn', {
    repeat: [HALL_WIDTH / 3, HALL_LENGTH / 3],
    color: '#8c6a42',
    aoIntensity: 1,
    displacementScale: 0.02,
  });
  const wallMat = usePBRMaterial('concrete_wall_008', {
    repeat: [HALL_LENGTH / 4, HALL_HEIGHT / 4],
    color: '#8e7046',
    roughnessBoost: 0.85,
  });
  const backWallMat = usePBRMaterial('concrete_wall_008', {
    repeat: [HALL_WIDTH / 4, HALL_HEIGHT / 4],
    color: '#7e6440',
    roughnessBoost: 0.9,
  });
  // Stage shell: wood grain wrapped around the curve — without a texture the
  // big cylinder reads as smooth plastic under the stage light.
  const shellMat = usePBRMaterial('wood_floor_worn', {
    repeat: [10, 4],
    color: '#8a6238',
    roughnessBoost: 0.75,
    aoIntensity: 0.8,
  });
  // The audience sees the concave inside of the open half-cylinder.
  shellMat.side = THREE.DoubleSide;

  // ---- Shared materials -------------------------------------------------
  const mats = useMemo(() => {
    return {
      gilt: new THREE.MeshStandardMaterial({
        color: '#c9a24b',
        metalness: 0.8,
        roughness: 0.28,
      }),
      giltBright: new THREE.MeshStandardMaterial({
        color: '#d7b56a',
        metalness: 0.85,
        roughness: 0.22,
        emissive: new THREE.Color('#8a6820'),
        emissiveIntensity: 0.22,
      }),
      woodDark: new THREE.MeshStandardMaterial({ color: '#3a2415', roughness: 0.72 }),
      woodMid: new THREE.MeshStandardMaterial({
        color: '#6b4a28',
        roughness: 0.55,
        metalness: 0.05,
      }),
      woodBeam: new THREE.MeshStandardMaterial({ color: '#7a5c34', roughness: 0.6 }),
      woodPolished: new THREE.MeshStandardMaterial({
        color: '#4a2f18',
        roughness: 0.35,
        metalness: 0.1,
      }),
      ceilingPanel: new THREE.MeshStandardMaterial({ color: '#55412a', roughness: 0.75 }),
      plaster: new THREE.MeshStandardMaterial({ color: '#d3c4a4', roughness: 0.65 }),
      plasterShade: new THREE.MeshStandardMaterial({ color: '#b9a888', roughness: 0.7 }),
      seatHintVelvet: new THREE.MeshStandardMaterial({ color: '#4a1520', roughness: 0.95 }),
      // Glassy, not metallic — full metalness renders near-black under IBL.
      crystal: new THREE.MeshStandardMaterial({
        color: '#f6efdd',
        metalness: 0.25,
        roughness: 0.08,
        envMapIntensity: 2.5,
        emissive: new THREE.Color('#ffd27a'),
        emissiveIntensity: 0.55,
      }),
      curtainVelvet: new THREE.MeshPhysicalMaterial({
        color: '#3a0d0d',
        roughness: 0.9,
        sheen: 1.0,
        sheenColor: new THREE.Color('#b3452e'),
        sheenRoughness: 0.5,
        side: THREE.DoubleSide,
      }),
    };
  }, []);

  // ---- Shared geometries (one of each ornament, reused everywhere) ------
  const geo = useMemo(() => {
    // Ceiling beams (chamfered profile extruded along the span).
    const beamProfile = makeBeamProfile(BEAM_W, BEAM_DROP);
    const beamZ = new THREE.ExtrudeGeometry(beamProfile, { depth: 36, bevelEnabled: false });
    beamZ.translate(0, 0, -18);
    const beamX = new THREE.ExtrudeGeometry(beamProfile, { depth: 16, bevelEnabled: false });
    beamX.translate(0, 0, -8);

    // Stepped coffer moulding: two nested frames per coffer.
    const cofferOuter = makeFrameGeometry(2.6, 3.4, 0.24, 0.09, 0.05);
    const cofferInner = makeFrameGeometry(2.05, 2.85, 0.16, 0.18, 0.04);

    // Gilt ceiling rosette — layered lathe disc with a central boss.
    const rosette = new THREE.LatheGeometry(
      [
        new THREE.Vector2(0.001, 0.16),
        new THREE.Vector2(0.05, 0.15),
        new THREE.Vector2(0.09, 0.1),
        new THREE.Vector2(0.13, 0.12),
        new THREE.Vector2(0.18, 0.06),
        new THREE.Vector2(0.24, 0.08),
        new THREE.Vector2(0.3, 0.03),
        new THREE.Vector2(0.36, 0.04),
        new THREE.Vector2(0.4, 0.0),
      ],
      20,
    );

    // Entablature/cornice around the whole hall.
    const corniceProfile = makeCorniceProfile();
    const corniceSide = new THREE.ExtrudeGeometry(corniceProfile, {
      depth: HALL_LENGTH,
      bevelEnabled: false,
    });
    corniceSide.translate(0, 0, -HALL_LENGTH / 2);
    const corniceEnd = new THREE.ExtrudeGeometry(corniceProfile, {
      depth: HALL_WIDTH,
      bevelEnabled: false,
    });
    corniceEnd.translate(0, 0, -HALL_WIDTH / 2);

    // Large gilt wall-panel frame.
    const panelFrame = makeFrameGeometry(4.4, 7.6, 0.2, 0.07, 0.035);

    // Fluted pilaster parts.
    const pilasterShaft = new THREE.BoxGeometry(0.32, 10.5, 0.62);
    const flute = new THREE.CylinderGeometry(0.034, 0.034, 10.3, 10);
    const pilasterBase = new THREE.BoxGeometry(0.42, 0.5, 0.74);
    const pilasterCap = new THREE.BoxGeometry(0.42, 0.36, 0.74);
    const pilasterAbacus = new THREE.BoxGeometry(0.5, 0.14, 0.82);

    // Balcony parapet: curved front extruded along the balcony length.
    const parapet = new THREE.ExtrudeGeometry(makeParapetProfile(), {
      depth: BALCONY_LEN,
      bevelEnabled: false,
      curveSegments: 10,
    });
    parapet.translate(0, 0, -BALCONY_LEN / 2);

    // Turned baluster (classic vase profile).
    const baluster = new THREE.LatheGeometry(
      [
        new THREE.Vector2(0.075, 0),
        new THREE.Vector2(0.085, 0.02),
        new THREE.Vector2(0.05, 0.06),
        new THREE.Vector2(0.042, 0.09),
        new THREE.Vector2(0.09, 0.18),
        new THREE.Vector2(0.075, 0.26),
        new THREE.Vector2(0.035, 0.36),
        new THREE.Vector2(0.03, 0.42),
        new THREE.Vector2(0.055, 0.46),
        new THREE.Vector2(0.07, 0.5),
        new THREE.Vector2(0.045, 0.53),
        new THREE.Vector2(0.07, 0.55),
      ],
      12,
    );

    // Curved corbel under the balcony deck (S-ish turned profile, widens up).
    const corbel = new THREE.LatheGeometry(
      [
        new THREE.Vector2(0.05, 0),
        new THREE.Vector2(0.09, 0.06),
        new THREE.Vector2(0.07, 0.14),
        new THREE.Vector2(0.16, 0.3),
        new THREE.Vector2(0.13, 0.4),
        new THREE.Vector2(0.22, 0.52),
        new THREE.Vector2(0.24, 0.6),
      ],
      14,
    );

    // Balcony seat hints.
    const balconySeat = new THREE.BoxGeometry(0.55, 0.5, 0.45);
    const balconyBack = new THREE.BoxGeometry(0.55, 0.55, 0.12);

    // Stage-shell coffering: vertical rib + horizontal band arcs.
    const shellRib = new THREE.BoxGeometry(0.22, 11, 0.3);
    const shellBand = new THREE.TorusGeometry(7.7, 0.09, 10, 96, 2.4);
    // Arc starts at angle 0 in the XY plane; center it on +Y, then fold the
    // ring into the XZ plane so the arc hugs the +z half of the shell.
    shellBand.rotateZ(Math.PI / 2 - 1.2);
    shellBand.rotateX(Math.PI / 2);

    // Chandelier crystal: slightly elongated octahedron drop.
    const crystal = new THREE.OctahedronGeometry(0.09, 0);
    crystal.scale(1, 1.6, 1);

    // Folded velvet curtain: parametric plane, x displaced by cos folds,
    // gathered tighter at tieback height (local y = -1.5).
    const curtainW = 2.6;
    const curtainH = 11;
    const curtain = new THREE.PlaneGeometry(curtainW, curtainH, 64, 32);
    const pos = curtain.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const y = pos.getY(i);
      const t = x / curtainW; // -0.5 .. 0.5 across the drop
      // Gaussian gather around the tieback.
      const gather = Math.exp(-((y + 1.5) * (y + 1.5)) / 1.4);
      const pinch = 1 - 0.55 * gather;
      // Folds get deeper where the fabric is gathered.
      const amp = 0.24 * (1.7 - pinch);
      const z =
        amp * Math.cos(t * Math.PI * 2 * 4.5) +
        amp * 0.35 * Math.cos(t * Math.PI * 2 * 11 + 1.7);
      pos.setX(i, x * pinch);
      pos.setZ(i, z);
    }
    curtain.computeVertexNormals();

    return {
      beamZ,
      beamX,
      cofferOuter,
      cofferInner,
      rosette,
      corniceSide,
      corniceEnd,
      panelFrame,
      pilasterShaft,
      flute,
      pilasterBase,
      pilasterCap,
      pilasterAbacus,
      parapet,
      baluster,
      corbel,
      balconySeat,
      balconyBack,
      shellRib,
      shellBand,
      crystal,
      curtain,
    };
  }, []);

  // ---- Instance matrices --------------------------------------------------
  const inst = useMemo(() => {
    // Coffer frames + rosettes: one per grid cell.
    const cofferOuterMats: THREE.Matrix4[] = [];
    const cofferInnerMats: THREE.Matrix4[] = [];
    const rosetteMats: THREE.Matrix4[] = [];
    for (let r = 0; r < COFFER_ROWS; r++) {
      for (let c = 0; c < COFFER_COLS; c++) {
        const x = -8 + CELL_W / 2 + c * CELL_W;
        const z = -18 + CELL_L / 2 + r * CELL_L;
        // Frames extrude downward from just under the ceiling plane.
        cofferOuterMats.push(compose(x, HALL_HEIGHT - 0.01, z, Math.PI / 2));
        cofferInnerMats.push(compose(x, HALL_HEIGHT - 0.01, z, Math.PI / 2));
        // Rosette hangs down from the recessed panel.
        rosetteMats.push(compose(x, HALL_HEIGHT - 0.02, z, Math.PI));
      }
    }

    // Pilasters: shaft, 8 flutes, base, capital + abacus on both side walls.
    const shaftMats: THREE.Matrix4[] = [];
    const fluteMats: THREE.Matrix4[] = [];
    const baseMats: THREE.Matrix4[] = [];
    const capMats: THREE.Matrix4[] = [];
    const abacusMats: THREE.Matrix4[] = [];
    for (const side of [-1, 1]) {
      for (const z of PILASTER_Z) {
        shaftMats.push(compose(side * 8.84, 6.95, z));
        baseMats.push(compose(side * 8.8, 1.45, z));
        capMats.push(compose(side * 8.8, 12.38, z));
        abacusMats.push(compose(side * 8.8, 12.62, z));
        for (let k = 0; k < FLUTES_PER_PILASTER; k++) {
          const fz = z + (k - (FLUTES_PER_PILASTER - 1) / 2) * 0.062;
          fluteMats.push(compose(side * 8.66, 6.95, fz));
        }
      }
    }

    // Wall panel frames: 4 bays per side wall + 2 on the back wall.
    const panelMats: THREE.Matrix4[] = [];
    for (const side of [-1, 1]) {
      for (const z of [-10.5, -3.5, 3.5, 10.5]) {
        panelMats.push(compose(side * 8.98, 6.2, z, 0, side > 0 ? -Math.PI / 2 : Math.PI / 2));
      }
    }
    for (const x of [-5.5, 5.5]) {
      panelMats.push(compose(x, 6.2, 18.98, 0, Math.PI));
    }

    // Balusters: 60 per side along the balcony rail.
    const balusterMats: THREE.Matrix4[] = [];
    const perSide = 60;
    for (const side of [-1, 1]) {
      for (let i = 0; i < perSide; i++) {
        const z = BALCONY_Z_MID + (i - (perSide - 1) / 2) * ((BALCONY_LEN - 0.6) / (perSide - 1));
        balusterMats.push(compose(side * BALCONY_FRONT, 5.56, z));
      }
    }

    // Corbels under the balcony deck edge.
    const corbelMats: THREE.Matrix4[] = [];
    for (const side of [-1, 1]) {
      for (let i = 0; i < 7; i++) {
        corbelMats.push(compose(side * (BALCONY_FRONT + 0.05), 4.4, BALCONY_Z_MIN + 1 + i * 4));
      }
    }

    // Hinted seat rows on the balcony decks (2 rows per side).
    const balconySeatMats: THREE.Matrix4[] = [];
    const balconyBackMats: THREE.Matrix4[] = [];
    for (const side of [-1, 1]) {
      for (let row = 0; row < 2; row++) {
        for (let i = 0; i < 24; i++) {
          const z = BALCONY_Z_MIN + 1.5 + i * 1.05;
          const x = side * (6.9 + row * 1.0);
          balconySeatMats.push(compose(x, 5.36, z));
          balconyBackMats.push(compose(x, 5.62, z + 0.23));
        }
      }
    }

    // Stage-shell vertical ribs along the curve.
    const ribMats: THREE.Matrix4[] = [];
    for (let i = 0; i < 9; i++) {
      const a = -1.2 + i * 0.3;
      ribMats.push(compose(7.55 * Math.sin(a), 6, -17.8 + 7.55 * Math.cos(a), 0, a, 0));
    }

    // Chandelier crystals: three tiers + descending strands (local to the
    // chandelier group).
    const crystalMats: THREE.Matrix4[] = [];
    const tiers = [
      { n: 28, r: 1.45, y: -0.5, s: 1.0 },
      { n: 20, r: 1.0, y: -0.85, s: 0.85 },
      { n: 14, r: 0.55, y: -1.15, s: 0.7 },
    ];
    for (const tier of tiers) {
      for (let i = 0; i < tier.n; i++) {
        const a = (i / tier.n) * Math.PI * 2;
        crystalMats.push(
          compose(Math.cos(a) * tier.r, tier.y, Math.sin(a) * tier.r, 0, a, 0.25, tier.s),
        );
      }
    }
    for (let arm = 0; arm < 8; arm++) {
      const a = (arm / 8) * Math.PI * 2;
      for (let k = 0; k < 3; k++) {
        const t = k / 2;
        const r = 1.45 - t * 0.85;
        const y = -0.6 - t * 0.45;
        crystalMats.push(compose(Math.cos(a) * r, y, Math.sin(a) * r, 0, a + k, 0.2, 0.6));
      }
    }

    return {
      cofferOuterMats,
      cofferInnerMats,
      rosetteMats,
      shaftMats,
      fluteMats,
      baseMats,
      capMats,
      abacusMats,
      panelMats,
      balusterMats,
      corbelMats,
      balconySeatMats,
      balconyBackMats,
      ribMats,
      crystalMats,
    };
  }, []);

  // Seats — curved-silhouette velvet theater chairs (instanced bank).
  // VelvetSeats convention: yaw=0 faces -z; the stage is at -z.
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
      {/* Parquet floor — high-segment plane so the displacement map bites */}
      <mesh position={[0, 0, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[HALL_WIDTH, HALL_LENGTH, 128, 128]} />
        <primitive object={floorMat} attach="material" />
      </mesh>

      {/* ——— Side walls: PBR field + wainscot + dado + panels + pilasters —— */}
      {[-1, 1].map((side) => (
        <group key={`sidewall-${side}`}>
          <mesh
            position={[(side * HALL_WIDTH) / 2, HALL_HEIGHT / 2, 0]}
            rotation={[0, side > 0 ? -Math.PI / 2 : Math.PI / 2, 0]}
            receiveShadow
          >
            <planeGeometry args={[HALL_LENGTH, HALL_HEIGHT]} />
            <primitive object={wallMat} attach="material" />
          </mesh>
          {/* Skirting board */}
          <mesh position={[side * 8.9, 0.1, 0]} material={mats.woodDark}>
            <boxGeometry args={[0.26, 0.2, HALL_LENGTH]} />
          </mesh>
          {/* Wainscot band up to the dado rail */}
          <mesh position={[side * 8.93, 0.7, 0]} material={mats.woodDark} receiveShadow>
            <boxGeometry args={[0.18, 1.2, HALL_LENGTH]} />
          </mesh>
          {/* Dado rail — gilt bead on top of the wainscot */}
          <mesh position={[side * 8.9, 1.34, 0]} material={mats.gilt}>
            <boxGeometry args={[0.28, 0.09, HALL_LENGTH]} />
          </mesh>
          {/* Gilt frieze strip just under the cornice */}
          <mesh position={[side * 8.93, 13.31, 0]} material={mats.gilt}>
            <boxGeometry args={[0.1, 0.08, HALL_LENGTH]} />
          </mesh>
        </group>
      ))}

      {/* Entablature / crown cornice around the full perimeter */}
      <mesh geometry={geo.corniceSide} material={mats.plaster} position={[-9, 13.35, 0]} />
      <mesh
        geometry={geo.corniceSide}
        material={mats.plaster}
        position={[9, 13.35, 0]}
        rotation={[0, Math.PI, 0]}
      />
      <mesh
        geometry={geo.corniceEnd}
        material={mats.plaster}
        position={[0, 13.35, 19]}
        rotation={[0, Math.PI / 2, 0]}
      />
      <mesh
        geometry={geo.corniceEnd}
        material={mats.plaster}
        position={[0, 13.35, -19]}
        rotation={[0, -Math.PI / 2, 0]}
      />

      {/* Gilt wall-panel frames (instanced across both side walls + back) */}
      <instancedMesh
        ref={(m) => setInstances(m, inst.panelMats)}
        args={[geo.panelFrame, mats.gilt, inst.panelMats.length]}
      />

      {/* Fluted pilasters — shaft/flutes/base/capital all instanced */}
      <instancedMesh
        ref={(m) => setInstances(m, inst.shaftMats)}
        args={[geo.pilasterShaft, mats.plaster, inst.shaftMats.length]}
      />
      <instancedMesh
        ref={(m) => setInstances(m, inst.fluteMats)}
        args={[geo.flute, mats.plasterShade, inst.fluteMats.length]}
      />
      <instancedMesh
        ref={(m) => setInstances(m, inst.baseMats)}
        args={[geo.pilasterBase, mats.woodMid, inst.baseMats.length]}
      />
      <instancedMesh
        ref={(m) => setInstances(m, inst.capMats)}
        args={[geo.pilasterCap, mats.giltBright, inst.capMats.length]}
      />
      <instancedMesh
        ref={(m) => setInstances(m, inst.abacusMats)}
        args={[geo.pilasterAbacus, mats.gilt, inst.abacusMats.length]}
      />

      {/* ——— Coffered ceiling: recessed panels + chamfered beam grid ————— */}
      {/* Recessed ceiling panel plane (set above the beam underside) */}
      <mesh position={[0, HALL_HEIGHT, 0]} rotation={[Math.PI / 2, 0, 0]} material={mats.ceilingPanel}>
        <planeGeometry args={[HALL_WIDTH, HALL_LENGTH]} />
      </mesh>
      {/* Longitudinal beams (run the length of the hall) */}
      {Array.from({ length: COFFER_COLS + 1 }).map((_, i) => (
        <mesh
          key={`beam-z-${i}`}
          geometry={geo.beamZ}
          material={mats.woodBeam}
          position={[-8 + i * CELL_W, HALL_HEIGHT, 0]}
        />
      ))}
      {/* Transverse beams (run the width) */}
      {Array.from({ length: COFFER_ROWS + 1 }).map((_, i) => (
        <mesh
          key={`beam-x-${i}`}
          geometry={geo.beamX}
          material={mats.woodBeam}
          position={[0, HALL_HEIGHT, -18 + i * CELL_L]}
          rotation={[0, Math.PI / 2, 0]}
        />
      ))}
      {/* Stepped coffer moulding frames + central gilt rosettes */}
      <instancedMesh
        ref={(m) => setInstances(m, inst.cofferOuterMats)}
        args={[geo.cofferOuter, mats.woodMid, inst.cofferOuterMats.length]}
      />
      <instancedMesh
        ref={(m) => setInstances(m, inst.cofferInnerMats)}
        args={[geo.cofferInner, mats.gilt, inst.cofferInnerMats.length]}
      />
      <instancedMesh
        ref={(m) => setInstances(m, inst.rosetteMats)}
        args={[geo.rosette, mats.giltBright, inst.rosetteMats.length]}
      />

      {/* ——— Back wall (entrance): PBR + wainscot + panels + double door ——— */}
      <mesh position={[0, HALL_HEIGHT / 2, HALL_LENGTH / 2]} rotation={[0, Math.PI, 0]} receiveShadow>
        <planeGeometry args={[HALL_WIDTH, HALL_HEIGHT]} />
        <primitive object={backWallMat} attach="material" />
      </mesh>
      <mesh position={[0, 0.7, 18.93]} material={mats.woodDark}>
        <boxGeometry args={[HALL_WIDTH - 0.4, 1.2, 0.18]} />
      </mesh>
      <mesh position={[0, 1.34, 18.9]} material={mats.gilt}>
        <boxGeometry args={[HALL_WIDTH - 0.4, 0.09, 0.28]} />
      </mesh>
      <mesh position={[0, 13.31, 18.93]} material={mats.gilt}>
        <boxGeometry args={[HALL_WIDTH - 0.4, 0.08, 0.1]} />
      </mesh>
      {/* Central double door with gilt trim */}
      <group position={[0, 0, 18.8]}>
        {[-1, 1].map((d) => (
          <mesh key={`door-${d}`} position={[d * 0.58, 2.4, 0]} material={mats.woodPolished}>
            <boxGeometry args={[1.12, 4.6, 0.14]} />
          </mesh>
        ))}
        {/* Door architrave */}
        <mesh position={[0, 4.85, -0.02]} material={mats.gilt}>
          <boxGeometry args={[2.7, 0.22, 0.2]} />
        </mesh>
        {[-1, 1].map((d) => (
          <mesh key={`arch-${d}`} position={[d * 1.28, 2.4, -0.02]} material={mats.gilt}>
            <boxGeometry args={[0.16, 4.7, 0.2]} />
          </mesh>
        ))}
        {/* Knobs */}
        {[-1, 1].map((d) => (
          <mesh key={`knob-${d}`} position={[d * 0.16, 2.2, -0.1]} material={mats.giltBright}>
            <sphereGeometry args={[0.05, 12, 10]} />
          </mesh>
        ))}
      </group>

      {/* ——— Balconies: curved parapet, balustrade, corbels, seat rows ——— */}
      {[-1, 1].map((side) => (
        <group key={`balcony-${side}`}>
          {/* Deck slab */}
          <mesh
            position={[side * 7.5, 5.0, BALCONY_Z_MID]}
            material={mats.woodMid}
            castShadow
            receiveShadow
          >
            <boxGeometry args={[3.0, 0.22, BALCONY_LEN]} />
          </mesh>
          {/* Curved-front parapet with mouldings */}
          <mesh
            geometry={geo.parapet}
            material={mats.woodMid}
            position={[side * BALCONY_FRONT, 5.1, BALCONY_Z_MID]}
            rotation={[0, side > 0 ? Math.PI : 0, 0]}
          />
          {/* Gilt moulding strips top + bottom of the parapet */}
          <mesh position={[side * BALCONY_FRONT, 5.57, BALCONY_Z_MID]} material={mats.gilt}>
            <boxGeometry args={[0.46, 0.07, BALCONY_LEN]} />
          </mesh>
          <mesh position={[side * BALCONY_FRONT, 5.12, BALCONY_Z_MID]} material={mats.gilt}>
            <boxGeometry args={[0.5, 0.07, BALCONY_LEN]} />
          </mesh>
          {/* Polished handrail above the balusters */}
          <mesh position={[side * BALCONY_FRONT, 6.16, BALCONY_Z_MID]} material={mats.woodPolished}>
            <boxGeometry args={[0.34, 0.1, BALCONY_LEN]} />
          </mesh>
        </group>
      ))}
      <instancedMesh
        ref={(m) => setInstances(m, inst.balusterMats)}
        args={[geo.baluster, mats.gilt, inst.balusterMats.length]}
      />
      <instancedMesh
        ref={(m) => setInstances(m, inst.corbelMats)}
        args={[geo.corbel, mats.woodMid, inst.corbelMats.length]}
      />
      <instancedMesh
        ref={(m) => setInstances(m, inst.balconySeatMats)}
        args={[geo.balconySeat, mats.seatHintVelvet, inst.balconySeatMats.length]}
      />
      <instancedMesh
        ref={(m) => setInstances(m, inst.balconyBackMats)}
        args={[geo.balconyBack, mats.seatHintVelvet, inst.balconyBackMats.length]}
      />

      {/* ——— Stage platform with rounded nosing + paneled front ——————— */}
      <mesh position={[0, 0.5, -HALL_LENGTH / 2 + 5]} castShadow receiveShadow>
        <boxGeometry args={[HALL_WIDTH - 3, 1, 8]} />
        <meshStandardMaterial color="#6a4a28" roughness={0.6} metalness={0.1} />
      </mesh>
      {/* Rounded stage nosing: front edge + both side edges */}
      <mesh position={[0, 0.98, -10.02]} rotation={[0, 0, Math.PI / 2]} material={mats.woodPolished}>
        <cylinderGeometry args={[0.13, 0.13, HALL_WIDTH - 3, 20]} />
      </mesh>
      {[-1, 1].map((side) => (
        <mesh
          key={`nosing-${side}`}
          position={[side * 7.48, 0.98, -14]}
          rotation={[Math.PI / 2, 0, 0]}
          material={mats.woodPolished}
        >
          <cylinderGeometry args={[0.13, 0.13, 8, 20]} />
        </mesh>
      ))}
      {/* Stage front: gilt strips + vertical dividers hint recessed panels */}
      <mesh position={[0, 0.86, -9.97]} material={mats.gilt}>
        <boxGeometry args={[HALL_WIDTH - 3.2, 0.08, 0.06]} />
      </mesh>
      <mesh position={[0, 0.14, -9.97]} material={mats.gilt}>
        <boxGeometry args={[HALL_WIDTH - 3.2, 0.08, 0.06]} />
      </mesh>
      {[-6, -3.6, -1.2, 1.2, 3.6, 6].map((x) => (
        <mesh key={`stage-div-${x}`} position={[x, 0.5, -9.97]} material={mats.woodDark}>
          <boxGeometry args={[0.12, 0.66, 0.05]} />
        </mesh>
      ))}

      {/* Curved stage shell — coffered with ribs and horizontal bands */}
      <mesh position={[0, 6, -HALL_LENGTH / 2 + 1.2]}>
        <cylinderGeometry args={[8, 8, 11, 96, 1, true, -Math.PI / 2, Math.PI]} />
        <primitive object={shellMat} attach="material" />
      </mesh>
      <instancedMesh
        ref={(m) => setInstances(m, inst.ribMats)}
        args={[geo.shellRib, mats.woodMid, inst.ribMats.length]}
      />
      {[2.5, 6, 9.3].map((y) => (
        <mesh
          key={`shell-band-${y}`}
          geometry={geo.shellBand}
          material={mats.woodMid}
          position={[0, y, -17.8]}
        />
      ))}

      {/* ——— Grand pipe organ behind the stage ——————————————————————————
          Classical three-tower façade: central flat "great" division flanked
          by two outer towers. Horizontal "chamade" trumpet pipes fan out
          over the top. Case edges carry bevelled gilt mouldings. */}
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
            {/* Bevelled gilt mouldings framing the case */}
            {[-1, 1].map((d) => (
              <mesh key={`case-trim-${d}`} position={[d * 7.05, 4.5, -0.1]} material={mats.gilt}>
                <boxGeometry args={[0.16, 9, 0.16]} />
              </mesh>
            ))}
            <mesh position={[0, 9.02, -0.1]} material={mats.woodMid}>
              <boxGeometry args={[14.4, 0.3, 0.7]} />
            </mesh>
            <mesh position={[0, 9.22, -0.1]} material={mats.gilt}>
              <boxGeometry args={[14.6, 0.12, 0.8]} />
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

            {/* Central flat division — 15 pipes, pyramid profile */}
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
                <mesh key={`org-c-mouth-${i}`} position={[xLocal, 0.6 + h - 0.4, 0.22]}>
                  <boxGeometry args={[0.28, 0.12, 0.02]} />
                  <meshStandardMaterial color="#3a2a14" roughness={0.7} metalness={0.3} />
                </mesh>
              );
            })}

            {/* Flanking towers — 7 large pipes each on a raised pedestal */}
            {[0, 1].map((mirror) => {
              const sideX = mirror === 0 ? -5.4 : 5.4;
              return (
                <group key={`tower-${mirror}`} position={[sideX, 0, 0.25]}>
                  {/* Raised pedestal with bevelled gilt cap moulding */}
                  <mesh position={[0, 1.3, 0]}>
                    <boxGeometry args={[3.2, 1.4, 0.7]} />
                    <meshStandardMaterial color="#4a2f18" roughness={0.55} metalness={0.2} />
                  </mesh>
                  <mesh position={[0, 2.02, 0]} material={mats.woodMid}>
                    <boxGeometry args={[3.4, 0.14, 0.85]} />
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
                      <mesh key={`tp-${i}`} position={[xLocal, 2.0 + h / 2, 0.0]}>
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
                      <mesh key={`tp-cap-${i}`} position={[xLocal, 2.0 + h, 0.0]}>
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

            {/* Horizontal "chamade" trumpet pipes fanning over the center */}
            {Array.from({ length: 11 }).map((_, i) => {
              const angle = (i - 5) * 0.11;
              const yCenter = 8.4 + Math.cos(angle) * 0.2;
              const length = 2.2;
              return (
                <group key={`chamade-${i}`} position={[0, yCenter, 0.5]} rotation={[0, 0, angle]}>
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

            {/* Upper decorative entablature with a carved shield */}
            <mesh position={[0, 9.5, 0.15]}>
              <boxGeometry args={[13.5, 0.6, 0.4]} />
              <meshStandardMaterial color="#5a3a1c" roughness={0.55} metalness={0.25} />
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
            {/* Central cartouche — carved shield with gilt laurel */}
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
            <pointLight position={[0, 5, 1.5]} intensity={14} distance={14} color="#ffd48a" />
            <pointLight position={[-5, 7, 1]} intensity={6} distance={8} color="#ffc880" />
            <pointLight position={[5, 7, 1]} intensity={6} distance={8} color="#ffc880" />
          </group>
        );
      })()}

      {/* Grand piano on stage — keyboard faces the audience (+z) */}
      <GrandPiano position={[0, 1, -HALL_LENGTH / 2 + 6.5]} rotation={[0, Math.PI, 0]} scale={1.35} />

      {/* Soloist figure — 19th-century tailcoat silhouette under the spot */}
      <PeriodFigure
        variant="romantic"
        position={[2.3, 1, -HALL_LENGTH / 2 + 7.3]}
        rotation={[0, -0.1, 0]}
        phase={0}
        sway={0.7}
      />

      {/* Cello on a stand — stage left */}
      <group position={[-4, 1, -HALL_LENGTH / 2 + 5.5]} rotation={[0, 0.3, 0]}>
        <mesh position={[0, 0.9, 0]} rotation={[Math.PI / 2.3, 0, 0]}>
          <cylinderGeometry args={[0.38, 0.34, 1.3, 32]} />
          <meshStandardMaterial color="#7a3a18" roughness={0.4} metalness={0.2} />
        </mesh>
        <mesh position={[0, 1.45, 0.15]} rotation={[Math.PI / 2.1, 0, 0]}>
          <sphereGeometry args={[0.3, 24, 16]} />
          <meshStandardMaterial color="#6a3010" roughness={0.4} metalness={0.2} />
        </mesh>
        <mesh position={[0, 2.0, 0.32]} rotation={[0.5, 0, 0]}>
          <boxGeometry args={[0.06, 0.8, 0.08]} />
          <meshStandardMaterial color="#1a0a04" roughness={0.3} />
        </mesh>
        <mesh position={[0, 2.45, 0.55]}>
          <sphereGeometry args={[0.08, 16, 16]} />
          <meshStandardMaterial color="#2a1408" roughness={0.4} />
        </mesh>
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
          <mesh position={[0, 0.85, 0]}>
            <cylinderGeometry args={[0.12, 0.14, 0.08, 24]} />
            <meshStandardMaterial color="#1a1a1a" roughness={0.5} />
          </mesh>
          <group position={[0, 1.25, 0]} rotation={[Math.PI / 2.2, 0, 0.1]}>
            <mesh>
              <cylinderGeometry args={[0.16, 0.14, 0.55, 28]} />
              <meshStandardMaterial color="#7a3818" roughness={0.35} metalness={0.25} />
            </mesh>
            <mesh position={[0, 0.28, 0.05]}>
              <sphereGeometry args={[0.14, 20, 14]} />
              <meshStandardMaterial color="#6a3010" roughness={0.35} metalness={0.25} />
            </mesh>
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

      {/* ——— Central chandelier: gilt rings + instanced crystal drops ——— */}
      <group position={[0, HALL_HEIGHT - 2.5, 0]}>
        {/* Core light orb */}
        <mesh>
          <sphereGeometry args={[0.4, 48, 32]} />
          <meshStandardMaterial color="#ffe199" emissive="#ffd27a" emissiveIntensity={3.2} />
        </mesh>
        {/* Gilt frame rings */}
        <mesh rotation={[Math.PI / 2, 0, 0]} material={mats.giltBright}>
          <torusGeometry args={[1.5, 0.045, 12, 72]} />
        </mesh>
        <mesh position={[0, -0.75, 0]} rotation={[Math.PI / 2, 0, 0]} material={mats.giltBright}>
          <torusGeometry args={[0.95, 0.035, 12, 56]} />
        </mesh>
        {/* Upper ring candles — 12 */}
        {Array.from({ length: 12 }).map((_, i) => {
          const a = (i / 12) * Math.PI * 2;
          return (
            <group key={`up-c-${i}`} position={[Math.cos(a) * 1.5, -0.2, Math.sin(a) * 1.5]}>
              <mesh>
                <cylinderGeometry args={[0.04, 0.04, 0.25, 12]} />
                <meshStandardMaterial color="#fff5d6" />
              </mesh>
              <mesh position={[0, 0.18, 0]}>
                <sphereGeometry args={[0.1, 16, 16]} />
                <meshStandardMaterial color="#ffeaaf" emissive="#ffd27a" emissiveIntensity={2.6} />
              </mesh>
            </group>
          );
        })}
        {/* Instanced crystal drops — three tiers + strands, IBL sparkle */}
        <instancedMesh
          ref={(m) => setInstances(m, inst.crystalMats)}
          args={[geo.crystal, mats.crystal, inst.crystalMats.length]}
        />
        {/* Central teardrop at the bottom */}
        <mesh position={[0, -1.35, 0]}>
          <coneGeometry args={[0.22, 0.6, 24]} />
          <meshStandardMaterial
            color="#f4e8bf"
            emissive="#ffd27a"
            emissiveIntensity={2.0}
            metalness={0.5}
            roughness={0.1}
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
            <meshStandardMaterial color="#ffe199" emissive="#ffd27a" emissiveIntensity={2.4} />
          </mesh>
          <mesh rotation={[Math.PI / 2, 0, 0]} material={mats.giltBright}>
            <torusGeometry args={[0.7, 0.03, 10, 40]} />
          </mesh>
          {Array.from({ length: 8 }).map((_, i) => {
            const a = (i / 8) * Math.PI * 2;
            return (
              <mesh
                key={`sc-${i}`}
                position={[Math.cos(a) * 0.7, -0.25, Math.sin(a) * 0.7]}
                rotation={[0, a, 0.2]}
                geometry={geo.crystal}
                material={mats.crystal}
                scale={0.8}
              />
            );
          })}
          <pointLight intensity={14} distance={14} color="#ffd27a" />
        </group>
      ))}

      {/* ——— Folded velvet curtains flanking the stage shell ——————————— */}
      {[-1, 1].map((side) => (
        <group
          key={`curt-${side}`}
          position={[side * (HALL_WIDTH / 2 - 0.85), 6, -HALL_LENGTH / 2 + 2.2]}
          rotation={[0, side * -0.12, 0]}
        >
          <mesh geometry={geo.curtain} material={mats.curtainVelvet} />
          {/* Pelmet box above the drop */}
          <mesh position={[0, 5.6, 0.05]} material={mats.woodDark}>
            <boxGeometry args={[2.9, 0.55, 0.6]} />
          </mesh>
          <mesh position={[0, 5.36, 0.1]} material={mats.gilt}>
            <boxGeometry args={[2.95, 0.08, 0.62]} />
          </mesh>
          {/* Gilt tieback rope at the gather */}
          <mesh position={[0, -1.5, 0.3]} rotation={[0.15, 0, 0]}>
            <torusGeometry args={[0.32, 0.045, 12, 32]} />
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

      {/* ——— Volumetric shafts: stage spot + chandelier ambience ————————— */}
      <LightShaft
        position={[0, 8, -HALL_LENGTH / 2 + 8]}
        rotation={[0.4, 0, 0]}
        length={8}
        radiusTop={0.5}
        radiusBottom={3.0}
        color="#ffd9a0"
        intensity={0.08}
      />
      <LightShaft
        position={[0, HALL_HEIGHT - 2.7, 0]}
        length={9.8}
        radiusTop={1.3}
        radiusBottom={4.2}
        color="#ffe2b0"
        intensity={0.04}
      />
      {[-1, 1].map((side) => (
        <LightShaft
          key={`side-shaft-${side}`}
          position={[side * 6, HALL_HEIGHT - 3.2, 0]}
          length={7.5}
          radiusTop={0.4}
          radiusBottom={2.4}
          color="#ffe2b0"
          intensity={0.03}
        />
      ))}

      {/* Lighting: warm stage key (sole shadow caster) + house ambience */}
      <ambientLight intensity={0.18} color="#d6c0a0" />
      <spotLight
        position={[0, 8, -HALL_LENGTH / 2 + 8]}
        target-position={[0, 1, -HALL_LENGTH / 2 + 5]}
        angle={Math.PI / 5}
        penumbra={0.6}
        intensity={160}
        distance={30}
        color="#ffd48a"
        castShadow
      />
      <pointLight
        position={[0, HALL_HEIGHT - 2.5, 0]}
        intensity={34}
        distance={25}
        color="#ffd27a"
      />
      <pointLight position={[0, 5, HALL_LENGTH / 2 - 3]} intensity={7} distance={18} color="#c8b48a" />
    </group>
  );
}
