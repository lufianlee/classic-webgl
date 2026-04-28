import { create } from 'zustand';
import type { AnalysisResult, CommentaryResponse, SpacePreset } from './api';
import { DEFAULT_QUALITY, QUALITY_PROFILES, type QualityTier } from './quality';

type CommentaryStatus = 'idle' | 'loading' | 'ready' | 'error';

const QUALITY_STORAGE_KEY = 'spatium:quality';

function loadPersistedQuality(): QualityTier {
  if (typeof window === 'undefined') return DEFAULT_QUALITY;
  try {
    const v = window.localStorage.getItem(QUALITY_STORAGE_KEY);
    if (v && v in QUALITY_PROFILES) return v as QualityTier;
  } catch {
    // localStorage blocked (private mode / embedded browser) — fall through.
  }
  return DEFAULT_QUALITY;
}

function persistQuality(q: QualityTier): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(QUALITY_STORAGE_KEY, q);
  } catch {
    // swallow — persisting is best-effort.
  }
}

interface AppState {
  analysis: AnalysisResult | null;
  audioUrl: string | null; // blob: URL used by <audio> for playback
  preset: SpacePreset;
  isPlaying: boolean;
  loadingStatus: 'idle' | 'fetching' | 'analyzing' | 'ready' | 'error';
  errorMessage: string | null;

  // Rendering quality tier — persisted to localStorage so exhibition PCs keep
  // the setting across reloads.
  quality: QualityTier;

  // Commentary
  commentary: CommentaryResponse | null;
  commentaryStatus: CommentaryStatus;
  commentaryError: string | null;

  setAnalysis: (a: AnalysisResult | null) => void;
  setAudioUrl: (u: string | null) => void;
  setPreset: (p: SpacePreset) => void;
  setIsPlaying: (v: boolean) => void;
  setLoadingStatus: (s: AppState['loadingStatus']) => void;
  setErrorMessage: (m: string | null) => void;
  setQuality: (q: QualityTier) => void;
  setCommentary: (c: CommentaryResponse | null) => void;
  setCommentaryStatus: (s: CommentaryStatus) => void;
  setCommentaryError: (e: string | null) => void;
  reset: () => void;
}

export const useAppStore = create<AppState>((set) => ({
  analysis: null,
  audioUrl: null,
  preset: 'cathedral',
  isPlaying: false,
  loadingStatus: 'idle',
  errorMessage: null,

  quality: loadPersistedQuality(),

  commentary: null,
  commentaryStatus: 'idle',
  commentaryError: null,

  setAnalysis: (analysis) => set({ analysis }),
  setAudioUrl: (audioUrl) => set({ audioUrl }),
  setPreset: (preset) => set({ preset }),
  setIsPlaying: (isPlaying) => set({ isPlaying }),
  setLoadingStatus: (loadingStatus) => set({ loadingStatus }),
  setErrorMessage: (errorMessage) => set({ errorMessage }),
  setQuality: (quality) => {
    persistQuality(quality);
    set({ quality });
  },
  setCommentary: (commentary) => set({ commentary }),
  setCommentaryStatus: (commentaryStatus) => set({ commentaryStatus }),
  setCommentaryError: (commentaryError) => set({ commentaryError }),
  reset: () =>
    set({
      analysis: null,
      audioUrl: null,
      isPlaying: false,
      loadingStatus: 'idle',
      errorMessage: null,
      commentary: null,
      commentaryStatus: 'idle',
      commentaryError: null,
    }),
}));

// Derive an HSL color from the detected key. Circle of fifths = circle of hues:
// C=0°, G=30°, D=60°, A=90°, E=120°, B=150°, F#=180°, C#=210°, G#=240°, D#=270°,
// A#=300°, F=330°. Minor modes shift toward cooler saturation.
const KEY_HUE: Record<string, number> = {
  C: 0,
  G: 30,
  D: 60,
  A: 90,
  E: 120,
  B: 150,
  'F#': 180,
  'C#': 210,
  'G#': 240,
  'D#': 270,
  'A#': 300,
  F: 330,
};

export function keyToColor(key: string, mode: 'major' | 'minor'): {
  hue: number;
  saturation: number;
  lightness: number;
} {
  const hue = KEY_HUE[key] ?? 30;
  // Minor: darker, slightly desaturated, shifted 15° colder.
  if (mode === 'minor') {
    return { hue: (hue + 345) % 360, saturation: 0.45, lightness: 0.42 };
  }
  return { hue, saturation: 0.58, lightness: 0.58 };
}
