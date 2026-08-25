from __future__ import annotations

import array
import io
import json
import unittest
import wave
from unittest.mock import patch

from app import _pause_map, app


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


class ClideSpeechTabTests(unittest.TestCase):
    """The CLIde tab must ask the real service, never a local copy of the rules."""

    def setUp(self) -> None:
        self.client = app.test_client()

    def test_speech_requires_text(self) -> None:
        response = self.client.post("/api/clide/speech", json={"text": "  "})
        self.assertEqual(response.status_code, 400)

    @patch("app._shim_request")
    def test_prepare_only_skips_synthesis(self, shim_request) -> None:
        shim_request.return_value = (
            200,
            json.dumps({
                "voice": "libritts-r-204",
                "separator": "stroke",
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


if __name__ == "__main__":
    unittest.main()
