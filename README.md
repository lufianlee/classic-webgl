# Spatium Sonorum — WebGL Early Music Spatial Visualizer

Classical (public-domain / Musopen) recordings transformed into **three-dimensional spaces you walk through**. Each piece's tempo, key, and spectral energy drive a living shader landscape.

---

## Concept

> *"You do not listen to the music. You walk through it."*

- **Bass** deforms the floor into rolling terrain
- **Mids** modulate ground noise and color gradients
- **Treble** brightens and expands a cloud of gilt particles
- **Musical key** paints the whole scene's hue (circle of fifths → circle of hues)
- **Tempo** sets your walking speed through the nave
- **Space preset** (Cathedral / Concert Hall / Salon) changes both architecture and a convolution reverb — you *hear* the room change

---

## Architecture

```
┌────────────────────────┐   audio URL   ┌──────────────────────────┐
│ Next.js 14 + R3F       │ ───────────▶  │ FastAPI + librosa        │
│ (WebGL scene + Web     │               │  BPM, key, mel-spec,      │
│  Audio analyser +      │ ◀─ JSON ──── │  per-band envelopes,      │
│  convolution reverb)   │               │  file cache               │
└────────────────────────┘               └──────────────────────────┘
         :3000                                      :8000
```

- **Frontend**: Next.js 14 (App Router) · React Three Fiber / Three.js · TypeScript · Tailwind · Zustand · @react-three/postprocessing
- **Backend**: FastAPI · librosa · numpy · httpx · uvicorn
- **LLM commentary**: Amazon Bedrock (Claude Sonnet 4.6, default) · Anthropic Messages API · OpenAI Chat Completions
- **PBR textures**: Poly Haven (CC0) — downloaded at Docker build time
- Both services run via `docker compose`.

---

## Run it

Prereq: Docker Desktop (or any Docker + Compose v2).

```bash
# (Optional) export LLM keys so commentary works out of the box
export AWS_BEARER_TOKEN_BEDROCK=...      # for Bedrock (default provider)
export AWS_REGION=us-east-1              # Bedrock region (default: us-east-1)
export ANTHROPIC_API_KEY=...             # alternative: Anthropic direct
export OPENAI_API_KEY=...                # alternative: OpenAI

docker compose up --build
```

Then open **http://localhost:3000**.

Paste any direct audio URL (`.mp3`, `.wav`, `.ogg`, `.flac`) or upload a local file. The backend caches downloads and analyses under a named volume, so re-visits are instant.

### LLM commentary

The intro overlay has a **"LLM Commentary"** toggle. When enabled, the backend sends the track's audio-feature timeline to the chosen model, which returns 4–8 time-synced segments (`heading` + 1–2 sentences each). The active segment scrolls into the bottom HUD as playback progresses and a progress bar ticks across it.

Providers:

| Provider | Auth | Default model |
| --- | --- | --- |
| `bedrock` (default) | `AWS_BEARER_TOKEN_BEDROCK` on the server | `us.anthropic.claude-sonnet-4-6` |
| `anthropic` | API key in the intro settings (or `ANTHROPIC_API_KEY`) | `claude-sonnet-4-6` |
| `openai` | API key in the intro settings (or `OPENAI_API_KEY`) | `gpt-4o-mini` |

You can also override the model string per request from the UI. API keys entered in the browser are stored in `localStorage` only.

> **Bedrock note.** On-demand Claude 4.x invocation requires an **inference-profile ID**, not a raw model ID. `us.*` means "US cross-region profile"; if your account sits elsewhere, use `global.*` or your region's profile.

### Tests

```bash
docker compose run --rm backend sh -c "pip install pytest --quiet && python -m pytest app/test_analysis.py -v"
```

Seven tests cover analysis range validity, bass/mid/treble band separation (synthesizing 80 Hz / 440 Hz / silent signals), tempo estimation on a click track, C-major key detection on a synthesized triad, and spectrogram frame-cap behavior.

---

## Controls

| Action            | Input                             |
| ----------------- | --------------------------------- |
| Walk              | **W A S D** or arrow keys         |
| Look around       | Click scene → **mouse**           |
| Free cursor       | **ESC**                           |
| Play / Pause      | Bottom HUD transport              |
| Change space      | Top-right HUD (Cathedral / Hall / Salon) |
| Exit to intro     | Bottom HUD "Exit"                 |

---

## Project layout

```
CLASSIC-WEBGL/
├── docker-compose.yml
├── backend/
│   ├── Dockerfile
│   ├── requirements.txt
│   └── app/
│       ├── main.py            # FastAPI routes (+ /api/commentary, /api/stream)
│       ├── analysis.py        # librosa feature extraction
│       ├── commentary.py      # Bedrock/Anthropic/OpenAI adapters + prompt
│       └── test_analysis.py   # real-audio tests (no mocks)
└── frontend/
    ├── Dockerfile
    ├── next.config.mjs
    ├── tailwind.config.ts
    └── src/
        ├── app/
        │   ├── page.tsx       # orchestrates intro, scene, HUD, audio element
        │   ├── layout.tsx
        │   └── globals.css    # parchment + gilt theme
        ├── lib/
        │   ├── api.ts         # backend client
        │   ├── audio.ts       # Web Audio graph: analyser + convolution reverb
        │   └── store.ts       # zustand + key-to-color mapping
        └── components/
            ├── ui/
            │   ├── IntroOverlay.tsx
            │   └── HUD.tsx
            └── webgl/
                ├── SpatialScene.tsx
                ├── TerrainFloor.tsx     # custom GLSL shader
                ├── TrebleParticles.tsx  # custom GLSL shader
                ├── SpaceArchitecture.tsx
                └── WalkControls.tsx     # WASD + pointer lock
```

---

## Notes

- Audio URLs are fetched server-side (size-capped at 80 MB, MIME-checked) and cached under `backend_cache`.
- The convolver's impulse response is synthesized per preset (noise × exponential decay) with realistic RT60 values — 4.5 s for cathedral, 1.8 s for concert hall, 0.6 s for salon.
- Key detection uses Krumhansl–Kessler profile correlation over a CQT chroma (more stable than STFT chroma for organ / harpsichord timbres).
- Head-bob, particle motion, terrain displacement, and walking speed are all driven in real-time from the `AnalyserNode` on the browser side — the server-side analysis supplies metadata for the HUD and for static scene coloring (key → hue).
