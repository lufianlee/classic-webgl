'use client';

import { useEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { useAppStore } from '@/lib/store';
import { AudioEngine } from '@/lib/audio';
import { streamUrl } from '@/lib/api';
import { useRealtimeFeatures } from '@/lib/useRealtimeFeatures';
import { IntroOverlay } from '@/components/ui/IntroOverlay';
import { HUD } from '@/components/ui/HUD';
import { CommentaryTicker } from '@/components/ui/CommentaryTicker';

const SpatialScene = dynamic(
  () => import('@/components/webgl/SpatialScene').then((m) => m.SpatialScene),
  { ssr: false },
);

export default function Page() {
  const analysis = useAppStore((s) => s.analysis);
  const preset = useAppStore((s) => s.preset);
  const setIsPlaying = useAppStore((s) => s.setIsPlaying);
  const setPreset = useAppStore((s) => s.setPreset);
  const reset = useAppStore((s) => s.reset);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const engineRef = useRef<AudioEngine | null>(null);
  const [engine, setEngine] = useState<AudioEngine | null>(null);
  const [audioSrc, setAudioSrc] = useState<string | null>(null);

  const { features, getLatest } = useRealtimeFeatures(engine);

  useEffect(() => {
    if (engine) engine.setPreset(preset);
  }, [preset, engine]);

  function ensureEngine(): AudioEngine | null {
    if (!audioRef.current) return null;
    if (!engineRef.current) {
      engineRef.current = new AudioEngine(audioRef.current);
      engineRef.current.setPreset(preset);
      setEngine(engineRef.current);
    }
    return engineRef.current;
  }

  async function startPlayback(src: string) {
    const el = audioRef.current;
    if (!el) return;

    el.src = src;
    setAudioSrc(src);
    el.load();

    const e = ensureEngine();
    if (!e) return;
    await e.ensureStarted();

    await new Promise<void>((resolve) => {
      if (el.readyState >= 3) return resolve();
      const done = () => {
        el.removeEventListener('canplay', done);
        el.removeEventListener('error', done);
        resolve();
      };
      el.addEventListener('canplay', done, { once: true });
      el.addEventListener('error', done, { once: true });
    });

    try {
      await el.play();
      setIsPlaying(true);
    } catch (err) {
      console.warn('Autoplay blocked — press Play in the HUD to start.', err);
      setIsPlaying(false);
    }
  }

  async function handleEnterUrl(sourceUrl: string) {
    await startPlayback(streamUrl(sourceUrl));
  }

  async function handleEnterUploadedBlob(blobUrl: string) {
    // For uploads we already have the raw bytes on the client (as a blob URL);
    // no need to go through the backend stream endpoint for playback.
    await startPlayback(blobUrl);
  }

  async function togglePlay() {
    const el = audioRef.current;
    if (!el) return;
    const e = ensureEngine();
    if (e) await e.ensureStarted();
    if (el.paused) {
      try {
        await el.play();
        setIsPlaying(true);
      } catch (err) {
        // Most common cause: autoplay policy. A user gesture click on the
        // Play button should resolve this on the next try — log the real
        // error so it's at least visible in the console.
        console.error('audio.play() rejected:', err);
        setIsPlaying(false);
      }
    } else {
      el.pause();
      setIsPlaying(false);
    }
  }

  function handleExit() {
    audioRef.current?.pause();
    if (audioSrc && audioSrc.startsWith('blob:')) URL.revokeObjectURL(audioSrc);
    setAudioSrc(null);
    if (engineRef.current) {
      engineRef.current.dispose();
      engineRef.current = null;
      setEngine(null);
    }
    reset();
  }

  return (
    <main className="relative w-full h-full">
      <audio
        ref={audioRef}
        crossOrigin="anonymous"
        onEnded={() => setIsPlaying(false)}
        onPause={() => setIsPlaying(false)}
        onPlay={() => setIsPlaying(true)}
      />

      {analysis ? (
        <>
          <SpatialScene
            engine={engine}
            preset={preset}
            getRealtime={getLatest}
            features={features}
            fallbackKey={analysis.key}
            fallbackMode={analysis.mode}
          />
          <HUD
            features={features}
            fallbackKey={analysis.key}
            fallbackMode={analysis.mode}
            fallbackTempo={analysis.tempo}
            durationSec={analysis.duration}
            onTogglePlay={togglePlay}
            onChangePreset={setPreset}
            onExit={handleExit}
          />
          <CommentaryTicker audioEl={audioRef.current} />
        </>
      ) : (
        <IntroOverlay
          onEnterUrl={handleEnterUrl}
          onEnterUpload={handleEnterUploadedBlob}
        />
      )}
    </main>
  );
}
