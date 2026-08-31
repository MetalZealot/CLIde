from __future__ import annotations

import array
import base64
import io
import json
import tempfile
import unittest
import wave
from pathlib import Path
from unittest.mock import MagicMock, patch

from app import _pause_map, _stage_recording, app


def wav_bytes(seconds: float = 0.1, rate: int = 22_050) -> bytes:
    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as wav_file:
        wav_file.setframerate(rate)
        wav_file.setsampwidth(2)
        wav_file.setnchannels(1)
        wav_file.writeframes(array.array("h", [1_000] * int(rate * seconds)).tobytes())
    return buffer.getvalue()


class ReferenceCorpusTests(unittest.TestCase):
    """The listening pass is only usable if every case survives the parser."""

    def setUp(self) -> None:
        self.client = app.test_client()

    def test_every_case_has_text_and_something_to_listen_for(self) -> None:
        cases = self.client.get("/api/corpus").get_json()["cases"]
        self.assertGreaterEqual(len(cases), 5)
        for case in cases:
            with self.subTest(case=case["name"]):
                self.assertTrue(case["name"])
                self.assertTrue(case["text"].strip())
                self.assertIn("Listen for", case["listen_for"])

    def test_a_case_may_contain_markdown_of_its_own(self) -> None:
        # The pacing case is a heading followed by a list. Splitting the corpus
        # on "##" swallowed it, which is why the bodies are fenced.
        cases = {case["name"]: case for case in self.client.get("/api/corpus").get_json()["cases"]}
        pacing = cases["Markdown structure and pacing"]
        self.assertTrue(pacing["text"].startswith("## Results"))
        self.assertIn("- First point here", pacing["text"])

    def test_studio_exposes_advanced_speech_and_saved_recordings(self) -> None:
        page = self.client.get("/").get_data(as_text=True)
        self.assertIn('id="speak-preset"', page)
        self.assertIn('id="speak-normalize"', page)
        self.assertNotIn('id="piper-compare"', page)
        self.assertIn('id="recordings-studio"', page)
        self.assertIn('id="whisper-save-clide"', page)
        self.assertIn('src="/static/recordings.js?', page)
        self.assertEqual(self.client.post("/api/clide/compare").status_code, 404)


class ClideSpeechTabTests(unittest.TestCase):
    """The CLIde tab must ask the real service, never a local copy of the rules."""

    def setUp(self) -> None:
        self.client = app.test_client()

    def test_speech_requires_text(self) -> None:
        response = self.client.post("/api/clide/speech", json={"text": "  "})
        self.assertEqual(response.status_code, 400)

    @patch("app.urllib.request.urlopen")
    def test_stt_settings_are_saved_through_the_shim(self, urlopen) -> None:
        upstream = MagicMock()
        upstream.status = 200
        upstream.read.return_value = json.dumps({
            "model": "base.en", "decoder_preset": "careful", "threads": 2,
            "initial_prompt": "CLIde", "capture": {},
        }).encode()
        urlopen.return_value.__enter__.return_value = upstream

        response = self.client.put("/api/clide/stt-settings", json={
            "model": "base.en", "decoder_preset": "careful", "threads": 2,
        })

        self.assertEqual(response.status_code, 200)
        request = urlopen.call_args.args[0]
        self.assertEqual(request.full_url, "http://127.0.0.1:8890/api/stt-settings")
        self.assertEqual(request.method, "PUT")

    @patch("app._shim_request")
    def test_prepare_only_skips_synthesis(self, shim_request) -> None:
        shim_request.return_value = (
            200,
            json.dumps({
                "voice": "hfc-male-medium",
                "separator": "slash",
                "prepared": "Results.",
                "phonemes": ["ɹɪzˈʌlts."],
            }).encode(),
            "application/json",
        )
        response = self.client.post(
            "/api/clide/speech", json={"text": "## Results", "speak": False}
        )
        self.assertEqual(response.status_code, 200)
        self.assertIsNone(response.get_json()["audio_base64"])
        # Only the prepare call: no audio was generated.
        self.assertEqual(shim_request.call_count, 1)
        self.assertEqual(shim_request.call_args.args[0], "/audio/speech/prepare")

    @patch("app._shim_request")
    def test_backend_failure_is_passed_through(self, shim_request) -> None:
        shim_request.return_value = (
            503, json.dumps({"error": "voice is not installed"}).encode(), "application/json",
        )
        response = self.client.post("/api/clide/speech", json={"text": "Hello"})
        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.get_json()["error"], "voice is not installed")

    def test_pause_map_finds_a_silent_run(self) -> None:
        rate = 22_050
        loud = array.array("h", [8_000] * rate)          # 1s of tone
        quiet = array.array("h", [0] * (rate // 2))      # 500 ms of silence
        buffer = io.BytesIO()
        with wave.open(buffer, "wb") as wav_file:
            wav_file.setframerate(rate)
            wav_file.setsampwidth(2)
            wav_file.setnchannels(1)
            wav_file.writeframes(loud.tobytes() + quiet.tobytes() + loud.tobytes())
        pauses = _pause_map(buffer.getvalue())
        self.assertEqual(len(pauses), 1)
        self.assertAlmostEqual(pauses[0]["at"], 1.0, places=1)
        self.assertAlmostEqual(pauses[0]["ms"], 500, delta=30)

    @patch("app._stage_recording", return_value="a" * 32)
    @patch("app._shim_request")
    def test_audition_forwards_controls_and_stages_the_exact_wav(
        self, shim_request, stage_recording
    ) -> None:
        audio = wav_bytes()
        shim_request.return_value = (
            200,
            json.dumps({
                "audio_base64": base64.b64encode(audio).decode(),
                "prepared": "Hello.",
                "phonemes": ["həloʊ"],
                "voice": "kusal-medium",
                "model": "en_US-kusal-medium",
                "speaker_id": None,
                "settings": {"length_scale": 1.3, "noise_scale": 0.333},
                "duration_seconds": 0.1,
                "generation_seconds": 0.2,
                "separator": "slash",
            }).encode(),
            "application/json",
        )
        response = self.client.post("/api/clide/audition", json={
            "text": "Hello.",
            "voice": "kusal-medium",
            "voice_name": "Kusal",
            "settings_preset": "LibriTTS-R Natural",
            "length_scale": 1.3,
            "noise_scale": 0.333,
            "noise_w_scale": 0.3,
            "normalize_audio": True,
            "volume": 1.0,
            "sentence_silence_seconds": 0.2,
            "structure_silence_seconds": 0.2,
        })

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json()["recording_token"], "a" * 32)
        forwarded = shim_request.call_args.args[1]
        self.assertEqual(forwarded["voice"], "kusal-medium")
        self.assertEqual(forwarded["noise_w_scale"], 0.3)
        self.assertEqual(forwarded["structure_silence_seconds"], 0.2)
        self.assertEqual(stage_recording.call_args.args[0], audio)
        metadata = stage_recording.call_args.args[1]
        self.assertEqual(metadata["voice"]["label"], "Kusal")
        self.assertEqual(metadata["settings_preset"], "LibriTTS-R Natural")

class VoiceLabelTests(unittest.TestCase):
    """Studio edits the runtime-owned labels instead of keeping a second store."""

    def setUp(self) -> None:
        self.client = app.test_client()

    @patch("app._shim_get")
    def test_labels_are_read_from_the_shim(self, shim_get) -> None:
        shim_get.return_value = (
            200,
            json.dumps({"voices": {"en_US-amy-medium": {"favorite": True}}}).encode(),
            "application/json",
        )
        response = self.client.get("/api/voices/labels")
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.get_json()["voices"]["en_US-amy-medium"]["favorite"])
        shim_get.assert_called_once_with("/api/voice-labels")

    @patch("app._shim_put")
    def test_label_changes_are_written_through_the_shim(self, shim_put) -> None:
        shim_put.return_value = (
            200,
            json.dumps({"key": "en_US-amy-medium", "entry": {"favorite": True}}).encode(),
            "application/json",
        )
        response = self.client.post(
            "/api/voices/labels",
            json={"key": "en_US-amy-medium", "favorite": True},
        )
        self.assertEqual(response.status_code, 200)
        shim_put.assert_called_once_with(
            "/api/voice-labels",
            {"key": "en_US-amy-medium", "favorite": True},
        )

    @patch("app._read_labels")
    def test_export_lists_only_favourites(self, read_labels) -> None:
        read_labels.return_value = {
            "en_US-libritts_r-medium#546": {
                "favorite": True,
                "speaker_name": "204",
                "notes": "keep",
                "length_scale": 1.35,
            },
            "en_US-amy-medium": {"gender": "female"},
        }
        exported = self.client.get("/api/voices/export").get_json()
        self.assertEqual(exported["count"], 1)
        self.assertIn("en_US-libritts_r-medium", exported["text"])
        self.assertNotIn("en_US-amy-medium", exported["text"])


class RecordingTests(unittest.TestCase):
    def setUp(self) -> None:
        self.client = app.test_client()
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        root = Path(self.directory.name)
        recordings_patcher = patch("app.RECORDINGS_DIR", root / "recordings")
        pending_patcher = patch("app.PENDING_RECORDINGS_DIR", root / "pending")
        recordings_patcher.start()
        pending_patcher.start()
        self.addCleanup(recordings_patcher.stop)
        self.addCleanup(pending_patcher.stop)

    def test_save_list_play_download_and_delete_one_recording(self) -> None:
        audio = wav_bytes()
        token = _stage_recording(audio, {
            "text": "The runtime lives here.",
            "prepared": "The runtime livz here.",
            "voice": {"id": "kusal-medium", "label": "Kusal"},
            "settings": {"length_scale": 1.0, "noise_scale": 0.667},
            "settings_preset": "Current CLIde settings",
            "duration_seconds": 0.1,
        })

        saved = self.client.post(
            "/api/recordings", json={"token": token, "title": "  Runtime   test  "}
        )
        self.assertEqual(saved.status_code, 201)
        item = saved.get_json()
        self.assertEqual(item["title"], "Runtime test")
        self.assertEqual(item["prepared"], "The runtime livz here.")

        listed = self.client.get("/api/recordings").get_json()["recordings"]
        self.assertEqual([entry["id"] for entry in listed], [item["id"]])
        playback = self.client.get(item["audio_url"])
        self.assertEqual(playback.status_code, 200)
        self.assertEqual(playback.data, audio)
        playback.close()
        download = self.client.get(item["download_url"])
        self.assertIn("attachment", download.headers["Content-Disposition"])
        download.close()

        deleted = self.client.delete(f"/api/recordings/{item['id']}")
        self.assertEqual(deleted.status_code, 200)
        self.assertEqual(self.client.get("/api/recordings").get_json()["recordings"], [])

    def test_save_rejects_a_missing_token_or_title(self) -> None:
        missing = self.client.post(
            "/api/recordings", json={"token": "a" * 32, "title": "Missing"}
        )
        untitled_token = _stage_recording(wav_bytes(), {"text": "Hello"})
        untitled = self.client.post(
            "/api/recordings", json={"token": untitled_token, "title": "  "}
        )
        self.assertEqual(missing.status_code, 404)
        self.assertEqual(untitled.status_code, 400)


if __name__ == "__main__":
    unittest.main()
