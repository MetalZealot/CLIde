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
import tempfile
import threading
import time
import urllib.error
import urllib.request
import uuid
import wave
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from flask import Flask, Response, jsonify, render_template, request, send_file

from whisper_studio import register_whisper_routes


# The running CLIde voice backend. The CLIde tab asks it, rather than keeping a
# second copy of the speech rules here -- a stale copy is why auditions used to
# disagree with what the app actually said.
SHIM_BASE_URL = os.environ.get("CLIDE_SHIM_BASE_URL", "http://127.0.0.1:8890")
VOICE_ROOT = Path(os.environ.get("CLIDE_VOICE_ROOT", "/home/gnuthall/voice"))
RECORDINGS_DIR = VOICE_ROOT / "recordings"
PENDING_RECORDINGS_DIR = Path(tempfile.gettempdir()) / "voice-studio-recordings"
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

# A voice is a model, or a model and one of its speakers: "libritts_r#546".
MAX_RECORDING_TITLE_CHARS = 120
PENDING_RECORDING_TTL_SECONDS = 60 * 60


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


def _shim_put(path: str, payload: dict[str, Any]) -> tuple[int, bytes, str]:
    shim_request = urllib.request.Request(
        f"{SHIM_BASE_URL}{path}",
        data=json.dumps(payload).encode(),
        headers={"Content-Type": "application/json"},
        method="PUT",
    )
    try:
        with urllib.request.urlopen(shim_request, timeout=SHIM_TIMEOUT_SECONDS) as response:
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
    payload = _audition_payload(data, text)
    try:
        status, body, _ = _shim_request("/audio/speech/audition", payload)
    except urllib.error.URLError as error:
        return jsonify({"error": f"Voice service unreachable: {error.reason}"}), 502
    if status != 200:
        return Response(body, status=status, mimetype="application/json")
    result = json.loads(body)
    encoded_audio = result.pop("audio_base64", None)
    if not encoded_audio:
        return jsonify({**result, "audio_base64": None, "pauses": []})

    audio = base64.b64decode(encoded_audio)
    result["recording_token"] = _stage_recording(audio, {
        "text": text,
        "prepared": result.get("prepared", ""),
        "voice": {
            "type": "preset" if result.get("voice") else "model",
            "id": result.get("voice") or result.get("model"),
            "label": str(data.get("voice_name") or result.get("voice") or result.get("model"))[:120],
            "model": result.get("model"),
            "speaker_id": result.get("speaker_id"),
        },
        "settings": result.get("settings") or {},
        "settings_preset": str(data.get("settings_preset") or "Custom audition")[:80],
        "duration_seconds": result.get("duration_seconds"),
    })
    return jsonify({
        **result,
        "audio_base64": base64.b64encode(audio).decode("ascii"),
        "pauses": _pause_map(audio),
        "sentences": [
            sentence for sentence in re.split(r"(?<=[.!?])\s+", result.get("prepared", ""))
            if sentence
        ],
    })


def _audition_payload(data: dict[str, Any], text: str) -> dict[str, Any]:
    return {
        "input": text,
        "voice": data.get("voice"),
        "model": data.get("model"),
        "speaker_id": data.get("speaker_id"),
        "length_scale": data.get("length_scale"),
        "noise_scale": data.get("noise_scale"),
        "noise_w_scale": data.get("noise_w_scale"),
        "normalize_audio": data.get("normalize_audio"),
        "volume": data.get("volume"),
        "sentence_silence_seconds": data.get("sentence_silence_seconds"),
        "structure_silence_seconds": data.get("structure_silence_seconds"),
        "path_separator": data.get("path_separator"),
        "speak": data.get("speak", True),
    }


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


@app.route("/api/clide/stt-settings", methods=["GET", "PUT"])
def clide_stt_settings() -> Any:
    """Proxy the saved dictation preset; the shim remains its only owner."""
    url = f"{SHIM_BASE_URL}/api/stt-settings"
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
    """Read the runtime-owned judgements used by Studio and CLIde."""
    try:
        status, body, _ = _shim_get("/api/voice-labels")
        if status != 200:
            return {}
        stored = json.loads(body)
    except (OSError, ValueError, urllib.error.URLError):
        return {}
    voices = stored.get("voices") if isinstance(stored, dict) else None
    return voices if isinstance(voices, dict) else {}


@app.get("/api/voices/labels")
def voice_labels() -> Any:
    try:
        status, body, _ = _shim_get("/api/voice-labels")
    except urllib.error.URLError:
        return jsonify({"error": "The CLIde voice service is not reachable on 8890"}), 503
    return Response(body, status=status, mimetype="application/json")


@app.post("/api/voices/labels")
def save_voice_label() -> Any:
    data = request.get_json(silent=True) or {}
    try:
        status, body, _ = _shim_put("/api/voice-labels", data)
    except urllib.error.URLError:
        return jsonify({"error": "The CLIde voice service is not reachable on 8890"}), 503
    return Response(body, status=status, mimetype="application/json")


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


RECORDING_ID_PATTERN = re.compile(r"^[0-9]{8}T[0-9]{6}Z-[a-f0-9]{8}$")
PENDING_TOKEN_PATTERN = re.compile(r"^[a-f0-9]{32}$")


def _clean_pending_recordings() -> None:
    cutoff = time.time() - PENDING_RECORDING_TTL_SECONDS
    try:
        candidates = list(PENDING_RECORDINGS_DIR.iterdir())
    except OSError:
        return
    for path in candidates:
        try:
            if path.is_file() and path.stat().st_mtime < cutoff:
                path.unlink()
        except OSError:
            continue


def _stage_recording(audio: bytes, metadata: dict[str, Any]) -> str:
    """Keep one generated WAV available for explicit saving without rerendering."""
    PENDING_RECORDINGS_DIR.mkdir(parents=True, exist_ok=True)
    _clean_pending_recordings()
    token = uuid.uuid4().hex
    (PENDING_RECORDINGS_DIR / f"{token}.wav").write_bytes(audio)
    (PENDING_RECORDINGS_DIR / f"{token}.json").write_text(
        json.dumps(metadata, indent=2, sort_keys=True), encoding="utf-8"
    )
    return token


def _recording_paths(recording_id: str) -> tuple[Path, Path] | None:
    if not RECORDING_ID_PATTERN.fullmatch(recording_id):
        return None
    return (
        RECORDINGS_DIR / f"{recording_id}.wav",
        RECORDINGS_DIR / f"{recording_id}.json",
    )


def _read_recording(metadata_path: Path) -> dict[str, Any] | None:
    try:
        metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    recording_id = str(metadata.get("id") or "") if isinstance(metadata, dict) else ""
    paths = _recording_paths(recording_id)
    if paths is None or not paths[0].is_file() or paths[1] != metadata_path:
        return None
    return {
        **metadata,
        "audio_url": f"/api/recordings/{recording_id}/audio",
        "download_url": f"/api/recordings/{recording_id}/audio?download=1",
    }


@app.get("/api/recordings")
def recordings() -> Any:
    try:
        metadata_paths = list(RECORDINGS_DIR.glob("*.json"))
    except OSError:
        metadata_paths = []
    items = [item for path in metadata_paths if (item := _read_recording(path)) is not None]
    items.sort(key=lambda item: str(item.get("created_at") or ""), reverse=True)
    return jsonify({"recordings": items})


@app.post("/api/recordings")
def save_recording() -> Any:
    data = request.get_json(silent=True) or {}
    token = str(data.get("token") or "")
    title = " ".join(str(data.get("title") or "").split())[:MAX_RECORDING_TITLE_CHARS]
    if not PENDING_TOKEN_PATTERN.fullmatch(token):
        return jsonify({"error": "This generated recording is no longer available"}), 400
    if not title:
        return jsonify({"error": "Give the recording a title"}), 400

    pending_wav = PENDING_RECORDINGS_DIR / f"{token}.wav"
    pending_metadata = PENDING_RECORDINGS_DIR / f"{token}.json"
    try:
        metadata = json.loads(pending_metadata.read_text(encoding="utf-8"))
        if not isinstance(metadata, dict):
            raise ValueError("invalid metadata")
        with wave.open(str(pending_wav)) as wav_file:
            if wav_file.getnchannels() != 1 or wav_file.getsampwidth() != 2:
                raise wave.Error("unsupported WAV")
    except (OSError, ValueError, json.JSONDecodeError, EOFError, wave.Error):
        return jsonify({"error": "This generated recording is no longer available"}), 404

    created_at = datetime.now(UTC)
    recording_id = f"{created_at:%Y%m%dT%H%M%SZ}-{uuid.uuid4().hex[:8]}"
    RECORDINGS_DIR.mkdir(parents=True, exist_ok=True)
    wav_path, metadata_path = _recording_paths(recording_id) or (None, None)
    assert wav_path is not None and metadata_path is not None
    stored = {
        **metadata,
        "id": recording_id,
        "title": title,
        "created_at": created_at.isoformat().replace("+00:00", "Z"),
    }
    temporary_metadata = metadata_path.with_suffix(".json.tmp")
    try:
        temporary_metadata.write_text(
            json.dumps(stored, indent=2, sort_keys=True), encoding="utf-8"
        )
        pending_wav.replace(wav_path)
        temporary_metadata.replace(metadata_path)
        pending_metadata.unlink(missing_ok=True)
    except OSError:
        temporary_metadata.unlink(missing_ok=True)
        return jsonify({"error": "Could not save the recording"}), 500
    return jsonify(_read_recording(metadata_path)), 201


@app.get("/api/recordings/<recording_id>/audio")
def recording_audio(recording_id: str) -> Any:
    paths = _recording_paths(recording_id)
    if paths is None or not paths[0].is_file():
        return jsonify({"error": "Recording not found"}), 404
    title = recording_id
    item = _read_recording(paths[1])
    if item:
        title = re.sub(r"[^A-Za-z0-9._-]+", "-", str(item.get("title") or title)).strip("-")
    return send_file(
        paths[0],
        mimetype="audio/wav",
        as_attachment=request.args.get("download") == "1",
        download_name=f"{title or recording_id}.wav",
        conditional=True,
    )


@app.delete("/api/recordings/<recording_id>")
def delete_recording(recording_id: str) -> Any:
    paths = _recording_paths(recording_id)
    if paths is None or not any(path.is_file() for path in paths):
        return jsonify({"error": "Recording not found"}), 404
    try:
        for path in paths:
            path.unlink(missing_ok=True)
    except OSError:
        return jsonify({"error": "Could not delete the recording"}), 500
    return jsonify({"deleted": True, "id": recording_id})



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
