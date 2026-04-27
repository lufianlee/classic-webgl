"""LLM-driven musical commentary.

Takes the backend's audio analysis (tempo, key, time-series envelopes,
chroma, beats) and produces a structured, time-synchronized commentary:

    {
      "overview": "…",
      "segments": [
        {"start": 0.0, "end": 32.5, "heading": "…", "text": "…"},
        …
      ]
    }

Providers supported:
  - bedrock (default):  Anthropic Claude via Amazon Bedrock Runtime,
                        authenticated with AWS_BEARER_TOKEN_BEDROCK.
  - anthropic:          Anthropic Messages API (direct), using an API key
                        passed by the caller or ANTHROPIC_API_KEY env.
  - openai:             OpenAI Chat Completions API, using an API key
                        passed by the caller or OPENAI_API_KEY env.

Model IDs are parameterized; sensible defaults target the most capable
current models per provider.
"""
from __future__ import annotations

import json
import logging
import os
import re
from dataclasses import dataclass
from typing import Any, Literal

import urllib.parse

import httpx
import numpy as np

logger = logging.getLogger("uvicorn.error")

Provider = Literal["bedrock", "anthropic", "openai"]

DEFAULT_MODELS: dict[Provider, str] = {
    # Bedrock requires an inference profile ID (not a raw model ID) for
    # on-demand invocation of Claude 4.x. "us." = US region cross-region
    # profile. Accounts in other regions should override via `model`.
    "bedrock": "us.anthropic.claude-sonnet-4-6",
    "anthropic": "claude-sonnet-4-6",
    "openai": "gpt-4o-mini",
}

BEDROCK_DEFAULT_REGION = os.getenv("AWS_REGION", "us-east-1")


@dataclass
class CommentarySegment:
    start: float
    end: float
    heading: str
    text: str


@dataclass
class CommentaryResult:
    overview: str
    segments: list[CommentarySegment]
    provider: str
    model: str


def _compress_features(analysis: dict[str, Any], target_points: int = 16) -> dict[str, Any]:
    """Compress the analysis timeline into a compact digest the LLM can chew on.

    The raw spectrogram is ~64×500 floats — too large and too noisy for a
    language model. We bucket the timeline into `target_points` windows and
    summarize each with dominant pitch class, bass/mid/treble energy, and
    mean RMS. This preserves the *shape* of the piece while cutting tokens.
    """
    duration = analysis["duration"]
    bass = np.array(analysis["bass_envelope"], dtype=float)
    mid = np.array(analysis["mid_envelope"], dtype=float)
    treble = np.array(analysis["treble_envelope"], dtype=float)
    env_t = np.array(analysis["envelope_times"], dtype=float)
    spec = np.array(analysis["spectrogram"], dtype=float)  # [time][mel]
    spec_t = np.array(analysis["spectrogram_times"], dtype=float)
    beats = np.array(analysis["beats"], dtype=float)

    if len(env_t) == 0 or duration <= 0:
        return {
            "duration": duration,
            "tempo": analysis.get("tempo", 0),
            "key": analysis.get("key", "C"),
            "mode": analysis.get("mode", "major"),
            "windows": [],
        }

    pitch_names = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
    windows: list[dict[str, Any]] = []
    for i in range(target_points):
        t0 = duration * i / target_points
        t1 = duration * (i + 1) / target_points

        def _slice(arr: np.ndarray, times: np.ndarray) -> np.ndarray:
            mask = (times >= t0) & (times < t1)
            return arr[mask] if mask.any() else arr[:0]

        b = _slice(bass, env_t)
        m = _slice(mid, env_t)
        tr = _slice(treble, env_t)

        # Beats-per-window → local tempo estimate.
        beat_mask = (beats >= t0) & (beats < t1)
        local_beats = beats[beat_mask]
        local_tempo = 0.0
        if len(local_beats) > 1:
            iois = np.diff(local_beats)
            if len(iois):
                local_tempo = 60.0 / float(np.median(iois))

        # Dominant pitch class in this window from mel bins weighted back
        # to pitch classes (approximate: we use chroma of analysis only for
        # global key; per-window we approximate with peak mel band shape).
        spec_mask = (spec_t >= t0) & (spec_t < t1)
        peak_info: dict[str, float | str] = {}
        if spec_mask.any():
            win = spec[spec_mask]  # [k, mel]
            mean_col = win.mean(axis=0)
            peak_mel = int(np.argmax(mean_col))
            peak_info = {
                "peak_mel_bin": peak_mel,
                "peak_mel_norm_energy": float(mean_col.max()),
                "spectral_centroid_rank": float(peak_mel / max(1, len(mean_col) - 1)),
            }

        windows.append(
            {
                "idx": i,
                "start": round(t0, 2),
                "end": round(t1, 2),
                "bass": round(float(b.mean()) if b.size else 0.0, 3),
                "mid": round(float(m.mean()) if m.size else 0.0, 3),
                "treble": round(float(tr.mean()) if tr.size else 0.0, 3),
                "local_tempo": round(local_tempo, 1),
                "beat_count": int(len(local_beats)),
                **peak_info,
            }
        )

    chroma = analysis.get("chroma") or []
    dominant_pcs: list[str] = []
    if chroma:
        order = np.argsort(chroma)[::-1]
        dominant_pcs = [pitch_names[i] for i in order[:4]]

    return {
        "duration": round(duration, 2),
        "tempo": round(float(analysis.get("tempo", 0)), 1),
        "key": analysis.get("key", "C"),
        "mode": analysis.get("mode", "major"),
        "key_confidence": round(float(analysis.get("key_confidence", 0)), 3),
        "dominant_pitches": dominant_pcs,
        "total_beats": int(len(beats)),
        "windows": windows,
    }


_LANGUAGE_NAMES = {
    "ko": "Korean (한국어)",
    "en": "English",
    "ja": "Japanese (日本語)",
    "zh": "Chinese (中文)",
    "fr": "French (français)",
    "de": "German (Deutsch)",
    "es": "Spanish (español)",
    "it": "Italian (italiano)",
}


def _language_name(code: str) -> str:
    """Convert an ISO code like 'ko' to a prompt-friendly name.
    Models interpret `Korean (한국어)` far more reliably than `ko`.
    """
    return _LANGUAGE_NAMES.get(code.lower(), code)


def _build_messages(
    digest: dict[str, Any],
    *,
    title: str | None,
    language: str,
) -> tuple[str, str]:
    """Build (system_prompt, user_message) for the LLM.

    Returns structured, time-synced segments grounded in the numeric
    audio features (tempo, energy envelopes, dominant pitches, beats).
    """
    lang_label = _language_name(language)
    title_line = f'Title/source: "{title}"\n' if title else ""
    digest_json = json.dumps(digest, ensure_ascii=False)

    # Language instruction appears TWICE (system + user) because models often
    # default to the language of the system prompt. Restating it up top with
    # an explicit, unambiguous name is what actually moves the needle.
    system = (
        f"You are a musicologist writing substantive, insight-driven "
        f"commentary on a piece of classical music based on extracted "
        f"audio features. Your commentary should feel like a thoughtful "
        f"program note — rich, specific, and grounded in what the "
        f"numeric features show.\n\n"
        f"ALL human-readable output fields (`overview`, `heading`, `text`) MUST "
        f"be written in {lang_label}. Do NOT output English if the requested "
        f"language is not English. JSON keys (\"overview\", \"segments\", "
        f"\"start\", \"end\", \"heading\", \"text\") stay in English regardless.\n\n"
        f"You MUST return valid JSON that matches the requested schema, with "
        f"no surrounding prose, no markdown fences, and no comments. "
        f"Use the provided timing windows exactly as boundaries for your "
        f"segments. Ground every claim in the numeric features — never "
        f"invent composer names, opus numbers, or performers."
    )
    schema = {
        "overview": (
            "4-6 sentence description of the overall character: the "
            "piece's trajectory, tonal world, dynamic range, and what "
            "makes it distinctive"
        ),
        "segments": [
            {
                "start": "number, seconds",
                "end": "number, seconds",
                "heading": "short title, 3-6 words",
                "text": (
                    "3-5 sentences of commentary anchored to the "
                    "features: what is happening harmonically, "
                    "rhythmically, and texturally; what emotional "
                    "effect it produces; how it relates to adjacent "
                    "segments"
                ),
            }
        ],
    }
    user = (
        f"{title_line}"
        f"Write every human-readable field in {lang_label}. "
        f"This is a hard requirement — any English output in overview/heading/text "
        f"(when the requested language is not English) is a failure.\n"
        f"Produce between 8 and 14 segments covering the entire duration "
        f"(roughly one segment per 20–45 seconds depending on the piece). "
        f"Segment boundaries SHOULD align with natural changes in the "
        f"feature windows (tempo shifts, energy changes, register "
        f"changes, harmonic turns). Coalesce adjacent similar windows "
        f"into one segment rather than producing one per window.\n\n"
        f"For each segment's `text`, write 3–5 full sentences. Go "
        f"beyond naming what's happening — interpret it. Why does the "
        f"energy rise here? What does the register shift suggest? How "
        f"does this moment function within the piece's arc? Anchor "
        f"every claim to a specific numeric cue from the digest "
        f"(tempo, bass/mid/treble levels, beat density, spectral "
        f"centroid) but weave the analysis into readable prose, not a "
        f"bulleted list of numbers.\n\n"
        f"The `overview` should be 4–6 sentences — a genuine program-"
        f"note style paragraph, not a one-line summary.\n\n"
        f"Audio feature digest (JSON):\n{digest_json}\n\n"
        f"Respond with JSON matching this schema:\n"
        f"{json.dumps(schema, ensure_ascii=False)}"
    )
    return system, user


# --------------------------------------------------------------------------- #
# Provider adapters
# --------------------------------------------------------------------------- #


async def _call_bedrock(
    system: str, user: str, *, model: str, max_tokens: int
) -> str:
    """Invoke a Claude model on Bedrock using a bearer token.

    Bedrock supports a newer API-key-style auth via `Authorization: Bearer …`
    when the key is provisioned as an "Amazon Bedrock API key". We use that
    rather than SigV4 to avoid pulling in boto3/botocore.
    """
    token = os.getenv("AWS_BEARER_TOKEN_BEDROCK")
    if not token:
        raise RuntimeError(
            "AWS_BEARER_TOKEN_BEDROCK is not set on the server. "
            "Export it before starting the backend, or choose provider "
            "'anthropic' / 'openai' and pass an API key."
        )
    region = BEDROCK_DEFAULT_REGION

    # Model IDs contain ':' which must be URL-encoded in the path.
    encoded_model = urllib.parse.quote(model, safe="")
    url = f"https://bedrock-runtime.{region}.amazonaws.com/model/{encoded_model}/invoke"
    body = {
        "anthropic_version": "bedrock-2023-05-31",
        "max_tokens": max_tokens,
        "system": system,
        "messages": [{"role": "user", "content": user}],
    }
    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
        "Accept": "application/json",
    }
    async with httpx.AsyncClient(timeout=90.0) as client:
        r = await client.post(url, json=body, headers=headers)
        if r.status_code != 200:
            raise RuntimeError(
                f"Bedrock error {r.status_code}: {r.text[:500]}"
            )
        data = r.json()
        # Bedrock returns Claude's native format.
        parts = data.get("content", [])
        texts = [p.get("text", "") for p in parts if p.get("type") == "text"]
        return "".join(texts)


async def _call_anthropic(
    system: str, user: str, *, model: str, max_tokens: int, api_key: str | None
) -> str:
    key = api_key or os.getenv("ANTHROPIC_API_KEY")
    if not key:
        raise RuntimeError(
            "No Anthropic API key provided. Pass `api_key` in the request "
            "body or set ANTHROPIC_API_KEY on the server."
        )
    url = "https://api.anthropic.com/v1/messages"
    body = {
        "model": model,
        "max_tokens": max_tokens,
        "system": system,
        "messages": [{"role": "user", "content": user}],
    }
    headers = {
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
    }
    async with httpx.AsyncClient(timeout=90.0) as client:
        r = await client.post(url, json=body, headers=headers)
        if r.status_code != 200:
            raise RuntimeError(
                f"Anthropic error {r.status_code}: {r.text[:500]}"
            )
        data = r.json()
        parts = data.get("content", [])
        texts = [p.get("text", "") for p in parts if p.get("type") == "text"]
        return "".join(texts)


async def _call_openai(
    system: str, user: str, *, model: str, max_tokens: int, api_key: str | None
) -> str:
    key = api_key or os.getenv("OPENAI_API_KEY")
    if not key:
        raise RuntimeError(
            "No OpenAI API key provided. Pass `api_key` in the request body "
            "or set OPENAI_API_KEY on the server."
        )
    url = "https://api.openai.com/v1/chat/completions"
    body = {
        "model": model,
        "max_tokens": max_tokens,
        "response_format": {"type": "json_object"},
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
    }
    headers = {
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
    }
    async with httpx.AsyncClient(timeout=90.0) as client:
        r = await client.post(url, json=body, headers=headers)
        if r.status_code != 200:
            raise RuntimeError(f"OpenAI error {r.status_code}: {r.text[:500]}")
        data = r.json()
        choice = data["choices"][0]["message"]["content"]
        return choice or ""


# --------------------------------------------------------------------------- #


def _extract_json(raw: str) -> dict[str, Any]:
    """Pull the first JSON object out of the model's raw text response.

    Some providers wrap JSON in code fences even when instructed not to;
    we tolerate that. Anything else (multiple objects, commentary before
    the object) raises.
    """
    raw = raw.strip()
    # Strip ```json … ``` fences if present.
    fence = re.match(r"^```(?:json)?\s*(.*?)```$", raw, re.DOTALL)
    if fence:
        raw = fence.group(1).strip()
    start = raw.find("{")
    end = raw.rfind("}")
    if start < 0 or end < 0 or end <= start:
        raise ValueError("Model output contained no JSON object")
    return json.loads(raw[start : end + 1])


def _coerce_segments(
    parsed: dict[str, Any], duration: float
) -> list[CommentarySegment]:
    raw = parsed.get("segments") or []
    out: list[CommentarySegment] = []
    for s in raw:
        try:
            start = float(s.get("start", 0))
            end = float(s.get("end", 0))
            heading = str(s.get("heading", "")).strip()
            text = str(s.get("text", "")).strip()
        except (TypeError, ValueError):
            continue
        # Clamp to piece duration and drop degenerate segments.
        start = max(0.0, min(duration, start))
        end = max(0.0, min(duration, end))
        if end <= start or not text:
            continue
        out.append(CommentarySegment(start=start, end=end, heading=heading, text=text))
    out.sort(key=lambda s: s.start)
    return out


async def generate_commentary(
    analysis: dict[str, Any],
    *,
    provider: Provider = "bedrock",
    model: str | None = None,
    language: str = "ko",
    title: str | None = None,
    api_key: str | None = None,
    max_tokens: int = 4096,
) -> CommentaryResult:
    digest = _compress_features(analysis)
    system, user = _build_messages(digest, title=title, language=language)
    chosen_model = model or DEFAULT_MODELS[provider]

    if provider == "bedrock":
        raw = await _call_bedrock(system, user, model=chosen_model, max_tokens=max_tokens)
    elif provider == "anthropic":
        raw = await _call_anthropic(
            system, user, model=chosen_model, max_tokens=max_tokens, api_key=api_key
        )
    elif provider == "openai":
        raw = await _call_openai(
            system, user, model=chosen_model, max_tokens=max_tokens, api_key=api_key
        )
    else:  # pragma: no cover — validated by pydantic
        raise ValueError(f"Unknown provider: {provider}")

    parsed = _extract_json(raw)
    overview = str(parsed.get("overview", "")).strip()
    segments = _coerce_segments(parsed, float(analysis.get("duration", 0)))
    if not segments:
        raise RuntimeError("LLM returned no usable segments")
    return CommentaryResult(
        overview=overview,
        segments=segments,
        provider=provider,
        model=chosen_model,
    )
