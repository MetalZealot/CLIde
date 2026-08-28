#!/usr/bin/env python3
"""Render raw and speech-normalized Markdown with the same Piper voice.

This is an audition tool, not CLIde integration code. It keeps the original
message intact and saves the exact normalized text used for comparison.
"""

from __future__ import annotations

import argparse
import html
import re
import subprocess
from pathlib import Path


VOICE_ROOT = Path("/home/gnuthall/voice")
DEFAULT_MODEL = "en_US-lessac-medium"
DEFAULT_SAMPLE = """# A short Markdown read-aloud test

Hello, **CLIde**. ✅ This is *emphasized*, and this is `inline code`. 🚀

- First item: use `npm run typecheck`.
- Second item: see [the project guide](https://example.invalid/guide).

Shopping list:

- apples
- bread
- tea

Steps:

1. Open Settings
2. Choose Voice
3. Save

> This is a quoted reminder.

| Check | Result |
| --- | --- |
| TTS | Ready |
| STT | Later |

```sh
# This command should not be read aloud.
npm run build:client
```

Here is      deliberately irregular whitespace
that should     become one natural spoken sentence.

For literal symbols, C# and 3 * 7 should still make sense. 👍
"""

EMOJI = re.compile(r"[\U0001F000-\U0001FAFF\U0001FC00-\U0001FFFD\u2600-\u27BF]+")
LIST_ITEM = "\ufff0"
LIST_END = "\ufff1"


def markdown_for_speech(markdown: str) -> str:
    """Conservatively turn common Markdown into plain, speakable prose.

    Code fences are deliberately replaced, rather than read character by
    character. Inline code is retained because it commonly contains a useful
    short command or identifier.
    """
    text = re.sub(
        r"```[^\n]*\n.*?```",
        "\n[See the code block in this message]\n",
        markdown,
        flags=re.DOTALL,
    )
    text = re.sub(r"^\s{0,3}#{1,6}\s+", "", text, flags=re.MULTILINE)
    text = re.sub(r"^\s{0,3}>\s?", "", text, flags=re.MULTILINE)
    # Preserve list boundaries until whitespace is normalized below. List items
    # need a prose pause even when the writer omitted terminal punctuation.
    text = re.sub(r"^\s{0,3}(?:[-+*]|\d+[.)])\s+", LIST_ITEM, text, flags=re.MULTILINE)
    # Prefer a link's visible label; URLs are usually noise in read-aloud.
    text = re.sub(r"\[([^\]]+)\]\([^)]*\)", r"\1", text)
    text = re.sub(r"!\[([^\]]*)\]\([^)]*\)", r"\1", text)
    # Remove matched formatting delimiters only. Do not strip arbitrary stars:
    # `3 * 7`, C#, glob patterns, and Markdown examples may be intentional.
    for delimiter in ("**", "__", "~~"):
        escaped = re.escape(delimiter)
        text = re.sub(rf"(?<!\\){escaped}([^\n]+?){escaped}", r"\1", text)
    text = re.sub(r"(?<!\\)`([^`\n]+)`", r"\1", text)
    text = re.sub(r"(?<!\\)\*([^\s*](?:[^*\n]*[^\s*])?)\*(?!\w)", r"\1", text)
    text = re.sub(r"(?<!\\)_([^\s_](?:[^_\n]*[^\s_])?)_(?!\w)", r"\1", text)
    # A Markdown table becomes short, readable rows. Separator rows disappear.
    rows = []
    for line in text.splitlines():
        if "|" not in line:
            rows.append(line)
            continue
        cells = [cell.strip() for cell in line.strip().strip("|").split("|")]
        if cells and all(re.fullmatch(r":?-{3,}:?", cell) for cell in cells):
            continue
        rows.append(". ".join(cell for cell in cells if cell))
    text = html.unescape("\n".join(rows))
    # Emoji and decorative symbols make most Piper voices stumble or invent words.
    text = EMOJI.sub("", text).replace("\ufe0e", "").replace("\ufe0f", "").replace("\u200d", "")
    # Preserve list and paragraph boundaries as a pause, then make all other
    # whitespace predictable. This avoids Piper treating indentation and line
    # wrapping as speech content while not running separate prose together.
    text = re.sub(rf"{LIST_ITEM}(.*?)(?=\n|$)", rf"\1{LIST_END}", text)
    text = re.sub(rf"{LIST_END}\s*", ". ", text)
    text = re.sub(r"\n\s*\n+", ". ", text)
    text = re.sub(r"\s+", " ", text)
    text = re.sub(r"\s+([,.;!?])", r"\1", text)
    return re.sub(r"\.{2,}", ".", text).strip()


def render(piper: Path, model: str, text: str, output: Path) -> None:
    subprocess.run(
        [str(piper), "-m", model, "--data-dir", str(VOICE_ROOT / "models"), "-f", str(output), "--", text],
        check=True,
    )


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model", default=DEFAULT_MODEL)
    parser.add_argument("--input", type=Path, help="Markdown input file; uses built-in sample if omitted")
    parser.add_argument("--output-dir", type=Path, default=VOICE_ROOT / "auditions" / "markdown-cleanup")
    args = parser.parse_args()

    piper = VOICE_ROOT / "shim" / ".venv" / "bin" / "piper"
    if not piper.is_file():
        raise SystemExit(f"Piper is not installed: {piper}")
    if not (VOICE_ROOT / "models" / f"{args.model}.onnx").is_file():
        raise SystemExit(f"Model not found: {args.model}")

    raw = args.input.read_text() if args.input else DEFAULT_SAMPLE
    cleaned = markdown_for_speech(raw)
    args.output_dir.mkdir(parents=True, exist_ok=True)
    (args.output_dir / "raw-markdown.md").write_text(raw)
    (args.output_dir / "speech-text.txt").write_text(cleaned + "\n")
    render(piper, args.model, raw, args.output_dir / "raw-markdown.wav")
    render(piper, args.model, cleaned, args.output_dir / "speech-text.wav")
    print(f"Raw:     {args.output_dir / 'raw-markdown.wav'}")
    print(f"Cleaned: {args.output_dir / 'speech-text.wav'}")
    print(f"Text:    {args.output_dir / 'speech-text.txt'}")


if __name__ == "__main__":
    main()
