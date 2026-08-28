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
from speech_rules import EDITABLE_VOICE_FIELDS, rules_store


# The models, the Whisper build and the user's saved rules are data, not code:
# they stay outside the repository. CLIDE_VOICE_ROOT relocates them together.
VOICE_ROOT = Path(os.environ.get("CLIDE_VOICE_ROOT", "/home/gnuthall/voice"))
WHISPER_CLI = VOICE_ROOT / "bin/whisper.cpp/build/bin/whisper-cli"
WHISPER_MODELS = {
    "tiny.en": VOICE_ROOT / "models/ggml-tiny.en.bin",
    "base.en": VOICE_ROOT / "models/ggml-base.en.bin",
}
DEFAULT_STT_MODEL = "tiny.en"
MAX_UPLOAD_BYTES = 25 * 1024 * 1024
MAX_TTS_INPUT_CHARS = 6_000
FFMPEG_TIMEOUT_SECONDS = 30
WHISPER_TIMEOUT_SECONDS = 120
ALLOWED_EXTENSIONS = {".aac", ".m4a", ".mp3", ".ogg", ".opus", ".wav", ".webm"}
SUPPORTED_TTS_MODELS = {"", "tts-1"}
MAX_NAMED_SPEAKERS = 32


@dataclass(frozen=True)
class VoicePreset:
    model_id: str
    speaker_id: int | None = None
    source_key: str | None = None
    length_scale: float | None = None
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
# Voice Studio favorites file. Pacing comes from each model's own config.
VOICE_CATALOG = {
    "danny-low": CatalogVoice(
        "Danny", "male", "low", "en-US", VoicePreset("en_US-danny-low")
    ),
    "hfc-male-medium": CatalogVoice(
        "HFC Male", "male", "medium", "en-US", VoicePreset("en_US-hfc_male-medium")
    ),
    "semaine-spike-medium": CatalogVoice(
        "Spike",
        "male",
        "medium-gb",
        "en-GB",
        VoicePreset("en_GB-semaine-medium", speaker_id=1, source_key="spike"),
    ),
    "rocket-raccoon-medium": CatalogVoice(
        "Rocket Raccoon",
        "male",
        "bonus",
        "en-US",
        VoicePreset("en_US-rocket-raccoon-medium"),
    ),
    "lessac-low": CatalogVoice(
        "Lessac", "female", "low", "en-US", VoicePreset("en_US-lessac-low")
    ),
    "hfc-female-medium": CatalogVoice(
        "HFC Female",
        "female",
        "medium",
        "en-US",
        VoicePreset("en_US-hfc_female-medium"),
    ),
    "cori-medium": CatalogVoice(
        "Cori", "female", "medium-gb", "en-GB", VoicePreset("en_GB-cori-medium")
    ),
    "agentvibes-jenny": CatalogVoice(
        "AgentVibes Jenny",
        "female",
        "bonus",
        "en-GB",
        VoicePreset("agentvibes-jenny", path_separator="stroke"),
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


def _resolve_model(requested_model: str | None) -> tuple[str, Path]:
    """Resolve only the two audition models; never accept a client path."""
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


def _transcribe_upload(upload: Any, model_path: Path) -> tuple[str, float, float | None, int]:
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
            process = subprocess.Popen(
                [
                    str(WHISPER_CLI), "-m", str(model_path), "-f", str(wav_path),
                    "-t", "4", "-nt", "-np", "-otxt", "-of", "-",
                ],
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
    stt_configured = WHISPER_CLI.is_file() and WHISPER_MODELS[DEFAULT_STT_MODEL].is_file()
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
            "stt_model": DEFAULT_STT_MODEL,
            "studio_models": [
                {"id": model_id, "installed": model_path.is_file()}
                for model_id, model_path in WHISPER_MODELS.items()
            ],
            "tts_configured": tts_configured,
            "tts_default_voice": DEFAULT_TTS_VOICE,
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
    try:
        model_id, model_path = _resolve_model(request.form.get("model"))
        text, elapsed_seconds, duration_seconds, peak_rss_kib = _transcribe_upload(upload, model_path)
    except TranscriptionError as error:
        _LOGGER.info("stt status=error model=%s", request.form.get("model") or DEFAULT_STT_MODEL)
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
    response.headers["X-Voice-Threads"] = "4"
    if duration_seconds is not None:
        response.headers["X-Voice-Audio-Seconds"] = str(duration_seconds)
    return response


def _resolve_voice(requested_voice: Any) -> tuple[str, VoicePreset]:
    voice_id = requested_voice.strip() if isinstance(requested_voice, str) else ""
    if voice_id in {"", "alloy"}:
        if DEFAULT_TTS_VOICE is None:
            raise SynthesisError("No default TTS voice is configured; choose an explicit catalog voice")
        voice_id = DEFAULT_TTS_VOICE
    preset = VOICE_PRESETS.get(voice_id)
    if preset is None:
        raise ValueError("Unknown TTS voice")
    return voice_id, _with_saved_overrides(voice_id, preset)


def _with_saved_overrides(voice_id: str, preset: VoicePreset) -> VoicePreset:
    """Apply the pacing values edited in Voice Studio, if any were saved."""
    overrides = rules_store.current().voices.get(voice_id)
    if not overrides:
        return preset
    return replace(preset, **{
        key: value for key, value in overrides.items()
        if key in EDITABLE_VOICE_FIELDS or key == "path_separator"
    })


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


def _model_default_length_scale(model_id: str) -> float:
    """A voice with no length override uses whatever its model config says."""
    try:
        config = json.loads((VOICE_ROOT / "models" / f"{model_id}.onnx.json").read_text())
    except (OSError, ValueError):
        return 1.0
    return float(config.get("inference", {}).get("length_scale", 1.0))


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
        models.append({
            "id": model_path.stem,
            "num_speakers": num_speakers,
            "length_scale": config.get("inference", {}).get("length_scale", 1.0),
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


@app.get("/api/audition/models")
def audition_models() -> Response:
    return jsonify({"models": _installed_models()})


@app.post("/audio/speech/audition")
def speech_audition() -> Response:
    """Render any installed model through the production speech front end.

    The presets are the shipped catalogue; this is how a voice earns a place
    in it. Same normalizer, same pacing, same lock -- only the model varies,
    so what is heard here is what the app would say in that voice.
    """
    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        return jsonify({"error": "Expected a JSON request"}), 400
    raw_text = data.get("input")
    if not isinstance(raw_text, str) or not raw_text.strip():
        return jsonify({"error": "Expected non-empty input text"}), 400
    if len(raw_text) > MAX_TTS_INPUT_CHARS:
        return jsonify({"error": f"Input is limited to {MAX_TTS_INPUT_CHARS:,} characters"}), 400

    model_id = str(data.get("model", "")).strip()
    if model_id != Path(model_id).name or not model_id:
        return jsonify({"error": "Unknown voice model"}), 400
    model_path = VOICE_ROOT / "models" / f"{model_id}.onnx"
    if not model_path.is_file():
        return jsonify({"error": f"{model_id} is not installed"}), 404

    try:
        speaker_id = int(data.get("speaker_id") or 0)
        length_scale = float(data.get("length_scale") or _model_default_length_scale(model_id))
    except (TypeError, ValueError):
        return jsonify({"error": "speaker_id and length_scale must be numbers"}), 400
    if not 0.35 <= length_scale <= 2.5:
        return jsonify({"error": "length_scale must be between 0.35 and 2.5"}), 400
    separator = str(data.get("path_separator") or "slash").strip()[:24] or "slash"

    preset = VoicePreset(
        model_id=model_id,
        speaker_id=speaker_id,
        length_scale=length_scale,
        sentence_silence_seconds=float(data.get("sentence_silence_seconds") or 0.20),
        path_separator=separator,
    )
    speech_text, structure_flags = speech_segments(raw_text, separator)
    if not speech_text:
        return jsonify({"error": "Nothing speakable remained after normalization"}), 400
    if not inference_lock.acquire(blocking=False):
        return jsonify({"error": "Another local voice job is running; try again shortly"}), 429
    started = time.perf_counter()
    try:
        wav_bytes, frames, sample_rate = voice_cache.synthesize(
            preset, speech_text, None, structure_flags
        )
    except SynthesisError as error:
        return jsonify({"error": str(error)}), 500
    finally:
        inference_lock.release()
    return jsonify({
        "audio_base64": base64.b64encode(wav_bytes).decode("ascii"),
        "prepared": speech_text,
        "model": model_id,
        "speaker_id": speaker_id,
        "length_scale": length_scale,
        "separator": separator,
        "duration_seconds": round(frames / sample_rate, 3),
        "generation_seconds": round(time.perf_counter() - started, 3),
    })


@app.get("/api/speech-rules")
def get_speech_rules() -> Response:
    """The editable rules, plus what each voice is currently using."""
    rules = rules_store.current()
    return jsonify({
        "pronunciations": rules.pronunciations,
        "voices": {
            voice_id: {
                "length_scale": (
                    _model_default_length_scale(effective.model_id)
                    if effective.length_scale is None
                    else effective.length_scale
                ),
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
            for voice_id, preset in VOICE_PRESETS.items()
            for effective in [_with_saved_overrides(voice_id, preset)]
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
    try:
        rules_store.save(payload)
    except ValueError as error:
        return jsonify({"error": str(error)}), 400
    except OSError as error:
        _LOGGER.exception("Could not write speech rules")
        return jsonify({"error": "Could not save the rules file"}), 500
    _LOGGER.info("speech rules saved: %d pronunciations", len(rules_store.current().pronunciations))
    return get_speech_rules()


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
