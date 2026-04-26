'use client';

import { useEffect, useRef, useState } from 'react';
import type { AudioEngine } from './audio';
import { RealtimeAnalyzer, type RealtimeFeatures } from './realtime';

/**
 * Polls the engine's real-time analyzer on a rAF loop and returns the
 * latest features. Throttled UI updates to ~10 Hz to avoid re-renders at
 * display frame rate; the WebGL scene reads features via `getLatest()`
 * ref directly each frame, bypassing React.
 */
export function useRealtimeFeatures(engine: AudioEngine | null): {
  features: RealtimeFeatures;
  getLatest: () => RealtimeFeatures;
} {
  const latestRef = useRef<RealtimeFeatures>(RealtimeAnalyzer.empty());
  const [features, setFeatures] = useState<RealtimeFeatures>(RealtimeAnalyzer.empty());

  useEffect(() => {
    if (!engine) return;
    let raf = 0;
    let lastUi = 0;

    const tick = () => {
      const now = performance.now() / 1000;
      const f = engine.sampleRealtime(now);
      latestRef.current = f;
      if (now - lastUi > 0.1) {
        lastUi = now;
        setFeatures(f);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [engine]);

  return {
    features,
    getLatest: () => latestRef.current,
  };
}
