#!/usr/bin/env python3
"""Render one message the way CLIde would, so you can listen to it.

    ./audition.py "Some **markdown** reply."
    ./audition.py --file reply.md --voice hfc-male-medium
    ./audition.py --file reply.md --show-phonemes

Prints the prepared text Piper receives, writes a WAV under
~/voice/auditions/, and prints where the pauses actually landed. The pause map
is measured from the samples, so it is objective -- but it only tells you where
silence is, never whether a word sounded right. Only your ears do that.
"""

from __future__ import annotations

import argparse
import array
import re
import sys
import wave
from datetime import datetime
from pathlib import Path

from app import VOICE_PRESETS, VOICE_ROOT, voice_cache
from normalizer import speech_segments

AUDITION_DIR = VOICE_ROOT / "auditions"
SILENCE_AMPLITUDE = 900          # 16-bit sample magnitude counted as silence
MIN_REPORTED_PAUSE_MS = 80
WINDOW_MS = 10


def pause_map(wav_path: Path) -> list[tuple[float, int]]:
    """Silent runs as (start seconds, duration ms), measured from the samples."""
    with wave.open(str(wav_path)) as wav_file:
        rate = wav_file.getframerate()
        samples = array.array("h", wav_file.readframes(wav_file.getnframes()))

    window = max(1, rate * WINDOW_MS // 1000)
    quiet: list[bool] = []
    for start in range(0, len(samples), window):
        block = samples[start:start + window]
        quiet.append(max((abs(value) for value in block), default=0) < SILENCE_AMPLITUDE)

    pauses: list[tuple[float, int]] = []
    run_start: int | None = None
    for index, is_quiet in enumerate([*quiet, False]):
        if is_quiet and run_start is None:
            run_start = index
        elif not is_quiet and run_start is not None:
            duration_ms = (index - run_start) * WINDOW_MS
            if duration_ms >= MIN_REPORTED_PAUSE_MS:
                pauses.append((run_start * WINDOW_MS / 1000, duration_ms))
            run_start = None
    return pauses


def describe_pauses(prepared: str, pauses: list[tuple[float, int]], total: float) -> None:
    # Sentence count is what Piper splits on, so it bounds the expected pauses.
    sentences = [s for s in re.split(r"(?<=[.!?])\s+", prepared) if s]
    print(f"\naudio      {total:.2f}s, {len(sentences)} sentences, "
          f"{len(pauses)} pauses over {MIN_REPORTED_PAUSE_MS} ms")
    if not pauses:
        print("           no pauses found -- everything ran together")
        return
    longest = max(pauses, key=lambda pause: pause[1])
    print(f"           shortest {min(p[1] for p in pauses)} ms, "
          f"longest {longest[1]} ms at {longest[0]:.2f}s")
    for at, duration_ms in pauses:
        print(f"    {at:7.2f}s  {duration_ms:5d} ms")


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("text", nargs="?", help="message text; omit with --file")
    parser.add_argument("--file", type=Path)
    parser.add_argument("--voice", default="hfc-male-medium")
    parser.add_argument("--out", type=Path)
    parser.add_argument("--show-phonemes", action="store_true")
    args = parser.parse_args(argv)

    if args.voice not in VOICE_PRESETS:
        parser.error(f"unknown voice {args.voice!r}; try one of {', '.join(VOICE_PRESETS)}")
    if bool(args.text) == bool(args.file):
        parser.error("give either a text argument or --file, not both")

    raw = args.file.read_text() if args.file else args.text
    preset = VOICE_PRESETS[args.voice]
    prepared, structure_flags = speech_segments(raw, preset.path_separator)
    print(f"voice      {args.voice}  (separator {preset.path_separator!r}, "
          f"length {preset.length_scale}, silence {preset.sentence_silence_seconds}s, "
          f"structure {preset.structure_silence_seconds or preset.sentence_silence_seconds * 2}s)")
    print(f"prepared   {prepared}")
    if args.show_phonemes:
        print("phonemes")
        for sentence in voice_cache.phonemize(preset, prepared):
            print(f"    {''.join(sentence)}")

    wav_bytes, frames, rate = voice_cache.synthesize(
        preset, prepared, None, structure_flags
    )
    AUDITION_DIR.mkdir(parents=True, exist_ok=True)
    out = args.out or AUDITION_DIR / (
        f"{datetime.now():%Y%m%d-%H%M%S}-{args.voice}.wav"
    )
    out.write_bytes(wav_bytes)
    describe_pauses(prepared, pause_map(out), frames / rate if rate else 0.0)
    print(f"\nwrote      {out}")
    print(f"play with  aplay {out}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
