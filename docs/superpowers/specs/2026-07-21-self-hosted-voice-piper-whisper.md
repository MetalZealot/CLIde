# Self-hosted voice backend — whisper.cpp (STT) + Piper (TTS) via a local shim

**Status:** settled design, not yet deployed. This is an **ops/deployment spec, not an app-code
feature** — CLIde already ships the entire voice UI + proxy (`server/voice-proxy.js`,
`VoiceSettingsTab`, `useVoiceInput`/`useTts`/`voicePlayer`, mic button + `MessageSpeakControl`).
Nothing in `src/` or `server/` needs to change to *use* voice. The work is standing up **one small
shim service** on the Pi that wraps two prebuilt binaries, and pointing the CLIde service's
`VOICE_API_BASE_URL` at it.

Prerequisite context: CLIde's proxy is a thin relay to any OpenAI-compatible audio backend — STT
via `POST {base}/audio/transcriptions` (multipart `file` + `model` → `{ text }`), TTS via
`POST {base}/audio/speech` (`{ model, voice, input }` → audio bytes). Per-user Settings fields ride
as `x-voice-*` headers; **the outbound host is server-only** (`resolveConfig` hardcodes
`ENV.baseUrl`, ignoring any client base URL — deliberate SSRF defense, `voice-proxy.js:32-34`).

## Why this architecture (the decision, don't reopen)

The Pi has **no Docker/Podman** and runs **Python 3.13.5** (checked 2026-07-21). Two routes were
rejected:

- **Docker** (Speaches + openedai-speech images) — adds a daemon + a whole container skill to learn
  and babysit forever, resident RAM on a 4 GB Pi. Not installed; not worth adopting for this.
- **Native pip** (Speaches/openedai-speech in a venv) — depends on `ctranslate2`/`onnxruntime`
  arm64 wheels on Python 3.13, the fragile category that rots across OS upgrades.

**Chosen: prebuilt binaries + one shim.** Piper (prebuilt arm64 binary) and whisper.cpp (compiled
once) have **no dependency tree** — nothing goes through pip's native-wheel machinery, so the
Python-3.13 risk is sidestepped entirely. A single small HTTP shim exposes *both* OpenAI audio
endpoints on one port, which **collapses CLIde's single-base-URL constraint** (both endpoints share
`cfg.baseUrl`, `voice-proxy.js:174` & `:201`) with no nginx unifier and no second server.

### Long-term ownership (why this is the low-burden route)

- **Binaries don't rot or auto-update.** A working Piper/whisper.cpp binary keeps working for years,
  untouched, unbroken by unrelated updates. Updates are **opt-in**: drop in a newer model/voice
  file and restart; ignore for a year with no consequence.
- **The shim is write-once.** It speaks the frozen OpenAI audio contract and just shells out to
  binaries. Its only dependency is **Flask** — *pure* Python (no compiled wheels), the safe kind
  that installs on any Python and survives OS upgrades. Isolated in a venv so it never touches
  system Python.
- **One always-on process** (the shim, a systemd **user** service like CLIde). Piper/whisper.cpp are
  spawned per request and exit → **idle RAM ≈ zero**, no model resident in the 4 GB except during an
  actual transcription.
- **Fully decoupled from the CLIde repo.** Everything lives outside `~/Projects/cloudcli` (in
  `~/voice/`), and the only CLIde-side change is one `VOICE_API_BASE_URL` line in a systemd drop-in
  (also outside the repo). The `git rebase upstream/main` → `npm install` → build → restart loop
  **can never touch the voice stack**, and vice versa — separate clocks.
- **No security treadmill:** localhost-only, never network-facing, so no scheduled CVE patching.
- **Honest downsides:** the shim is *yours* (no upstream to file bugs against — but it's ~100
  readable lines doing one dull job); voice/model improvements are a manual download; the one fiddly
  setup step is compiling whisper.cpp with `make`.

⚠️ **Trap — do NOT `apt install piper`.** Debian's `piper` (Candidate `0.8-1`) is the **GNOME
gaming-mouse config tool**, unrelated to TTS. Piper-TTS comes only from the `rhasspy/piper` GitHub
release binary (or the `piper-tts` pip package). ffmpeg is already present on the Pi.

## Topology

```
CLIde Node server (voice-proxy.js, :3001)
        │  fetch VOICE_API_BASE_URL = http://127.0.0.1:8890   (no /v1 — proxy appends /audio/…)
        ▼
voice shim  (Flask, systemd user service, 127.0.0.1:8890)
   POST /audio/transcriptions ─► ffmpeg (→16k mono wav) ─► whisper.cpp ─► { text }
   POST /audio/speech          ─► piper (→wav) ─► [ffmpeg →mp3 if asked] ─► audio bytes
```

Everything binds `127.0.0.1` — no ufw rules (IPv4 or IPv6), no Tailscale, nothing public, because
CLIde calls it server-to-server over loopback.

## Layout on disk (all outside the repo)

```
~/voice/
  bin/        piper (arm64 binary), whisper.cpp build → whisper-cli
  models/     ggml-base.en.bin (whisper), en_US-ryan-high.onnx + .json (piper voice)
  shim/       app.py, .venv/ (Flask only)
```

## Component A — STT: whisper.cpp

Compile once from [ggerganov/whisper.cpp](https://github.com/ggerganov/whisper.cpp) (`make`), fetch a
`ggml` model. whisper.cpp is compiled C++ — no Python, dodges the wheel risk.

- **Model:** `ggml-base.en.bin` (≈140 MB) — accuracy ceiling that stays usable on a Pi 4 CPU;
  `ggml-tiny.en.bin` is the faster fallback. Non-live (record → send → transcribe) hides the
  multi-second latency.
- **Input handling:** the browser's `MediaRecorder` sends webm/opus, but whisper.cpp wants 16 kHz
  mono WAV — so the shim transcodes first: `ffmpeg -i <upload> -ar 16000 -ac 1 -f wav pipe:1`, then
  `whisper-cli -m models/ggml-base.en.bin -f - -nt -otxt` (no timestamps, text out), return
  `{ "text": <stdout> }`.

## Component B — TTS: Piper

Prebuilt arm64 binary from `rhasspy/piper` releases + one voice `.onnx` (+ its `.json`), ~20–65 MB.
Faster-than-real-time on Pi 4 CPU.

- **Synthesis:** `echo "<input>" | piper -m models/en_US-ryan-high.onnx --output_file -` → WAV on
  stdout.
- **Format:** return **WAV by default** (`voicePlayer` plays it; loopback size is a non-issue). Only
  if the request asks `response_format: mp3`, pipe through `ffmpeg -i - -f mp3 pipe:1`. Start with
  WAV; add the mp3 branch only if ever needed.

## The shim service

A single Flask app (`~/voice/shim/app.py`) in a venv, serving exactly the two paths CLIde calls:

- `POST /audio/transcriptions` — multipart `file` (+ ignored `model`) → `{ "text": ... }`
- `POST /audio/speech` — JSON `{ input, voice?, response_format? }` → audio bytes

The shim can **ignore the incoming `model`/`voice` fields** and use its configured whisper model +
Piper voice, so the client Settings model/voice fields are cosmetic and can be left blank/default.
(Later: map `voice` → an onnx path for multiple voices.) Spawn binaries per request via
`subprocess`; no long-lived model in memory.

**systemd user unit** `~/.config/systemd/user/voice-shim.service`:

```
[Unit]
Description=Voice shim (whisper.cpp STT + Piper TTS) for CLIde
After=network-online.target

[Service]
Type=simple
WorkingDirectory=/home/gnuthall/voice/shim
ExecStart=/home/gnuthall/voice/shim/.venv/bin/python app.py
Restart=always
RestartSec=5

[Install]
WantedBy=default.target
```

Lingering is already enabled on this Pi (CLIde runs as a user service), so it survives reboot/logout.
`systemctl --user enable --now voice-shim`.

## Wiring into CLIde

**1. Server base URL — systemd drop-in** (the `cloudcli.service` unit has no `EnvironmentFile`; add a
drop-in rather than editing the pinned-Node unit):

```
# ~/.config/systemd/user/cloudcli.service.d/voice.conf
[Service]
Environment=VOICE_API_BASE_URL=http://127.0.0.1:8890
```

`systemctl --user daemon-reload`, then restart cloudcli **from SSH only** (never in-session). No
`VOICE_API_KEY` — the shim needs no auth (`authHeader` omits it when the key is empty,
`voice-proxy.js:143`).

**2. Client Settings** (Settings → Voice, per browser/device, stored in `localStorage`): just
**Enable voice**. API key, models, voice, format can all stay **blank** — the shim ignores them.
Health check: `GET /api/voice/health` returns `{ configured: true }` once the env var is set.

## Pi 4 resource budget

- **Idle:** ~zero — only the tiny Flask listener; no model resident until a request runs.
- **STT burst:** whisper.cpp loads `base.en` (~140 MB) per invocation → a few seconds CPU per short
  clip. Fine for occasional dictation. If per-request model load feels sluggish, the **optimization**
  is whisper.cpp's `whisper-server` (keeps the model warm on a localhost port) with the shim proxying
  STT to it — defer until measured.
- **TTS burst:** Piper is light and faster-than-real-time; negligible.
- Baseline free RAM was 2.8 Gi (2026-07-21) — comfortable. **Check `free -h`** during the first real
  transcription anyway; drop STT to `tiny.en` if it squeezes.

## Optional code cleanup — the dead Base URL field (separate from this deploy)

`VoiceSettingsTab` renders an editable **Base URL** input, but the server ignores any client base URL
(`resolveConfig` always uses `ENV.baseUrl`) and `voiceConfigHeaders()` never sends it — so a user
typing their local URL there sees no effect. Worth a **TODO**: hide the field, or make it a read-only
"configured on server (`VOICE_API_BASE_URL`)" indicator driven off `/api/voice/health`.
Provider-agnostic surface, so it stays correct for OpenAI/Groq users too. Not required to ship voice.

## Rollout / verification steps

1. `free -h` baseline. Create `~/voice/{bin,models,shim}`.
2. **Piper:** download `rhasspy/piper` arm64 binary + one voice (`.onnx` + `.json`). Test:
   `echo "hello" | ./piper -m ../models/en_US-ryan-high.onnx --output_file test.wav` → plays.
3. **whisper.cpp:** clone + `make`; download `ggml-base.en.bin`. Test on a 16 k WAV:
   `./whisper-cli -m ../models/ggml-base.en.bin -f test.wav -nt` → prints text.
4. **Shim:** `python3 -m venv .venv && .venv/bin/pip install flask`; write `app.py`; run it; `curl`
   both endpoints on `127.0.0.1:8890` (multipart audio → `{text}`; JSON `input` → audio bytes).
5. Install + enable the `voice-shim` user unit; re-run the two curls.
6. Add the `cloudcli` drop-in; `daemon-reload`; restart cloudcli **from SSH**.
7. In the PWA: enable voice, hit `/api/voice/health`, then test the mic button (STT) and a message
   speak control (TTS). Watch `free -h` / load during a real transcription.

## Open questions / risks

- **whisper.cpp compile** is the one fiddly step (build tools + `make`) — the go/no-go for setup.
- **base.en latency** on this specific CPU is unmeasured — step 3's test is the gate; fall back to
  `tiny.en`, or adopt the warm `whisper-server` optimization, if a short clip feels too slow.
- **Shim language:** Flask (pure-Python, one safe dep) is the pick; a Node built-in-`http` shim is
  possible but reintroduces the system-v20-vs-nvm-v24 question — Flask sidesteps it.
- **First-run downloads** need network + disk: base.en ≈ 140 MB, one Piper voice ≈ 20–65 MB, Piper
  binary a few MB.
- **mp3 vs wav:** ship WAV; add the ffmpeg mp3 branch only if payload size ever matters.
```
