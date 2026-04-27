'use client';

import { useEffect, useRef, useState } from 'react';
import { useAppStore } from '@/lib/store';

/**
 * Live commentary ticker: watches <audio>.currentTime and highlights the
 * segment that covers it. Fades between segments and shows a tiny progress
 * bar for the current segment.
 */
export function CommentaryTicker({ audioEl }: { audioEl: HTMLAudioElement | null }) {
  const commentary = useAppStore((s) => s.commentary);
  const status = useAppStore((s) => s.commentaryStatus);
  const error = useAppStore((s) => s.commentaryError);
  const [currentTime, setCurrentTime] = useState(0);
  const [collapsed, setCollapsed] = useState(false);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (!audioEl) return;
    const tick = () => {
      setCurrentTime(audioEl.currentTime);
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [audioEl]);

  // Render nothing if commentary is off and there's no in-flight request.
  if (status === 'idle' && !commentary && !error) return null;

  let body: React.ReactNode = null;

  if (status === 'loading') {
    body = (
      <div className="italic opacity-75 text-sm">
        The commentator is listening to the piece… (LLM analysis in progress)
      </div>
    );
  } else if (status === 'error') {
    body = (
      <div className="text-sm text-oxblood">
        Commentary failed: {error ?? 'unknown error'}
      </div>
    );
  } else if (commentary) {
    const segs = commentary.segments;
    const active = segs.find((s) => currentTime >= s.start && currentTime < s.end);
    const fallback = segs[0];
    const seg = active ?? fallback;
    const progress = seg
      ? Math.min(1, Math.max(0, (currentTime - seg.start) / (seg.end - seg.start)))
      : 0;
    body = (
      <div className="flex flex-col gap-2.5">
        {/* Overall overview — always visible, sets the frame for the live segment */}
        {commentary.overview && (
          <div>
            <div className="flex items-baseline gap-2 mb-1">
              <div className="text-[9px] tracking-[0.3em] opacity-55">
                OVERVIEW
              </div>
              <div className="text-[10px] opacity-40 ml-auto">
                {commentary.provider} · {commentary.model}
              </div>
            </div>
            <div className="text-[12px] leading-[1.55] opacity-85 italic">
              {commentary.overview}
            </div>
          </div>
        )}

        {/* Divider */}
        {commentary.overview && seg && (
          <div className="h-px bg-[rgba(177,139,74,0.25)]" />
        )}

        {/* Live segment — changes with playback time */}
        {seg && (
          <div>
            <div className="flex items-baseline gap-3 mb-1">
              <div className="text-[9px] tracking-[0.3em] opacity-55">
                NUNC
              </div>
              <div className="display text-base leading-tight">
                {seg.heading}
              </div>
              <div className="text-[10px] opacity-55 tracking-wider font-mono ml-auto">
                {formatTime(seg.start)} – {formatTime(seg.end)}
              </div>
            </div>
            <div className="text-[13px] leading-[1.55] opacity-95">
              {seg.text}
            </div>
            <div className="mt-2 h-[2px] bg-[rgba(177,139,74,0.2)]">
              <div
                className="h-full bg-[var(--gilt)]"
                style={{ width: `${progress * 100}%`, transition: 'width 150ms linear' }}
              />
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div
      className="hud-corner"
      style={{
        bottom: '6.5rem',
        left: '50%',
        transform: 'translateX(-50%)',
        maxWidth: 'min(780px, 92vw)',
        width: '100%',
      }}
    >
      <div className="parchment-panel px-5 py-3">
        <div className="flex items-center gap-2 mb-1">
          <div className="text-[10px] tracking-[0.3em] opacity-55">
            COMMENTARIUS
          </div>
          <button
            onClick={() => setCollapsed((c) => !c)}
            className="text-[11px] opacity-60 hover:opacity-100 px-1 ml-auto leading-none"
            title={collapsed ? 'expand' : 'collapse'}
          >
            {collapsed ? '▸' : '▾'}
          </button>
        </div>
        {!collapsed && (
          <div className="overflow-y-auto pr-1" style={{ maxHeight: '38vh' }}>
            {body}
          </div>
        )}
      </div>
    </div>
  );
}

function formatTime(sec: number): string {
  if (!isFinite(sec) || sec < 0) return '—';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}
