#!/usr/bin/env python3
"""Loopback-only OpenAI-compatible Piper and Whisper service for CLIde."""

from __future__ import annotations

import argparse
import base64
import json
import io
import logging
import os
import re
import subprocess
import tempfile
import threading
import time
import uuid
import wave
from dataclasses import dataclass, replace
from pathlib import Path
from typing import Any

from flask import Flask, Response, jsonify, render_template, request
from piper import PiperVoice, SynthesisConfig

from normalizer import prepare_speech_text, speech_segments
from speech_rules import (
    EDITABLE_VOICE_FIELDS,
    rules_store,
)


# The models, the Whisper build and the user's saved rules are data, not code:
# they stay outside the repository. CLIDE_VOICE_ROOT relocates them together.
VOICE_ROOT = Path(os.environ.get("CLIDE_VOICE_ROOT", "/home/gnuthall/voice"))
WHISPER_CLI = VOICE_ROOT / "bin/whisper.cpp/build/bin/whisper-cli"
STT_DECODER_ARGUMENTS = {
    "standard": [],
    "careful": ["-bo", "8", "-bs", "8"],
}
MAX_UPLOAD_BYTES = 25 * 1024 * 1024
MAX_TTS_INPUT_CHARS = 6_000
FFMPEG_TIMEOUT_SECONDS = 30
WHISPER_TIMEOUT_SECONDS = 120
ALLOWED_EXTENSIONS = {".aac", ".m4a", ".mp3", ".ogg", ".opus", ".wav", ".webm"}
SUPPORTED_TTS_MODELS = {"", "tts-1"}
MAX_NAMED_SPEAKERS = 32
VOICE_LABELS_PATH = VOICE_ROOT / "voice-labels.json"
VOICE_KEY_PATTERN = re.compile(r"^[A-Za-z0-9_.-]{1,80}(?:#\d{1,4})?$")
VOICE_GENDERS = {"", "male", "female", "neutral"}
MAX_VOICE_NOTE_CHARS = 2_000
voice_labels_lock = threading.Lock()


@dataclass(frozen=True)
class VoicePreset:
    model_id: str
    speaker_id: int | None = None
    source_key: str | None = None
    length_scale: float | None = None
    noise_scale: float | None = None
    noise_w_scale: float | None = None
    normalize_audio: bool = True
    volume: float = 1.0
    sentence_silence_seconds: float = 0.0
    path_separator: str = "slash"
    # Pause after a heading, list item, table row, or paragraph. Longer than an
    # ordinary sentence break, because those boundaries carry more structure.
    # Set by ear; None means twice the sentence pause, which is a starting
    # point rather than a measured value -- there is nothing to measure here,
    # only listening.
    structure_silence_seconds: float | None = None


@dataclass(frozen=True)
class CatalogVoice:
    label: str
    gender: str
    tier: str
    locale: str
    preset: VoicePreset


# This is the production allowlist, not the installed-model inventory or the
# Voice Studio favorites file. Accepted pacing overrides are explicit; voices
# without one use the model's own config.
VOICE_CATALOG = {
    "danny-low": CatalogVoice(
        "Danny", "male", "low", "en-US", VoicePreset("en_US-danny-low")
    ),
    "hfc-male-medium": CatalogVoice(
        "HFC Male",
        "male",
        "medium",
        "en-US",
        VoicePreset(
            "en_US-hfc_male-medium",
            length_scale=0.90,
            sentence_silence_seconds=0.10,
        ),
    ),
    "kusal-medium": CatalogVoice(
        "Kusal",
        "male",
        "medium",
        "en-US",
        VoicePreset("en_US-kusal-medium"),
    ),
    "rocket-raccoon-medium": CatalogVoice(
        "Rocket Raccoon",
        "male",
        "bonus",
        "en-US",
        VoicePreset("en_US-rocket-raccoon-medium", length_scale=0.85),
    ),
    "lessac-low": CatalogVoice(
        "Lessac", "female", "low", "en-US", VoicePreset("en_US-lessac-low")
    ),
    "hfc-female-medium": CatalogVoice(
        "HFC Female",
        "female",
        "medium",
        "en-US",
        VoicePreset(
            "en_US-hfc_female-medium",
            length_scale=0.90,
            sentence_silence_seconds=0.10,
        ),
    ),
    "cori-medium": CatalogVoice(
        "Cori", "female", "medium-gb", "en-GB", VoicePreset("en_GB-cori-medium")
    ),
    "agentvibes-jenny": CatalogVoice(
        "AgentVibes Jenny",
        "female",
        "bonus",
        "en-GB",
        VoicePreset(
            "agentvibes-jenny",
            sentence_silence_seconds=0.20,
            path_separator="stroke",
        ),
    ),
}
VOICE_PRESETS = {
    voice_id: catalog_voice.preset
    for voice_id, catalog_voice in VOICE_CATALOG.items()
}
DEFAULT_TTS_VOICE = "hfc-male-medium"

app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = MAX_UPLOAD_BYTES
_LOGGER = logging.getLogger("voice-shim")
inference_lock = threading.Lock()
speech_job_condition = threading.Condition()
active_speech_job: "SpeechJob | None" = None
cancelled_speech_jobs: dict[str, float] = {}
SPEECH_JOB_ID_PATTERN = re.compile(r"^[A-Za-z0-9_-]{1,64}$")
CANCELLED_JOB_TTL_SECONDS = 600


class TranscriptionError(RuntimeError):
    """A safe, client-facing transcription failure."""


class SynthesisError(RuntimeError):
    """A safe, client-facing synthesis failure."""


class SynthesisCancelled(RuntimeError):
    """A requested synthesis stopped before producing a response."""


@dataclass(frozen=True)
class SpeechJob:
    job_id: str
    cancel_event: threading.Event


class VoiceCache:
    """Keep only the most recently used Piper model resident."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._model_id: str | None = None
        self._voice: PiperVoice | None = None

    def _resident_voice(self, preset: VoicePreset) -> PiperVoice:
        """Return the loaded model for this preset. Caller holds self._lock."""
        model_path = VOICE_ROOT / "models" / f"{preset.model_id}.onnx"
        config_path = Path(f"{model_path}.json")
        if not model_path.is_file() or not config_path.is_file():
            raise SynthesisError("The selected Piper voice is not installed")

        if self._model_id != preset.model_id or self._voice is None:
            _LOGGER.info("Loading Piper model %s", preset.model_id)
            try:
                self._voice = PiperVoice.load(model_path)
            except (OSError, RuntimeError, ValueError) as error:
                raise SynthesisError("The selected Piper voice could not be loaded") from error
            self._model_id = preset.model_id
        return self._voice

    def phonemize(self, preset: VoicePreset, text: str) -> list[list[str]]:
        """The eSpeak phonemes this voice would receive. Diagnostic only."""
        with self._lock:
            return self._resident_voice(preset).phonemize(text)

    def synthesize(
        self,
        preset: VoicePreset,
        text: str,
        cancel_event: threading.Event | None = None,
        structure_flags: list[bool] | None = None,
    ) -> tuple[bytes, int, int]:
        """Render one Piper request, varying only the silence between sentences.

        `structure_flags` marks which sentences close a heading, list item,
        table row, or paragraph. This is a single synthesize() call whose
        chunks are Piper's own sentences; it is not several renders stitched
        together, which is what once produced static. If Piper's sentence count
        disagrees with ours the flags are discarded and every gap falls back to
        the ordinary sentence pause, so the failure is a flat rhythm rather
        than corrupt audio.
        """
        with self._lock:
            voice = self._resident_voice(preset)
            if preset.source_key is not None:
                mapped_speaker = voice.config.speaker_id_map.get(preset.source_key)
                if mapped_speaker != preset.speaker_id:
                    raise SynthesisError("The selected Piper speaker mapping is invalid")

            config = SynthesisConfig(
                speaker_id=preset.speaker_id,
                length_scale=preset.length_scale,
                noise_scale=preset.noise_scale,
                noise_w_scale=preset.noise_w_scale,
                normalize_audio=preset.normalize_audio,
                volume=preset.volume,
            )
            def _silence(seconds: float) -> bytes:
                # Whole 16-bit frames only: an odd byte count shifts every
                # later sample and turns the rest of the message into static.
                return bytes(int(voice.config.sample_rate * seconds) * 2)

            sentence_silence = _silence(preset.sentence_silence_seconds)
            structure_silence = _silence(
                preset.sentence_silence_seconds * 2
                if preset.structure_silence_seconds is None
                else preset.structure_silence_seconds
            )
            wav_io = io.BytesIO()
            frames = 0
            try:
                with wave.open(wav_io, "wb") as wav_file:
                    wav_file.setframerate(voice.config.sample_rate)
                    wav_file.setsampwidth(2)
                    wav_file.setnchannels(1)
                    index = 0
                    # Streamed, not materialised: cancellation has to land on
                    # the next chunk rather than after the whole render.
                    for index, chunk in enumerate(voice.synthesize(text, config)):
                        if cancel_event is not None and cancel_event.is_set():
                            raise SynthesisCancelled()
                        if index > 0:
                            after_structure = (
                                structure_flags is not None
                                and index - 1 < len(structure_flags)
                                and structure_flags[index - 1]
                            )
                            silence = structure_silence if after_structure else sentence_silence
                            wav_file.writeframes(silence)
                            frames += len(silence) // 2
                        wav_file.writeframes(chunk.audio_int16_bytes)
                        frames += len(chunk.audio_int16_bytes) // 2
                    if cancel_event is not None and cancel_event.is_set():
                        raise SynthesisCancelled()
                    # Piper splits sentences itself. If its count disagrees
                    # with ours the pauses landed in the wrong places, which is
                    # a flat rhythm, never corrupt audio.
                    if structure_flags is not None and index + 1 != len(structure_flags):
                        _LOGGER.info(
                            "tts pacing=misaligned sentences=%d chunks=%d",
                            len(structure_flags),
                            index + 1,
                        )
            except SynthesisCancelled:
                raise
            except (OSError, RuntimeError, ValueError) as error:
                raise SynthesisError("Piper could not synthesize this response") from error

            return wav_io.getvalue(), frames, voice.config.sample_rate


voice_cache = VoiceCache()


def _whisper_models() -> dict[str, Path]:
    """Installed whisper.cpp model files addressed only by their safe IDs."""
    return {
        model_path.name.removeprefix("ggml-").removesuffix(".bin"): model_path
        for model_path in sorted((VOICE_ROOT / "models").glob("ggml-*.bin"))
        if VOICE_KEY_PATTERN.fullmatch(
            model_path.name.removeprefix("ggml-").removesuffix(".bin")
        )
    }


def _resolve_model(requested_model: str | None) -> tuple[str, Path]:
    """Resolve an explicit model or the current Voice Studio default."""
    model_id = (requested_model or "").strip()
    if model_id in {"", "whisper-1"}:
        model_id = str(rules_store.current().stt["model"])
    model_path = _whisper_models().get(model_id)
    if model_path is None:
        raise TranscriptionError("Choose an installed Whisper model")
    return model_id, model_path


def _require_runtime(model_path: Path) -> None:
    if not WHISPER_CLI.is_file() or not WHISPER_CLI.stat().st_mode & 0o111:
        raise TranscriptionError("whisper-cli is not installed")
    if not model_path.is_file():
        raise TranscriptionError("The selected Whisper model is not installed")


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
    """Read the child process RSS without retaining user audio or transcript data."""
    try:
        for line in Path(f"/proc/{process.pid}/status").read_text().splitlines():
            if line.startswith("VmRSS:"):
                return int(line.split()[1])
    except (FileNotFoundError, OSError, ValueError, IndexError):
        pass
    return 0


def _transcribe_upload(
    upload: Any,
    model_path: Path,
    settings: dict[str, Any],
) -> tuple[str, float, float | None, int]:
    """Return transcript, elapsed wall time, audio duration, and peak Whisper RSS."""
    _require_runtime(model_path)
    original_name = str(getattr(upload, "filename", "recording.webm"))
    suffix = Path(original_name).suffix.lower()
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
            _LOGGER.info("ffmpeg rejected upload: %s", error.stderr.strip())
            raise TranscriptionError("The recording could not be decoded") from error

        started = time.perf_counter()
        try:
            command = [
                str(WHISPER_CLI), "-m", str(model_path), "-f", str(wav_path),
                "-t", str(settings["threads"]), "-nt", "-np", "-otxt", "-of", "-",
                *STT_DECODER_ARGUMENTS[settings["decoder_preset"]],
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
            _LOGGER.error("whisper-cli failed: %s", stderr.strip())
            raise TranscriptionError("Whisper could not transcribe this recording")

        return stdout.strip(), time.perf_counter() - started, _audio_duration_seconds(wav_path), peak_rss_kib


@app.get("/")
def studio() -> str:
    return render_template("index.html")


@app.get("/api/health")
def health() -> Response:
    rules = rules_store.current()
    stt_settings = rules.stt
    whisper_models = _whisper_models()
    stt_configured = WHISPER_CLI.is_file() and stt_settings["model"] in whisper_models
    tts_models = sorted({preset.model_id for preset in VOICE_PRESETS.values()})
    tts_configured = all(
        (VOICE_ROOT / "models" / f"{model_id}.onnx").is_file()
        and (VOICE_ROOT / "models" / f"{model_id}.onnx.json").is_file()
        for model_id in tts_models
    )
    return jsonify(
        {
            "configured": stt_configured and tts_configured,
            "stt_configured": stt_configured,
            "stt_model": stt_settings["model"],
            "stt_settings": stt_settings,
            "studio_models": [
                {"id": model_id, "installed": model_path.is_file()}
                for model_id, model_path in whisper_models.items()
            ],
            "tts_configured": tts_configured,
            "tts_default_voice": _runtime_default_voice(),
            "tts_selected_voice": rules.tts["selected_voice"] or None,
            "tts_voices": [
                {
                    "id": voice_id,
                    "label": catalog_voice.label,
                    "gender": catalog_voice.gender,
                    "tier": catalog_voice.tier,
                    "locale": catalog_voice.locale,
                }
                for voice_id, catalog_voice in VOICE_CATALOG.items()
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
    requested_model = request.form.get("model")
    try:
        model_id, model_path = _resolve_model(requested_model)
        settings = rules_store.current().stt
        text, elapsed_seconds, duration_seconds, peak_rss_kib = _transcribe_upload(
            upload, model_path, settings
        )
    except TranscriptionError as error:
        _LOGGER.info(
            "stt status=error model=%s",
            requested_model or rules_store.current().stt["model"],
        )
        return jsonify({"error": str(error)}), 400
    finally:
        inference_lock.release()

    _LOGGER.info(
        "stt status=ok model=%s process_ms=%d peak_rss_kib=%d",
        model_id,
        round(elapsed_seconds * 1_000),
        peak_rss_kib,
    )

    response = jsonify({"text": text})
    response.headers["X-Voice-Model"] = model_id
    response.headers["X-Voice-Process-Ms"] = str(round(elapsed_seconds * 1_000))
    response.headers["X-Voice-Peak-Rss-KiB"] = str(peak_rss_kib)
    response.headers["X-Voice-Threads"] = str(settings["threads"])
    if duration_seconds is not None:
        response.headers["X-Voice-Audio-Seconds"] = str(duration_seconds)
    return response


def _resolve_voice(requested_voice: Any) -> tuple[str, VoicePreset]:
    voice_id = requested_voice.strip() if isinstance(requested_voice, str) else ""
    if voice_id in {"", "alloy"}:
        runtime_default = _runtime_default_voice()
        if not runtime_default:
            raise SynthesisError("No default TTS voice is configured; choose an explicit catalog voice")
        voice_id = str(rules_store.current().tts.get("selected_voice") or runtime_default)
    preset = VOICE_PRESETS.get(voice_id)
    if preset is not None:
        return voice_id, _with_saved_overrides(voice_id, preset)
    return voice_id, _with_saved_overrides(voice_id, _installed_voice_preset(voice_id))


def _runtime_default_voice() -> str:
    """Shared user-selected default, falling back to the configured catalog voice."""
    return str(rules_store.current().tts.get("default_voice") or DEFAULT_TTS_VOICE or "")


def _with_saved_overrides(voice_id: str, preset: VoicePreset) -> VoicePreset:
    """Apply the pacing values edited in Voice Studio, if any were saved."""
    overrides = rules_store.current().voices.get(voice_id)
    if not overrides:
        return preset
    return replace(preset, **{
        key: value for key, value in overrides.items()
        if key in EDITABLE_VOICE_FIELDS or key == "path_separator"
    })


def _with_speech_pace(preset: VoicePreset) -> VoicePreset:
    """Scale timing from the saved baseline without changing that baseline."""
    pace = float(rules_store.current().tts.get("speech_pace", 1.0))
    if abs(pace - 1.0) < 1e-9:
        return preset
    length_scale = (
        _model_default_length_scale(preset.model_id)
        if preset.length_scale is None
        else preset.length_scale
    )
    return replace(
        preset,
        length_scale=length_scale / pace,
        sentence_silence_seconds=preset.sentence_silence_seconds / pace,
        structure_silence_seconds=(
            None
            if preset.structure_silence_seconds is None
            else preset.structure_silence_seconds / pace
        ),
    )


def _speech_job_id() -> str:
    job_id = request.headers.get("X-Voice-Job-ID", "").strip()
    if not job_id:
        return uuid.uuid4().hex
    if not SPEECH_JOB_ID_PATTERN.fullmatch(job_id):
        raise ValueError("Expected a valid X-Voice-Job-ID header")
    return job_id


def _prune_cancelled_speech_jobs(now: float) -> None:
    expired = [
        job_id
        for job_id, cancelled_at in cancelled_speech_jobs.items()
        if now - cancelled_at >= CANCELLED_JOB_TTL_SECONDS
    ]
    for job_id in expired:
        del cancelled_speech_jobs[job_id]


def _claim_speech_job(job_id: str) -> SpeechJob | None:
    global active_speech_job

    with speech_job_condition:
        _prune_cancelled_speech_jobs(time.monotonic())
        if cancelled_speech_jobs.pop(job_id, None) is not None:
            return None
        job = SpeechJob(job_id, threading.Event())
        active_speech_job = job
        return job


def _release_speech_job(job: SpeechJob) -> None:
    global active_speech_job

    with speech_job_condition:
        if active_speech_job is job:
            active_speech_job = None
        speech_job_condition.notify_all()


def _cancel_speech_job(job_id: str, wait_seconds: float = 60.0) -> bool:
    with speech_job_condition:
        _prune_cancelled_speech_jobs(time.monotonic())
        job = active_speech_job
        if job is None or job.job_id != job_id:
            cancelled_speech_jobs[job_id] = time.monotonic()
            return True

        job.cancel_event.set()
        deadline = time.monotonic() + wait_seconds
        while active_speech_job is job:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                break
            speech_job_condition.wait(remaining)
        return active_speech_job is not job


def _acquire_speech_inference() -> bool:
    if inference_lock.acquire(blocking=False):
        return True

    with speech_job_condition:
        previous_job = active_speech_job
        if previous_job is None:
            return False
        previous_job.cancel_event.set()
        deadline = time.monotonic() + 60.0
        while active_speech_job is previous_job:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                return False
            speech_job_condition.wait(remaining)

    return inference_lock.acquire(timeout=1.0)


@app.post("/audio/speech/cancel")
def cancel_speech() -> Response:
    data = request.get_json(silent=True)
    job_id = data.get("job_id") if isinstance(data, dict) else None
    if not isinstance(job_id, str) or not SPEECH_JOB_ID_PATTERN.fullmatch(job_id):
        return jsonify({"error": "Expected a valid job_id"}), 400

    released = _cancel_speech_job(job_id)
    return jsonify({"cancelled": True, "released": released})


@app.post("/audio/speech")
def speech() -> Response:
    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        return jsonify({"error": "Expected a JSON request"}), 400

    raw_text = data.get("input")
    if not isinstance(raw_text, str) or not raw_text.strip():
        return jsonify({"error": "Expected non-empty input text"}), 400
    if len(raw_text) > MAX_TTS_INPUT_CHARS:
        return jsonify({"error": f"Input is limited to {MAX_TTS_INPUT_CHARS:,} characters"}), 400

    model = data.get("model", "")
    if not isinstance(model, str) or model.strip() not in SUPPORTED_TTS_MODELS:
        return jsonify({"error": "Only the tts-1 model is supported"}), 400
    response_format = data.get("response_format", "")
    if not isinstance(response_format, str) or response_format.strip().lower() not in {"", "wav"}:
        return jsonify({"error": "Only WAV response format is supported"}), 400

    try:
        voice_id, preset = _resolve_voice(data.get("voice"))
        preset = _with_speech_pace(preset)
    except SynthesisError as error:
        return jsonify({"error": str(error)}), 503
    except ValueError as error:
        return jsonify({"error": str(error)}), 400

    speech_text, structure_flags = speech_segments(raw_text, preset.path_separator)
    if not speech_text:
        return jsonify({"error": "Nothing speakable remained after normalization"}), 400
    try:
        job_id = _speech_job_id()
    except ValueError as error:
        return jsonify({"error": str(error)}), 400
    if not _acquire_speech_inference():
        return jsonify({"error": "Another local voice job is running; try again shortly"}), 429

    job = _claim_speech_job(job_id)
    if job is None:
        inference_lock.release()
        return jsonify({"error": "Speech generation cancelled"}), 409

    started = time.perf_counter()
    try:
        wav_bytes, frames, sample_rate = voice_cache.synthesize(
            preset,
            speech_text,
            job.cancel_event,
            structure_flags,
        )
    except SynthesisCancelled:
        _LOGGER.info("tts status=cancelled voice=%s model=%s", voice_id, preset.model_id)
        return jsonify({"error": "Speech generation cancelled"}), 409
    except SynthesisError as error:
        _LOGGER.info("tts status=error voice=%s model=%s", voice_id, preset.model_id)
        return jsonify({"error": str(error)}), 503
    except Exception:
        _LOGGER.exception("tts status=error voice=%s model=%s", voice_id, preset.model_id)
        return jsonify({"error": "Piper could not synthesize this response"}), 500
    finally:
        _release_speech_job(job)
        inference_lock.release()

    elapsed_seconds = time.perf_counter() - started
    audio_seconds = frames / sample_rate if sample_rate else 0
    _LOGGER.info(
        "tts status=ok voice=%s model=%s process_ms=%d audio_seconds=%.3f speech=%r",
        voice_id,
        preset.model_id,
        round(elapsed_seconds * 1_000),
        audio_seconds,
        speech_text[:200],
    )
    response = Response(wav_bytes, mimetype="audio/wav")
    response.headers["X-Voice-Voice"] = voice_id
    response.headers["X-Voice-Model"] = preset.model_id
    response.headers["X-Voice-Process-Ms"] = str(round(elapsed_seconds * 1_000))
    response.headers["X-Voice-Audio-Seconds"] = str(round(audio_seconds, 3))
    return response


def _model_render_defaults(model_id: str) -> dict[str, float | bool]:
    """The render values Piper would use when Studio applies no overrides."""
    try:
        config = json.loads((VOICE_ROOT / "models" / f"{model_id}.onnx.json").read_text())
    except (OSError, ValueError):
        config = {}
    inference = config.get("inference") or {}
    return {
        "length_scale": float(inference.get("length_scale", 1.0)),
        "noise_scale": float(inference.get("noise_scale", 0.667)),
        "noise_w_scale": float(inference.get("noise_w", 0.8)),
        "normalize_audio": True,
        "volume": 1.0,
    }


def _model_default_length_scale(model_id: str) -> float:
    """Compatibility helper for saved pacing rules and voice labels."""
    return float(_model_render_defaults(model_id)["length_scale"])


def _effective_render_settings(preset: VoicePreset) -> dict[str, float | bool]:
    defaults = _model_render_defaults(preset.model_id)
    sentence_silence = preset.sentence_silence_seconds
    return {
        "length_scale": (
            defaults["length_scale"] if preset.length_scale is None else preset.length_scale
        ),
        "noise_scale": defaults["noise_scale"] if preset.noise_scale is None else preset.noise_scale,
        "noise_w_scale": (
            defaults["noise_w_scale"]
            if preset.noise_w_scale is None
            else preset.noise_w_scale
        ),
        "normalize_audio": preset.normalize_audio,
        "volume": preset.volume,
        "sentence_silence_seconds": sentence_silence,
        "structure_silence_seconds": (
            sentence_silence * 2
            if preset.structure_silence_seconds is None
            else preset.structure_silence_seconds
        ),
    }


def _only_real_overrides(voices: Any) -> dict[str, dict[str, Any]]:
    """Keep just the values that differ from the catalogue defaults.

    The UI posts every field every time; without this, the saved file would
    pin values nobody changed and "overridden" would stop meaning anything.
    """
    trimmed: dict[str, dict[str, Any]] = {}
    for voice_id, overrides in voices.items():
        preset = VOICE_PRESETS.get(voice_id)
        if preset is None or not isinstance(overrides, dict):
            continue
        defaults = {
            "length_scale": (
                _model_default_length_scale(preset.model_id)
                if preset.length_scale is None
                else preset.length_scale
            ),
            "sentence_silence_seconds": preset.sentence_silence_seconds,
            "structure_silence_seconds": (
                preset.sentence_silence_seconds * 2
                if preset.structure_silence_seconds is None
                else preset.structure_silence_seconds
            ),
            "path_separator": preset.path_separator,
        }
        changed = {
            key: value
            for key, value in overrides.items()
            if key in defaults and value is not None and (
                value != defaults[key]
                if isinstance(value, str)
                else abs(float(value) - float(defaults[key])) > 1e-9
            )
        }
        if changed:
            trimmed[voice_id] = changed
    return trimmed


SWEEP_PATH = VOICE_ROOT / "auditions/voice-word-drop-sweep.txt"


def _sweep_verdicts() -> dict[str, str]:
    """PASS/WEAK/DROPS per model from the last catalogue sweep, if it exists.

    Advisory only: it is a measurement, not a gate, and a voice can pass the
    probe and still sound wrong. Regenerate with `speech_probe.py drop`.
    """
    verdicts: dict[str, str] = {}
    try:
        lines = SWEEP_PATH.read_text(encoding="utf-8").splitlines()[1:]
    except OSError:
        return verdicts
    for line in lines:
        parts = line.split()
        if len(parts) >= 2:
            verdicts[parts[0]] = parts[-1]
    return verdicts


def _installed_models() -> list[dict[str, Any]]:
    verdicts = _sweep_verdicts()
    models = []
    for model_path in sorted((VOICE_ROOT / "models").glob("*.onnx")):
        config_path = model_path.with_suffix(".onnx.json")
        try:
            config = json.loads(config_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        speaker_map = config.get("speaker_id_map") or {}
        num_speakers = int(config.get("num_speakers", 1))
        render_defaults = _model_render_defaults(model_path.stem)
        models.append({
            "id": model_path.stem,
            "num_speakers": num_speakers,
            **render_defaults,
            "sentence_silence_seconds": 0.0,
            "structure_silence_seconds": 0.0,
            "verdict": verdicts.get(model_path.stem, ""),
            "quality": (config.get("audio") or {}).get("quality", ""),
            "region": (config.get("language") or {}).get("region", ""),
            "language": (config.get("language") or {}).get("code", ""),
            "dataset": config.get("dataset", ""),
            # A named cast is worth showing; a corpus of reader ids is not, so
            # large maps are left for the client to number.
            "speakers": (
                [name for name, _ in sorted(speaker_map.items(), key=lambda pair: pair[1])]
                if 1 < num_speakers <= MAX_NAMED_SPEAKERS
                else []
            ),
        })
    return models


def _read_voice_labels() -> dict[str, dict[str, Any]]:
    """Return durable voice judgements; malformed data never blocks speech."""
    try:
        stored = json.loads(VOICE_LABELS_PATH.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return {}
    except (OSError, json.JSONDecodeError) as error:
        _LOGGER.warning("Ignoring unreadable %s: %s", VOICE_LABELS_PATH.name, error)
        return {}
    voices = stored.get("voices") if isinstance(stored, dict) else None
    if not isinstance(voices, dict):
        return {}
    return {
        str(key): dict(value)
        for key, value in voices.items()
        if isinstance(key, str) and isinstance(value, dict)
    }


def _write_voice_labels(voices: dict[str, dict[str, Any]]) -> None:
    temporary = VOICE_LABELS_PATH.with_name(f"{VOICE_LABELS_PATH.name}.tmp")
    temporary.write_text(
        json.dumps({"voices": voices}, indent=2, sort_keys=True), encoding="utf-8"
    )
    temporary.replace(VOICE_LABELS_PATH)


def _voice_key_parts(voice_id: str) -> tuple[str, int | None, dict[str, Any]]:
    if not VOICE_KEY_PATTERN.fullmatch(voice_id):
        raise ValueError("Unknown TTS voice")
    model_id, separator, speaker_text = voice_id.partition("#")
    installed = {model["id"]: model for model in _installed_models()}
    model = installed.get(model_id)
    if model is None:
        raise ValueError("Unknown TTS voice")
    speaker_id = int(speaker_text) if separator else None
    num_speakers = int(model["num_speakers"])
    if num_speakers > 1 and speaker_id is None:
        raise ValueError("Choose a speaker for this multi-speaker voice")
    if speaker_id is not None and not 0 <= speaker_id < num_speakers:
        raise ValueError("Unknown TTS speaker")
    return model_id, speaker_id, model


def _matching_catalog_voice(model_id: str, speaker_id: int | None) -> str | None:
    normalized_speaker = speaker_id if speaker_id not in {None, 0} else None
    for voice_id, preset in VOICE_PRESETS.items():
        if preset.model_id == model_id and preset.speaker_id == normalized_speaker:
            return voice_id
    return None


def _installed_voice_preset(voice_id: str) -> VoicePreset:
    """Resolve only a runtime-published model/speaker ID, never a path."""
    model_id, speaker_id, model = _voice_key_parts(voice_id)
    catalog_voice = _matching_catalog_voice(model_id, speaker_id)
    if catalog_voice is not None:
        return _with_saved_overrides(catalog_voice, VOICE_PRESETS[catalog_voice])

    canonical_key = model_id if int(model["num_speakers"]) == 1 else f"{model_id}#{speaker_id}"
    label = _read_voice_labels().get(canonical_key, {})
    length_scale = label.get("length_scale")
    if not isinstance(length_scale, (int, float)):
        length_scale = None
    elif not EDITABLE_VOICE_FIELDS["length_scale"][0] <= float(length_scale) \
            <= EDITABLE_VOICE_FIELDS["length_scale"][1]:
        length_scale = None
    return VoicePreset(
        model_id=model_id,
        speaker_id=speaker_id,
        source_key=canonical_key,
        length_scale=float(length_scale) if length_scale is not None else None,
    )


def _display_model_name(model_id: str) -> str:
    without_locale = re.sub(r"^[a-z]{2}_[A-Z]{2}-", "", model_id)
    without_tier = re.sub(r"-(?:x-low|low|medium|high)$", "", without_locale)
    return without_tier.replace("_", " ").replace("-", " ").title()


def _favorite_voices() -> list[dict[str, Any]]:
    favorites: list[dict[str, Any]] = []
    for source_key, entry in sorted(_read_voice_labels().items()):
        if entry.get("favorite") is not True:
            continue
        try:
            model_id, speaker_id, model = _voice_key_parts(source_key)
        except ValueError:
            continue
        catalog_voice_id = _matching_catalog_voice(model_id, speaker_id)
        catalog_voice = VOICE_CATALOG.get(catalog_voice_id or "")
        speaker_name = str(entry.get("speaker_name") or "").strip() or None
        if speaker_name is None and speaker_id is not None:
            speakers = model.get("speakers") or []
            speaker_name = (
                str(speakers[speaker_id])
                if speaker_id < len(speakers)
                else f"Speaker {speaker_id}"
            )
        label = str(entry.get("label") or "").strip()
        if not label:
            label = catalog_voice.label if catalog_voice else _display_model_name(model_id)
        if speaker_name:
            label = f"{label} · {speaker_name}"
        favorites.append({
            "id": catalog_voice_id or source_key,
            "source_key": source_key,
            "model_id": model_id,
            "speaker_id": speaker_id,
            "speaker_name": speaker_name,
            "label": label,
            "gender": entry.get("gender") if entry.get("gender") in VOICE_GENDERS else "",
            "length_scale": entry.get("length_scale")
            if isinstance(entry.get("length_scale"), (int, float)) else None,
            "notes": str(entry.get("notes") or "")[:MAX_VOICE_NOTE_CHARS],
            "num_speakers": int(model["num_speakers"]),
        })
    return favorites


def _selected_voice_tuning() -> dict[str, Any] | None:
    """Exact saved baseline for the effective daily voice, before global pace."""
    effective_voice = str(rules_store.current().tts.get("selected_voice") or _runtime_default_voice())
    if not effective_voice:
        return None
    try:
        voice_id, preset = _resolve_voice(effective_voice)
    except (SynthesisError, ValueError):
        return None
    render = _effective_render_settings(preset)
    return {
        "voice_id": voice_id,
        "length_scale": render["length_scale"],
        "sentence_silence_seconds": render["sentence_silence_seconds"],
        "structure_silence_seconds": render["structure_silence_seconds"],
    }


def _save_voice_label(data: dict[str, Any]) -> tuple[str, dict[str, Any] | None]:
    key = str(data.get("key", "")).strip()
    model_id, speaker_id, model = _voice_key_parts(key)
    with voice_labels_lock:
        voices = _read_voice_labels()
        if data.get("remove"):
            voices.pop(key, None)
            _write_voice_labels(voices)
            return key, None

        entry = dict(voices.get(key) or {})
        if "gender" in data:
            gender = str(data.get("gender") or "")
            if gender not in VOICE_GENDERS:
                raise ValueError("Unknown gender label")
            entry["gender"] = gender
        if "favorite" in data:
            entry["favorite"] = bool(data.get("favorite"))
            if entry["favorite"]:
                entry.setdefault("model", model_id)
                if speaker_id is not None:
                    entry.setdefault("speaker_id", speaker_id)
                    speakers = model.get("speakers") or []
                    entry.setdefault(
                        "speaker_name",
                        str(speakers[speaker_id])
                        if speaker_id < len(speakers)
                        else f"Speaker {speaker_id}",
                    )
        if "label" in data:
            entry["label"] = str(data.get("label") or "").strip()[:80]
        if "notes" in data:
            entry["notes"] = str(data.get("notes") or "")[:MAX_VOICE_NOTE_CHARS]
        if "heard" in data:
            entry["heard"] = bool(data.get("heard"))
        for field in ("model", "speaker_id", "speaker_name", "length_scale"):
            if field in data and data[field] is not None:
                entry[field] = data[field]
        entry["updated"] = round(time.time())
        if not entry.get("gender") and not entry.get("favorite") \
                and not entry.get("notes") and not entry.get("heard"):
            voices.pop(key, None)
            saved_entry = None
        else:
            voices[key] = entry
            saved_entry = entry
        _write_voice_labels(voices)
    return key, saved_entry


@app.get("/api/voice-settings")
def get_voice_settings() -> Response:
    rules = rules_store.current()
    selected_voice = rules.tts["selected_voice"] or None
    default_voice = _runtime_default_voice() or None
    return jsonify({
        "capabilities": {
            "installed_voices": True,
            "favorites": True,
            "voice_selection": True,
            "voice_tuning": True,
            "stt_settings": True,
        },
        "tts": {
            "default_voice": default_voice,
            "selected_voice": selected_voice,
            "effective_voice": selected_voice or default_voice,
            "speech_pace": rules.tts["speech_pace"],
            "tuning": _selected_voice_tuning(),
            "catalog": [
                {
                    "id": voice_id,
                    "label": catalog_voice.label,
                    "gender": catalog_voice.gender,
                    "tier": catalog_voice.tier,
                    "locale": catalog_voice.locale,
                }
                for voice_id, catalog_voice in VOICE_CATALOG.items()
            ],
            "installed_models": _installed_models(),
            "favorites": _favorite_voices(),
        },
        "stt": {
            "models": [
                {"id": model_id, "installed": model_path.is_file()}
                for model_id, model_path in _whisper_models().items()
            ],
            "settings": rules.stt,
        },
    })


@app.put("/api/voice-settings")
def put_voice_settings() -> Response:
    payload = request.get_json(silent=True)
    allowed = {"default_voice", "selected_voice", "speech_pace", "voice_tuning", "stt_settings"}
    if not isinstance(payload, dict) or not payload or set(payload) - allowed:
        return jsonify({"error": "Expected a supported voice setting"}), 400
    current = rules_store.current()
    default_voice = payload.get("default_voice", current.tts.get("default_voice") or None)
    if default_voice is not None and not isinstance(default_voice, str):
        return jsonify({"error": "default_voice must be a voice ID or null"}), 400
    normalized_default = (default_voice or "").strip()
    selected_voice = payload.get("selected_voice", current.tts["selected_voice"] or None)
    if selected_voice is not None and not isinstance(selected_voice, str):
        return jsonify({"error": "selected_voice must be a voice ID or null"}), 400
    normalized = (selected_voice or "").strip()
    try:
        if normalized_default:
            _resolve_voice(normalized_default)
        if normalized:
            _resolve_voice(normalized)
        stt_settings = payload.get("stt_settings", current.stt)
        if not isinstance(stt_settings, dict):
            raise ValueError("stt_settings must be an object")
        if str(stt_settings.get("model", "")).strip() not in _whisper_models():
            raise ValueError("Choose an installed Whisper model")
        voices = dict(current.voices)
        if "voice_tuning" in payload:
            effective_voice = normalized or normalized_default or DEFAULT_TTS_VOICE
            if not effective_voice:
                raise ValueError("No effective voice is available to tune")
            tuning = payload["voice_tuning"]
            if tuning is None:
                voices.pop(effective_voice, None)
            elif not isinstance(tuning, dict) or set(tuning) != set(EDITABLE_VOICE_FIELDS):
                raise ValueError("voice_tuning must contain the three editable timing fields")
            else:
                voices[effective_voice] = tuning
        rules_store.save({
            "pronunciations": current.pronunciations,
            "voices": voices,
            "stt": stt_settings,
            "tts": {
                "default_voice": normalized_default,
                "selected_voice": normalized,
                "speech_pace": payload.get("speech_pace", current.tts["speech_pace"]),
            },
        })
    except ValueError as error:
        return jsonify({"error": str(error)}), 400
    except OSError:
        _LOGGER.exception("Could not write TTS settings")
        return jsonify({"error": "Could not save the settings file"}), 500
    return get_voice_settings()


@app.route("/api/voice-labels", methods=["GET", "PUT"])
def voice_labels() -> Response:
    if request.method == "GET":
        return jsonify({"voices": _read_voice_labels()})
    payload = request.get_json(silent=True)
    if not isinstance(payload, dict):
        return jsonify({"error": "Expected a JSON request"}), 400
    try:
        key, entry = _save_voice_label(payload)
    except ValueError as error:
        return jsonify({"error": str(error)}), 400
    except OSError:
        _LOGGER.exception("Could not write voice labels")
        return jsonify({"error": "Could not save voice labels"}), 500
    return jsonify({"key": key, "entry": entry})


@app.get("/api/audition/models")
def audition_models() -> Response:
    return jsonify({"models": _installed_models()})


@app.post("/audio/speech/audition")
def speech_audition() -> Response:
    """Render any installed model through the production speech front end.

    A catalog id starts from its current CLIde settings; an installed model
    starts from its own config. Request overrides affect this render only.
    Both paths retain the production normalizer, pronunciation rules, safe
    frame-aligned pauses, and inference lock.
    """
    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        return jsonify({"error": "Expected a JSON request"}), 400
    raw_text = data.get("input")
    if not isinstance(raw_text, str) or not raw_text.strip():
        return jsonify({"error": "Expected non-empty input text"}), 400
    if len(raw_text) > MAX_TTS_INPUT_CHARS:
        return jsonify({"error": f"Input is limited to {MAX_TTS_INPUT_CHARS:,} characters"}), 400

    requested_voice = str(data.get("voice") or "").strip()
    requested_model = str(data.get("model") or "").strip()
    if requested_voice and requested_model:
        return jsonify({"error": "Choose a catalog voice or an installed model, not both"}), 400

    voice_id: str | None = None
    if requested_voice:
        try:
            voice_id, base_preset = _resolve_voice(requested_voice)
        except SynthesisError as error:
            return jsonify({"error": str(error)}), 503
        except ValueError as error:
            return jsonify({"error": str(error)}), 400
        model_id = base_preset.model_id
    else:
        model_id = requested_model
        if model_id != Path(model_id).name or not model_id:
            return jsonify({"error": "Unknown voice model"}), 400
        base_preset = VoicePreset(model_id=model_id)

    model_path = VOICE_ROOT / "models" / f"{model_id}.onnx"
    if not model_path.is_file():
        return jsonify({"error": f"{model_id} is not installed"}), 404

    model_defaults = _model_render_defaults(model_id)
    effective_defaults = _effective_render_settings(base_preset)

    def number(name: str, low: float, high: float) -> float:
        raw = data[name] if name in data and data[name] is not None else effective_defaults[name]
        value = float(raw)
        if not low <= value <= high:
            raise ValueError(name)
        return value

    try:
        speaker_id = (
            base_preset.speaker_id
            if requested_voice
            else int(data["speaker_id"] if data.get("speaker_id") is not None else 0)
        )
        length_scale = number("length_scale", 0.35, 2.5)
        noise_scale = number("noise_scale", 0.0, 2.0)
        noise_w_scale = number("noise_w_scale", 0.0, 2.0)
        volume = number("volume", 0.1, 2.0)
        sentence_silence = number("sentence_silence_seconds", 0.0, 1.5)
        structure_silence = number("structure_silence_seconds", 0.0, 2.0)
    except (TypeError, ValueError):
        return jsonify({"error": "Audition settings are outside their allowed range"}), 400
    normalize_audio = data.get("normalize_audio")
    if normalize_audio is None:
        normalize_audio = effective_defaults["normalize_audio"]
    if not isinstance(normalize_audio, bool):
        return jsonify({"error": "normalize_audio must be true or false"}), 400
    separator = str(data.get("path_separator") or base_preset.path_separator).strip()[:24] or "slash"

    preset = replace(
        base_preset,
        speaker_id=speaker_id,
        length_scale=length_scale,
        noise_scale=noise_scale,
        noise_w_scale=noise_w_scale,
        normalize_audio=normalize_audio,
        volume=volume,
        sentence_silence_seconds=sentence_silence,
        structure_silence_seconds=structure_silence,
        path_separator=separator,
    )
    speech_text, structure_flags = speech_segments(raw_text, separator)
    if not speech_text:
        return jsonify({"error": "Nothing speakable remained after normalization"}), 400
    if not inference_lock.acquire(blocking=False):
        return jsonify({"error": "Another local voice job is running; try again shortly"}), 429
    started = time.perf_counter()
    try:
        phonemes = ["".join(sentence) for sentence in voice_cache.phonemize(preset, speech_text)]
        if data.get("speak", True) is False:
            wav_bytes, frames, sample_rate = b"", 0, 0
        else:
            wav_bytes, frames, sample_rate = voice_cache.synthesize(
                preset, speech_text, None, structure_flags
            )
        generation_seconds = round(time.perf_counter() - started, 3)
    except SynthesisError as error:
        return jsonify({"error": str(error)}), 500
    finally:
        inference_lock.release()
    result: dict[str, Any] = {
        "audio_base64": base64.b64encode(wav_bytes).decode("ascii") if wav_bytes else None,
        "prepared": speech_text,
        "phonemes": phonemes,
        "voice": voice_id,
        "model": model_id,
        "speaker_id": speaker_id,
        "settings": {
            "length_scale": length_scale,
            "noise_scale": noise_scale,
            "noise_w_scale": noise_w_scale,
            "normalize_audio": normalize_audio,
            "volume": volume,
            "sentence_silence_seconds": sentence_silence,
            "structure_silence_seconds": structure_silence,
            "model_defaults": model_defaults,
        },
        "separator": separator,
        "duration_seconds": round(frames / sample_rate, 3) if sample_rate else 0,
        "generation_seconds": generation_seconds,
    }
    return jsonify(result)


@app.get("/api/speech-rules")
def get_speech_rules() -> Response:
    """The editable rules, plus what each voice is currently using."""
    rules = rules_store.current()
    return jsonify({
        "pronunciations": rules.pronunciations,
        "stt": rules.stt,
        "tts": rules.tts,
        "voices": {
            voice_id: {
                "label": catalog_voice.label,
                "gender": catalog_voice.gender,
                "tier": catalog_voice.tier,
                "locale": catalog_voice.locale,
                "length_scale": (
                    _model_default_length_scale(effective.model_id)
                    if effective.length_scale is None
                    else effective.length_scale
                ),
                "noise_scale": render_settings["noise_scale"],
                "noise_w_scale": render_settings["noise_w_scale"],
                "normalize_audio": render_settings["normalize_audio"],
                "volume": render_settings["volume"],
                "sentence_silence_seconds": effective.sentence_silence_seconds,
                "structure_silence_seconds": (
                    effective.sentence_silence_seconds * 2
                    if effective.structure_silence_seconds is None
                    else effective.structure_silence_seconds
                ),
                "path_separator": effective.path_separator,
                "model": effective.model_id,
                "overridden": sorted(rules.voices.get(voice_id, {})),
            }
            for voice_id, catalog_voice in VOICE_CATALOG.items()
            for preset in [catalog_voice.preset]
            for effective in [_with_saved_overrides(voice_id, preset)]
            for render_settings in [_effective_render_settings(effective)]
        },
        "editable_fields": {
            name: {"min": low, "max": high}
            for name, (low, high) in EDITABLE_VOICE_FIELDS.items()
        },
    })


@app.put("/api/speech-rules")
def put_speech_rules() -> Response:
    """Save edited rules. They take effect on the next request, no restart."""
    payload = request.get_json(silent=True)
    unknown = set((payload or {}).get("voices", {})) - set(VOICE_PRESETS)
    if unknown:
        return jsonify({"error": f"Unknown voice(s): {', '.join(sorted(unknown))}"}), 400
    payload = dict(payload or {})
    payload["voices"] = _only_real_overrides(payload.get("voices") or {})
    payload.setdefault("stt", rules_store.current().stt)
    payload.setdefault("tts", rules_store.current().tts)
    try:
        rules_store.save(payload)
    except ValueError as error:
        return jsonify({"error": str(error)}), 400
    except OSError as error:
        _LOGGER.exception("Could not write speech rules")
        return jsonify({"error": "Could not save the rules file"}), 500
    _LOGGER.info("speech rules saved: %d pronunciations", len(rules_store.current().pronunciations))
    return get_speech_rules()


@app.get("/api/stt-settings")
def get_stt_settings() -> Response:
    """The complete dictation preset currently used by CLIde."""
    return jsonify(rules_store.current().stt)


@app.put("/api/stt-settings")
def put_stt_settings() -> Response:
    """Save one dictation preset without replacing TTS or pronunciation data."""
    current = rules_store.current()
    payload = request.get_json(silent=True)
    if not isinstance(payload, dict) or str(payload.get("model", "")).strip() not in _whisper_models():
        return jsonify({"error": "Choose an installed Whisper model"}), 400
    try:
        saved = rules_store.save({
            "pronunciations": current.pronunciations,
            "voices": current.voices,
            "stt": payload,
            "tts": current.tts,
        })
    except ValueError as error:
        return jsonify({"error": str(error)}), 400
    except OSError:
        _LOGGER.exception("Could not write STT settings")
        return jsonify({"error": "Could not save the settings file"}), 500
    _LOGGER.info(
        "stt settings saved: model=%s decoder=%s threads=%d",
        saved.stt["model"],
        saved.stt["decoder_preset"],
        saved.stt["threads"],
    )
    return jsonify(saved.stt)


@app.post("/audio/speech/prepare")
def prepare_speech() -> Response:
    """Show what Piper would receive, without synthesizing.

    Loopback-only diagnostic. A listening failure can be attributed to a stage
    by comparing the stored reply, the prepared text, and the phonemes: if the
    prepared text is wrong the normalizer owns it, if the phonemes are wrong
    eSpeak owns it, and if both are right the voice model owns it.
    """
    data = request.get_json(silent=True) or {}
    raw_text = data.get("input")
    if not isinstance(raw_text, str) or not raw_text.strip():
        return jsonify({"error": "input is required"}), 400
    if len(raw_text) > MAX_TTS_INPUT_CHARS:
        return jsonify({"error": f"input is limited to {MAX_TTS_INPUT_CHARS} characters"}), 400

    try:
        voice_id, preset = _resolve_voice(data.get("voice"))
    except SynthesisError as error:
        return jsonify({"error": str(error)}), 503
    except ValueError as error:
        return jsonify({"error": str(error)}), 400

    prepared = prepare_speech_text(raw_text, preset.path_separator)
    payload = {
        "voice": voice_id,
        "model": preset.model_id,
        "separator": preset.path_separator,
        "stored": raw_text,
        "prepared": prepared,
    }
    if data.get("phonemes") is True:
        voice = voice_cache.phonemize(preset, prepared)
        payload["phonemes"] = ["".join(sentence) for sentence in voice]
    return jsonify(payload)


@app.errorhandler(413)
def request_too_large(_error: Exception) -> Response:
    return jsonify({"error": "Request is limited to 25 MiB"}), 413


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8890)
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    app.run(host=args.host, port=args.port, debug=False, threaded=True)


if __name__ == "__main__":
    main()
