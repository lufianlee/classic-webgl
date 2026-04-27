'use client';

import { useEffect, useState } from 'react';
import type { CommentaryProvider } from './api';

export interface CommentarySettings {
  enabled: boolean;
  provider: CommentaryProvider;
  model: string; // empty = use server default
  language: string; // e.g. 'ko', 'en'
  anthropicKey: string;
  openaiKey: string;
}

// Bumped to v4 because we dropped the `output` field alongside image gen.
// Older payloads (v1/v2/v3) still merge cleanly with DEFAULT_SETTINGS; any
// extra keys they carry are simply ignored.
const STORAGE_KEY = 'spatium:commentary:v4';

const DEFAULT_SETTINGS: CommentarySettings = {
  enabled: false,
  provider: 'bedrock',
  model: '',
  language: 'ko',
  anthropicKey: '',
  openaiKey: '',
};

function readStorage(): CommentarySettings {
  if (typeof window === 'undefined') return DEFAULT_SETTINGS;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<CommentarySettings>;
    return { ...DEFAULT_SETTINGS, ...parsed };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

/**
 * Persist commentary settings (provider, model, keys, language) to localStorage.
 * Keys are stored in the browser only — never sent anywhere except the
 * request body of /api/commentary (which routes them to the chosen vendor).
 */
export function useCommentarySettings(): {
  settings: CommentarySettings;
  update: (partial: Partial<CommentarySettings>) => void;
} {
  const [settings, setSettings] = useState<CommentarySettings>(DEFAULT_SETTINGS);

  useEffect(() => {
    setSettings(readStorage());
  }, []);

  function update(partial: Partial<CommentarySettings>) {
    setSettings((prev) => {
      const next = { ...prev, ...partial };
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch {
        // ignore quota / private-mode errors
      }
      return next;
    });
  }

  return { settings, update };
}

/** Pick the right API key for the chosen provider, if any. */
export function apiKeyFor(settings: CommentarySettings): string | undefined {
  if (settings.provider === 'anthropic') return settings.anthropicKey || undefined;
  if (settings.provider === 'openai') return settings.openaiKey || undefined;
  return undefined;
}
