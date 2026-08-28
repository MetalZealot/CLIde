"""Prepare a speech-only copy of CLIde response text.

_prepared runs five ordered stages, each independently testable:

  1. strip_markdown          document structure -> sentence punctuation,
                             ending in _speak_technical_text for units,
                             numbers, ports, identifiers, paths and URLs
  2. apply_lexicon           editable respellings and substitutions
  3. strip_emojis            characters espeak would name aloud
  4. strip_unspeakable       whole words left holding unreadable symbols
  5. collapse_whitespace     spacing, and the BOUNDARY pause markers

Every rule here cites the measured failure it fixes. The measurement is:
synthesize a sentence with and without one word and compare audio duration.
A rendered word adds 0.28-0.60s; a dropped word adds under 0.15s. A rule with
no measurement behind it is a guess and does not belong in this file.

A Whisper round trip is not evidence: it reported "slash" in audio that did
not contain it.
"""

from __future__ import annotations

import html
import re
from typing import Sequence
from urllib.parse import unquote, urlsplit


EMOJI = re.compile(r"[\U0001F000-\U0001FAFF\U0001FC00-\U0001FFFD\u2600-\u27BF]+")
HEADER_LINE = "\ufff0"
LIST_ITEM = "\ufff1"
# Marks a sentence that ends a document structure (heading, list item, table
# row, paragraph). It survives the later stages and is removed by
# speech_segments(), which is the only consumer.
BOUNDARY = "\ufff2"
ONES = (
    "zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine",
    "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen",
    "seventeen", "eighteen", "nineteen",
)
TENS = ("", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety")
DECADES = ("", "tens", "twenties", "thirties", "forties", "fifties", "sixties",
           "seventies", "eighties", "nineties")
MONTHS = ("", "January", "February", "March", "April", "May", "June", "July",
          "August", "September", "October", "November", "December")
ORDINALS = {
    1: "first", 2: "second", 3: "third", 4: "fourth", 5: "fifth", 6: "sixth",
    7: "seventh", 8: "eighth", 9: "ninth", 10: "tenth", 11: "eleventh",
    12: "twelfth", 13: "thirteenth", 14: "fourteenth", 15: "fifteenth",
    16: "sixteenth", 17: "seventeenth", 18: "eighteenth", 19: "nineteenth",
    20: "twentieth", 30: "thirtieth",
}
TECHNICAL_UNITS = {
    "ms": ("millisecond", "milliseconds"),
    "s": ("second", "seconds"),
    "kb": ("kilobyte", "kilobytes"),
    "mb": ("megabyte", "megabytes"),
    "gb": ("gigabyte", "gigabytes"),
    "kib": ("kibibyte", "kibibytes"),
    "mib": ("mebibyte", "mebibytes"),
    "gib": ("gibibyte", "gibibytes"),
}


def apply_lexicon(text: str, lexicon: Sequence[tuple[re.Pattern[str], str]] | None = None) -> str:
    """Apply the editable pronunciation rules (stage 3).

    These are respellings that correct a wrong eSpeak phonemisation, or a word
    a voice model renders badly. They are data, edited from Voice Studio, not
    code -- see speech_rules.py. Passing None loads the current saved rules.
    """
    if lexicon is None:
        from speech_rules import rules_store

        lexicon = rules_store.compiled()
    for pattern, replacement in lexicon:
        text = pattern.sub(replacement, text)
    return text


def _ensure_pause(text: str) -> str:
    text = text.strip()
    if not text or re.search(r"[.!?;:]$", text):
        return text
    return f"{text}."


def _number_to_words(number: int) -> str:
    if number < 20:
        return ONES[number]
    if number < 100:
        tens, remainder = divmod(number, 10)
        return TENS[tens] if remainder == 0 else f"{TENS[tens]} {ONES[remainder]}"
    if number < 1_000:
        hundreds, remainder = divmod(number, 100)
        prefix = f"{ONES[hundreds]} hundred"
        return prefix if remainder == 0 else f"{prefix} {_number_to_words(remainder)}"
    thousands, remainder = divmod(number, 1_000)
    prefix = f"{_number_to_words(thousands)} thousand"
    return prefix if remainder == 0 else f"{prefix} {_number_to_words(remainder)}"


def _spell_characters(value: str) -> str:
    return " ".join(character.upper() if character.isalpha() else ONES[int(character)] for character in value)


def _speak_year(value: str) -> str:
    year = int(value)
    if year == 2000:
        return "two thousand"
    century = year // 100
    remainder = year % 100
    if remainder == 0:
        return f"{_number_to_words(century)} hundred"
    joiner = " oh " if remainder < 10 else " "
    return f"{_number_to_words(century)}{joiner}{_number_to_words(remainder)}"


def _speak_inline_code(match: re.Match[str]) -> str:
    value = match.group(1)
    if value.startswith(("/", "~/", "./", "../")):
        return _speak_file_path(value)
    if re.fullmatch(r"\d{4,}", value):
        return _spell_characters(value)
    if len(value) >= 7 and re.fullmatch(r"[0-9a-fA-F]+", value):
        return _spell_characters(value)
    return value


def _speak_component(value: str) -> str:
    value = unquote(value).replace("_", " ").replace("-", " ")
    if value.startswith("."):
        value = f"dot {value[1:]}"
    return value.replace(".", " dot ").strip()


def _speak_file_path(value: str) -> str:
    # "~" is a word espeak cannot say, so it would be dropped silently and a
    # home path would be indistinguishable from a relative one.
    parts = [
        _speak_component("home" if part == "~" else part)
        for part in value.split("/")
        if part not in {"", "."}
    ]
    if not parts:
        return "the root path"
    return f"the {', '.join(parts)} path"


RELATIVE_PATH_CANDIDATE = re.compile(
    r"(?<![\w/~.])[A-Za-z0-9._-]+(?:/[A-Za-z0-9._-]+)+(?![\w/])"
)
FILE_EXTENSION = re.compile(r"\.[A-Za-z][A-Za-z0-9]{0,4}$")


def _looks_like_relative_path(value: str) -> bool:
    """Reject the things that are written with a slash but are not paths.

    "3/4", "24/7" and "08/24/2026" carry no letters. "yes/no" and "TTS/STT"
    carry letters but neither a second separator nor a file extension, so a
    lone slash between two plain words stays a spoken separator.
    """
    if not any(character.isalpha() for character in value):
        return False
    return value.count("/") >= 2 or bool(FILE_EXTENSION.search(value))


def _speak_paths(text: str) -> str:
    """Render absolute and relative paths alike as one spoken noun phrase.

    Relative paths took the separator-word branch until 2026-08-24, which read
    the same file two ways -- "foo dot ts" absolute, a literal "foo.ts"
    relative -- and left them exposed to the voices that swallow "slash".
    """

    def replace(match: re.Match[str]) -> str:
        value = match.group(0)
        trailing = "." if value.endswith(".") else ""
        return _speak_file_path(value.rstrip(".")) + trailing

    def replace_relative(match: re.Match[str]) -> str:
        candidate = match.group(0).rstrip(".")
        if not _looks_like_relative_path(candidate):
            return match.group(0)
        return replace(match)

    text = re.sub(r"(?<!\w)~?/(?:[A-Za-z0-9._-]+/?)+", replace, text)
    return RELATIVE_PATH_CANDIDATE.sub(replace_relative, text)


def _speak_web_address(match: re.Match[str], path_separator: str) -> str:
    raw_value = match.group(0)
    trailing = ""
    while raw_value and raw_value[-1] in ".,;!?":
        trailing = raw_value[-1] + trailing
        raw_value = raw_value[:-1]

    try:
        parsed = urlsplit(raw_value)
        port = parsed.port
    except ValueError:
        return f"[Web address omitted]{trailing}"
    path_parts = [unquote(part) for part in parsed.path.split("/") if part]
    is_simple = (
        bool(parsed.hostname)
        and parsed.username is None
        and parsed.password is None
        and not parsed.query
        and not parsed.fragment
        and len(raw_value) <= 100
        and len(path_parts) <= 3
        and all(
            len(part) <= 24 and re.fullmatch(r"[A-Za-z0-9._~-]+", part)
            for part in path_parts
        )
        and re.fullmatch(r"[A-Za-z0-9.-]+", parsed.hostname or "") is not None
    )
    if not is_simple:
        return f"[Web address omitted]{trailing}"

    host = " dot ".join(_speak_component(part) for part in parsed.hostname.split("."))
    spoken = host
    if port is not None:
        spoken += f", port {_spell_characters(str(port))}"
    for part in path_parts:
        spoken += f" {path_separator} {_speak_component(part)}"
    return f"{spoken}{trailing}"


def _ordinal_words(number: int) -> str:
    if number in ORDINALS:
        return ORDINALS[number]
    tens, ones = divmod(number, 10)
    return f"{TENS[tens]} {ORDINALS[ones]}"


def _speak_decade(match: re.Match[str]) -> str:
    """"The 1990s" was reaching espeak as "the 1990 seconds"."""
    year = int(match.group(1))
    century, remainder = divmod(year, 100)
    if remainder:
        return f"{_number_to_words(century)} {DECADES[remainder // 10]}"
    if year % 1_000 == 0:
        return f"{_number_to_words(year // 1_000)} thousands"
    return f"{_number_to_words(century)} hundreds"


def _speak_iso_date(match: re.Match[str]) -> str:
    """Only the unambiguous form. "08/24/2026" and "24/08/2026" are the same
    eight characters in two countries, so they stay as written."""
    year, month, day = (int(part) for part in match.groups())
    if not 1 <= month <= 12 or not 1 <= day <= 31:
        return match.group(0)
    return f"{MONTHS[month]} {_ordinal_words(day)}, {_speak_year(str(year))}"


def _speak_money(match: re.Match[str]) -> str:
    amount = match.group(1).replace(",", "")
    whole, _, cents = amount.partition(".")
    cents = int((cents + "00")[:2]) if cents else 0
    dollars = int(whole)
    parts = []
    if dollars or not cents:
        parts.append(f"{_number_to_words(dollars)} dollar{'' if dollars == 1 else 's'}")
    if cents:
        parts.append(f"{_number_to_words(cents)} cent{'' if cents == 1 else 's'}")
    return " ".join(parts)


def _speak_decimal(value: str) -> str:
    whole, _, fraction = value.replace(",", "").partition(".")
    spoken = _number_to_words(int(whole))
    if not fraction:
        return spoken
    digits = " ".join(ONES[int(digit)] for digit in fraction)
    return f"{spoken} point {digits}"


def _speak_fraction(match: re.Match[str]) -> str:
    numerator, denominator = int(match.group(1)), int(match.group(2))
    # Only a proper fraction. "24/7" and "16/9" are ratios, and reading them
    # as sevenths and ninths is worse than leaving them alone.
    if not 1 <= numerator < denominator <= 100:
        return match.group(0)
    if denominator == 2:
        name = "half" if numerator == 1 else "halves"
    elif denominator == 4:
        name = "quarter" if numerator == 1 else "quarters"
    else:
        name = _ordinal_words(denominator)
        if numerator != 1:
            name += "s"
    return f"{_number_to_words(numerator)} {name}"


def _speak_clock_time(match: re.Match[str]) -> str:
    hour, minute = int(match.group(1)), int(match.group(2))
    meridiem = match.group(3)
    if hour > (12 if meridiem else 23) or hour == 0 and meridiem:
        return match.group(0)
    if minute == 0 and meridiem:
        spoken = _number_to_words(hour)
    elif minute == 0:
        # "seventeen o'clock" is not English; a 24-hour time reads as hundreds.
        closing = "hundred" if hour > 12 else "o'clock"
        spoken = f"{_number_to_words(hour)} {closing}"
    elif minute < 10:
        spoken = f"{_number_to_words(hour)} oh {_number_to_words(minute)}"
    else:
        spoken = f"{_number_to_words(hour)} {_number_to_words(minute)}"
    return f"{spoken} {meridiem.lower()} m" if meridiem else spoken


def _speak_technical_text(text: str, path_separator: str) -> str:
    text = re.sub(
        r"https?://[^\s<>()\]]+",
        lambda match: _speak_web_address(match, path_separator),
        text,
        flags=re.IGNORECASE,
    )
    text = re.sub(r"\bhttps\b", "H T T P S", text, flags=re.IGNORECASE)
    # Before the number rules: they rewrite "2026" inside a path to "twenty
    # twenty six", and the space then splits the path mid-way.
    text = _speak_paths(text)
    text = re.sub(
        r"\b(commit(?:\s+(?:number|id))?\s+)(\d{4,})\b",
        lambda match: f"{match.group(1)}{_spell_characters(match.group(2))}",
        text,
        flags=re.IGNORECASE,
    )
    text = re.sub(
        r"\b(port\s+)(\d{2,5})\b",
        lambda match: f"{match.group(1)}{_spell_characters(match.group(2))}",
        text,
        flags=re.IGNORECASE,
    )

    def replace_unit(match: re.Match[str]) -> str:
        number = int(match.group(1))
        singular, plural = TECHNICAL_UNITS[match.group(2).lower()]
        return f"{_number_to_words(number)} {singular if number == 1 else plural}"

    text = re.sub(
        r"\b(\d{1,4})\s*(ms|KiB|MiB|GiB|KB|MB|GB)\b",
        replace_unit,
        text,
        flags=re.IGNORECASE,
    )
    # Decades before the unit rules: "1990s" was matching the seconds rule.
    text = re.sub(r"\b(1\d{2}0|20\d0)s\b", _speak_decade, text)
    text = re.sub(r"\b(\d{4})-(\d{2})-(\d{2})\b", _speak_iso_date, text)
    text = re.sub(r"\$(\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?)", _speak_money, text)
    text = re.sub(
        r"\b(\d{1,3}(?:,\d{3})*(?:\.\d+)?|\d+(?:\.\d+)?)\s*%",
        lambda match: f"{_speak_decimal(match.group(1))} percent",
        text,
    )
    text = re.sub(r"\b(\d{1,2})/(\d{1,3})\b(?!/)", _speak_fraction, text)
    text = re.sub(
        r"\b(\d+(?:\.\d+)?)\s*s\b",
        lambda match: f"{_speak_decimal(match.group(1))} seconds",
        text,
    )
    # Before the year and three-digit rules, which would otherwise claim the
    # halves of a clock time separately.
    text = re.sub(
        r"\b(\d{1,2}):([0-5]\d)(?:\s*([ap])\.?\s?m(?:\.(?!\s*(?:(?-i:[A-Z])|$)))?)?(?![\w:])",
        _speak_clock_time,
        text,
        # (?-i:) turns the case fold back off inside the lookahead: under
        # IGNORECASE [A-Z] matches lowercase too, and the closing dot of
        # "p.m." would be kept mid-sentence as a spurious full stop.
        flags=re.IGNORECASE,
    )
    text = re.sub(
        r"\b(19\d{2}|20\d{2})\b",
        lambda match: _speak_year(match.group(1)),
        text,
    )
    text = re.sub(
        r"\b\d{3}\b",
        lambda match: _number_to_words(int(match.group(0))),
        text,
    )
    for abbreviation, (_singular, plural) in TECHNICAL_UNITS.items():
        # Bare one-letter units only ever fire by accident: an apostrophe is a
        # non-word character, so \bs\b matched the "s" in "That's" and said
        # "That seconds". A number-attached "8.67s" is handled above.
        if len(abbreviation) < 2:
            continue
        text = re.sub(rf"\b{abbreviation}\b", plural, text, flags=re.IGNORECASE)
    text = re.sub(r"\band/or\b", "and or", text, flags=re.IGNORECASE)
    text = re.sub(r"\s*[\u2190-\u21ff\u27f0-\u27ff\u2b00-\u2b11]+\s*", ", ", text)
    text = re.sub(r"\s+[-\u2013]\s+", ", ", text)
    text = text.replace("/", f" {path_separator} ")
    # Only a colon that separates clauses is sentence punctuation. One with no
    # space after it is inside an identifier -- "build:client" was becoming
    # "build. client", splitting a sentence mid-name and moving the pause with
    # it. espeak says the bare identifier correctly on its own.
    return re.sub(r"\s*:(\s+|$)", ". ", text)


def strip_markdown(text: str, path_separator: str = "slash") -> str:
    """Conservatively retain prose while removing common Markdown syntax."""
    text = re.sub(
        r"```[^\n]*\n.*?```",
        "\n[See the code block in this message]\n",
        text,
        flags=re.DOTALL,
    )
    text = re.sub(
        r"^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$",
        rf"{HEADER_LINE}\1",
        text,
        flags=re.MULTILINE,
    )
    text = re.sub(r"^\s{0,3}>\s?", "", text, flags=re.MULTILINE)
    text = re.sub(
        r"^\s{0,3}(?:[-+*]|\d+[.)])\s+",
        LIST_ITEM,
        text,
        flags=re.MULTILINE,
    )
    text = re.sub(r"!\[([^\]]*)\]\([^)]*\)", r"\1", text)
    text = re.sub(r"\[([^\]]+)\]\([^)]*\)", r"\1", text)

    for delimiter in ("**", "__", "~~"):
        escaped = re.escape(delimiter)
        text = re.sub(rf"(?<!\\){escaped}([^\n]+?){escaped}", r"\1", text)
    text = re.sub(r"(?<!\\)`([^`\n]+)`", _speak_inline_code, text)
    text = re.sub(r"(?<!\\)\*([^\s*](?:[^*\n]*[^\s*])?)\*(?!\w)", r"\1", text)
    text = re.sub(r"(?<!\\)_([^\s_](?:[^_\n]*[^\s_])?)_(?!\w)", r"\1", text)

    rows: list[str] = []
    for line in text.splitlines():
        if line.startswith(HEADER_LINE):
            rows.append(_ensure_pause(line.removeprefix(HEADER_LINE)) + BOUNDARY)
            continue
        if line.startswith(LIST_ITEM):
            rows.append(_ensure_pause(line.removeprefix(LIST_ITEM)) + BOUNDARY)
            continue
        if "|" not in line:
            rows.append(line)
            continue

        cells = [cell.strip() for cell in line.strip().strip("|").split("|")]
        if cells and all(re.fullmatch(r":?-{3,}:?", cell) for cell in cells):
            continue
        rows.append(_ensure_pause(". ".join(cell for cell in cells if cell)) + BOUNDARY)

    text = re.sub(r"\s*—\s*", ", ", html.unescape("\n".join(rows)))
    return _speak_technical_text(text, path_separator)


# Anything outside this set reaches eSpeak as a spelled-out character name.
# IPA in a reply about pronunciation is the worst case: "lˈaɪv" is read as
# "L stress a smallcap I V".
SPEAKABLE = re.compile(r"[^A-Za-z0-9\s.,;:!?'\"()\[\]/#*+%$&=@_\ufff2\u00c0-\u024f-]+")


def strip_unspeakable(text: str) -> str:
    """Drop whole words eSpeak would read out as character names.

    The word goes, not just the offending character: stripping the modifiers
    out of "lˈaɪv" leaves "l a v", which is read aloud as three letters.
    """
    kept = [word for word in text.split(" ") if not SPEAKABLE.search(word)]
    return " ".join(kept)


def strip_emojis(text: str) -> str:
    return EMOJI.sub("", text).replace("\ufe0e", "").replace("\ufe0f", "").replace("\u200d", "")


def collapse_whitespace(text: str) -> str:
    # A blank line closes a paragraph. Add the full stop only when the
    # paragraph does not already end in one.
    text = re.sub(rf"(?<=[.!?{BOUNDARY}])\s*\n\s*\n+", f"{BOUNDARY} ", text)
    text = re.sub(r"\n\s*\n+", f". {BOUNDARY} ", text)
    text = re.sub(r"\s+", " ", text)
    text = re.sub(r"\s+([,.;!?])", r"\1", text)
    text = re.sub(r"\.{2,}", ".", text)
    # The boundary attaches to the sentence it closes, keeping the space that
    # separates it from the next sentence.
    text = re.sub(rf"(?:\s*{BOUNDARY}\s*)+", f"{BOUNDARY} ", text)
    return capitalize_sentences(text.strip())


def capitalize_sentences(text: str) -> str:
    """Open every sentence with a capital, including the injected ones.

    A substitution can land a lowercase word straight after a full stop --
    "ones. the src, lib, foo dot ts path" -- and the model reads the pair as
    one long clause. Measured on libritts-r-204, three runs each: the lowercase
    form takes 6.58-7.43 s and the capitalised form 6.05-6.38 s, non-
    overlapping, so the sentence break is genuinely being missed.
    """
    def opened(match: re.Match[str]) -> str:
        word = match.group("word")
        # "eSpeak", "iPhone", "npm" chose their own case. Only a plainly
        # lowercase word is one this missed.
        if word[1:].lower() != word[1:]:
            return match.group(0)
        return f"{match.group('lead')}{word[0].upper()}{word[1:]}"

    # Sentence openings only, never the start of the text: the first word is
    # the author's, and capitalising it renamed "eSpeak" to "ESpeak".
    return re.sub(
        rf"(?P<lead>[.!?]{BOUNDARY}?\s+)(?P<word>[a-z]\S*)",
        opened,
        text,
    )


def _prepared(text: str, path_separator: str, lexicon=None) -> str:
    text = strip_markdown(text, path_separator)
    text = apply_lexicon(text, lexicon)
    text = strip_emojis(text)
    text = strip_unspeakable(text)
    return collapse_whitespace(text)


def prepare_speech_text(text: str, path_separator: str = "slash", lexicon=None) -> str:
    """Turn a stored assistant reply into the exact text Piper receives."""
    return _prepared(text, path_separator, lexicon).replace(BOUNDARY, "")


def speech_segments(
    text: str, path_separator: str = "slash", lexicon=None
) -> tuple[str, list[bool]]:
    """The text Piper receives, plus one structure flag per sentence.

    A flag is True when that sentence closes a heading, list item, table row,
    or paragraph, and so deserves a longer pause after it than an ordinary
    sentence break. The text is a single Piper request; only the silence
    inserted between its sentence chunks varies.
    """
    prepared = _prepared(text, path_separator, lexicon)
    sentences: list[str] = []
    flags: list[bool] = []
    for part in re.split(rf"(?<=[.!?{BOUNDARY}])\s+", prepared):
        if not part:
            continue
        flags.append(part.endswith(BOUNDARY))
        sentences.append(part.replace(BOUNDARY, ""))
    return " ".join(sentences), flags
