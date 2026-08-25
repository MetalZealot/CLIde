#!/usr/bin/env python3
"""Loopback-only Piper Audition Studio."""

from __future__ import annotations

import argparse
import array
import base64
import io
import json
import logging
import os
import re
import threading
import time
import urllib.error
import urllib.request
import wave
from pathlib import Path
from typing import Any

from flask import Flask, Response, jsonify, render_template, request

from whisper_studio import register_whisper_routes


# The running CLIde voice backend. The CLIde tab asks it, rather than keeping a
# second copy of the speech rules here -- a stale copy is why auditions used to
# disagree with what the app actually said.
SHIM_BASE_URL = "http://127.0.0.1:8890"
VOICE_ROOT = Path(os.environ.get("CLIDE_VOICE_ROOT", "/home/gnuthall/voice"))
LABELS_PATH = VOICE_ROOT / "voice-labels.json"
SHIM_TIMEOUT_SECONDS = 300
SILENCE_AMPLITUDE = 900
PAUSE_WINDOW_MS = 10
MIN_REPORTED_PAUSE_MS = 80

app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = 25 * 1024 * 1024
# The front end is edited live; a stale cached bundle or template reads as
# a bug, and Jinja caches for the life of the process unless told not to.
app.config["SEND_FILE_MAX_AGE_DEFAULT"] = 0
app.config["TEMPLATES_AUTO_RELOAD"] = True
_LOGGER = logging.getLogger("voice-studio")
inference_lock = threading.Lock()
labels_lock = threading.Lock()

# A voice is a model, or a model and one of its speakers: "libritts_r#546".
VOICE_KEY_PATTERN = re.compile(r"^[A-Za-z0-9_.-]{1,80}(#\d{1,4})?$")
GENDERS = {"", "male", "female", "neutral"}
MAX_NOTE_CHARS = 2000


STATIC_DIR = Path(__file__).with_name("static")


@app.context_processor
def _asset_version() -> dict[str, str]:
    """Stamp the bundles with their own mtime; the front end is edited live."""
    newest = max((path.stat().st_mtime for path in STATIC_DIR.glob("*.*")), default=0)
    return {"asset_version": str(int(newest))}


@app.get("/")
def index() -> str:
    return render_template("index.html")


CORPUS_PATH = Path(__file__).with_name("reference-corpus.md")


CASE_PATTERN = re.compile(
    r"^## (?P<name>.+?)\n+````\n(?P<text>.*?)\n````(?P<listen>.*?)(?=\n## |\Z)",
    re.S | re.M,
)


def _reference_corpus() -> list[dict[str, str]]:
    """The listening-pass cases, parsed out of the Markdown they are written in.

    Each case's spoken text is fenced verbatim with four backticks, because the
    cases contain Markdown of their own -- one is a heading followed by a list,
    and splitting on "##" swallowed it. The `>` block after the fence is what
    to listen for and is never spoken.
    """
    source = CORPUS_PATH.read_text(encoding="utf-8")
    return [
        {
            "name": case["name"].strip(),
            "text": case["text"].strip(),
            "listen_for": " ".join(
                line.lstrip("> ").rstrip()
                for line in case["listen"].strip().splitlines()
            ).strip(),
        }
        for case in CASE_PATTERN.finditer(source)
    ]


@app.get("/api/corpus")
def corpus() -> Any:
    try:
        return jsonify({"cases": _reference_corpus()})
    except OSError as error:
        return jsonify({"error": f"Could not read the corpus: {error}"}), 500


def _shim_request(path: str, payload: dict[str, Any]) -> tuple[int, bytes, str]:
    request_body = json.dumps(payload).encode()
    shim_request = urllib.request.Request(
        f"{SHIM_BASE_URL}{path}",
        data=request_body,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(shim_request, timeout=SHIM_TIMEOUT_SECONDS) as response:
            return response.status, response.read(), response.headers.get_content_type()
    except urllib.error.HTTPError as error:
        return error.code, error.read(), error.headers.get_content_type()


def _pause_map(wav_bytes: bytes) -> list[dict[str, float]]:
    """Silent runs measured from the samples, so the pacing is not guesswork."""
    with wave.open(io.BytesIO(wav_bytes)) as wav_file:
        rate = wav_file.getframerate()
        samples = array.array("h", wav_file.readframes(wav_file.getnframes()))

    window = max(1, rate * PAUSE_WINDOW_MS // 1000)
    quiet = [
        max((abs(value) for value in samples[start:start + window]), default=0)
        < SILENCE_AMPLITUDE
        for start in range(0, len(samples), window)
    ]

    pauses: list[dict[str, float]] = []
    run_start: int | None = None
    for index, is_quiet in enumerate([*quiet, False]):
        if is_quiet and run_start is None:
            run_start = index
        elif not is_quiet and run_start is not None:
            duration_ms = (index - run_start) * PAUSE_WINDOW_MS
            if duration_ms >= MIN_REPORTED_PAUSE_MS:
                pauses.append({
                    "at": round(run_start * PAUSE_WINDOW_MS / 1000, 2),
                    "ms": duration_ms,
                })
            run_start = None
    return pauses


def _shim_get(path: str) -> tuple[int, bytes, str]:
    try:
        with urllib.request.urlopen(f"{SHIM_BASE_URL}{path}", timeout=SHIM_TIMEOUT_SECONDS) as response:
            return response.status, response.read(), response.headers.get_content_type()
    except urllib.error.HTTPError as error:
        return error.code, error.read(), error.headers.get_content_type()


@app.get("/api/clide/models")
def clide_models() -> Any:
    """Every installed model, not only the shipped presets.

    Auditioning a voice is how it earns a preset, so the lab has to reach past
    the catalogue -- but it renders through the shim, so the text it speaks is
    still the production text.
    """
    try:
        status, body, _ = _shim_get("/api/audition/models")
    except urllib.error.URLError as error:
        return jsonify({"error": f"Voice service unreachable: {error.reason}"}), 502
    return Response(body, status=status, mimetype="application/json")


@app.post("/api/clide/audition")
def clide_audition() -> Any:
    data = request.get_json(silent=True) or {}
    text = str(data.get("text", ""))
    if not text.strip():
        return jsonify({"error": "Enter some text to synthesize"}), 400
    payload = {
        "input": text,
        "model": data.get("model"),
        "speaker_id": data.get("speaker_id"),
        "length_scale": data.get("length_scale"),
        "path_separator": data.get("path_separator"),
    }
    try:
        status, body, _ = _shim_request("/audio/speech/audition", payload)
    except urllib.error.URLError as error:
        return jsonify({"error": f"Voice service unreachable: {error.reason}"}), 502
    if status != 200:
        return Response(body, status=status, mimetype="application/json")
    result = json.loads(body)
    audio = base64.b64decode(result.pop("audio_base64"))
    return jsonify({**result, "audio_base64": base64.b64encode(audio).decode("ascii"),
                    "pauses": _pause_map(audio)})


@app.get("/api/clide/voices")
def clide_voices() -> Any:
    try:
        with urllib.request.urlopen(f"{SHIM_BASE_URL}/api/health", timeout=10) as response:
            health = json.loads(response.read())
    except (urllib.error.URLError, OSError, ValueError):
        return jsonify({"error": "The CLIde voice service is not reachable on 8890"}), 503
    return jsonify({
        "voices": health.get("tts_voices", []),
        "default_voice": health.get("tts_default_voice"),
    })


@app.route("/api/clide/rules", methods=["GET", "PUT"])
def clide_rules() -> Any:
    """Proxy the editable speech rules; the shim owns them."""
    url = f"{SHIM_BASE_URL}/api/speech-rules"
    try:
        if request.method == "GET":
            with urllib.request.urlopen(url, timeout=15) as response:
                return app.response_class(
                    response.read(), status=response.status, mimetype="application/json"
                )
        body = json.dumps(request.get_json(silent=True) or {}).encode()
        put = urllib.request.Request(
            url, data=body, headers={"Content-Type": "application/json"}, method="PUT"
        )
        with urllib.request.urlopen(put, timeout=15) as response:
            return app.response_class(
                response.read(), status=response.status, mimetype="application/json"
            )
    except urllib.error.HTTPError as error:
        return app.response_class(
            error.read(), status=error.code, mimetype="application/json"
        )
    except (urllib.error.URLError, OSError):
        return jsonify({"error": "The CLIde voice service is not reachable on 8890"}), 503


@app.post("/api/clide/speech")
def clide_speech() -> Any:
    """Render text through the real CLIde pipeline and show every stage."""
    data = request.get_json(silent=True) or {}
    raw_text = data.get("text")
    if not isinstance(raw_text, str) or not raw_text.strip():
        return jsonify({"error": "Enter some text to speak"}), 400
    voice = data.get("voice") or None

    payload: dict[str, Any] = {"input": raw_text, "phonemes": True}
    if voice:
        payload["voice"] = voice
    status, body, _ = _shim_request("/audio/speech/prepare", payload)
    if status != 200:
        return jsonify(json.loads(body or b"{}") or {"error": "Preparation failed"}), status
    prepared = json.loads(body)

    if not data.get("speak", True):
        return jsonify({**prepared, "audio_base64": None, "pauses": []})

    started = time.perf_counter()
    status, audio, content_type = _shim_request(
        "/audio/speech", {"input": raw_text, **({"voice": voice} if voice else {})}
    )
    generation_seconds = time.perf_counter() - started
    if status != 200 or not content_type.startswith("audio/"):
        return jsonify(json.loads(audio or b"{}") or {"error": "Synthesis failed"}), status

    with wave.open(io.BytesIO(audio)) as wav_file:
        duration_seconds = wav_file.getnframes() / wav_file.getframerate()
    return jsonify({
        **prepared,
        "audio_base64": base64.b64encode(audio).decode("ascii"),
        "pauses": _pause_map(audio),
        "sentences": [s for s in re.split(r"(?<=[.!?])\s+", prepared["prepared"]) if s],
        "generation_seconds": round(generation_seconds, 3),
        "duration_seconds": round(duration_seconds, 3),
    })


def _read_labels() -> dict[str, Any]:
    """Every judgement made about a voice, keyed by model and speaker.

    Auditioning 1,800 voices is only worth doing once, so this outlives the
    browser: it is the list being compiled for CLIde, not a UI cache.
    """
    try:
        stored = json.loads(LABELS_PATH.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return {}
    except (OSError, json.JSONDecodeError) as error:
        _LOGGER.warning("Ignoring unreadable %s: %s", LABELS_PATH.name, error)
        return {}
    voices = stored.get("voices") if isinstance(stored, dict) else None
    return voices if isinstance(voices, dict) else {}


def _write_labels(voices: dict[str, Any]) -> None:
    temporary = LABELS_PATH.with_name(f"{LABELS_PATH.name}.tmp")
    temporary.write_text(
        json.dumps({"voices": voices}, indent=2, sort_keys=True), encoding="utf-8"
    )
    temporary.replace(LABELS_PATH)


@app.get("/api/voices/labels")
def voice_labels() -> Any:
    return jsonify({"voices": _read_labels()})


@app.post("/api/voices/labels")
def save_voice_label() -> Any:
    data = request.get_json(silent=True) or {}
    key = str(data.get("key", "")).strip()
    if not VOICE_KEY_PATTERN.match(key):
        return jsonify({"error": "Unknown voice key"}), 400

    with labels_lock:
        voices = _read_labels()
        if data.get("remove"):
            voices.pop(key, None)
            _write_labels(voices)
            return jsonify({"key": key, "entry": None})

        entry = dict(voices.get(key) or {})
        if "gender" in data:
            gender = str(data.get("gender") or "")
            if gender not in GENDERS:
                return jsonify({"error": "Unknown gender label"}), 400
            entry["gender"] = gender
        if "favorite" in data:
            entry["favorite"] = bool(data.get("favorite"))
        if "notes" in data:
            entry["notes"] = str(data.get("notes") or "")[:MAX_NOTE_CHARS]
        if "heard" in data:
            entry["heard"] = bool(data.get("heard"))
        for field in ("model", "speaker_id", "speaker_name", "length_scale"):
            if field in data and data[field] is not None:
                entry[field] = data[field]
        entry["updated"] = round(time.time())

        # An entry with nothing left to say is deleted, so "unlabelled" stays
        # an honest filter rather than a file of empty records.
        if not entry.get("gender") and not entry.get("favorite") \
                and not entry.get("notes") and not entry.get("heard"):
            voices.pop(key, None)
            entry = {}
        else:
            voices[key] = entry
        _write_labels(voices)
    return jsonify({"key": key, "entry": entry or None})


@app.get("/api/voices/export")
def export_favorites() -> Any:
    """The favorites as a preset block, ready to paste into the shim."""
    voices = _read_labels()
    favorites = sorted(
        ((key, entry) for key, entry in voices.items() if entry.get("favorite")),
        key=lambda pair: (pair[1].get("gender") or "zz", pair[0]),
    )
    lines = [f"# {len(favorites)} favorite voices", ""]
    for key, entry in favorites:
        model, _, speaker = key.partition("#")
        name = entry.get("speaker_name") or speaker or "voice"
        arguments = [f'"{model}"']
        if speaker:
            arguments.append(speaker)
            arguments.append(f'"{name}"')
        arguments.append(str(entry.get("length_scale") or 1.0))
        gender = entry.get("gender") or "no gender"
        notes = (entry.get("notes") or "").replace("\n", " ").strip()
        lines.append(f'    "{model.split("-")[-2] if "-" in model else model}-{name}": '
                     f'VoicePreset({", ".join(arguments)}),')
        lines.append(f"    # {gender}{' — ' + notes if notes else ''}")
    return jsonify({"text": "\n".join(lines), "count": len(favorites)})



@app.errorhandler(413)
def request_too_large(_error: Exception) -> Any:
    return jsonify({"error": "Request is too large"}), 413


register_whisper_routes(app, inference_lock)


def main() -> None:
    parser = argparse.ArgumentParser(description="Local Piper and Whisper Voice Studio")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8891)
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    app.run(host=args.host, port=args.port, debug=False, threaded=True)


if __name__ == "__main__":
    main()
