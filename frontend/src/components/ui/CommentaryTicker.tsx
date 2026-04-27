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
  // Active segment element — scroll into view when the playhead advances
  // to a new segment so the user's eye follows playback without manual
  // scrolling. We remember the last-auto-scrolled index so we don't fight
  // the user if they scroll back up to re-read an earlier segment.
  const activeSegRef = useRef<HTMLDivElement | null>(null);
  const lastScrolledIdxRef = useRef<number>(-1);

  function downloadCommentary() {
    if (!commentary) return;
    const lines: string[] = [];
    lines.push('# Spatium Sonorum — Commentary');
    lines.push('');
    lines.push(`Provider: ${commentary.provider}`);
    lines.push(`Model: ${commentary.model}`);
    lines.push(`Segments: ${commentary.segments.length}`);
    lines.push('');
    if (commentary.overview) {
      lines.push('## Overview');
      lines.push('');
      lines.push(commentary.overview);
      lines.push('');
    }
    if (commentary.segments.length > 0) {
      lines.push('## Segments');
      lines.push('');
      commentary.segments.forEach((s, i) => {
        lines.push(
          `### ${i + 1}. ${s.heading} (${formatTime(s.start)} – ${formatTime(s.end)})`,
        );
        lines.push('');
        lines.push(s.text);
        lines.push('');
      });
    }
    const blob = new Blob([lines.join('\n')], {
      type: 'text/markdown;charset=utf-8',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `spatium-commentary-${Date.now()}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

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

  // Compute active segment index at module scope so the auto-scroll effect
  // below can depend on it. Duplicates a bit of logic in the render path —
  // kept in sync manually.
  const segs = commentary?.segments ?? [];
  let activeIdx = segs.findIndex(
    (s) => currentTime >= s.start && currentTime < s.end,
  );
  if (activeIdx < 0) {
    for (let i = segs.length - 1; i >= 0; i--) {
      if (segs[i].start <= currentTime) {
        activeIdx = i;
        break;
      }
    }
  }

  // When the active segment changes, scroll it into view. Respect user
  // scrolling: we only auto-scroll once per index change.
  useEffect(() => {
    if (activeIdx < 0) return;
    if (lastScrolledIdxRef.current === activeIdx) return;
    lastScrolledIdxRef.current = activeIdx;
    const el = activeSegRef.current;
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, [activeIdx]);

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
    const seg = activeIdx >= 0 ? segs[activeIdx] : segs[0];
    const progress = seg
      ? Math.min(1, Math.max(0, (currentTime - seg.start) / (seg.end - seg.start)))
      : 0;

    // Total duration for the timeline minimap — use the last segment's end
    // as the piece length (tracks the actual analyzed duration better than
    // `audioEl.duration`, which can be NaN early).
    const totalDur = segs.length > 0 ? segs[segs.length - 1].end : 0;
    const playheadPct = totalDur > 0 ? (currentTime / totalDur) * 100 : 0;

    body = (
      <div className="flex flex-col gap-2.5">
        {/* Timeline minimap — each segment is a gilt tile on a track the
             width of the piece. The active tile glows; a vertical playhead
             marks the exact current time. */}
        {totalDur > 0 && (
          <div>
            <div className="flex items-baseline gap-2 mb-1">
              <div className="text-[9px] tracking-[0.3em] opacity-55">
                TIMELINE
              </div>
              <div className="text-[10px] opacity-55 font-mono ml-auto">
                {formatTime(currentTime)} / {formatTime(totalDur)}
              </div>
            </div>
            <div
              className="relative h-4 bg-[rgba(177,139,74,0.12)] rounded-sm"
              title={`Segment ${activeIdx + 1} / ${segs.length}`}
            >
              {segs.map((s, i) => {
                const leftPct = (s.start / totalDur) * 100;
                const widthPct = ((s.end - s.start) / totalDur) * 100;
                const isActive = i === activeIdx;
                return (
                  <div
                    key={i}
                    className="absolute top-0 bottom-0"
                    style={{
                      left: `${leftPct}%`,
                      width: `${widthPct}%`,
                      // Tiny gap between tiles so boundaries read.
                      padding: '0 1px',
                    }}
                    title={`${i + 1}. ${s.heading} — ${formatTime(s.start)}`}
                  >
                    <div
                      className="w-full h-full rounded-[1px]"
                      style={{
                        background: isActive
                          ? 'var(--gilt)'
                          : 'rgba(177, 139, 74, 0.35)',
                        boxShadow: isActive
                          ? '0 0 6px rgba(217, 180, 99, 0.55)'
                          : 'none',
                        opacity: isActive ? 1 : 0.55,
                        transition: 'opacity 150ms, background 150ms',
                      }}
                    />
                  </div>
                );
              })}
              {/* Playhead — a thin bright line at the current time. */}
              <div
                className="absolute top-[-2px] bottom-[-2px] w-[2px] bg-white/90"
                style={{
                  left: `${playheadPct}%`,
                  boxShadow: '0 0 4px rgba(255,255,255,0.7)',
                  transition: 'left 150ms linear',
                }}
              />
            </div>
            <div className="flex justify-between text-[9px] opacity-45 mt-0.5 font-mono">
              <span>
                {activeIdx >= 0 ? `${activeIdx + 1}` : '—'} / {segs.length}
              </span>
              <span>{seg ? `${formatTime(seg.start)} – ${formatTime(seg.end)}` : ''}</span>
            </div>
          </div>
        )}

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
        {commentary.overview && segs.length > 0 && (
          <div className="h-px bg-[rgba(177,139,74,0.25)]" />
        )}

        {/* All segments reached so far, accumulated — past segments dim,
             the active one glows and hosts the progress bar. Segments
             further in the future are hidden until the playhead arrives. */}
        {segs.length > 0 && (
          <div className="flex flex-col gap-3">
            {segs.map((s, i) => {
              if (activeIdx >= 0 && i > activeIdx) return null;
              const isActive = i === activeIdx;
              return (
                <div
                  key={i}
                  ref={isActive ? activeSegRef : null}
                  className={
                    isActive
                      ? 'border-l-2 border-[var(--gilt)] pl-3'
                      : 'border-l-2 border-[rgba(177,139,74,0.2)] pl-3 opacity-60'
                  }
                >
                  <div className="flex items-baseline gap-3 mb-1">
                    <div className="text-[9px] tracking-[0.3em] opacity-55">
                      {isActive ? 'NUNC' : `§ ${i + 1}`}
                    </div>
                    <div
                      className={
                        'display leading-tight ' +
                        (isActive ? 'text-base' : 'text-sm')
                      }
                    >
                      {s.heading}
                    </div>
                    <div className="text-[10px] opacity-55 tracking-wider font-mono ml-auto">
                      {formatTime(s.start)} – {formatTime(s.end)}
                    </div>
                  </div>
                  <div
                    className={
                      'leading-[1.55] ' +
                      (isActive
                        ? 'text-[13px] opacity-95'
                        : 'text-[12px] opacity-80')
                    }
                  >
                    {s.text}
                  </div>
                  {isActive && (
                    <div className="mt-2 h-[2px] bg-[rgba(177,139,74,0.2)]">
                      <div
                        className="h-full bg-[var(--gilt)]"
                        style={{
                          width: `${progress * 100}%`,
                          transition: 'width 150ms linear',
                        }}
                      />
                    </div>
                  )}
                </div>
              );
            })}
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
          {commentary && commentary.segments.length > 0 && (
            <button
              onClick={downloadCommentary}
              className="text-[10px] opacity-60 hover:opacity-100 ml-auto leading-none border border-[rgba(177,139,74,0.4)] rounded px-2 py-0.5"
              title="Download commentary as .md"
            >
              ↓ 내려받기
            </button>
          )}
          <button
            onClick={() => setCollapsed((c) => !c)}
            className={
              'text-[11px] opacity-60 hover:opacity-100 px-1 leading-none' +
              (commentary && commentary.segments.length > 0 ? '' : ' ml-auto')
            }
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
