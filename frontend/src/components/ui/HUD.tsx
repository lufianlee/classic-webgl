'use client';

import { useState } from 'react';
import { useAppStore } from '@/lib/store';
import type { SpacePreset } from '@/lib/api';
import type { RealtimeFeatures } from '@/lib/realtime';
import { PITCH_CLASSES } from '@/lib/realtime';
import { QUALITY_PROFILES, type QualityTier } from '@/lib/quality';

function FoldToggle({
  collapsed,
  onToggle,
}: {
  collapsed: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      onClick={onToggle}
      className="text-[11px] opacity-60 hover:opacity-100 px-1 leading-none"
      title={collapsed ? 'expand' : 'collapse'}
    >
      {collapsed ? '▸' : '▾'}
    </button>
  );
}

interface Props {
  features: RealtimeFeatures;
  fallbackKey: string;
  fallbackMode: 'major' | 'minor';
  fallbackTempo: number;
  durationSec: number;
  onTogglePlay: () => void;
  onChangePreset: (p: SpacePreset) => void;
  onExit: () => void;
}

const PRESET_LABELS: Record<SpacePreset, string> = {
  cathedral: 'Cathedral',
  concert_hall: 'Concert Hall',
  salon: 'Salon',
};

export function HUD({
  features,
  fallbackKey,
  fallbackMode,
  fallbackTempo,
  durationSec,
  onTogglePlay,
  onChangePreset,
  onExit,
}: Props) {
  const isPlaying = useAppStore((s) => s.isPlaying);
  const preset = useAppStore((s) => s.preset);
  const quality = useAppStore((s) => s.quality);
  const setQuality = useAppStore((s) => s.setQuality);

  const [liveCollapsed, setLiveCollapsed] = useState(false);
  const [spaceCollapsed, setSpaceCollapsed] = useState(false);
  const [qualityCollapsed, setQualityCollapsed] = useState(false);
  const [transportCollapsed, setTransportCollapsed] = useState(false);

  const liveKey = features.keyConfidence > 0.1 ? features.key : fallbackKey;
  const liveMode = features.keyConfidence > 0.1 ? features.mode : fallbackMode;
  const liveBpm = features.bpm > 0 ? features.bpm : Math.round(fallbackTempo);

  return (
    <>
      {/* Top-left: live metadata + chroma strip */}
      <div className="hud-corner top-6 left-6 max-w-sm">
        <div className="parchment-panel px-5 py-4">
          <div className="flex items-center gap-2 mb-1">
            <div className="text-[10px] tracking-[0.3em] opacity-60">LIVE ANALYSIS</div>
            <div className="ml-auto">
              <FoldToggle
                collapsed={liveCollapsed}
                onToggle={() => setLiveCollapsed((c) => !c)}
              />
            </div>
          </div>
          {!liveCollapsed && (
          <>
          <div className="gilt-underline w-full my-2" />
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[13px] items-baseline">
            <dt className="opacity-60">Key</dt>
            <dd>
              <span className="display text-lg">{liveKey}</span>{' '}
              <span className="opacity-70 text-xs">{liveMode}</span>
              <span className="opacity-45 text-[11px] ml-2">
                {Math.round((features.keyConfidence || 0) * 100)}%
              </span>
            </dd>
            <dt className="opacity-60">Tempo</dt>
            <dd>
              <span className="display text-lg">{liveBpm > 0 ? liveBpm : '—'}</span>{' '}
              <span className="opacity-70 text-xs">bpm</span>
              {features.bpm === 0 && (
                <span className="opacity-45 text-[11px] ml-2">avg</span>
              )}
            </dd>
            <dt className="opacity-60">Length</dt>
            <dd className="text-sm">{formatTime(durationSec)}</dd>
          </dl>

          {/* 12-bin chroma strip */}
          <div className="mt-3">
            <div className="text-[9px] tracking-[0.25em] opacity-55 mb-1">CHROMA</div>
            <div className="flex gap-[2px] h-6 items-end">
              {features.chroma.map((v, i) => {
                const active = PITCH_CLASSES[i] === liveKey;
                return (
                  <div
                    key={i}
                    className="flex-1 origin-bottom transition-[height,opacity] duration-200"
                    style={{
                      height: `${Math.max(6, Math.round(v * 100))}%`,
                      background: active ? 'var(--gilt)' : 'rgba(233, 223, 199, 0.55)',
                      opacity: active ? 1 : 0.5 + v * 0.5,
                    }}
                    title={PITCH_CLASSES[i]}
                  />
                );
              })}
            </div>
            <div className="flex gap-[2px] mt-0.5 text-[8px] opacity-55 font-mono">
              {PITCH_CLASSES.map((p) => (
                <div key={p} className="flex-1 text-center">
                  {p}
                </div>
              ))}
            </div>
          </div>
          </>
          )}
        </div>
      </div>

      {/* Top-right: space picker + quality selector */}
      <div className="hud-corner top-6 right-6 flex flex-col gap-3">
        <div className="parchment-panel px-4 py-3">
          <div className="flex items-center gap-2 mb-2">
            <div className="text-[10px] tracking-[0.3em] opacity-60">SPACE</div>
            <div className="ml-auto">
              <FoldToggle
                collapsed={spaceCollapsed}
                onToggle={() => setSpaceCollapsed((c) => !c)}
              />
            </div>
          </div>
          {!spaceCollapsed && (
            <div className="flex flex-col gap-1.5">
              {(Object.keys(PRESET_LABELS) as SpacePreset[]).map((p) => (
                <button
                  key={p}
                  className="gilt-btn text-left"
                  onClick={() => onChangePreset(p)}
                  style={{
                    opacity: preset === p ? 1 : 0.55,
                    borderColor:
                      preset === p ? 'var(--gilt)' : 'rgba(177, 139, 74, 0.35)',
                  }}
                >
                  {PRESET_LABELS[p]}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Render quality tier — persisted across reloads. Exhibition mode
            turns on the full cinematic pipeline; Performance drops to a
            1.0 DPR / no-AO pipeline for integrated GPUs. */}
        <div className="parchment-panel px-4 py-3">
          <div className="flex items-center gap-2 mb-2">
            <div className="text-[10px] tracking-[0.3em] opacity-60">
              QUALITY
            </div>
            <div className="ml-auto">
              <FoldToggle
                collapsed={qualityCollapsed}
                onToggle={() => setQualityCollapsed((c) => !c)}
              />
            </div>
          </div>
          {!qualityCollapsed && (
            <div className="flex flex-col gap-1.5">
              {(Object.keys(QUALITY_PROFILES) as QualityTier[]).map((q) => {
                const p = QUALITY_PROFILES[q];
                return (
                  <button
                    key={q}
                    className="gilt-btn text-left"
                    onClick={() => setQuality(q)}
                    title={p.description}
                    style={{
                      opacity: quality === q ? 1 : 0.55,
                      borderColor:
                        quality === q
                          ? 'var(--gilt)'
                          : 'rgba(177, 139, 74, 0.35)',
                    }}
                  >
                    {p.label}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Bottom-center: transport */}
      <div
        className="hud-corner"
        style={{ bottom: '1.5rem', left: '50%', transform: 'translateX(-50%)' }}
      >
        <div className="parchment-panel flex items-center gap-4 px-6 py-3">
          <button className="gilt-btn" onClick={onTogglePlay}>
            {isPlaying ? '‖  Pause' : '▶  Play'}
          </button>
          {!transportCollapsed && (
            <div className="text-[11px] opacity-70 leading-snug">
              Click the scene to walk &nbsp;·&nbsp; W A S D &nbsp;·&nbsp; Mouse to look &nbsp;·&nbsp;
              ESC to free cursor
            </div>
          )}
          <button className="gilt-btn" onClick={onExit}>
            Exit
          </button>
          <FoldToggle
            collapsed={transportCollapsed}
            onToggle={() => setTransportCollapsed((c) => !c)}
          />
        </div>
      </div>
    </>
  );
}

function formatTime(sec: number): string {
  if (!isFinite(sec) || sec <= 0) return '—';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}
