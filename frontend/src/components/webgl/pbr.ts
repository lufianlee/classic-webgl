'use client';

import { useMemo } from 'react';
import { useLoader } from '@react-three/fiber';
import * as THREE from 'three';

export type TextureSetId =
  | 'medieval_blocks_03'
  | 'castle_brick_07'
  | 'wood_floor_worn'
  | 'concrete_wall_008'
  | 'large_grey_tiles';

type MapKind = 'diff' | 'nor_gl' | 'rough' | 'ao' | 'disp';

function texturePath(id: TextureSetId, map: MapKind): string {
  return `/textures/${id}/${id}_${map}_2k.jpg`;
}

export interface PBRMaterialOptions {
  repeat?: [number, number];
  color?: string;
  roughnessBoost?: number;
  metalness?: number;
  /** Ambient-occlusion map strength (0 disables sampling cost is already paid). */
  aoIntensity?: number;
  /**
   * World-unit displacement amplitude. Only meaningful on geometry with
   * enough segments to displace (e.g. a plane with 128×128 divisions) —
   * on a 1×1 plane it does nothing visible.
   */
  displacementScale?: number;
  /** Usually -displacementScale/2 so the surface stays centered. */
  displacementBias?: number;
}

/**
 * Load a Poly Haven PBR texture set at 2K: diffuse + normal + roughness +
 * ambient occlusion (+ optional height/displacement).
 *
 * `repeat` tiles the texture so it doesn't look stretched on large surfaces.
 * Anisotropy 16 keeps floors sharp at grazing angles — the single biggest
 * "photo vs. smear" difference on large walkable surfaces.
 */
export function usePBRMaterial(
  id: TextureSetId,
  options: PBRMaterialOptions = {},
): THREE.MeshStandardMaterial {
  const useDisplacement = (options.displacementScale ?? 0) !== 0;

  const [diff, normal, rough, ao, disp] = useLoader(THREE.TextureLoader, [
    texturePath(id, 'diff'),
    texturePath(id, 'nor_gl'),
    texturePath(id, 'rough'),
    texturePath(id, 'ao'),
    texturePath(id, 'disp'),
  ]);

  return useMemo(() => {
    const repeat = options.repeat ?? [4, 4];
    for (const t of [diff, normal, rough, ao, disp]) {
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.repeat.set(repeat[0], repeat[1]);
      t.anisotropy = 16;
      // aoMap samples UV channel 1 by default; our parametric geometry only
      // has channel 0, so point every map at the base UVs.
      t.channel = 0;
      t.needsUpdate = true;
    }
    diff.colorSpace = THREE.SRGBColorSpace;
    normal.colorSpace = THREE.NoColorSpace;
    rough.colorSpace = THREE.NoColorSpace;
    ao.colorSpace = THREE.NoColorSpace;
    disp.colorSpace = THREE.NoColorSpace;

    const mat = new THREE.MeshStandardMaterial({
      map: diff,
      normalMap: normal,
      roughnessMap: rough,
      aoMap: ao,
      aoMapIntensity: options.aoIntensity ?? 1.0,
      roughness: options.roughnessBoost ?? 1.0,
      metalness: options.metalness ?? 0.02,
      color: options.color ? new THREE.Color(options.color) : new THREE.Color('#ffffff'),
    });
    if (useDisplacement) {
      mat.displacementMap = disp;
      mat.displacementScale = options.displacementScale ?? 0;
      mat.displacementBias =
        options.displacementBias ?? -(options.displacementScale ?? 0) / 2;
    }
    return mat;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    diff,
    normal,
    rough,
    ao,
    disp,
    options.repeat?.[0],
    options.repeat?.[1],
    options.color,
    options.roughnessBoost,
    options.metalness,
    options.aoIntensity,
    options.displacementScale,
    options.displacementBias,
  ]);
}
