#!/usr/bin/env python3
"""Measure what a Piper voice actually renders, without listening.

Method: synthesize a carrier sentence with and without one word, and compare
audio duration. The result is scored against the same voice rendering a
reference word it is known to say, because a voice at length_scale 0.85 spends
less time on every word than one at 1.35 -- a fixed second-count threshold
reports false drops on the faster voices. Averaged over several runs, because
Piper's duration predictor is stochastic; run-to-run spread on a short word is wide enough that
fewer than three runs produces false drops. This answers "does the voice say
this word at all", not finer questions about pacing -- those need ears.

This exists because a Whisper round trip is not valid evidence here: Whisper
reported "slash" in LibriTTS-R audio that did not contain it, which sent an
earlier round of work down two wrong paths. Duration is measured from the
generated samples, so it cannot hallucinate.

Usage:
    ./speech_probe.py drop slash stroke dash        # every catalogue voice
    ./speech_probe.py drop --voice hfc-male-medium slash
    ./speech_probe.py say "Open https://example.com/path."
"""

from __future__ import annotations

import argparse
import sys

from piper import PiperVoice
from piper.config import SynthesisConfig

from app import VOICE_PRESETS, VOICE_ROOT, VoicePreset
from normalizer import prepare_speech_text

CARRIER = "Open example dot com {word} path."
CARRIER_WITHOUT = "Open example dot com path."
# A word every tested model renders, used to calibrate each voice's own pace.
# One syllable, so that single-syllable candidates are compared like for like.
REFERENCE_WORD = "dash"
# Below this share of the reference word's duration, the model is not saying it.
DROPPED_BELOW_SHARE = 0.35
RUNS = 3


def _load(preset: VoicePreset) -> tuple[PiperVoice, SynthesisConfig]:
    voice = PiperVoice.load(str(VOICE_ROOT / "models" / f"{preset.model_id}.onnx"))
    config = SynthesisConfig(speaker_id=preset.speaker_id)
    if preset.length_scale is not None:
        config.length_scale = preset.length_scale
    return voice, config


def _duration(voice: PiperVoice, config: SynthesisConfig, text: str) -> float:
    total = 0.0
    for chunk in voice.synthesize(text, config):
        total += len(chunk.audio_int16_bytes) / 2 / chunk.sample_rate
    return total


def _mean_duration(voice, config, text: str, runs: int) -> float:
    return sum(_duration(voice, config, text) for _ in range(runs)) / runs


def probe_drops(voice_ids: list[str], words: list[str], runs: int) -> int:
    dropped = 0
    for voice_id in voice_ids:
        preset = VOICE_PRESETS[voice_id]
        voice, config = _load(preset)
        baseline = _mean_duration(voice, config, CARRIER_WITHOUT, runs)
        reference = _mean_duration(
            voice, config, CARRIER.format(word=REFERENCE_WORD), runs
        ) - baseline
        print(f"{voice_id}  ({preset.model_id}, speaker {preset.speaker_id}, "
              f"length {preset.length_scale}, baseline {baseline:.2f}s, "
              f"{REFERENCE_WORD} {reference:+.3f}s)")
        for word in words:
            delta = _mean_duration(voice, config, CARRIER.format(word=word), runs) - baseline
            share = delta / reference if reference > 0 else 0.0
            verdict = "DROPPED" if share < DROPPED_BELOW_SHARE else "rendered"
            dropped += verdict == "DROPPED"
            print(f"    {word:<14} {delta:+.3f}s  {share:5.0%} of reference  {verdict}")
    return dropped


def show_speech(text: str, voice_id: str) -> None:
    preset = VOICE_PRESETS[voice_id]
    prepared = prepare_speech_text(text, preset.path_separator)
    voice, _ = _load(preset)
    print(f"voice     {voice_id}  (separator {preset.path_separator!r})")
    print(f"stored    {text!r}")
    print(f"prepared  {prepared!r}")
    print("phonemes")
    for sentence in voice.phonemize(prepared):
        print(f"    {''.join(sentence)}")


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)

    drop = sub.add_parser("drop", help="measure whether a voice renders a word")
    drop.add_argument("words", nargs="+")
    drop.add_argument("--voice", action="append", dest="voices")
    drop.add_argument("--runs", type=int, default=RUNS)

    say = sub.add_parser("say", help="show prepared text and phonemes for a reply")
    say.add_argument("text")
    say.add_argument("--voice", default="hfc-male-medium")

    args = parser.parse_args(argv)
    if args.command == "say":
        show_speech(args.text, args.voice)
        return 0

    voices = args.voices or list(VOICE_PRESETS)
    unknown = [v for v in voices if v not in VOICE_PRESETS]
    if unknown:
        parser.error(f"unknown voice(s): {', '.join(unknown)}")
    # One representative per model: speakers of one model behave alike.
    if not args.voices:
        seen: set[str] = set()
        voices = [v for v in voices
                  if not (VOICE_PRESETS[v].model_id in seen
                          or seen.add(VOICE_PRESETS[v].model_id))]
    return 1 if probe_drops(voices, args.words, args.runs) else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
