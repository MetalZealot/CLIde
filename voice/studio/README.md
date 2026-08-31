# Voice Studio

Standalone, private experiment for the local voice paths. Built for a phone:
five bottom tabs, nothing native, and no menu that runs taller than a thumb.

- **Speak** auditions one voice against one script through the running
  `voice-shim` service on 8890. A CLIde preset uses its real production pacing;
  an arbitrary installed model uses the same speech preparation and saved
  pronunciation rules with audition pacing. Prepared text, phonemes and the
  measured pause map are there, collapsed. Its Advanced panel can load the
  selected model's defaults, the current CLIde settings, or the historic
  LibriTTS-R Natural preset, then vary speed, safe pauses, noise, phoneme
  width, volume, and normalization for that audition only.
- **Recordings** keeps explicitly saved Speak output under `~/voice/recordings`.
  Each WAV retains its source text, selected voice, loaded preset, and exact
  render settings; it can be played, downloaded, or deleted from the Studio.
- **Favorites** is the list being compiled for CLIde: every kept voice with its
  model, speaker, speed, gender label and a free-text note. **Export** prints
  them as a `VOICE_PRESETS` block to paste into `../shim/app.py`.
- **Rules** edits the pronunciation lexicon and the per-voice pacing that the
  service uses. Save, then press Speak it — no restart.
- **Dictation** records or uploads audio and compares `tiny.en` and `base.en`.
  **Save to CLIde** stores the chosen model, decoder, threads, vocabulary
  prompt, and microphone processing; the next CLIde recording uses them.

The **Save recording** action appears only after synthesis. It moves that exact
generated WAV into the recordings library rather than rendering the text a
second time. Unsaved output expires from temporary storage after one hour.

## Picking a voice out of ~1,800

Dozens of models are installed and two of them carry 904 speakers each, so the
picker is a full-screen sheet rather than a dropdown: search, two rows of filter
chips, and a drill-down into a model's speakers. Named casts show their names; a
corpus of reader ids is numbered instead. Inside a model, **Unheard** hides
everything already auditioned and **Random unheard** jumps to one, which is the
only way a 900-speaker model gets swept.

The second chip row filters the catalogue itself, by quality (`low`, `medium`,
`high`, and `other` for a model that names its own) and by language, each chip
carrying how many models it holds. They combine, they survive closing the sheet,
and the count line under them names whichever are active — the strip scrolls, so
that line is the only place both are always visible. The presets group hides
while a catalogue filter is on, because a preset is a curated choice rather than
a catalogue entry.

Both facets come from each model's own config. Two spellings are tidied because
they mean one thing: `en-us` is merged into `en_US`, and the jane-eyre model's
`EnglishBritish` into `en-GB`. Everything else is reported exactly as declared,
including `unknown` for the two models that declare no language at all.

## Labels and favorites

Every judgement is written to `voice-labels.json` beside the speech rules, not
to the browser, so it survives a refresh and follows you from phone to desktop.
A voice is keyed by model and speaker (`en_US-libritts_r-medium#546`); an entry
that has lost its gender, star, note and heard flag is deleted rather than kept
empty, so "unlabeled" stays an honest filter. Speaking a voice marks it heard.

## Changing how CLIde sounds

Most of it is editable from the **Rules** tab, and saved to
`../shim/speech_rules.json`:

- **Pronunciation** — respell a word. Three match modes: `word` (whole word,
  any case), `phrase` (an exact run of words), and `before` (a word, but only
  when followed by one of a list — that is how the verb "lives" is caught
  without touching "nine lives"). Match text is escaped, never treated as a
  pattern, so `c++` is safe to type. A replacement keeps the matched word's
  leading or all-caps form, so `Lives` becomes `Livz` while `lives` stays
  `livz`.
- **Voice pacing** — speed, the sentence pause, the structure pause (after a
  heading, list item, table row, or paragraph), and the word spoken for `/`.

Only values you actually change are written to the file, so `overridden` stays
meaningful. Delete `speech_rules.json` to return to the built-in defaults. A
malformed file is logged and ignored rather than breaking speech.

Pronunciation rules are collapsed to one-line summaries. The Add action stays
at the top while that list scrolls; it inserts an expanded rule first and puts
the cursor in its match field.

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
the 4 GB Pi. Dictation can compare a short initial vocabulary prompt, one of two
reproducible decoder presets, one to four CPU threads, and browser microphone
processing. Keep those settings fixed while comparing models, then vary one
setting at a time. Saving chooses one model and writes the complete preset to
the same data file the CLIde runtime reloads; temporary comparisons remain
audition-only.

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
