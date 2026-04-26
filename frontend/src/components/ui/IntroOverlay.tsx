'use client';

import { useRef, useState } from 'react';
import type { SpacePreset } from '@/lib/api';
import { analyzeUpload, analyzeUrl, requestCommentary } from '@/lib/api';
import { useAppStore } from '@/lib/store';
import { apiKeyFor, useCommentarySettings } from '@/lib/commentarySettings';
import { CommentarySettings } from './CommentarySettings';

function validateAudioUrl(value: string): { ok: true } | { ok: false; reason: string } {
  if (!value) {
    return { ok: false, reason: 'Please paste a direct audio URL.' };
  }
  if (value.length > 2000) {
    return {
      ok: false,
      reason: `That doesn't look like a URL (${value.length} chars). Paste only the audio link.`,
    };
  }
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return { ok: false, reason: 'Not a valid URL. Example: https://.../track.mp3' };
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { ok: false, reason: 'URL must start with http:// or https://' };
  }
  if (/\s/.test(value)) {
    return { ok: false, reason: 'URL cannot contain spaces or line breaks.' };
  }
  return { ok: true };
}

const PRESETS: { value: SpacePreset; label: string; hint: string }[] = [
  { value: 'cathedral', label: 'Cathedral', hint: 'Vast nave, long reverb (~4.5s)' },
  { value: 'concert_hall', label: 'Concert Hall', hint: 'Shoebox hall (~1.8s)' },
  { value: 'salon', label: 'Salon', hint: 'Intimate chamber (~0.6s)' },
];

interface Props {
  onEnterUrl: (url: string) => void | Promise<void>;
  /** Called with a blob: URL ready to feed <audio>.src after upload analysis. */
  onEnterUpload: (blobUrl: string) => void | Promise<void>;
}

type Source = { kind: 'url' } | { kind: 'file' };

export function IntroOverlay({ onEnterUrl, onEnterUpload }: Props) {
  const [source, setSource] = useState<Source>({ kind: 'url' });
  const [url, setUrl] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const loadingStatus = useAppStore((s) => s.loadingStatus);
  const errorMessage = useAppStore((s) => s.errorMessage);
  const preset = useAppStore((s) => s.preset);

  const setAnalysis = useAppStore((s) => s.setAnalysis);
  const setPreset = useAppStore((s) => s.setPreset);
  const setLoadingStatus = useAppStore((s) => s.setLoadingStatus);
  const setErrorMessage = useAppStore((s) => s.setErrorMessage);
  const setCommentary = useAppStore((s) => s.setCommentary);
  const setCommentaryStatus = useAppStore((s) => s.setCommentaryStatus);
  const setCommentaryError = useAppStore((s) => s.setCommentaryError);

  const { settings: commentarySettings } = useCommentarySettings();

  const busy = loadingStatus === 'fetching' || loadingStatus === 'analyzing';

  async function submit() {
    setErrorMessage(null);
    setCommentary(null);
    setCommentaryError(null);
    setCommentaryStatus('idle');
    try {
      if (source.kind === 'url') {
        const trimmed = url.trim();
        const validation = validateAudioUrl(trimmed);
        if (!validation.ok) {
          setErrorMessage(validation.reason);
          return;
        }
        setLoadingStatus('fetching');
        setLoadingStatus('analyzing');
        const result = await analyzeUrl(trimmed);
        setAnalysis(result);
        setLoadingStatus('ready');
        kickCommentary({ url: trimmed });
        await onEnterUrl(trimmed);
      } else {
        if (!file) {
          setErrorMessage('Please choose an audio file.');
          return;
        }
        setLoadingStatus('analyzing');
        const [result, blobUrl] = await Promise.all([
          analyzeUpload(file),
          Promise.resolve(URL.createObjectURL(file)),
        ]);
        setAnalysis(result);
        setLoadingStatus('ready');
        if (result.upload_hash) kickCommentary({ uploadHash: result.upload_hash });
        await onEnterUpload(blobUrl);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Unknown error';
      setErrorMessage(msg);
      setLoadingStatus('error');
    }
  }

  /** Fire-and-forget commentary request. Silent no-op if disabled. */
  function kickCommentary(source: { url?: string; uploadHash?: string }) {
    if (!commentarySettings.enabled) return;
    setCommentaryStatus('loading');
    setCommentaryError(null);
    requestCommentary({
      url: source.url,
      uploadHash: source.uploadHash,
      provider: commentarySettings.provider,
      model: commentarySettings.model || undefined,
      language: commentarySettings.language,
      apiKey: apiKeyFor(commentarySettings),
    })
      .then((c) => {
        setCommentary(c);
        setCommentaryStatus('ready');
      })
      .catch((e: Error) => {
        setCommentaryError(e.message);
        setCommentaryStatus('error');
      });
  }

  return (
    <div className="fixed inset-0 z-20 flex items-center justify-center bg-[#05060a]/95">
      <div className="parchment-panel max-w-xl w-full mx-4 p-10">
        <div className="text-center mb-8">
          <div className="text-[11px] tracking-[0.35em] opacity-60 mb-2">
            EST. MMXXVI · A WEBGL JOURNEY
          </div>
          <h1 className="display text-4xl md:text-5xl text-parchment">Spatium Sonorum</h1>
          <div className="gilt-underline w-40 mx-auto mt-3 mb-3" />
          <p className="italic text-sm md:text-base opacity-80 leading-relaxed">
            Bring a classical recording. Choose a space. Walk through the music.
          </p>
        </div>

        {/* Source tabs */}
        <div className="flex gap-1 mb-4 justify-center">
          {(['url', 'file'] as const).map((k) => (
            <button
              key={k}
              className="gilt-btn"
              onClick={() => setSource({ kind: k })}
              style={{
                opacity: source.kind === k ? 1 : 0.55,
                borderColor:
                  source.kind === k ? 'var(--gilt)' : 'rgba(177, 139, 74, 0.35)',
              }}
              disabled={busy}
            >
              {k === 'url' ? 'Paste URL' : 'Upload File'}
            </button>
          ))}
        </div>

        {/* URL input */}
        {source.kind === 'url' && (
          <div className="mb-6">
            <label className="block text-[10px] uppercase tracking-[0.3em] opacity-60 mb-2">
              Audio URL (.mp3 / .wav / .ogg / .flac)
            </label>
            <input
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !busy) submit();
              }}
              placeholder="https://…"
              className="w-full"
              disabled={busy}
              autoFocus
            />
          </div>
        )}

        {/* File upload */}
        {source.kind === 'file' && (
          <div className="mb-6">
            <label className="block text-[10px] uppercase tracking-[0.3em] opacity-60 mb-2">
              Audio file (.mp3 / .wav / .ogg / .flac / .m4a)
            </label>
            <div className="flex gap-2 items-center">
              <button
                className="gilt-btn"
                onClick={() => fileInputRef.current?.click()}
                disabled={busy}
              >
                Choose file…
              </button>
              <div className="text-xs opacity-75 flex-1 truncate">
                {file ? `${file.name} · ${(file.size / 1024 / 1024).toFixed(1)} MB` : 'no file chosen'}
              </div>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept=".mp3,.wav,.ogg,.flac,.m4a,audio/*"
              className="hidden"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
          </div>
        )}

        {/* Space picker */}
        <div className="mb-6">
          <label className="block text-[10px] uppercase tracking-[0.3em] opacity-60 mb-2">
            Space
          </label>
          <div className="grid grid-cols-3 gap-2">
            {PRESETS.map((p) => (
              <button
                key={p.value}
                className="gilt-btn w-full"
                onClick={() => setPreset(p.value)}
                style={{
                  opacity: preset === p.value ? 1 : 0.55,
                  borderColor:
                    preset === p.value ? 'var(--gilt)' : 'rgba(177, 139, 74, 0.35)',
                }}
                title={p.hint}
                disabled={busy}
              >
                {p.label}
              </button>
            ))}
          </div>
          <p className="text-[11px] opacity-55 mt-2 text-center">
            {PRESETS.find((p) => p.value === preset)?.hint}
          </p>
        </div>

        <CommentarySettings busy={busy} />

        <button
          className="gilt-btn w-full mt-2 text-base py-3"
          onClick={submit}
          disabled={
            busy || (source.kind === 'url' ? !url.trim() : !file)
          }
        >
          {busy ? '…' : 'Enter the Space'}
        </button>

        <div className="mt-5 text-center text-xs opacity-70 min-h-[1.25rem]">
          {loadingStatus === 'fetching' && 'Fetching recording…'}
          {loadingStatus === 'analyzing' && 'Analyzing tempo, key, and spectrum…'}
          {loadingStatus === 'error' && errorMessage && (
            <span className="text-oxblood">{errorMessage}</span>
          )}
        </div>
      </div>
    </div>
  );
}
