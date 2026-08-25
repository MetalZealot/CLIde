# Auditable text-to-speech preparation

- Status: complete
- Next: none — resume [self-hosted voice](self-hosted-voice.md) Phase 4
- Context: [self-hosted voice plan](self-hosted-voice.md),
  [Piper CLI](https://github.com/OHF-Voice/piper1-gpl/blob/main/docs/CLI.md),
  [eSpeak NG dictionaries](https://github.com/espeak-ng/espeak-ng/blob/master/docs/dictionary.md),
  and the host-local voice README, which owns runtime and deployment facts

The speech front end is the speech-only transformation between a stored
assistant reply and Piper. Whisper, and the visible/copied/exported reply,
are outside it.

## The measurement that ends the guessing

Synthesize a sentence with and without one word and compare audio duration.
A word the model renders adds 0.28–0.60 s; a word it drops adds under 0.15 s.
This is objective, needs three seconds per case, and needs no listening.

A Whisper round trip is **not** valid evidence here: it inserted `slash` into
the transcript of audio that did not contain it, which is what sent the earlier
work down two wrong paths.

## Phases

- [x] **1. Locate each failure in the pipeline.** Measured on
      `en_US-libritts_r-medium`, speaker 546, length 1.35, three runs per case:
      - **`slash` is dropped by the voice model, and only that word.** eSpeak
        emits the correct `slˈæʃ` and Piper passes all 83 phoneme ids to the
        model; the model then allocates it +0.00 s. `lash`, `flash`, `crash`,
        `splash`, `slap`, `sleep`, `slice`, `sling`, `slow`, `backslash`,
        `dash` and `stroke` all render normally, so it is not the `sl` cluster
        and not a phoneme-map gap. It reproduces on speakers 0/100/204/300/
        546/700/900 and survives `noise_w` 0.333–1.0, so it is neither
        speaker-specific nor duration-predictor noise. `hfc_male` and
        `rocket-raccoon` render it at +0.30–0.44 s from the identical ids.
      - **`URL` is not dropped** (+0.36 s). eSpeak fuses it to
        `jˌuːˌɑːɹɹˈɛl` — the "oourl" that was heard. Spacing it as `U R L`
        yields clean letter phonemes (+0.55 s).
      - **`is live` was never broken.** eSpeak already gives `lˈaɪv` in
        "the fix is live" and `lˈɪv` in "I live here".
      - **`lives` as a verb is a real eSpeak error**: "the runtime lives here"
        gets `lˈaɪvz`, the plural of *life*.
      - **`200 ms` is fused by eSpeak** into `tˈuːhˈʌndɹɪd ˌɛmˈɛs` with no word
        boundary, which is the drawn-out "two…… hundred" that was heard.
      Piper 1.4.2 phonemizes every case correctly, so the runtime version is
      not implicated in any of them.
- [x] **2. Cut the rules back to what the evidence supports.** `is live` →
      `is active` and `URL` → `web address` are gone; both fixed failures that
      did not exist. `URL` is now spaced to `U R L`, which corrects the actual
      eSpeak fusion. `diagonal stroke` is gone and a web address is one
      sentence again — the three-sentence split existed only to stop LibriTTS-R
      swallowing `slash`. The separator is a per-voice preset carrying a real
      word: `stroke` for LibriTTS-R and Jenny, `slash` for HFC and Rocket, each
      measured. The verb `lives` is respelled `livz`, restoring `lˈɪvz`. The
      normalizer now documents its four stages and every rule cites its
      measurement. 31 shim tests pass.
- [x] **3. Regression proof and voice acceptance.** Built: `speech_probe.py`
      measures word drops across the catalogue and prints stored → prepared →
      phonemes for any reply; `POST /audio/speech/prepare` returns the same
      trace live without synthesizing; the prepared text is logged per request.
      Sentence silence is now rounded to a whole 16-bit frame, with a test, so
      the static failure cannot recur. Scoring is relative to each voice's own
      rendering of a one-syllable reference word, because a fixed second-count
      threshold reported false drops on the faster voices. Recorded across the
      catalogue over `dot`, `port`, `commit`, `path`, `megabytes`,
      `milliseconds`, `omitted`, `slash`, `stroke`: the only true drop is
      `slash` on LibriTTS-R, at 26% of reference. Jenny reads it weak but
      present at 59%; Grayson could not hear it, so Jenny keeps `stroke` on his
      listening rather than on the probe. `audition.py` renders a reply, writes
      the WAV, and prints a measured pause map. Structure pauses — after a
      heading, list item, table row, or paragraph — are inserted between the
      sentence chunks of one Piper request, guarded so a sentence-count
      mismatch degrades to flat rhythm rather than corrupt audio; measured at
      570-620 ms against 360 ms between prose sentences. Remaining: his
      listening pass over the corpus, then resume self-hosted voice Phase 4.

      Correction from that pass: `is live` → `is active` was removed on
      phoneme evidence and is restored. eSpeak phonemises it correctly and the
      models still render it wrong, so listening outranks phonemes and the
      rule stays. Arrows, IPA and similar symbols are now dropped whole —
      eSpeak read `→` aloud as "right arrow" and `lˈaɪv` as "L stress a
      smallcap I V".

      Second correction pass, after more listening and an independent check on
      piper.ttstool.com: `slash` is closed as a voice-model limitation and the
      shortlist stands — see
      [the findings](tts-pronunciation-findings.md). Relative paths now render
      through the same spoken noun phrase as absolute ones
      (`src/lib/foo.ts` → "the src, lib, foo dot ts path"), so they no longer
      depend on the separator word at all; `~` speaks as "home"; a colon only
      ends a sentence when a space follows it, so `build:client` and `16:9`
      survive intact; and clock times are spoken. 53 shim tests. The shim and
      the studio are now tracked in this repository under `voice/`. The corpus
      the acceptance refers to is written down at
      `voice/studio/reference-corpus.md` — eight cases, one per class of
      failure, each naming what to listen for — and loads by name from a
      picker in the Speech tab, so a case can be replayed in seconds on a
      phone.

      Accepted by listening on 2026-08-24, on `libritts-r-204`. Three faults
      were caught by ear in that pass and fixed in `3c80ca03`: the bare unit
      rule read "That's" as "That seconds"; the `live` phrase list missed
      "Verified live", so it became an `unless` rule listing the verb's
      subjects instead; and a colon-turned-full-stop left the next word
      lowercase, which the model read as one long clause — measured at
      6.58-7.43 s against 6.05-6.38 s capitalised, three runs each and
      non-overlapping.

## Done when

- Every remaining transformation names the measured failure it fixes.
- The prepared speech text is visible for any generated audio.
- `slash`, `URL`, `lives`, `NutHall`, and fused numbers each either pass the
  corpus or carry a recorded voice-model limitation and an accepted fallback.
- The selected voices pass by human listening, with no inserted-silence
  artifacts.
- Self-hosted voice Phase 4 can close without new unclassified patches.

## Not doing

- Changing Whisper transcription; this plan owns text-to-speech input.
- Splitting one reply into several Piper renders and stitching silence between
  them. It was tried, produced an odd byte count against 16-bit samples, and
  turned the rest of the message into static. Per-sentence silence is Piper's
  own setting.
- Implementing full SSML, or a general document or screen reader.
- Retraining voice models, or upgrading Piper as part of this work: the
  measurements put every current failure in eSpeak or the model weights, not
  in the runtime.
- Treating a Whisper round trip, a waveform inspection, or any automated audio
  metric as listening acceptance.
