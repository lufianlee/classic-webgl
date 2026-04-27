# Spatium Sonorum — WebGL Early Music Spatial Visualizer

Classical (public-domain / Musopen) recordings transformed into **three-dimensional spaces you walk through**. Each piece's tempo, key, and spectral energy drive a living, audio-reactive scene, and Claude Sonnet writes a full program-note-style commentary synced to the playback.

---

## Concept

> *"You do not listen to the music. You walk through it."*

- **Three spaces** — Gothic **Cathedral** (long reverb, stained glass, pipe organ), 19th-century **Concert Hall** (three-tower organ façade, strings on stage, multi-tier chandelier), 18th-century **Salon** (parquet, French windows, candelabra)
- **Audio-reactive particles** — bass drives a vertical bounce + size pulse, mids set the swirl rate, treble expands the radius and brightens, an RMS-jump gate adds a hot-core burst on beats
- **Musical key → color** — circle of fifths mapped to a circle of hues (C=0°, G=30°, D=60°… ); minor modes shift cooler and darker
- **Convolution reverb** — per-preset impulse response with realistic RT60 (4.5 s cathedral → 0.6 s salon); you *hear* the room
- **LLM commentary** — Claude Sonnet 4.6 writes a 4–6-sentence overview and 8–14 time-synced segments, each 3–5 sentences of genuine program-note-style analysis; the HUD shows the overview and the current segment simultaneously, progress-barred to playback

---

## Architecture

```
┌──────────────────────────┐  audio URL / file  ┌────────────────────────┐
│ Next.js 14 + R3F         │ ──────────────────▶│ FastAPI + librosa      │
│   WebGL scene            │                     │   BPM, key, mel-spec,  │
│   Web Audio analyser     │ ◀──── JSON ─────── │   per-band envelopes,  │
│   convolution reverb     │                     │   file cache           │
│   LLM ticker HUD         │                     │                        │
└──────────────────────────┘                     └────────────────────────┘
         :3000                                             :8000
```

- **Frontend** — Next.js 14 (App Router) · React Three Fiber / Three.js · TypeScript · Tailwind · Zustand · @react-three/postprocessing (Bloom + SMAA + Vignette)
- **Backend** — FastAPI · librosa · numpy · httpx · uvicorn
- **LLM commentary** — Amazon Bedrock (Claude Sonnet 4.6, default) · Anthropic Messages API · OpenAI Chat Completions
- **PBR textures** — Poly Haven (CC0) — downloaded at Docker build time (medieval brick, castle brick, worn wood floor, concrete wall)
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

Open **http://localhost:3000**.

Paste any direct audio URL (`.mp3`, `.wav`, `.ogg`, `.flac`) or upload a local file. The backend caches downloads and analyses under a named volume, so re-visits are instant.

### LLM commentary

The intro overlay has a **"LLM Commentary"** toggle. When enabled, the backend sends the track's compressed audio-feature digest (tempo, per-band envelopes, dominant pitches, beat density) to the chosen model, which returns:

- An **overview** — 4–6 sentences, program-note style, framing the whole piece
- **8–14 time-synced segments** — each 3–5 sentences interpreting what is happening harmonically, rhythmically, and texturally

The bottom `COMMENTARIUS` panel shows both at once: the overview stays fixed up top, and the `NUNC` ("now") section swaps to the active segment as playback crosses its boundaries. A thin gilt bar tracks progress within the segment.

Providers:

| Provider            | Auth                                                   | Default model                       |
| ------------------- | ------------------------------------------------------ | ----------------------------------- |
| `bedrock` (default) | `AWS_BEARER_TOKEN_BEDROCK` on the server               | `us.anthropic.claude-sonnet-4-6`    |
| `anthropic`         | API key in the intro settings (or `ANTHROPIC_API_KEY`) | `claude-sonnet-4-6`                 |
| `openai`            | API key in the intro settings (or `OPENAI_API_KEY`)    | `gpt-4o-mini`                       |

Model strings can be overridden per request from the UI. API keys entered in the browser are stored in `localStorage` only.

> **Bedrock note.** On-demand Claude 4.x invocation requires an **inference-profile ID**, not a raw model ID. `us.*` means "US cross-region profile"; accounts in other regions should use `global.*` or their region's profile.

### Tests

```bash
docker compose run --rm backend sh -c "pip install pytest --quiet && python -m pytest app/test_analysis.py -v"
```

Seven tests cover analysis range validity, bass/mid/treble band separation (synthesizing 80 Hz / 440 Hz / silent signals), tempo estimation on a click track, C-major key detection on a synthesized triad, and spectrogram frame-cap behavior.

---

## Controls

| Action            | Input                                       |
| ----------------- | ------------------------------------------- |
| Walk              | **W A S D** or arrow keys                   |
| Look around       | Click scene → **mouse**                     |
| Free cursor       | **ESC**                                     |
| Play / Pause      | Bottom HUD transport                        |
| Change space      | Top-right HUD (Cathedral / Hall / Salon)    |
| Fold / unfold HUD | **▾ / ▸** on any panel                      |
| Exit to intro     | Bottom HUD "Exit"                           |

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
        │   ├── page.tsx          # orchestrates intro, scene, HUD, audio element
        │   ├── layout.tsx
        │   └── globals.css       # parchment + gilt theme
        ├── lib/
        │   ├── api.ts            # backend client + types
        │   ├── audio.ts          # Web Audio graph: analyser + convolution reverb
        │   ├── realtime.ts       # per-frame chroma / key / BPM
        │   ├── commentarySettings.ts
        │   └── store.ts          # zustand + key-to-color mapping
        └── components/
            ├── ui/
            │   ├── IntroOverlay.tsx
            │   ├── CommentarySettings.tsx
            │   ├── CommentaryTicker.tsx   # OVERVIEW + NUNC panel
            │   └── HUD.tsx                # collapsible panels
            └── webgl/
                ├── SpatialScene.tsx
                ├── TrebleParticles.tsx    # custom GLSL, bass/mid/treble/pulse
                ├── WalkControls.tsx       # WASD + pointer lock
                ├── pbr.ts
                ├── objects/
                │   └── GrandPiano.tsx
                └── spaces/
                    ├── Cathedral.tsx       # pointed arches, pipe organ, stained glass
                    ├── ConcertHall.tsx     # 3-tower organ façade, strings, chandelier
                    └── Salon.tsx           # French windows, candelabra, PBR parquet
```

---

## Notes

- Audio URLs are fetched server-side (size-capped at 80 MB, MIME-checked) and cached under `backend_cache`.
- The convolver's impulse response is synthesized per preset (early reflections + bandlimited noise × exponential decay) — 5.2 s RT60 for cathedral, 2.0 s for concert hall, 0.7 s for salon.
- Key detection uses Krumhansl–Kessler profile correlation over a CQT chroma (more stable than STFT chroma for organ / harpsichord timbres).
- Particle shader uses additive blending on a `THREE.Points` geometry with four live uniforms (`uBass`, `uMid`, `uTreble`, `uPulse`); the beat gate fires on RMS derivatives above 0.06 and decays exponentially each frame.
- All HUD panels (live analysis, space picker, transport, commentary) are collapsible via the `▾` / `▸` toggle in their headers.
