"""Editable speech rules, stored as data rather than code.

Everything here is meant to be changed from Voice Studio without a restart:
dictation choices, microphone processing, pronunciation fixes and per-voice
pacing. The regex machinery in normalizer.py stays in code, because it is
structural (Markdown, numbers, paths) rather than a personal setting.

Rules live in speech_rules.json under CLIDE_VOICE_ROOT -- his edits are data,
so they sit outside the repository next to the voice models. The file is
optional; if it is missing or unreadable the built-in defaults below apply, so
a bad edit can never stop the service from speaking.
"""

from __future__ import annotations

import json
import logging
import os
import re
import threading
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

RULES_PATH = Path(
    os.environ.get("CLIDE_VOICE_ROOT", "/home/gnuthall/voice")
) / "speech_rules.json"
_LOGGER = logging.getLogger("voice-shim")

# How a pronunciation rule matches:
#   word    whole word, any case          "URL" -> "U R L"
#   phrase  literal run of words          "is live" -> "is active"
#   before  whole word, but only when followed by one of `followed_by`
#   unless  whole word, but NOT when preceded by one of `preceded_by`
MODES = {"word", "phrase", "before", "unless"}

DEFAULT_PRONUNCIATIONS: list[dict[str, Any]] = [
    {
        "match": "URL", "say": "U R L", "mode": "word",
        "note": "eSpeak fuses the acronym into 'oourl'; spacing the letters fixes it",
    },
    {"match": "URLs", "say": "U R Ls", "mode": "word", "note": ""},
    {
        "match": "is live", "say": "is active", "mode": "phrase",
        "note": "Found by ear. eSpeak's phonemes look correct, but the models "
                "render them wrong -- do not remove this on phoneme evidence",
    },
    {
        "match": "live", "say": "active", "mode": "unless",
        "preceded_by": ["I", "you", "we", "they", "to", "people", "who", "and",
                        "or", "a", "an"],
        "note": "The phrase list only covered is/are/was/were/now, so "
                "'Verified live' still came out as 'livv'. In CLIde's prose "
                "'live' is nearly always the adjective; the verb takes a "
                "subject, so listing the subjects is the shorter list. 'a' "
                "and 'an' are listed too: 'a active concert' would be worse "
                "than the mispronunciation it fixes.",
    },
    {
        "match": "lives", "say": "livz", "mode": "before",
        "followed_by": ["in", "at", "on", "under", "inside", "within", "beside",
                        "alongside", "near", "outside", "here", "there"],
        "note": "eSpeak gives lˈaɪvz, the plural of 'life'; 'livz' gives lˈɪvz",
    },
    {
        "match": "gnuthall", "say": "G NutHall", "mode": "word",
        "note": "The capital H stops Piper saying 'Noothull'",
    },
]

# Only these preset fields may be edited from the UI. Model, speaker id, and
# source key are catalogue identity, not taste, and stay in app.py.
EDITABLE_VOICE_FIELDS = {
    "length_scale": (0.35, 2.5),
    "sentence_silence_seconds": (0.0, 1.5),
    "structure_silence_seconds": (0.0, 2.0),
}

STT_DECODER_PRESETS = {"standard", "careful"}
DEFAULT_STT_SETTINGS: dict[str, Any] = {
    "model": "tiny.en",
    "decoder_preset": "standard",
    "threads": 4,
    "initial_prompt": "",
    "capture": {
        "echo_cancellation": True,
        "noise_suppression": True,
        "auto_gain_control": False,
    },
}
DEFAULT_TTS_SETTINGS: dict[str, Any] = {
    # Empty preserves the runtime's code-configured fallback. A safe concrete
    # model/speaker ID makes the user's library choice the shared default.
    "default_voice": "",
    # Empty means the runtime's configured default. A concrete safe voice ID
    # can be selected by either CLIde or Voice Studio without a restart.
    "selected_voice": "",
    # Familiar media-player speed: 1.0 is each voice's saved baseline. Higher
    # values shorten both spoken audio and inserted pauses proportionately.
    "speech_pace": 1.0,
}


@dataclass
class SpeechRules:
    pronunciations: list[dict[str, Any]] = field(default_factory=list)
    voices: dict[str, dict[str, Any]] = field(default_factory=dict)
    stt: dict[str, Any] = field(default_factory=dict)
    tts: dict[str, Any] = field(default_factory=dict)

    @staticmethod
    def _bounded(match: str) -> str:
        r"""Escape `match` and anchor it so it cannot fire mid-word.

        \b only works next to a word character, so "c++" needs a lookahead on
        the symbol instead -- otherwise the rule silently never matches.
        """
        escaped = re.escape(match)
        prefix = r"(?<!\w)" if match[:1].isalnum() or match[:1] == "_" else r"(?<!\S)"
        suffix = r"(?!\w)" if match[-1:].isalnum() or match[-1:] == "_" else r"(?!\S)"
        return f"{prefix}{escaped}{suffix}"

    def compiled(self) -> list[tuple[re.Pattern[str], str]]:
        """Rules as (pattern, replacement). Every input is escaped."""
        compiled: list[tuple[re.Pattern[str], str]] = []
        for rule in self.pronunciations:
            match = str(rule.get("match", "")).strip()
            say = str(rule.get("say", ""))
            mode = str(rule.get("mode", "word"))
            if not match or mode not in MODES:
                continue
            if mode == "phrase":
                pattern = self._bounded(match).replace(r"\ ", r"\s+")
                compiled.append((re.compile(pattern, re.IGNORECASE), say))
            elif mode == "before":
                following = [re.escape(str(word)) for word in rule.get("followed_by", []) if word]
                if not following:
                    continue
                compiled.append((
                    re.compile(
                        rf"{self._bounded(match)}(?=\s+(?:{'|'.join(following)})(?!\w))",
                        re.IGNORECASE,
                    ),
                    say,
                ))
            elif mode == "unless":
                preceding = [str(word).strip() for word in rule.get("preceded_by", []) if str(word).strip()]
                if not preceding:
                    continue
                # One lookbehind per word: re needs each to be fixed width, but
                # it is happy to chain several of different widths.
                guards = "".join(f"(?<!{re.escape(word)} )" for word in preceding)
                compiled.append((
                    re.compile(f"{guards}{self._bounded(match)}", re.IGNORECASE),
                    say,
                ))
            else:
                compiled.append((re.compile(self._bounded(match), re.IGNORECASE), say))
        return compiled


def default_rules() -> SpeechRules:
    return SpeechRules(
        pronunciations=[dict(rule) for rule in DEFAULT_PRONUNCIATIONS],
        voices={},
        stt={
            **DEFAULT_STT_SETTINGS,
            "capture": dict(DEFAULT_STT_SETTINGS["capture"]),
        },
        tts=dict(DEFAULT_TTS_SETTINGS),
    )


def validate_tts(payload: Any) -> dict[str, Any]:
    """Return bounded daily TTS controls; model resolution stays in app.py."""
    if payload is None:
        return dict(DEFAULT_TTS_SETTINGS)
    if not isinstance(payload, dict):
        raise ValueError("TTS settings must be an object")
    voice_pattern = r"[A-Za-z0-9_.-]*(?:#\d{1,4})?"
    default_voice = str(payload.get("default_voice", "")).strip()
    selected_voice = str(payload.get("selected_voice", "")).strip()
    if len(default_voice) > 96 or not re.fullmatch(voice_pattern, default_voice):
        raise ValueError("TTS default voice must be a safe voice ID")
    if len(selected_voice) > 96 or not re.fullmatch(voice_pattern, selected_voice):
        raise ValueError("TTS selected voice must be a safe voice ID")
    try:
        speech_pace = float(payload.get("speech_pace", DEFAULT_TTS_SETTINGS["speech_pace"]))
    except (TypeError, ValueError) as error:
        raise ValueError("TTS speech pace must be a number") from error
    if not 0.75 <= speech_pace <= 1.5:
        raise ValueError("TTS speech pace must be between 0.75 and 1.5")
    return {
        "default_voice": default_voice,
        "selected_voice": selected_voice,
        "speech_pace": speech_pace,
    }


def validate_stt(payload: Any) -> dict[str, Any]:
    """Return one complete, bounded dictation preset."""
    if payload is None:
        return default_rules().stt
    if not isinstance(payload, dict):
        raise ValueError("STT settings must be an object")

    model = str(payload.get("model", DEFAULT_STT_SETTINGS["model"])).strip()
    if len(model) > 80 or not re.fullmatch(r"[A-Za-z0-9_.-]+", model):
        raise ValueError("STT model must be a safe installed model ID")
    decoder = str(
        payload.get("decoder_preset", DEFAULT_STT_SETTINGS["decoder_preset"])
    ).strip()
    if decoder not in STT_DECODER_PRESETS:
        raise ValueError("STT decoder preset must be standard or careful")
    try:
        threads = int(payload.get("threads", DEFAULT_STT_SETTINGS["threads"]))
    except (TypeError, ValueError) as error:
        raise ValueError("STT threads must be a whole number") from error
    if not 1 <= threads <= 4:
        raise ValueError("STT threads must be between 1 and 4")
    initial_prompt = str(payload.get("initial_prompt", "")).strip()
    if len(initial_prompt) > 400:
        raise ValueError("STT initial prompt is limited to 400 characters")

    capture = payload.get("capture", DEFAULT_STT_SETTINGS["capture"])
    if not isinstance(capture, dict):
        raise ValueError("STT capture settings must be an object")
    clean_capture: dict[str, bool] = {}
    for key, fallback in DEFAULT_STT_SETTINGS["capture"].items():
        value = capture.get(key, fallback)
        if not isinstance(value, bool):
            raise ValueError(f"STT capture '{key}' must be true or false")
        clean_capture[key] = value

    return {
        "model": model,
        "decoder_preset": decoder,
        "threads": threads,
        "initial_prompt": initial_prompt,
        "capture": clean_capture,
    }


def validate(payload: Any) -> SpeechRules:
    """Reject anything malformed before it can reach the file. Raises ValueError."""
    if not isinstance(payload, dict):
        raise ValueError("Expected an object")

    pronunciations: list[dict[str, Any]] = []
    for index, rule in enumerate(payload.get("pronunciations", []), start=1):
        if not isinstance(rule, dict):
            raise ValueError(f"Rule {index} is not an object")
        match = str(rule.get("match", "")).strip()
        mode = str(rule.get("mode", "word"))
        if not match:
            raise ValueError(f"Rule {index} has an empty 'match'")
        if mode not in MODES:
            raise ValueError(f"Rule {index}: mode must be one of {', '.join(sorted(MODES))}")
        if len(match) > 80 or len(str(rule.get("say", ""))) > 160:
            raise ValueError(f"Rule {index} is too long")
        entry = {
            "match": match,
            "say": str(rule.get("say", "")),
            "mode": mode,
            "note": str(rule.get("note", ""))[:300],
        }
        if mode == "before":
            words = [str(word).strip() for word in rule.get("followed_by", []) if str(word).strip()]
            if not words:
                raise ValueError(f"Rule {index}: 'before' needs at least one following word")
            entry["followed_by"] = words[:40]
        if mode == "unless":
            words = [str(word).strip() for word in rule.get("preceded_by", []) if str(word).strip()]
            if not words:
                raise ValueError(f"Rule {index}: 'unless' needs at least one preceding word")
            entry["preceded_by"] = words[:40]
        pronunciations.append(entry)

    voices: dict[str, dict[str, Any]] = {}
    for voice_id, overrides in (payload.get("voices") or {}).items():
        if not isinstance(overrides, dict):
            raise ValueError(f"Voice {voice_id} overrides are not an object")
        clean: dict[str, Any] = {}
        for key, value in overrides.items():
            if key == "path_separator":
                separator = str(value).strip()
                if not separator or len(separator) > 40:
                    raise ValueError(f"Voice {voice_id}: separator must be 1-40 characters")
                clean[key] = separator
                continue
            if value is None:
                continue  # null means "no override; use the model default"
            if key not in EDITABLE_VOICE_FIELDS:
                raise ValueError(f"Voice {voice_id}: '{key}' is not editable")
            low, high = EDITABLE_VOICE_FIELDS[key]
            try:
                number = float(value)
            except (TypeError, ValueError) as error:
                raise ValueError(f"Voice {voice_id}: '{key}' must be a number") from error
            if not low <= number <= high:
                raise ValueError(f"Voice {voice_id}: '{key}' must be between {low} and {high}")
            clean[key] = number
        voices[str(voice_id)] = clean

    return SpeechRules(
        pronunciations=pronunciations,
        voices=voices,
        stt=validate_stt(payload.get("stt")),
        tts=validate_tts(payload.get("tts")),
    )


class RulesStore:
    """Reads the rules file, reloading it whenever it changes on disk."""

    def __init__(self, path: Path = RULES_PATH) -> None:
        self._path = path
        self._lock = threading.Lock()
        self._stamp: tuple[int, int] | None = None
        self._rules = default_rules()
        self._compiled = self._rules.compiled()

    def _stat(self) -> tuple[int, int] | None:
        try:
            info = self._path.stat()
        except OSError:
            return None
        return (info.st_mtime_ns, info.st_size)

    def current(self) -> SpeechRules:
        with self._lock:
            stamp = self._stat()
            if stamp != self._stamp:
                self._stamp = stamp
                if stamp is None:
                    self._rules = default_rules()
                else:
                    try:
                        self._rules = validate(json.loads(self._path.read_text()))
                    except (OSError, ValueError, json.JSONDecodeError):
                        _LOGGER.exception("speech_rules.json is unusable; using defaults")
                        self._rules = default_rules()
                self._compiled = self._rules.compiled()
            return self._rules

    def compiled(self) -> list[tuple[re.Pattern[str], str]]:
        self.current()
        with self._lock:
            return self._compiled

    def save(self, payload: Any) -> SpeechRules:
        rules = validate(payload)
        with self._lock:
            self._path.write_text(json.dumps(
                {
                    "pronunciations": rules.pronunciations,
                    "voices": rules.voices,
                    "stt": rules.stt,
                    "tts": rules.tts,
                },
                indent=2,
            ) + "\n")
            self._stamp = self._stat()
            self._rules = rules
            self._compiled = rules.compiled()
            return rules


rules_store = RulesStore()
