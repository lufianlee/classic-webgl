"""FastAPI server that fetches classical audio (e.g. Musopen) and returns
features for the WebGL spatial visualizer.
"""
from __future__ import annotations

import hashlib
import json
import logging
import os
import re
from pathlib import Path
from urllib.parse import urlparse

import httpx
from fastapi import FastAPI, HTTPException, Query, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from typing import Any, Literal

from pydantic import BaseModel, Field, HttpUrl

from .analysis import analyze_audio
from .commentary import (
    DEFAULT_MODELS as COMMENTARY_DEFAULT_MODELS,
    generate_commentary,
)

logger = logging.getLogger("uvicorn.error")

CACHE_DIR = Path(os.getenv("CACHE_DIR", "/app/cache"))
CACHE_DIR.mkdir(parents=True, exist_ok=True)

ALLOWED_ORIGINS = [
    o.strip()
    for o in os.getenv("ALLOWED_ORIGINS", "http://localhost:3000").split(",")
    if o.strip()
]

# Curated Musopen / public-domain picks across the early-music spectrum.
# These are starting points for users who don't have a URL handy.
SAMPLE_TRACKS = [
    {
        "id": "bach-cello-1-prelude",
        "title": "Cello Suite No. 1 in G major, BWV 1007 — Prelude",
        "composer": "J. S. Bach",
        "era": "Baroque",
        "year": 1720,
        "preset": "cathedral",
        "url": "https://musopen.org/recordings/download/1/",
        "note": "Try any Musopen mp3 link — paste the direct .mp3 URL.",
    },
    {
        "id": "pachelbel-canon",
        "title": "Canon in D",
        "composer": "J. Pachelbel",
        "era": "Baroque",
        "year": 1680,
        "preset": "salon",
        "url": "",
        "note": "Public-domain recording available on Musopen.",
    },
    {
        "id": "palestrina-kyrie",
        "title": "Missa Papae Marcelli — Kyrie",
        "composer": "G. P. da Palestrina",
        "era": "Renaissance",
        "year": 1562,
        "preset": "cathedral",
        "url": "",
        "note": "High-polyphony sacred music — try with the cathedral preset.",
    },
]

MAX_DOWNLOAD_BYTES = 80 * 1024 * 1024  # 80 MB
ALLOWED_CONTENT_TYPES = (
    "audio/mpeg",
    "audio/mp3",
    "audio/ogg",
    "audio/wav",
    "audio/x-wav",
    "audio/flac",
    "audio/x-flac",
    "application/octet-stream",  # some CDNs mislabel
)

app = FastAPI(title="Classical WebGL Analyzer", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


class AnalyzeRequest(BaseModel):
    url: HttpUrl = Field(..., description="Direct URL to an audio file")


class CommentaryRequest(BaseModel):
    # One of these identifies the track to comment on.
    url: HttpUrl | None = Field(
        None, description="Source URL previously analyzed (or to be analyzed now)"
    )
    upload_hash: str | None = Field(
        None,
        description="Hash for a previously uploaded file (from the analyze-upload response).",
    )

    provider: Literal["bedrock", "anthropic", "openai"] = "bedrock"
    model: str | None = Field(
        None, description="Model ID; if omitted, a provider-appropriate default is used."
    )
    language: str = Field("ko", description="Language for the commentary (e.g., 'ko', 'en').")
    api_key: str | None = Field(
        None,
        description=(
            "For provider='anthropic' or 'openai'. Ignored for 'bedrock' "
            "(which uses AWS_BEARER_TOKEN_BEDROCK on the server)."
        ),
    )
    max_tokens: int = Field(4096, ge=256, le=8192)


def _safe_extension(url: str, content_type: str | None) -> str:
    path = urlparse(url).path
    m = re.search(r"\.([A-Za-z0-9]{2,5})$", path)
    if m:
        ext = m.group(1).lower()
        if ext in {"mp3", "ogg", "wav", "flac", "m4a"}:
            return ext
    if content_type:
        if "mpeg" in content_type or "mp3" in content_type:
            return "mp3"
        if "ogg" in content_type:
            return "ogg"
        if "wav" in content_type:
            return "wav"
        if "flac" in content_type:
            return "flac"
    return "mp3"


async def _download_to_cache(url: str) -> Path:
    """Download URL to the cache directory, keyed by URL hash. Returns path."""
    url_hash = hashlib.sha256(url.encode()).hexdigest()[:16]
    # Probe for an existing cached file with any known extension.
    for existing in CACHE_DIR.glob(f"{url_hash}.*"):
        if existing.suffix != ".json":
            return existing

    # Some CDNs (Wikimedia, archive.org) return 403 for clients without a UA.
    headers = {
        "User-Agent": (
            "SpatiumSonorum/0.1 (+https://example.invalid; early-music-webgl)"
        ),
        "Accept": "*/*",
    }
    async with httpx.AsyncClient(
        follow_redirects=True, timeout=60.0, headers=headers
    ) as client:
        try:
            async with client.stream("GET", url) as resp:
                if resp.status_code != 200:
                    raise HTTPException(
                        status_code=400,
                        detail=f"Failed to fetch audio: HTTP {resp.status_code}",
                    )
                content_type = resp.headers.get("content-type", "").lower()
                if content_type and not any(
                    t in content_type for t in ALLOWED_CONTENT_TYPES
                ):
                    raise HTTPException(
                        status_code=415,
                        detail=f"Unsupported content type: {content_type}",
                    )

                ext = _safe_extension(url, content_type)
                dest = CACHE_DIR / f"{url_hash}.{ext}"
                total = 0
                with dest.open("wb") as f:
                    async for chunk in resp.aiter_bytes(chunk_size=64 * 1024):
                        total += len(chunk)
                        if total > MAX_DOWNLOAD_BYTES:
                            f.close()
                            dest.unlink(missing_ok=True)
                            raise HTTPException(
                                status_code=413,
                                detail=(
                                    f"File exceeds {MAX_DOWNLOAD_BYTES // (1024 * 1024)} MB limit"
                                ),
                            )
                        f.write(chunk)
                return dest
        except httpx.HTTPError as e:
            raise HTTPException(status_code=502, detail=f"Upstream error: {e}") from e


def _cached_analysis_path(audio_path: Path) -> Path:
    return audio_path.with_suffix(audio_path.suffix + ".analysis.json")


_EXT_MIME = {
    "mp3": "audio/mpeg",
    "wav": "audio/wav",
    "ogg": "audio/ogg",
    "flac": "audio/flac",
    "m4a": "audio/mp4",
}


@app.get("/api/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/api/stream")
async def stream(url: str = Query(..., description="Source audio URL")) -> FileResponse:
    """Serve the already-cached audio file from the backend.

    The browser can't always load external audio URLs directly — CORS headers
    or missing `Access-Control-Allow-Origin` will make Web Audio produce silence
    when `crossOrigin="anonymous"` is set on the <audio> element. Since we
    download and cache the file server-side for analysis anyway, the frontend
    plays it back through this endpoint.
    """
    audio_path = await _download_to_cache(url)
    mime = _EXT_MIME.get(audio_path.suffix.lstrip(".").lower(), "application/octet-stream")
    return FileResponse(audio_path, media_type=mime)


@app.get("/api/samples")
async def samples() -> dict[str, list]:
    return {"samples": SAMPLE_TRACKS}


@app.post("/api/analyze")
async def analyze(req: AnalyzeRequest) -> dict:
    url = str(req.url)
    audio_path = await _download_to_cache(url)
    cached = _cached_analysis_path(audio_path)
    if cached.exists():
        try:
            return json.loads(cached.read_text())
        except json.JSONDecodeError:
            cached.unlink(missing_ok=True)

    logger.info("Analyzing %s (%s)", url, audio_path.name)
    try:
        result = analyze_audio(audio_path)
    except Exception as e:  # noqa: BLE001
        logger.exception("Analysis failed for %s", url)
        raise HTTPException(status_code=500, detail=f"Analysis failed: {e}") from e

    payload = {"source_url": url, **result.to_dict()}
    cached.write_text(json.dumps(payload))
    return payload


@app.get("/api/commentary/providers")
async def commentary_providers() -> dict[str, Any]:
    """List available providers and default model IDs so the UI can render
    the settings panel without hardcoding anything."""
    # Only advertise a provider if the backend has some way to authenticate.
    # For anthropic/openai the key may arrive in the request body, so we
    # always list them; for bedrock, we also list it (the error message at
    # call time explains what env var to set).
    return {
        "providers": [
            {
                "id": "bedrock",
                "label": "Bedrock (Claude)",
                "default_model": COMMENTARY_DEFAULT_MODELS["bedrock"],
                "auth": "server env AWS_BEARER_TOKEN_BEDROCK",
                "server_configured": bool(os.getenv("AWS_BEARER_TOKEN_BEDROCK")),
            },
            {
                "id": "anthropic",
                "label": "Anthropic (direct)",
                "default_model": COMMENTARY_DEFAULT_MODELS["anthropic"],
                "auth": "request api_key or ANTHROPIC_API_KEY",
                "server_configured": bool(os.getenv("ANTHROPIC_API_KEY")),
            },
            {
                "id": "openai",
                "label": "OpenAI (ChatGPT)",
                "default_model": COMMENTARY_DEFAULT_MODELS["openai"],
                "auth": "request api_key or OPENAI_API_KEY",
                "server_configured": bool(os.getenv("OPENAI_API_KEY")),
            },
        ]
    }


@app.post("/api/commentary")
async def commentary(req: CommentaryRequest) -> dict[str, Any]:
    """Return time-synced commentary for a previously-analyzed track."""
    # Resolve to an analysis payload. We require the URL or upload hash to
    # match a cached analysis — no fresh downloads happen here.
    if req.url:
        url = str(req.url)
        # Reuse the cache lookup logic from analyze(): find a cached audio
        # file, then its sibling .analysis.json.
        audio_path = await _download_to_cache(url)
        cached = _cached_analysis_path(audio_path)
        if not cached.exists():
            # Run analysis first so commentary doesn't need a separate trip.
            result = analyze_audio(audio_path)
            cached.write_text(
                json.dumps({"source_url": url, **result.to_dict()})
            )
        analysis = json.loads(cached.read_text())
        title = url
    elif req.upload_hash:
        matches = list(CACHE_DIR.glob(f"upload_{req.upload_hash}.*"))
        audio_candidates = [m for m in matches if not m.name.endswith(".json")]
        if not audio_candidates:
            raise HTTPException(
                status_code=404, detail="No uploaded file for that hash; upload first."
            )
        audio_path = audio_candidates[0]
        cached = _cached_analysis_path(audio_path)
        if not cached.exists():
            raise HTTPException(
                status_code=404,
                detail="Upload exists but has no analysis; call /api/analyze-upload again.",
            )
        analysis = json.loads(cached.read_text())
        title = analysis.get("filename") or audio_path.name
    else:
        raise HTTPException(
            status_code=400, detail="Provide either `url` or `upload_hash`."
        )

    try:
        result = await generate_commentary(
            analysis,
            provider=req.provider,
            model=req.model,
            language=req.language,
            title=title,
            api_key=req.api_key,
            max_tokens=req.max_tokens,
        )
    except RuntimeError as e:
        logger.exception("Commentary generation failed")
        raise HTTPException(status_code=502, detail=str(e)) from e
    except ValueError as e:
        logger.exception("Commentary parsing failed")
        raise HTTPException(status_code=500, detail=f"Parse error: {e}") from e
    except Exception as e:  # noqa: BLE001
        logger.exception("Commentary unexpected failure")
        raise HTTPException(
            status_code=500, detail=f"Commentary failed: {type(e).__name__}: {e}"
        ) from e

    return {
        "overview": result.overview,
        "segments": [s.__dict__ for s in result.segments],
        "provider": result.provider,
        "model": result.model,
    }


@app.post("/api/analyze-upload")
async def analyze_upload(file: UploadFile = File(...)) -> dict:
    if file.size and file.size > MAX_DOWNLOAD_BYTES:
        raise HTTPException(status_code=413, detail="File too large")
    data = await file.read()
    if len(data) > MAX_DOWNLOAD_BYTES:
        raise HTTPException(status_code=413, detail="File too large")

    file_hash = hashlib.sha256(data).hexdigest()[:16]
    ext = (file.filename or "upload.mp3").rsplit(".", 1)[-1].lower()
    if ext not in {"mp3", "wav", "ogg", "flac", "m4a"}:
        raise HTTPException(status_code=415, detail=f"Unsupported extension: {ext}")

    audio_path = CACHE_DIR / f"upload_{file_hash}.{ext}"
    if not audio_path.exists():
        audio_path.write_bytes(data)

    cached = _cached_analysis_path(audio_path)
    if cached.exists():
        try:
            return json.loads(cached.read_text())
        except json.JSONDecodeError:
            cached.unlink(missing_ok=True)

    try:
        result = analyze_audio(audio_path)
    except Exception as e:  # noqa: BLE001
        logger.exception("Analysis failed for upload %s", file.filename)
        raise HTTPException(status_code=500, detail=f"Analysis failed: {e}") from e

    payload = {
        "source_url": f"upload://{file.filename}",
        "filename": file.filename,
        "upload_hash": file_hash,
        **result.to_dict(),
    }
    cached.write_text(json.dumps(payload))
    return payload
