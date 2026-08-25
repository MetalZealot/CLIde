from __future__ import annotations

import io
import unittest
from unittest.mock import patch

from app import app, inference_lock


class WhisperApiTests(unittest.TestCase):
    def setUp(self) -> None:
        self.client = app.test_client()

    def test_health_lists_the_two_audition_models(self) -> None:
        response = self.client.get("/api/health")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            [model["id"] for model in response.get_json()["studio_models"]],
            ["tiny.en", "base.en"],
        )

    @patch("whisper_studio._transcribe_upload", return_value=("Hello CLIde", 1.234, 2.5, 180_224))
    def test_transcription_contract_and_metrics(self, _transcribe_upload) -> None:
        response = self.client.post(
            "/audio/transcriptions",
            data={"file": (io.BytesIO(b"fake audio"), "recording.webm"), "model": "base.en"},
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json()["text"], "Hello CLIde")
        self.assertEqual(response.get_json()["studio_settings"]["threads"], 4)
        self.assertEqual(response.headers["X-Voice-Model"], "base.en")
        self.assertEqual(response.headers["X-Voice-Peak-Rss-KiB"], "180224")

    def test_transcription_settings_are_validated(self) -> None:
        response = self.client.post(
            "/audio/transcriptions",
            data={"file": (io.BytesIO(b"fake audio"), "recording.webm"), "threads": "5"},
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("1 and 4", response.get_json()["error"])

    def test_unknown_audition_model_is_rejected(self) -> None:
        response = self.client.post(
            "/audio/transcriptions",
            data={"file": (io.BytesIO(b"fake audio"), "recording.webm"), "model": "small.en"},
        )
        self.assertEqual(response.status_code, 400)

    def test_inference_gate_rejects_parallel_transcription(self) -> None:
        self.assertTrue(inference_lock.acquire(blocking=False))
        try:
            response = self.client.post(
                "/audio/transcriptions",
                data={"file": (io.BytesIO(b"fake audio"), "recording.webm")},
            )
        finally:
            inference_lock.release()
        self.assertEqual(response.status_code, 429)


if __name__ == "__main__":
    unittest.main()
