# CLIde voice shim

Loopback-only OpenAI-compatible service for CLIde's self-hosted voice paths.
It combines whisper.cpp dictation and Piper read-aloud.

## Where things live

The code is here, in the CLIde repository, under version control. Everything
that is data stays outside it, under `~/voice`:

| path | holds |
|---|---|
| `~/voice/.venv` | the Python environment (`$VENV` below is `~/voice/.venv/bin`) |
| `~/voice/models` | the Piper `.onnx` voices and the Whisper `.bin` models |
| `~/voice/bin/whisper.cpp` | the compiled whisper.cpp build |
| `~/voice/speech_rules.json` | your saved dictation, microphone, pronunciation, and pacing settings |
| `~/voice/auditions` | rendered `.wav` output |

`~/voice/shim` is a symlink into this checkout, so the service runs the tracked
runtime code directly. Voice Studio is a separate private tool whose stable
`~/voice/studio` symlink points to its own repository. Set `CLIDE_VOICE_ROOT`
to move the shared data elsewhere.

The shim is installed as the enabled `voice-shim` systemd user service and is
ready on loopback. CLIde's isolated Phase 4 server is configured to call it;
production CLIde is unchanged pending installed-PWA acceptance. The initial
default is `hfc-male-medium`.

The browser microphone API requires an HTTPS origin on a phone. Plain-HTTP
branch-test slots cannot provide phone microphone acceptance.

## Service

```sh
systemctl --user status voice-shim
systemctl --user restart voice-shim
journalctl --user -u voice-shim -f
```

The unit lives at `~/.config/systemd/user/voice-shim.service`, starts with the
user's default target, and runs:

```sh
cd ~/voice/shim
$VENV/python app.py --host 127.0.0.1 --port 8890
```

The process must remain bound to `127.0.0.1`. It serializes STT and TTS through
one inference lock and returns `429` instead of running two four-core jobs at
once. Piper retains only the most recently used model in memory.

`requirements.lock` is the exact Python environment snapshot. The live
integration uses `piper-tts==1.7.0` and whisper.cpp 1.8.6. Piper 1.7.0 passed
selected-voice listening plus the controlled 6,000-character Pi benchmark.

## Transcription contract

`POST /audio/transcriptions` accepts multipart field `file` and optional
`model`. Blank and `whisper-1` use the Voice Studio selection; an explicit
`tiny.en` or `base.en` remains a request-level override. The saved decoder,
thread count, and vocabulary prompt apply to the next CLIde transcription
without a restart. Voice Studio stores the browser microphone-processing
choices beside them; CLIde reads those through voice health before opening the
microphone.
Uploads are limited to 25 MiB and the allowlisted AAC, M4A, MP3, OGG, OPUS, WAV,
and WebM extensions. Audio is converted to temporary 16 kHz mono PCM WAV, then
deleted automatically after the bounded whisper.cpp call.

```sh
curl -F 'file=@/home/gnuthall/voice/tech-prop-noun.m4a' \
  http://127.0.0.1:8890/audio/transcriptions
```

The response body is exactly `{"text":"..."}`. Timing, model, threads, audio
duration, and peak Whisper RSS are returned in `X-Voice-*` headers.

## Speech contract

`POST /audio/speech` accepts OpenAI-style JSON containing `input`, `voice`, and
optional `model` and `response_format`. Model may be blank or `tts-1`; format may
be blank or `wav`. The response is raw `audio/wav` bytes.

CLIde sends a unique `X-Voice-Job-ID` with each request. Posting that id as
`{"job_id":"..."}` to `/audio/speech/cancel` stops the matching generation at
the next Piper audio chunk and releases the inference lock. A newer speech
request also cancels an older speech job before starting; it never supersedes a
Whisper transcription. Requests without the header remain compatible but cannot
be targeted later by an external cancellation call.

The service normalizes a speech-only copy of the input. CLIde's rendered,
stored, copied, and exported response remains unchanged. Markdown markers and
emoji are removed, fenced code is omitted, short inline code and meaningful
symbols are retained, and links and tables are converted to speakable text.
Speech punctuation preserves header, table-cell, table-row, and list-item
boundaries; em dashes become short comma pauses because Piper does not pause for
them consistently. Short numbers and years are written out for smoother pacing;
ports, numeric commit ids, and hexadecimal inline hashes are spelled character
by character. Storage units expand to their full names. Simple web addresses
speak their domain and up to three path segments; addresses with credentials,
queries, fragments, or longer paths are omitted. Filesystem paths speak as a
comma-separated location rather than a chain of slash tokens. A web address is
one sentence: URL path separators use "stroke" for AgentVibes Jenny and
"slash" for the other selected voices. The `URL` initialism is spaced to
`U R L`, and "is live" becomes "is active" -- that one was found by ear, and
eSpeak's phonemes argue against it, so do not remove it on phoneme evidence.
Smart quotes, apostrophes, dashes, ranges and ellipses are converted without
losing their surrounding words. Common arrows use their sentence context;
maths, measurements, status marks, sections and common Greek letters use
spoken meanings. Decorative legal marks are silent without deleting the name
beside them. IPA remains a whole-token omission, because stripping the
modifiers out of "lˈaɪv" leaves "l a v". Prose colons become full stops;
the verb "lives" is respelled "livz"; and the exact `gnuthall` path component
uses its accepted "G NutHall" pronunciation.

Every rule above cites a measurement in `normalizer.py`. Two earlier
substitutions were removed as misdiagnoses: `URL` was never dropped (eSpeak
merely fused it), and eSpeak already phonemises "the fix is live" correctly.

## Diagnosing a speech failure

`POST /audio/speech/prepare` takes the same `input` and `voice` and returns the
stored reply, the prepared text, the separator, and — with `"phonemes": true` —
the eSpeak phonemes, without synthesizing anything. Compare the three: a wrong
prepared text is the normalizer, wrong phonemes are eSpeak, and correct
phonemes that still sound wrong are the voice model.

`./audition.py` renders a message the way CLIde would, writes the WAV, and
prints where the pauses landed:

```sh
$VENV/python audition.py --file reply.md --show-phonemes
aplay ~/voice/auditions/<the file it names>
```

The pause map is measured from the samples, so it is objective about *where*
silence is. It says nothing about whether a word sounded right -- only ears do.

Each voice baseline has `length_scale`, `sentence_silence_seconds`, and
`structure_silence_seconds`; unset structure silence defaults to twice the
sentence pause. The daily `speech_pace` multiplier scales speech and both gaps
together without overwriting those baselines.

Structure pauses are inserted between the sentence chunks of a **single**
Piper request. The static failure came from splitting a reply into several
separate renders, which is a different thing and is not done here.

`./speech_probe.py` measures the last case without listening:

```sh
$VENV/python speech_probe.py drop slash stroke     # every voice family
$VENV/python speech_probe.py say "Open https://example.com/path."
```

It synthesizes a carrier sentence with and without a word and compares audio
duration. A rendered word adds 0.28-0.60s; a dropped word adds under 0.15s.
Never use a Whisper round trip for word-drop measurements.

The initial runtime default is `hfc-male-medium`; Voice Library can replace it
with any installed model/speaker ID. Blank and OpenAI's `alloy` alias use the
saved daily selection when one exists, otherwise the saved runtime default.
Direct requests may use these internal, non-user-facing ids:

| Voice id | Settings label | Group | Piper asset |
|---|---|---|---|
| `danny-low` | Danny | Male · Low | `en_US-danny-low` |
| `hfc-male-medium` | HFC Male | Male · Medium | `en_US-hfc_male-medium` |
| `kusal-medium` | Kusal | Male · Medium | `en_US-kusal-medium` |
| `rocket-raccoon-medium` | Rocket Raccoon | Male · Bonus | `en_US-rocket-raccoon-medium` |
| `lessac-low` | Lessac | Female · Low | `en_US-lessac-low` |
| `hfc-female-medium` | HFC Female | Female · Medium | `en_US-hfc_female-medium` |
| `cori-medium` | Cori | Female · Medium GB | `en_GB-cori-medium` |
| `agentvibes-jenny` | AgentVibes Jenny | Female · Bonus | `agentvibes-jenny` |

Rocket Raccoon's exact local ONNX and config Git blobs match
[`cosycove/BeefStew` at `5bb2191`](https://github.com/cosycove/BeefStew/tree/5bb2191bf64af7da19b1da7994dc355200fb29f1/src/data/tts_voices),
whose repository declares the MIT licence. That repository provides no
model-specific training-data or voice-likeness provenance, so Rocket remains a
user-installed bonus voice and its weights must not be bundled with CLIde.

Previously accepted presets remain part of the production catalog: HFC Male and
Female use length `0.90` with `100 ms` sentence pauses, Rocket Raccoon uses
length `0.85`, and AgentVibes Jenny uses `200 ms` sentence pauses. The other
voices use their model speed with no inserted sentence pause. A later Settings
speed control may adjust those starting points.

```sh
curl -sS http://127.0.0.1:8890/audio/speech \
  -H 'Content-Type: application/json' \
  -d '{"model":"tts-1","voice":"hfc-male-medium","input":"Hello from CLIde","response_format":"wav"}' \
  --output /tmp/clide-voice.wav
```

The 6,000-character limit is the measured Pi-safe ceiling. It generated 315.6
seconds of audio in 110.8 seconds with about 534 MiB peak server RSS and no
thermal limit. A controlled cold 12,000-character retry started at 47.2 C after
five continuous minutes below 55 C, then reached the 78 C safety cutoff after
195 seconds. It was stopped before throttling, confirming that 12,000 is not a
safe production limit on this host.

## Health and tests

`GET /api/health` reports installed STT and selected TTS assets. The richer
`GET /api/voice-settings` contract publishes safe installed-model IDs,
favorites, optional friendly display names, the writable runtime default and
daily selection, exact timing baseline, pace, every installed `ggml-*.bin`
Whisper model, STT settings, and capabilities. `PUT` changes these shared daily
settings. Display names are keyed by the stable model or model-and-speaker ID;
blanking one restores the runtime's original name without changing voice
identity. `GET|PUT /api/voice-labels` owns Studio-only gender, heard state, and
audition notes as well as the shared favorite bit.

```sh
cd ~/voice/shim
$VENV/python -m unittest -v
```

The separate private Voice Studio remains the audition and diagnostic lab.
Favorite, display-name, tuning, and STT edits go through this runtime so Studio
and CLIde cannot drift into separate settings stores. Gender balance, heard
state, and audition notes remain Studio metadata and are not published in
CLIde's shared settings contract.
