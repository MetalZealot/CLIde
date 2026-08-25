"""Whisper routes for the local Voice Studio.

This module keeps the OpenAI-style STT contract separate from the Piper
audition routes. It accepts only the two locally installed audition models and
uses the shared inference gate supplied by the host application.
"""

from __future__ import annotations

import os
import subprocess
import tempfile
import time
from pathlib import Path
from typing import Any

from flask import Flask, Response, jsonify, request


# Data, not code: the Whisper build and models stay outside the repository.
VOICE_ROOT = Path(os.environ.get("CLIDE_VOICE_ROOT", "/home/gnuthall/voice"))
WHISPER_CLI = VOICE_ROOT / "bin/whisper.cpp/build/bin/whisper-cli"
WHISPER_MODELS = {
    "tiny.en": VOICE_ROOT / "models/ggml-tiny.en.bin",
    "base.en": VOICE_ROOT / "models/ggml-base.en.bin",
}
DEFAULT_STT_MODEL = "tiny.en"
DEFAULT_THREADS = 4
FFMPEG_TIMEOUT_SECONDS = 30
WHISPER_TIMEOUT_SECONDS = 120
ALLOWED_EXTENSIONS = {".aac", ".m4a", ".mp3", ".ogg", ".opus", ".wav", ".webm"}
DECODER_PRESETS = {
    "standard": {
        "label": "Standard (Whisper defaults)",
        "arguments": [],
    },
    "careful": {
        "label": "Careful (larger search)",
        "arguments": ["-bo", "8", "-bs", "8"],
    },
}


class TranscriptionError(RuntimeError):
    """A safe, client-facing transcription failure."""


def _resolve_model(requested_model: str | None) -> tuple[str, Path]:
    model_id = (requested_model or "").strip()
    if model_id in {"", "whisper-1"}:
        model_id = DEFAULT_STT_MODEL
    model_path = WHISPER_MODELS.get(model_id)
    if model_path is None:
        raise TranscriptionError("Choose tiny.en or base.en")
    return model_id, model_path


def _require_runtime(model_path: Path) -> None:
    if not WHISPER_CLI.is_file() or not WHISPER_CLI.stat().st_mode & 0o111:
        raise TranscriptionError("whisper-cli is not installed")
    if not model_path.is_file():
        raise TranscriptionError("The selected Whisper model is not installed")


def _resolve_settings(form: Any) -> dict[str, Any]:
    try:
        threads = int(form.get("threads", DEFAULT_THREADS))
    except (TypeError, ValueError) as error:
        raise TranscriptionError("Threads must be a whole number") from error
    if not 1 <= threads <= 4:
        raise TranscriptionError("Choose between 1 and 4 CPU threads")

    preset_id = (form.get("decoder_preset") or "standard").strip()
    preset = DECODER_PRESETS.get(preset_id)
    if preset is None:
        raise TranscriptionError("Choose a supported decoder preset")

    initial_prompt = (form.get("initial_prompt") or "").strip()
    if len(initial_prompt) > 400:
        raise TranscriptionError("Initial prompt is limited to 400 characters")

    return {
        "threads": threads,
        "decoder_preset": preset_id,
        "decoder_label": preset["label"],
        "initial_prompt": initial_prompt,
    }


def _audio_duration_seconds(wav_path: Path) -> float | None:
    try:
        completed = subprocess.run(
            [
                "ffprobe", "-v", "error", "-show_entries", "format=duration",
                "-of", "default=noprint_wrappers=1:nokey=1", str(wav_path),
            ],
            check=True,
            capture_output=True,
            text=True,
            timeout=10,
        )
        return round(float(completed.stdout.strip()), 3)
    except (OSError, ValueError, subprocess.SubprocessError):
        return None


def _peak_rss_kib(process: subprocess.Popen[str]) -> int:
    try:
        for line in Path(f"/proc/{process.pid}/status").read_text().splitlines():
            if line.startswith("VmRSS:"):
                return int(line.split()[1])
    except (FileNotFoundError, OSError, ValueError, IndexError):
        pass
    return 0


def _transcribe_upload(
    upload: Any, model_path: Path, settings: dict[str, Any]
) -> tuple[str, float, float | None, int]:
    _require_runtime(model_path)
    suffix = Path(str(getattr(upload, "filename", "recording.webm"))).suffix.lower()
    if suffix not in ALLOWED_EXTENSIONS:
        raise TranscriptionError("Use AAC, M4A, MP3, OGG, OPUS, WAV, or WebM audio")

    with tempfile.TemporaryDirectory(prefix="clide-whisper-") as temp_dir:
        temp_path = Path(temp_dir)
        source_path = temp_path / f"upload{suffix}"
        wav_path = temp_path / "normalized.wav"
        upload.save(source_path)
        if not source_path.stat().st_size:
            raise TranscriptionError("The recording was empty")

        try:
            subprocess.run(
                [
                    "ffmpeg", "-hide_banner", "-loglevel", "error", "-nostdin", "-y",
                    "-i", str(source_path), "-ar", "16000", "-ac", "1",
                    "-c:a", "pcm_s16le", str(wav_path),
                ],
                check=True,
                capture_output=True,
                text=True,
                timeout=FFMPEG_TIMEOUT_SECONDS,
            )
        except subprocess.TimeoutExpired as error:
            raise TranscriptionError("Audio conversion timed out") from error
        except subprocess.CalledProcessError as error:
            raise TranscriptionError("The recording could not be decoded") from error

        started = time.perf_counter()
        try:
            command = [
                str(WHISPER_CLI), "-m", str(model_path), "-f", str(wav_path),
                "-t", str(settings["threads"]), "-nt", "-np", "-otxt", "-of", "-",
                *DECODER_PRESETS[settings["decoder_preset"]]["arguments"],
            ]
            if settings["initial_prompt"]:
                command.extend(["--prompt", settings["initial_prompt"]])
            process = subprocess.Popen(
                command,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
            )
            peak_rss_kib = 0
            deadline = started + WHISPER_TIMEOUT_SECONDS
            while process.poll() is None:
                peak_rss_kib = max(peak_rss_kib, _peak_rss_kib(process))
                if time.perf_counter() >= deadline:
                    process.kill()
                    process.communicate()
                    raise TranscriptionError("Transcription timed out")
                time.sleep(0.05)
            stdout, stderr = process.communicate()
        except OSError as error:
            raise TranscriptionError("Whisper could not start") from error
        if process.returncode != 0:
            raise TranscriptionError("Whisper could not transcribe this recording")

        return stdout.strip(), time.perf_counter() - started, _audio_duration_seconds(wav_path), peak_rss_kib


def register_whisper_routes(app: Flask, inference_lock: Any) -> None:
    @app.get("/api/health")
    def health() -> Response:
        configured = WHISPER_CLI.is_file() and WHISPER_MODELS[DEFAULT_STT_MODEL].is_file()
        return jsonify(
            {
                "configured": configured,
                "stt_model": DEFAULT_STT_MODEL,
                "studio_models": [
                    {"id": model_id, "installed": model_path.is_file()}
                    for model_id, model_path in WHISPER_MODELS.items()
                ],
            }
        )

    @app.post("/audio/transcriptions")
    def transcriptions() -> Response:
        upload = request.files.get("file")
        if upload is None:
            return jsonify({"error": "Expected multipart field 'file'"}), 400
        if not inference_lock.acquire(blocking=False):
            return jsonify({"error": "Another local voice job is running; try again shortly"}), 429
        try:
            model_id, model_path = _resolve_model(request.form.get("model"))
            settings = _resolve_settings(request.form)
            text, elapsed_seconds, duration_seconds, peak_rss_kib = _transcribe_upload(upload, model_path, settings)
        except TranscriptionError as error:
            return jsonify({"error": str(error)}), 400
        finally:
            inference_lock.release()

        response = jsonify(
            {
                "text": text,
                "studio_settings": {
                    "threads": settings["threads"],
                    "decoder_preset": settings["decoder_preset"],
                    "decoder_label": settings["decoder_label"],
                    "initial_prompt": settings["initial_prompt"],
                },
            }
        )
        response.headers["X-Voice-Model"] = model_id
        response.headers["X-Voice-Process-Ms"] = str(round(elapsed_seconds * 1_000))
        response.headers["X-Voice-Peak-Rss-KiB"] = str(peak_rss_kib)
        response.headers["X-Voice-Threads"] = str(settings["threads"])
        if duration_seconds is not None:
            response.headers["X-Voice-Audio-Seconds"] = str(duration_seconds)
        return response
