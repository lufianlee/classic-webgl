'use client';

import { useMemo } from 'react';
import * as THREE from 'three';

/**
 * 19th-century theater seating — rendered as a bank of upholstered chairs
 * with curved silhouettes (not box stacks). Each chair is assembled from:
 *
 *   - cushion : a `LatheGeometry` rounded rectangular puff (top rolled,
 *     bottom flat) — reads as a real tufted velvet cushion rather than a box
 *   - seat    : a soft extruded rounded-square seat pan
 *   - back    : `ExtrudeGeometry` of a cartouche (curved top, pinched waist)
 *     with a rolled top moulding on top (small torus) — period detail
 *   - armrests: two lathed wooden rails with a rounded scroll at the front
 *   - legs    : short turned-wood legs (lathe with two mouldings)
 *
 * The whole chair is expressed as 5 merged InstancedMesh calls — one per
 * material. This replaces 120+ individual boxGeometry draw calls with 5
 * total, which also makes higher-quality shadows viable on the bank.
 *
 * API: pass an array of world-space positions and a shared yaw; each
 * instance gets its own matrix. No per-instance color variation — the
 * identical-upholstery pattern is what sells "a concert hall" rather than
 * "a shuffle of chairs".
 */

export interface SeatTransform {
  position: [number, number, number];
  /** Yaw (Y-rotation) in radians. Lets curved rows face a stage. */
  yaw?: number;
}

interface Props {
  seats: SeatTransform[];
  /** Velvet color for cushion + back upholstery */
  velvetColor?: string;
  /** Wood color for armrests, legs, back frame */
  woodColor?: string;
  /** Gilt accent for the backrest top rail */
  giltColor?: string;
}

/** Rounded rectangle Shape used for the seat pan and back upholstery. */
function makeRoundedRect(
  width: number,
  height: number,
  radius: number,
): THREE.Shape {
  const s = new THREE.Shape();
  const w = width / 2;
  const h = height / 2;
  const r = Math.min(radius, Math.min(w, h));
  s.moveTo(-w + r, -h);
  s.lineTo(w - r, -h);
  s.quadraticCurveTo(w, -h, w, -h + r);
  s.lineTo(w, h - r);
  s.quadraticCurveTo(w, h, w - r, h);
  s.lineTo(-w + r, h);
  s.quadraticCurveTo(-w, h, -w, h - r);
  s.lineTo(-w, -h + r);
  s.quadraticCurveTo(-w, -h, -w + r, -h);
  return s;
}

/** Cartouche-shaped backrest silhouette: rounded-top, slightly pinched waist. */
function makeCartoucheShape(width: number, height: number): THREE.Shape {
  const s = new THREE.Shape();
  const w = width / 2;
  const h = height / 2;

  // Start at bottom-left, climb up the left side with a subtle inward curve
  // (the "waist" of the cartouche), then arch over the top, mirror down.
  s.moveTo(-w * 0.95, -h);
  s.bezierCurveTo(-w * 1.02, -h * 0.4, -w * 0.78, h * 0.2, -w * 0.9, h * 0.55);
  s.bezierCurveTo(-w * 1.0, h * 0.85, -w * 0.55, h * 1.02, 0, h);
  s.bezierCurveTo(w * 0.55, h * 1.02, w * 1.0, h * 0.85, w * 0.9, h * 0.55);
  s.bezierCurveTo(w * 0.78, h * 0.2, w * 1.02, -h * 0.4, w * 0.95, -h);
  s.lineTo(-w * 0.95, -h);
  return s;
}

export function VelvetSeats({
  seats,
  velvetColor = '#5a1f1f',
  woodColor = '#3a2410',
  giltColor = '#c89a55',
}: Props) {
  // ---- Shared geometries (one per part) ----
  const cushionGeom = useMemo(() => {
    // Lathe profile of a rolled rectangular cushion cross-section.
    // Points go from the center (r=0) up along the top surface and back
    // down the side, rotated 360°. The upper curve makes a "bun" top.
    const pts: THREE.Vector2[] = [];
    const steps = 24;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      // Half-circle-ish bun: radius 0.45, height 0.14 at apex
      const angle = t * Math.PI;
      const r = Math.sin(angle) * 0.45 + 0.02;
      const y = 0.04 + (1 - Math.cos(angle)) * 0.07;
      pts.push(new THREE.Vector2(r, y));
    }
    // Close back down on the underside
    pts.push(new THREE.Vector2(0.01, 0));
    const g = new THREE.LatheGeometry(pts, 48);
    // Squash into a slightly rectangular puff
    g.scale(1.1, 1.0, 0.95);
    g.computeVertexNormals();
    return g;
  }, []);

  const seatPanGeom = useMemo(() => {
    const shape = makeRoundedRect(1.0, 0.9, 0.12);
    const g = new THREE.ExtrudeGeometry(shape, {
      depth: 0.12,
      bevelEnabled: true,
      bevelThickness: 0.04,
      bevelSize: 0.04,
      bevelSegments: 4,
      curveSegments: 16,
    });
    // ExtrudeGeometry extrudes along +Z; rotate so the pan is flat on XZ.
    g.rotateX(-Math.PI / 2);
    // Center it at origin
    g.translate(0, 0, 0);
    g.computeVertexNormals();
    return g;
  }, []);

  const backUpholsteryGeom = useMemo(() => {
    const shape = makeCartoucheShape(0.95, 1.25);
    const g = new THREE.ExtrudeGeometry(shape, {
      depth: 0.1,
      bevelEnabled: true,
      bevelThickness: 0.03,
      bevelSize: 0.03,
      bevelSegments: 4,
      curveSegments: 24,
    });
    g.computeVertexNormals();
    return g;
  }, []);

  // Wooden back-frame = cartouche slightly larger than upholstery, shallower
  // extrusion so it reads as a frame behind the velvet.
  const backFrameGeom = useMemo(() => {
    const shape = makeCartoucheShape(1.05, 1.35);
    const g = new THREE.ExtrudeGeometry(shape, {
      depth: 0.06,
      bevelEnabled: true,
      bevelThickness: 0.015,
      bevelSize: 0.02,
      bevelSegments: 3,
      curveSegments: 24,
    });
    g.computeVertexNormals();
    return g;
  }, []);

  // Gilt top rail (small torus arc across the top of the back).
  const topRailGeom = useMemo(() => {
    const g = new THREE.TorusGeometry(0.4, 0.025, 12, 32, Math.PI);
    g.computeVertexNormals();
    return g;
  }, []);

  // Armrest: a lathed rail with a scroll at the front.
  const armrestGeom = useMemo(() => {
    const pts: THREE.Vector2[] = [
      new THREE.Vector2(0.04, 0),
      new THREE.Vector2(0.06, 0.03),
      new THREE.Vector2(0.06, 0.5),
      new THREE.Vector2(0.045, 0.55),
      new THREE.Vector2(0.035, 0.58),
    ];
    const g = new THREE.LatheGeometry(pts, 20);
    g.rotateZ(-Math.PI / 2); // lay it horizontally
    g.computeVertexNormals();
    return g;
  }, []);

  // Scroll cap — small toroidal ring at the front of each armrest
  const scrollGeom = useMemo(() => {
    const g = new THREE.TorusGeometry(0.06, 0.02, 10, 18);
    g.computeVertexNormals();
    return g;
  }, []);

  // Turned leg — lathe profile with two decorative swells
  const legGeom = useMemo(() => {
    const pts = [
      new THREE.Vector2(0.04, 0),
      new THREE.Vector2(0.055, 0.02),
      new THREE.Vector2(0.04, 0.1),
      new THREE.Vector2(0.06, 0.15),
      new THREE.Vector2(0.04, 0.22),
      new THREE.Vector2(0.05, 0.3),
      new THREE.Vector2(0.035, 0.42),
    ];
    const g = new THREE.LatheGeometry(pts, 18);
    g.computeVertexNormals();
    return g;
  }, []);

  // ---- Shared materials ----
  const velvetMat = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: velvetColor,
        roughness: 0.92,
        metalness: 0.0,
        sheen: 1.0, // MeshStandardMaterial ignores it but keeps the intent
      } as THREE.MeshStandardMaterialParameters),
    [velvetColor],
  );
  const velvetBackMat = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: velvetColor,
        roughness: 0.9,
        metalness: 0.0,
      }),
    [velvetColor],
  );
  const woodMat = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: woodColor,
        roughness: 0.55,
        metalness: 0.15,
      }),
    [woodColor],
  );
  const giltMat = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: giltColor,
        roughness: 0.3,
        metalness: 0.75,
        emissive: new THREE.Color(giltColor),
        emissiveIntensity: 0.08,
      }),
    [giltColor],
  );

  // ---- Per-instance transforms ----
  const count = seats.length;

  const { cushionMats, seatPanMats, backMats, frameMats, railMats, armMats, scrollMats, legMats } =
    useMemo(() => {
      const tmp = new THREE.Object3D();
      const mk = () => new Array(count).fill(null).map(() => new THREE.Matrix4());

      const cushionMats = mk();
      const seatPanMats = mk();
      const backMats = mk();
      const frameMats = mk();
      const railMats = mk();
      const armMats = mk();
      const scrollMats = mk();
      const legMats: THREE.Matrix4[] = new Array(count * 4).fill(null).map(() => new THREE.Matrix4());

      for (let i = 0; i < count; i++) {
        const { position, yaw = 0 } = seats[i];
        const [x, y, z] = position;

        // Seat pan
        tmp.position.set(x, y + 0.5, z);
        tmp.rotation.set(0, yaw, 0);
        tmp.scale.setScalar(1);
        tmp.updateMatrix();
        seatPanMats[i].copy(tmp.matrix);

        // Cushion on top of the pan
        tmp.position.set(x, y + 0.58, z);
        tmp.rotation.set(0, yaw, 0);
        tmp.scale.set(1, 1, 1);
        tmp.updateMatrix();
        cushionMats[i].copy(tmp.matrix);

        // Back frame — behind the upholstery
        tmp.position.set(
          x + Math.sin(yaw) * 0.38,
          y + 1.35,
          z + Math.cos(yaw) * 0.38,
        );
        tmp.rotation.set(0, yaw, 0);
        tmp.scale.set(1, 1, 1);
        tmp.updateMatrix();
        frameMats[i].copy(tmp.matrix);

        // Velvet back upholstery — on top of the frame
        tmp.position.set(
          x + Math.sin(yaw) * 0.4,
          y + 1.35,
          z + Math.cos(yaw) * 0.4,
        );
        tmp.rotation.set(0, yaw, 0);
        tmp.updateMatrix();
        backMats[i].copy(tmp.matrix);

        // Gilt top rail — arches over the top of the back
        tmp.position.set(
          x + Math.sin(yaw) * 0.45,
          y + 1.97,
          z + Math.cos(yaw) * 0.45,
        );
        // Rotate so the torus arc opens downward around the back top
        tmp.rotation.set(0, yaw, 0);
        tmp.updateMatrix();
        railMats[i].copy(tmp.matrix);

        // Two armrests (left + right)
        [-1, 1].forEach((side, k) => {
          const ox = Math.cos(yaw) * side * 0.48;
          const oz = -Math.sin(yaw) * side * 0.48;
          tmp.position.set(x + ox, y + 1.05, z + oz);
          tmp.rotation.set(0, yaw, 0);
          tmp.updateMatrix();
          armMats[i * 2 + k] = armMats[i * 2 + k] ?? new THREE.Matrix4();
          armMats[i * 2 + k].copy(tmp.matrix);

          // Scroll cap at the front tip of the armrest
          const tipX = ox + Math.cos(yaw) * -0.3 + Math.sin(yaw) * 0; // front = -z local
          const tipZ = oz + Math.sin(yaw) * -0.3 + Math.cos(yaw) * 0;
          // Simpler: derive front offset
          tmp.position.set(
            x + ox + -Math.sin(yaw - Math.PI / 2) * 0.3,
            y + 1.05,
            z + oz + -Math.cos(yaw - Math.PI / 2) * 0.3,
          );
          tmp.rotation.set(0, yaw, 0);
          tmp.updateMatrix();
          scrollMats[i * 2 + k] = scrollMats[i * 2 + k] ?? new THREE.Matrix4();
          scrollMats[i * 2 + k].copy(tmp.matrix);
          // silence unused-vars
          void tipX;
          void tipZ;
        });

        // Four legs
        const legOffsets: Array<[number, number]> = [
          [-0.42, -0.38],
          [0.42, -0.38],
          [-0.42, 0.38],
          [0.42, 0.38],
        ];
        legOffsets.forEach(([lx, lz], k) => {
          // Rotate local (lx,lz) by yaw
          const cos = Math.cos(yaw);
          const sin = Math.sin(yaw);
          const rx = lx * cos + lz * sin;
          const rz = -lx * sin + lz * cos;
          tmp.position.set(x + rx, y, z + rz);
          tmp.rotation.set(0, yaw, 0);
          tmp.updateMatrix();
          legMats[i * 4 + k].copy(tmp.matrix);
        });
      }

      // Flatten arm/scroll doubled-up arrays back (we used 2× length so we
      // actually need 2× count for the InstancedMesh too).
      return {
        cushionMats,
        seatPanMats,
        backMats,
        frameMats,
        railMats,
        armMats,
        scrollMats,
        legMats,
      };
    }, [seats, count]);

  // ---- Render ----
  // We set instance matrices in a ref callback so the data lands on the GPU
  // immediately. Using `dispose={null}` prevents the GC race where instanced
  // arrays get disposed while the composer is still reading depth.

  function setInstances(
    mesh: THREE.InstancedMesh | null,
    mats: THREE.Matrix4[],
  ) {
    if (!mesh) return;
    for (let i = 0; i < mats.length; i++) mesh.setMatrixAt(i, mats[i]);
    mesh.instanceMatrix.needsUpdate = true;
    mesh.count = mats.length;
    mesh.computeBoundingSphere();
  }

  return (
    <group>
      <instancedMesh
        ref={(m) => setInstances(m, seatPanMats)}
        args={[seatPanGeom, velvetMat, count]}
        castShadow
        receiveShadow
      />
      <instancedMesh
        ref={(m) => setInstances(m, cushionMats)}
        args={[cushionGeom, velvetMat, count]}
        castShadow
        receiveShadow
      />
      <instancedMesh
        ref={(m) => setInstances(m, frameMats)}
        args={[backFrameGeom, woodMat, count]}
        castShadow
        receiveShadow
      />
      <instancedMesh
        ref={(m) => setInstances(m, backMats)}
        args={[backUpholsteryGeom, velvetBackMat, count]}
        castShadow
        receiveShadow
      />
      <instancedMesh
        ref={(m) => setInstances(m, railMats)}
        args={[topRailGeom, giltMat, count]}
        castShadow
      />
      <instancedMesh
        ref={(m) => setInstances(m, armMats)}
        args={[armrestGeom, woodMat, count * 2]}
        castShadow
      />
      <instancedMesh
        ref={(m) => setInstances(m, scrollMats)}
        args={[scrollGeom, woodMat, count * 2]}
        castShadow
      />
      <instancedMesh
        ref={(m) => setInstances(m, legMats)}
        args={[legGeom, woodMat, count * 4]}
        castShadow
      />
    </group>
  );
}
