# TTS pronunciation: what's actually broken

- Status: complete
- Next: none — findings only; acted on in tts-speech-front-end.md

Investigation 2026-08-24, merging independent Claude and Codex passes, with the
disagreements resolved by measurement.

## The one-paragraph version

The normalizer was never the problem. `/` has always been normalized to the word
"slash" and espeak-ng has always phonemized it to `slˈæʃ`. The default voice,
`en_US-libritts_r-medium`, then fails to render it — along with much of the rest of
the sentence. Days of regex work went into patching a layer that was already correct.

## Three layers, three owners

Every pronunciation complaint belongs to exactly one of these. Diagnose the layer
before writing a rule.

| Symptom | Owner | How to check |
|---|---|---|
| Markdown, paths, URLs, numbers, dates, units | normalizer | `prepare_speech_text(t)` — read the string |
| Right word, wrong pronunciation ("live", "lives") | espeak-ng | `EspeakPhonemizer().phonemize("en-us", t)` — read the IPA |
| Correct phonemes, no audible word | voice model | synthesize with/without the word, compare wav duration |

Whisper round-trips are not evidence at any layer. A round-trip reported "slash" in
audio that did not contain it.

## Layer 3: the voice model (the actual bug)

`en_US-libritts_r-medium` omits words mid-sentence. All 39 installed voices were
swept: synthesize a 12-word sentence with and without three occurrences of "slash",
compare durations. A rendered word adds 0.28–0.60s.

Passing voices land at +1.28 to +1.53s (bryce, hfc_female, lessac, ryan and 27
more). `en_GB-northern_english_male-medium` is marginal at +0.14.
`en_US-libritts_r-medium` scores **−0.10** and `en_US-libritts-high` **−1.00**.

Full results: `~/voice/auditions/voice-word-drop-sweep.txt`.
**31 of 39 pass. Both LibriTTS families fail catastrophically.** Reproduced across
speaker ids 0/79/204/256 and length_scale 1.0/1.4 — the model, not the speaker or
the rate. Upstream: [rhasspy/piper#296](https://github.com/rhasspy/piper/issues/296).

This is not a Piper-wide defect and is not a reason to leave Piper. It is one bad
model that happened to be the default.

(`piper1-gpl#280` is sometimes cited here. It is a narrower, unresolved report about
one `ʤ` cluster in a nonsense word on 1.4.0, and one of the two voices it names,
`kristin-medium`, passes this sweep at +1.35. Different phenomenon — don't conflate.)

### Reopened, 2026-08-24 evening: LibriTTS-R is being replaced

The decision below held only as long as "slash" was the single affected word.
It is not. `:` measures the same way: espeak renders it as the word "colon"
(`kˈoʊlən`) and libritts-r-204 allocates +0.24 s against hfc_male's +0.43 s for
identical phonemes, three runs each. Grayson also still hears "livv" for the
adjective "live", which the substitution only hides.

That is three words papered over with substitutions, and the pattern is short
technical words generally, not a fixed list. A speech front end cannot fix a
model that will not say the words. Auditioning moved to the shipped catalogue:
31 of 39 installed voices PASS the word-drop sweep, so the shortlist was never
as narrow as it felt.

### Superseded decision, 2026-08-24: closed, keep LibriTTS-R

Held while "slash" looked like the only affected word. `stroke` measures +0.449s
on `libritts-r-204` against `slash` at +0.093s, and `lash` `flash` `crash` `slap`
`slice` `slow` `dash` all render, so it is not the `sl` cluster. Reproduced on
<https://piper.ttstool.com/>: the published model, not this install, and
inconsistent rather than incapable.

Respellings ("pslasch") survive one sentence, then hallucinate on repetition —
the word-morphing failure this document exists to stop. Do not reopen that.

## Layer 2: espeak-ng homographs

espeak-ng already handles more than `speech_rules.py` assumes. Verified correct with
no help: "The server is live" `lˈaɪv` · "I live in Ohio" `lˈɪv` · "are/was/were live" ·
"Two lives were lost" `lˈaɪvz` · "I have read" `ɹˈɛd` · "wind will wind down" ·
"close/close" · and `/` → "slash" in every context tested.

Two genuine failures:

- **"It is now live"** → `lˈɪv`.
- **Verb "lives" without a pronoun subject** → `lˈaɪvz`. "He lives here" is correct;
  "The runtime lives here" and "The config lives in etc" are wrong. espeak's POS
  tagger keys off a pronoun subject, which CLIde's prose rarely supplies.

So most of `DEFAULT_PRONUNCIATIONS` corrects an espeak bug that isn't there — but
`is live` → `is active` was found by ear and stays. Correct phonemes are not proof of
correct audio; that is the whole finding of Layer 3. Do not delete a rule someone
heard working on phoneme evidence alone.

### The fix mechanism: raw phonemes, not respelling

piper-tts 1.4.2 accepts inline `[[ lˈaɪvz ]]` blocks verbatim (`piper/voice.py`,
`_PHONEME_BLOCK_PATTERN` ~line 204); get strings from
`espeak-ng -v en-us --ipa=3 -q <word>`. Caveats:

- IPA, not Kirshenbaum.
- Only via `PiperVoice.phonemize()`. Calling `EspeakPhonemizer.phonemize()` directly
  spells the brackets out — that's why it can look broken.
- SSML `<phoneme>` is **not** supported; tags get read aloud as words.

This replaces the whole "respell it as `livz` / swap in a different word" category.

## Layer 1: the normalizer

### Is there a prebuilt one to adopt?

No drop-in for Piper — Piper delegates normalization to espeak-ng and offers no
plugin point. Of the real options:

- **NeMo-text-processing** / **WeTextProcessing** — the serious WFST normalizers;
  both need Pynini/OpenFst, impractical on Pi aarch64 + Python 3.13.
- **gruut** — archived, and its phonemes don't match espeak-trained Piper voices.
- **KittenTTS `normalize_text`** — Apache 2.0, pure Python, importable standalone,
  recommended elsewhere as a base. **Tested on CLIde content; worse than ours** and
  must not replace stage 1:

On CLIde content it deletes path slashes (`src/lib/foo.ts` → "src lib foo.ts"),
drops `~/`, reads `2026-08-24` as a subtraction, leaves `_italic_` markers in, and
has no notion of document structure or pauses.

**Verdict: vendor it as a parts bin, don't build on it.** Its `expand_*` functions are
genuinely better than ours and are the pieces we're missing.

### Bugs found in our normalizer while comparing

`The 1990s` → "the nineteen ninety *seconds*". `build:client` → "build. client" and
`3:30pm` → "3. 30pm", the colon becoming a sentence break. `2026-08-24` → "twenty
twenty six-08-24". `$12.50`, `50%`, `3/4` and roman numerals pass through raw.

The colon bug is the worst of these: it splits one sentence into two mid-identifier,
which also corrupts the pause structure.

## What's left

Superseded where it conflicts with the 2026-08-24 decision above: the default voice
stays `libritts-r-204`, and the substitution rules stay. Relative paths now render
through `_speak_file_path` like absolute ones and `~` speaks as "home"; a colon only
breaks a sentence when a space follows it, and clock times, decades, ISO dates,
currency, percentages and proper fractions are all spoken. Still open:

1. **Roman numerals.** Deliberately not done: "I" is a pronoun, "MIX", "DID" and
   "MI" are words, and the false positives would cost more than the misreadings.
   Revisit only with a measured failure behind it.
2. **Gate voices on the reference corpus.** Any voice failing the with/without
   duration test is rejected however good it sounds — `speech_probe.py drop` is the
   test. Worth surfacing as a button in the Studio next to the voice picker.
3. **Upgrade piper-tts 1.4.2 -> 1.7.0** opportunistically. The changelog is other
   languages' phonemizers and a C++ CLI, no English normalizer work, so it fixes
   nothing here — re-run the sweep after.

The Studio already shows prepared text, phonemes and measured pauses beside the
audio, which was the other half of this list.
