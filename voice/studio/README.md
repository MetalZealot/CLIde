# Voice Studio

Standalone, private experiment for the local voice paths.

- **Speech** is what CLIde actually says. It posts to the running `voice-shim`
  service on 8890 and shows the prepared text, the eSpeak phonemes, and a pause
  map measured from the returned audio. Nothing is duplicated here, so it
  cannot drift from the app.
- **Rules** edits the pronunciation lexicon and the per-voice pacing that the
  service uses. Save, then press Speak — no restart.
- **Dictation** records or uploads audio and compares `tiny.en` and `base.en`.

The old free-form Read aloud tab is gone; its normalizer was a stale copy and
auditions there disagreed with the app.

## Changing how CLIde sounds

Most of it is now editable from the **Rules** tab, and saved to
`../shim/speech_rules.json`:

- **Pronunciation** — respell a word. Three match modes: `word` (whole word,
  any case), `phrase` (an exact run of words), and `before` (a word, but only
  when followed by one of a list — that is how the verb "lives" is caught
  without touching "nine lives"). Match text is escaped, never treated as a
  pattern, so `c++` is safe to type.
- **Voice pacing** — speed, the sentence pause, the structure pause (after a
  heading, list item, table row, or paragraph), and the word spoken for `/`.

Only values you actually change are written to the file, so `overridden` stays
meaningful. Delete `speech_rules.json` to return to the built-in defaults. A
malformed file is logged and ignored rather than breaking speech.

What still needs a code edit in `../shim/normalizer.py`, because it is
structural rather than a judgement about one word: Markdown handling, numbers,
units, ports, file paths, URLs, and which characters get dropped.

| Symptom | Where |
|---|---|
| Prepared text is wrong | Rules tab, or `shim/normalizer.py` for structure |
| Prepared text right, phonemes wrong | Rules tab — respell the word |
| Both right, still sounds wrong | the voice model; try another voice |
| Pauses too short or long | Rules tab, voice pacing |

Run:

```sh
cd ~/voice/studio
$VENV/python app.py --host 127.0.0.1 --port 8892
```

Open `http://127.0.0.1:8892` on the Pi, or use an SSH port forward from another
machine:

```sh
ssh -L 8892:127.0.0.1:8892 gnuthall@YOUR_PI
```

Then open `http://127.0.0.1:8892` on that machine. Do not bind it to a public
interface; this demo has no authentication. The active private phone URL is:

```text
https://nuthallpi.tailb083b8.ts.net:8892/
```

It is HTTPS because mobile browsers require a secure context for microphone
recording. The Tailscale proxy stays private to the Tailnet.

The Studio serializes Piper synthesis and Whisper transcription through one
inference gate. This prevents two four-core inference jobs from competing on
the 4 GB Pi. The Whisper tab sends `tiny.en` or `base.en` only when auditioning;
an eventual CLIde `model=whisper-1` request remains mapped to `tiny.en`.
Its Advanced dictation settings can compare a short initial vocabulary prompt,
one of two reproducible decoder presets, and one to four CPU threads. Browser
microphone processing is recorded with each take. Keep those settings fixed
while comparing models, then vary one setting at a time.

Whisper's OpenAI-style endpoint remains available for testing:

```sh
curl -F 'file=@/home/gnuthall/voice/tech-prop-noun.m4a' \
  http://127.0.0.1:8892/audio/transcriptions
```

Tests:

```sh
cd ~/voice/studio
$VENV/python -m unittest -v
```

The transient live service is named `voice-studio`; it is intentionally not
enabled at boot. Its status and logs are available with:

```sh
systemctl --user status voice-studio
journalctl --user -u voice-studio -f
```

`$VENV` is `~/voice/.venv/bin`; see `../shim/README.md` for the code/data
split.
