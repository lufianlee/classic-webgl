'use client';

import { useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import type { AudioEngine } from '@/lib/audio';
import type { RealtimeFeatures } from '@/lib/realtime';

/**
 * WASD + mouse-look with pointer lock.
 *   - Walking speed is modulated by the *live* BPM (reacts to tempo changes).
 *   - Bass RMS adds a subtle head-bob.
 *   - Camera is clamped to the space's walk radius.
 */

interface Props {
  engine: AudioEngine | null;
  getRealtime: () => RealtimeFeatures;
  bounds: number;
}

const BASE_SPEED = 5.2; // units/sec at 120 BPM
const EYE_HEIGHT = 1.7;

export function WalkControls({ engine, getRealtime, bounds }: Props) {
  const { camera, gl } = useThree();
  const keys = useRef<Record<string, boolean>>({});
  const yaw = useRef(0);
  const pitch = useRef(0);
  const locked = useRef(false);
  const bobPhase = useRef(0);

  useEffect(() => {
    // Start roughly at the back of the room, looking forward.
    camera.position.set(0, EYE_HEIGHT, Math.min(bounds - 2, 12));
    camera.lookAt(0, EYE_HEIGHT, 0);
    yaw.current = 0;
    pitch.current = 0;
  }, [camera, bounds]);

  useEffect(() => {
    const canvas = gl.domElement;

    function onKeyDown(e: KeyboardEvent) {
      keys.current[e.code] = true;
    }
    function onKeyUp(e: KeyboardEvent) {
      keys.current[e.code] = false;
    }
    function onClick() {
      if (!locked.current) canvas.requestPointerLock();
    }
    function onLockChange() {
      locked.current = document.pointerLockElement === canvas;
    }
    function onMouseMove(e: MouseEvent) {
      if (!locked.current) return;
      yaw.current -= e.movementX * 0.0022;
      pitch.current -= e.movementY * 0.0022;
      pitch.current = Math.max(
        -Math.PI / 2 + 0.05,
        Math.min(Math.PI / 2 - 0.05, pitch.current),
      );
    }

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    canvas.addEventListener('click', onClick);
    document.addEventListener('pointerlockchange', onLockChange);
    document.addEventListener('mousemove', onMouseMove);

    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      canvas.removeEventListener('click', onClick);
      document.removeEventListener('pointerlockchange', onLockChange);
      document.removeEventListener('mousemove', onMouseMove);
    };
  }, [gl]);

  useFrame((_, delta) => {
    const rt = getRealtime();
    const bpm = rt.bpm;
    const tempoScale = bpm > 0 ? Math.min(1.6, Math.max(0.55, bpm / 120)) : 1;
    const speed = BASE_SPEED * tempoScale;

    const forward = new THREE.Vector3(-Math.sin(yaw.current), 0, -Math.cos(yaw.current));
    const right = new THREE.Vector3(Math.cos(yaw.current), 0, -Math.sin(yaw.current));

    const move = new THREE.Vector3();
    if (keys.current['KeyW'] || keys.current['ArrowUp']) move.add(forward);
    if (keys.current['KeyS'] || keys.current['ArrowDown']) move.sub(forward);
    if (keys.current['KeyD'] || keys.current['ArrowRight']) move.add(right);
    if (keys.current['KeyA'] || keys.current['ArrowLeft']) move.sub(right);
    if (move.lengthSq() > 0) move.normalize().multiplyScalar(speed * delta);
    camera.position.add(move);

    // Clamp within walk bounds — circle, with a small inset for walls.
    const r = Math.hypot(camera.position.x, camera.position.z);
    const rmax = bounds;
    if (r > rmax) {
      camera.position.x *= rmax / r;
      camera.position.z *= rmax / r;
    }

    // Head-bob derived from live RMS (louder passages → stronger bob).
    let bob = 0;
    if (engine) {
      const f = engine.sample();
      bobPhase.current += delta * (2 + f.bassLevel * 4);
      bob = Math.sin(bobPhase.current) * (0.03 + f.bassLevel * 0.06);
    }
    camera.position.y = EYE_HEIGHT + bob;

    const quat = new THREE.Quaternion();
    quat.setFromEuler(new THREE.Euler(pitch.current, yaw.current, 0, 'YXZ'));
    camera.quaternion.copy(quat);

    // Feed the listener's world position + forward vector to the audio
    // graph so the PannerNode spatializes the dry signal correctly.
    if (engine) {
      engine.setListener(
        [camera.position.x, camera.position.y, camera.position.z],
        [-Math.sin(yaw.current), 0, -Math.cos(yaw.current)],
      );
    }
  });

  return null;
}
