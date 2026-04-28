'use client';

import { useMemo } from 'react';
import * as THREE from 'three';

/**
 * Louis XV–style cabriole salon chair (fauteuil à la reine).
 *
 * Key period silhouette cues we reproduce:
 *   - cabriole legs: S-curved legs with a "knee" that bulges outward and
 *     a "foot" that curves back inward (built via TubeGeometry along a
 *     bezier curve for a smooth swept profile — not a stack of cylinders)
 *   - cartouche back: curved-top back panel with a pinched waist
 *     (ExtrudeGeometry of a cartouche Shape)
 *   - rounded seat rail: bevelled rounded rectangle in place of a slab
 *   - upholstered cushion: lathed puff cross-section (reads as tufted
 *     velvet, not a box)
 *   - gilt cresting rail: small torus arc along the top of the back
 *
 * Scale is calibrated to slot into the salon ~0.9m tall, 0.55m wide
 * footprint — matches the chair-arc layout in Salon.tsx without code
 * changes on that side.
 */

interface Props {
  position?: [number, number, number];
  rotation?: [number, number, number];
  velvetColor?: string;
  woodColor?: string;
  giltColor?: string;
}

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

/** Cartouche-shaped back: pinched-waist, rounded-top period silhouette. */
function makeCartoucheShape(width: number, height: number): THREE.Shape {
  const s = new THREE.Shape();
  const w = width / 2;
  const h = height / 2;
  s.moveTo(-w * 0.95, -h);
  s.bezierCurveTo(-w * 1.02, -h * 0.4, -w * 0.76, h * 0.2, -w * 0.88, h * 0.6);
  s.bezierCurveTo(-w * 1.02, h * 0.9, -w * 0.48, h * 1.04, 0, h);
  s.bezierCurveTo(w * 0.48, h * 1.04, w * 1.02, h * 0.9, w * 0.88, h * 0.6);
  s.bezierCurveTo(w * 0.76, h * 0.2, w * 1.02, -h * 0.4, w * 0.95, -h);
  s.lineTo(-w * 0.95, -h);
  return s;
}

/**
 * A cabriole leg curve. Starts at the top (near the seat rail), bulges
 * outward at the knee (~1/3 down), curves back in at the ankle, then
 * flares into the foot/toe. The curve is swept as a TubeGeometry with
 * slight thickness variation along its length so knee reads thicker.
 */
function makeCabrioleLegGeometry(outDir: [number, number]): THREE.BufferGeometry {
  const [ox, oz] = outDir; // unit vector in XZ pointing outward from chair center

  // Control points for a cubic curve, from top (y=0.4) down to floor (y=0).
  const top = new THREE.Vector3(0, 0.4, 0);
  const knee = new THREE.Vector3(ox * 0.14, 0.24, oz * 0.14);
  const ankle = new THREE.Vector3(ox * 0.02, 0.08, oz * 0.02);
  const foot = new THREE.Vector3(ox * 0.06, 0, oz * 0.06);

  const curve = new THREE.CubicBezierCurve3(top, knee, ankle, foot);

  // Tube with tapered radius — we approximate taper by building a
  // non-uniform tube: sample the curve and extrude a varying-radius ring.
  const segments = 32;
  const radiusTop = 0.028;
  const radiusKnee = 0.045;
  const radiusAnkle = 0.022;
  const radiusFoot = 0.034;

  const points = curve.getPoints(segments);
  const rings: THREE.Vector3[][] = [];
  const radialSegments = 12;

  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    // Piecewise taper: top→knee→ankle→foot
    let r: number;
    if (t < 0.33) r = THREE.MathUtils.lerp(radiusTop, radiusKnee, t / 0.33);
    else if (t < 0.66) r = THREE.MathUtils.lerp(radiusKnee, radiusAnkle, (t - 0.33) / 0.33);
    else r = THREE.MathUtils.lerp(radiusAnkle, radiusFoot, (t - 0.66) / 0.34);

    const p = points[i];
    const tangent = curve.getTangentAt(Math.min(t, 0.999)).normalize();
    // Build an orthonormal basis perpendicular to the tangent
    const up = Math.abs(tangent.y) > 0.9
      ? new THREE.Vector3(1, 0, 0)
      : new THREE.Vector3(0, 1, 0);
    const bitangent = new THREE.Vector3().crossVectors(tangent, up).normalize();
    const normal = new THREE.Vector3().crossVectors(bitangent, tangent).normalize();

    const ring: THREE.Vector3[] = [];
    for (let j = 0; j < radialSegments; j++) {
      const a = (j / radialSegments) * Math.PI * 2;
      const dir = new THREE.Vector3()
        .addScaledVector(normal, Math.cos(a) * r)
        .addScaledVector(bitangent, Math.sin(a) * r);
      ring.push(new THREE.Vector3().addVectors(p, dir));
    }
    rings.push(ring);
  }

  // Build vertices + indices
  const vertices: number[] = [];
  const indices: number[] = [];

  for (const ring of rings) {
    for (const v of ring) vertices.push(v.x, v.y, v.z);
  }
  for (let i = 0; i < segments; i++) {
    for (let j = 0; j < radialSegments; j++) {
      const a = i * radialSegments + j;
      const b = i * radialSegments + ((j + 1) % radialSegments);
      const c = (i + 1) * radialSegments + ((j + 1) % radialSegments);
      const d = (i + 1) * radialSegments + j;
      indices.push(a, b, d);
      indices.push(b, c, d);
    }
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  g.setIndex(indices);
  g.computeVertexNormals();
  return g;
}

export function SalonChair({
  position = [0, 0, 0],
  rotation = [0, 0, 0],
  velvetColor = '#7a2828',
  woodColor = '#c89a55',
  giltColor = '#d6b470',
}: Props) {
  const seatPanGeom = useMemo(() => {
    const shape = makeRoundedRect(0.62, 0.58, 0.1);
    const g = new THREE.ExtrudeGeometry(shape, {
      depth: 0.08,
      bevelEnabled: true,
      bevelThickness: 0.03,
      bevelSize: 0.03,
      bevelSegments: 4,
      curveSegments: 14,
    });
    g.rotateX(-Math.PI / 2);
    g.computeVertexNormals();
    return g;
  }, []);

  const cushionGeom = useMemo(() => {
    // Tufted velvet puff — lathed bun profile, squashed rectangular.
    const pts: THREE.Vector2[] = [];
    const steps = 22;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const angle = t * Math.PI;
      const r = Math.sin(angle) * 0.3 + 0.02;
      const y = 0.03 + (1 - Math.cos(angle)) * 0.06;
      pts.push(new THREE.Vector2(r, y));
    }
    pts.push(new THREE.Vector2(0.01, 0));
    const g = new THREE.LatheGeometry(pts, 40);
    g.scale(1.05, 1.0, 0.95);
    g.computeVertexNormals();
    return g;
  }, []);

  const backUpholsteryGeom = useMemo(() => {
    const shape = makeCartoucheShape(0.58, 0.75);
    const g = new THREE.ExtrudeGeometry(shape, {
      depth: 0.08,
      bevelEnabled: true,
      bevelThickness: 0.025,
      bevelSize: 0.025,
      bevelSegments: 4,
      curveSegments: 24,
    });
    g.computeVertexNormals();
    return g;
  }, []);

  const backFrameGeom = useMemo(() => {
    const shape = makeCartoucheShape(0.66, 0.82);
    const g = new THREE.ExtrudeGeometry(shape, {
      depth: 0.05,
      bevelEnabled: true,
      bevelThickness: 0.012,
      bevelSize: 0.018,
      bevelSegments: 3,
      curveSegments: 24,
    });
    g.computeVertexNormals();
    return g;
  }, []);

  const crestGeom = useMemo(() => {
    // Small gilt ornament at the top of the back — a half-torus flourish.
    const g = new THREE.TorusGeometry(0.1, 0.015, 12, 24, Math.PI);
    g.computeVertexNormals();
    return g;
  }, []);

  // Four cabriole legs — each points outward from center.
  const legGeoms = useMemo(() => {
    const dirs: Array<[number, number]> = [
      [-1, -1],
      [1, -1],
      [-1, 1],
      [1, 1],
    ];
    return dirs.map((d) => {
      const len = Math.hypot(d[0], d[1]);
      return makeCabrioleLegGeometry([d[0] / len, d[1] / len]);
    });
  }, []);

  const legOffsets: Array<[number, number]> = useMemo(
    () => [
      [-0.24, -0.22],
      [0.24, -0.22],
      [-0.24, 0.22],
      [0.24, 0.22],
    ],
    [],
  );

  const velvetMat = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: velvetColor,
        roughness: 0.88,
        metalness: 0.0,
      }),
    [velvetColor],
  );
  const woodMat = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: woodColor,
        roughness: 0.4,
        metalness: 0.55,
        emissive: new THREE.Color(woodColor),
        emissiveIntensity: 0.08,
      }),
    [woodColor],
  );
  const giltMat = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: giltColor,
        roughness: 0.25,
        metalness: 0.8,
        emissive: new THREE.Color(giltColor),
        emissiveIntensity: 0.15,
      }),
    [giltColor],
  );

  return (
    <group position={position} rotation={rotation}>
      {/* Four cabriole legs */}
      {legGeoms.map((g, i) => (
        <mesh
          key={`leg-${i}`}
          geometry={g}
          material={woodMat}
          position={[legOffsets[i][0], 0, legOffsets[i][1]]}
          castShadow
          receiveShadow
        />
      ))}

      {/* Seat rail — rounded rectangular pan atop the legs */}
      <mesh geometry={seatPanGeom} material={woodMat} position={[0, 0.4, 0]} castShadow receiveShadow />

      {/* Velvet cushion on the seat */}
      <mesh
        geometry={cushionGeom}
        material={velvetMat}
        position={[0, 0.48, 0]}
        castShadow
        receiveShadow
      />

      {/* Wooden back frame — cartouche silhouette */}
      <mesh
        geometry={backFrameGeom}
        material={woodMat}
        position={[0, 0.92, 0.22]}
        rotation={[0.05, 0, 0]}
        castShadow
        receiveShadow
      />

      {/* Velvet upholstery on top of the back frame */}
      <mesh
        geometry={backUpholsteryGeom}
        material={velvetMat}
        position={[0, 0.92, 0.24]}
        rotation={[0.05, 0, 0]}
        castShadow
      />

      {/* Gilt cresting flourish at the top of the back */}
      <mesh
        geometry={crestGeom}
        material={giltMat}
        position={[0, 1.32, 0.26]}
        rotation={[0.05, 0, 0]}
        castShadow
      />
    </group>
  );
}
