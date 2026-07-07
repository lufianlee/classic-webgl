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

// Kept at v1 across the mode/output additions and removals. The reader
// merges stored keys with DEFAULT_SETTINGS, so any fields that no longer
// exist are silently ignored and missing fields fall back to defaults.
// Bumping the key wiped live users' settings (including `enabled`), which
// made the commentary panel look like it had disappeared.
const STORAGE_KEY = 'spatium:commentary:v1';

// One-time migration marker: commentary (Bedrock 곡 해설) is opt-in now.
// Browsers that stored enabled=true before this policy get reset to off
// exactly once; re-enabling afterwards sticks as usual.
const DEFAULT_OFF_MIGRATION_KEY = 'spatium:commentary:default-off:v1';

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
    if (!raw) {
      // Nothing stored yet — defaults are already off; just mark the
      // migration done so a later explicit enable isn't reset.
      window.localStorage.setItem(DEFAULT_OFF_MIGRATION_KEY, '1');
      return DEFAULT_SETTINGS;
    }
    const parsed = JSON.parse(raw) as Partial<CommentarySettings>;
    const merged = { ...DEFAULT_SETTINGS, ...parsed };
    if (!window.localStorage.getItem(DEFAULT_OFF_MIGRATION_KEY)) {
      merged.enabled = false;
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
      window.localStorage.setItem(DEFAULT_OFF_MIGRATION_KEY, '1');
    }
    return merged;
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
        window.localStorage.setItem(DEFAULT_OFF_MIGRATION_KEY, '1');
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
