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

function texturePath(id: TextureSetId, map: 'diff' | 'nor_gl' | 'rough'): string {
  return `/textures/${id}/${id}_${map}_1k.jpg`;
}

/**
 * Load a Poly Haven PBR texture set (diffuse + normal + roughness).
 *
 * `repeat` tiles the texture so it doesn't look stretched on large surfaces.
 * `anisotropy` sharpens oblique viewing angles (floors seen at a grazing
 * angle) — without it the floor blurs into mush near the horizon.
 */
export function usePBRMaterial(
  id: TextureSetId,
  options: {
    repeat?: [number, number];
    color?: string;
    roughnessBoost?: number;
    metalness?: number;
  } = {},
): THREE.MeshStandardMaterial {
  const [diff, normal, rough] = useLoader(THREE.TextureLoader, [
    texturePath(id, 'diff'),
    texturePath(id, 'nor_gl'),
    texturePath(id, 'rough'),
  ]);

  return useMemo(() => {
    const repeat = options.repeat ?? [4, 4];
    for (const t of [diff, normal, rough]) {
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.repeat.set(repeat[0], repeat[1]);
      t.anisotropy = 8;
    }
    diff.colorSpace = THREE.SRGBColorSpace;
    normal.colorSpace = THREE.NoColorSpace;
    rough.colorSpace = THREE.NoColorSpace;

    const mat = new THREE.MeshStandardMaterial({
      map: diff,
      normalMap: normal,
      roughnessMap: rough,
      roughness: (options.roughnessBoost ?? 1.0),
      metalness: options.metalness ?? 0.02,
      color: options.color ? new THREE.Color(options.color) : new THREE.Color('#ffffff'),
    });
    return mat;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [diff, normal, rough, options.repeat?.[0], options.repeat?.[1], options.color, options.roughnessBoost, options.metalness]);
}
