export interface AnalysisResult {
  source_url: string;
  filename?: string;
  upload_hash?: string;
  duration: number;
  sample_rate: number;
  tempo: number;
  key: string;
  mode: 'major' | 'minor';
  key_confidence: number;
  beats: number[];
  spectrogram: number[][]; // [time][mel_bin], 0..1
  spectrogram_times: number[];
  bass_envelope: number[];
  mid_envelope: number[];
  treble_envelope: number[];
  envelope_times: number[];
  chroma: number[];
  rms_peak: number;
}

export type SpacePreset = 'cathedral' | 'concert_hall' | 'salon';

export type CommentaryProvider = 'bedrock' | 'anthropic' | 'openai';

export interface ProviderInfo {
  id: CommentaryProvider;
  label: string;
  default_model: string;
  auth: string;
  server_configured: boolean;
}

export interface CommentarySegment {
  start: number;
  end: number;
  heading: string;
  text: string;
}

export interface CommentaryResponse {
  overview: string;
  segments: CommentarySegment[];
  provider: string;
  model: string;
}

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000';

/** Proxied playback URL — avoids CORS issues that silence Web Audio graphs. */
export function streamUrl(sourceUrl: string): string {
  return `${API_URL}/api/stream?url=${encodeURIComponent(sourceUrl)}`;
}

export async function fetchCommentaryProviders(): Promise<ProviderInfo[]> {
  const res = await fetch(`${API_URL}/api/commentary/providers`);
  if (!res.ok) throw new Error(`providers request failed: ${res.status}`);
  const data = (await res.json()) as { providers: ProviderInfo[] };
  return data.providers;
}

export interface CommentaryRequestInit {
  url?: string;
  uploadHash?: string;
  provider: CommentaryProvider;
  model?: string;
  language?: string;
  apiKey?: string;
  maxTokens?: number;
}

export async function requestCommentary(
  init: CommentaryRequestInit,
): Promise<CommentaryResponse> {
  const body: Record<string, unknown> = {
    provider: init.provider,
    language: init.language ?? 'ko',
    max_tokens: init.maxTokens ?? 2048,
  };
  if (init.url) body.url = init.url;
  if (init.uploadHash) body.upload_hash = init.uploadHash;
  if (init.model) body.model = init.model;
  if (init.apiKey) body.api_key = init.apiKey;

  const res = await fetch(`${API_URL}/api/commentary`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`commentary failed (${res.status}): ${detail}`);
  }
  return (await res.json()) as CommentaryResponse;
}

export async function analyzeUrl(url: string): Promise<AnalysisResult> {
  const res = await fetch(`${API_URL}/api/analyze`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url }),
  });
  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`analyze failed (${res.status}): ${detail}`);
  }
  return (await res.json()) as AnalysisResult;
}

export async function analyzeUpload(file: File): Promise<AnalysisResult> {
  const form = new FormData();
  form.append('file', file);
  const res = await fetch(`${API_URL}/api/analyze-upload`, {
    method: 'POST',
    body: form,
  });
  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`upload analyze failed (${res.status}): ${detail}`);
  }
  return (await res.json()) as AnalysisResult;
}
