from __future__ import annotations

import io
import tempfile
import threading
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import ANY, patch

from app import (
    DEFAULT_TTS_VOICE,
    MAX_TTS_INPUT_CHARS,
    VOICE_CATALOG,
    VOICE_PRESETS,
    VOICE_ROOT,
    SynthesisCancelled,
    VoiceCache,
    VoicePreset,
    _resolve_voice,
    _with_speech_pace,
    app,
    inference_lock,
)
from normalizer import apply_lexicon, prepare_speech_text, speech_segments
from speech_rules import RulesStore, default_rules, rules_store, validate, validate_stt


def setUpModule() -> None:
    """Never read Grayson's saved rules; the suite tests the shipped defaults."""
    global _rules_dir
    _rules_dir = tempfile.TemporaryDirectory()
    rules_store._path = Path(_rules_dir.name) / "speech_rules.json"
    rules_store._stamp = object()


def tearDownModule() -> None:
    _rules_dir.cleanup()


EXPECTED_VOICES = {
    "danny-low": ("en_US-danny-low", None, None, None, 0.0),
    "hfc-male-medium": ("en_US-hfc_male-medium", None, None, 0.90, 0.10),
    "kusal-medium": ("en_US-kusal-medium", None, None, None, 0.0),
    "rocket-raccoon-medium": ("en_US-rocket-raccoon-medium", None, None, 0.85, 0.0),
    "lessac-low": ("en_US-lessac-low", None, None, None, 0.0),
    "hfc-female-medium": ("en_US-hfc_female-medium", None, None, 0.90, 0.10),
    "cori-medium": ("en_GB-cori-medium", None, None, None, 0.0),
    "agentvibes-jenny": ("agentvibes-jenny", None, None, None, 0.20),
}


class NormalizerTests(unittest.TestCase):
    def test_markdown_emoji_and_whitespace(self) -> None:
        result = prepare_speech_text(
            "# Hello ✅\n\nThis is **CLIde**.   C# and 3 * 7 stay."
        )
        self.assertEqual(result, "Hello. This is CLIde. C# and 3 * 7 stay.")

    def test_links_tables_and_code_are_prepared_for_speech(self) -> None:
        result = prepare_speech_text(
            "[Docs](https://example.test)\n\n```python\nprint('secret')\n```\n\n"
            "| Name | Value |\n| --- | --- |\n| Piper | Ready |"
        )
        self.assertEqual(
            result,
            "Docs. [See the code block in this message]. Name. Value. Piper. Ready.",
        )

    def test_structural_markdown_keeps_spoken_boundaries(self) -> None:
        result = prepare_speech_text(
            "## Results\n"
            "The first clause — followed by the second.\n\n"
            "| Name | Result |\n"
            "| --- | --- |\n"
            "| Alpha | Passed |\n"
            "| Beta | Needs work |\n\n"
            "- First point\n"
            "- Second point\n"
            "- Final point\n\n"
            "This follows the list."
        )
        self.assertEqual(
            result,
            "Results. The first clause, followed by the second. "
            "Name. Result. Alpha. Passed. Beta. Needs work. "
            "First point. Second point. Final point. This follows the list.",
        )

    def test_technical_numbers_units_and_symbols_are_spoken_deliberately(self) -> None:
        result = prepare_speech_text(
            "Wait 200 ms. In 2026, use port 3001. Commit `5400000` used "
            "512 MB and 64 KB. Open https://example.com/path or "
            "`/home/gnuthall/voice`: now."
        )
        self.assertEqual(
            result,
            "Wait two hundred milliseconds. In twenty twenty six, use port "
            "three zero zero one. Commit five four zero zero zero zero zero used "
            "five hundred twelve megabytes and sixty four kilobytes. Open "
            "example dot com slash path or the home, G NutHall, voice path. Now.",
        )

    def test_relative_paths_are_spoken_like_absolute_ones(self) -> None:
        # Before this, only a leading "/" or "~/" reached _speak_file_path, so
        # the same file read two ways and a relative path still depended on the
        # separator word -- the one word LibriTTS-R swallows.
        result = prepare_speech_text(
            "The file is at src/lib/foo.ts and the log is in /var/log. "
            "Compare ~/Projects/x.md.",
            path_separator="stroke",
        )
        self.assertEqual(
            result,
            "The file is at the src, lib, foo dot ts path and the log is in "
            "the var, log path. Compare the home, Projects, x dot md path.",
        )

    def test_a_slash_between_two_plain_words_is_not_a_path(self) -> None:
        # A relative match needs a letter, and either a second separator or a
        # file extension. Everything here is written with a slash and is not a
        # path.
        result = prepare_speech_text(
            "Roughly 24/7, yes/no, TTS/STT.", path_separator="stroke"
        )
        self.assertEqual(
            result, "Roughly 24 stroke 7, yes stroke no, TTS stroke STT."
        )

    def test_decades_dates_money_percentages_and_fractions(self) -> None:
        # "The 1990s" was reaching espeak as "the 1990 seconds": the decade
        # suffix matched the unit rule. The rest was passed through raw.
        result = prepare_speech_text(
            "The 1990s shipped 2026-08-24. It cost $1,200.50, up 3.5%, "
            "with 3/4 done and 1/2 left."
        )
        self.assertEqual(
            result,
            "The nineteen nineties shipped August twenty fourth, twenty twenty "
            "six. It cost one thousand two hundred dollars fifty cents, up "
            "three point five percent, with three quarters done and one half "
            "left.",
        )

    def test_ratios_and_ambiguous_dates_are_left_alone(self) -> None:
        # A ratio is not a fraction, and "08/24/2026" is two different dates
        # depending on the country, so neither is guessed at.
        result = prepare_speech_text("Ratio 16:9, uptime 24/7, dated 08/24/2026.")
        self.assertEqual(
            result,
            "Ratio 16:9, uptime 24 slash 7, dated 08 slash 24 slash twenty "
            "twenty six.",
        )

    def test_apostrophe_s_is_not_a_unit(self) -> None:
        # An apostrophe is a non-word character, so \bs\b matched the "s" in
        # "That's" and the unit rule said "That seconds".
        result = prepare_speech_text("That's fine. It's here. It took 8.67s.")
        self.assertEqual(
            result,
            "That's fine. It's here. It took eight point six seven seconds.",
        )

    def test_an_injected_sentence_opens_with_a_capital(self) -> None:
        # Measured on libritts-r-204, three runs each: the lowercase form runs
        # 6.58-7.43 s and the capitalised form 6.05-6.38 s, non-overlapping.
        # The model was reading the two sentences as one long clause.
        result = prepare_speech_text(
            "Relative paths render like absolute ones: src/lib/foo.ts reads as a path.",
            path_separator="stroke",
        )
        self.assertEqual(
            result,
            "Relative paths render like absolute ones. The src, lib, foo dot "
            "ts path reads as a path.",
        )

    def test_auditioning_reaches_past_the_shipped_presets(self) -> None:
        # A voice earns a preset by being auditioned, so the endpoint has to
        # accept any installed model -- but only by bare name, never a path.
        client = app.test_client()
        listed = client.get("/api/audition/models").get_json()["models"]
        self.assertGreater(len(listed), len(VOICE_PRESETS))
        libritts = next(model for model in listed if model["id"] == "en_US-libritts_r-medium")
        self.assertEqual(libritts["noise_scale"], 0.333)
        self.assertEqual(libritts["noise_w_scale"], 0.333)
        refused = client.post(
            "/audio/speech/audition",
            json={"input": "Hello", "model": "../../etc/passwd"},
        )
        self.assertEqual(refused.status_code, 400)
        missing = client.post(
            "/audio/speech/audition",
            json={"input": "Hello", "model": "no-such-voice"},
        )
        self.assertEqual(missing.status_code, 404)

    def test_colons_become_full_spoken_stops(self) -> None:
        result = prepare_speech_text("Test this reply: The next sentence starts here.")
        self.assertEqual(result, "Test this reply. The next sentence starts here.")

    def test_a_colon_inside_an_identifier_is_not_a_sentence_break(self) -> None:
        # "build:client" was read as "build. client", splitting one sentence in
        # two mid-name and moving the pause with it. Only a colon with space
        # after it is punctuation.
        result = prepare_speech_text("Run build:client, then check 16:9 output.")
        self.assertEqual(result, "Run build:client, then check 16:9 output.")

    def test_clock_times_are_spoken_as_times(self) -> None:
        result = prepare_speech_text(
            "Meet at 3:30pm. It ran 09:05 to 17:00. Reset at 12:00 am."
        )
        self.assertEqual(
            result,
            "Meet at three thirty p m. It ran nine oh five to seventeen "
            "hundred. Reset at twelve a m.",
        )

    def test_live_is_the_adjective_unless_it_has_a_subject(self) -> None:
        # The phrase list only covered is/are/was/were/now, so "Verified live"
        # still came out as "livv". Listing the verb's subjects is shorter and
        # covers the rest; "a"/"an" are listed so "a live concert" is not
        # turned into "a active concert".
        result = prepare_speech_text(
            "Verified live at noon. It is now live. I live here. "
            "We live there. This is a live concert."
        )
        self.assertEqual(
            result,
            "Verified active at noon. It is now active. I live here. "
            "We live there. This is a live concert.",
        )

    def test_live_and_lives_follow_the_listening_result(self) -> None:
        # "is live" -> "is active" was found by ear. eSpeak phonemises it
        # correctly as lˈaɪv, so phoneme evidence argues for removing this
        # rule; the models still render it wrong, so listening wins. The verb
        # "lives" is a separate, genuine eSpeak error (lˈaɪvz, plural of
        # "life"); the respelling "livz" restores lˈɪvz.
        result = prepare_speech_text(
            "The fix is live. I live here. This is a live concert. "
            "Nine lives were saved. "
            "The runtime lives at `/home/gnuthall/voice`."
        )
        self.assertEqual(
            result,
            "The fix is active. I live here. This is a live concert. "
            "Nine lives were saved. "
            "The runtime livz at the home, G NutHall, voice path.",
        )

    def test_complex_web_addresses_are_omitted(self) -> None:
        result = prepare_speech_text(
            "Open https://user@example.com/a/b/c/d?token=secret#result instead."
        )
        self.assertEqual(result, "Open [Web address omitted] instead.")

    def test_url_initialism_is_spaced_and_the_address_stays_one_sentence(self) -> None:
        # Measured: "URL" is rendered (+0.36s), not dropped -- eSpeak fuses it
        # into jˌuːˌɑːɹɹˈɛl ("oourl"). Spacing the letters fixes the phonemes
        # without replacing the word. The address is one sentence; the earlier
        # three-sentence split existed only to stop LibriTTS-R swallowing
        # "slash", which is now a per-voice separator word instead.
        result = prepare_speech_text(
            "This URL has a path: https://example.com/path. These URLs differ.",
            path_separator="slash",
        )
        self.assertEqual(
            result,
            "This U R L has a path. Example dot com slash path. "
            "These U R Ls differ.",
        )


class VoiceCatalogTests(unittest.TestCase):
    def test_authoritative_catalog_and_presets(self) -> None:
        actual = {
            voice_id: (
                preset.model_id,
                preset.speaker_id,
                preset.source_key,
                preset.length_scale,
                preset.sentence_silence_seconds,
            )
            for voice_id, preset in VOICE_PRESETS.items()
        }
        self.assertEqual(actual, EXPECTED_VOICES)

    def test_path_separator_profiles_follow_listening_evidence(self) -> None:
        for voice_id, preset in VOICE_PRESETS.items():
            with self.subTest(voice=voice_id):
                # Measured per model, sentence with vs without the word:
                #   libritts_r  slash +0.05s (dropped)  stroke +0.45s
                #   jenny       slash +0.19s (mumbled)  stroke +0.50s
                #   hfc_male    slash +0.41s            rocket slash +0.49s
                expected = "stroke" if voice_id == "agentvibes-jenny" else "slash"
                self.assertEqual(preset.path_separator, expected)

    def test_sentence_silence_is_a_whole_16_bit_frame(self) -> None:
        # Piper audio is 16-bit. An odd silence byte count shifts every later
        # sample and turns the rest of the message into static; a 350 ms pause
        # at 22050 Hz once did exactly that (15,435 bytes).
        for voice_id, preset in VOICE_PRESETS.items():
            with self.subTest(voice=voice_id):
                for sample_rate in (22_050, 16_000, 44_100):
                    byte_count = int(sample_rate * preset.sentence_silence_seconds) * 2
                    self.assertEqual(byte_count % 2, 0)

    def test_selected_voice_assets_are_installed(self) -> None:
        for preset in VOICE_PRESETS.values():
            with self.subTest(model=preset.model_id):
                model_path = VOICE_ROOT / "models" / f"{preset.model_id}.onnx"
                self.assertTrue(model_path.is_file())
                self.assertTrue(model_path.with_suffix(".onnx.json").is_file())


class VoiceCacheTests(unittest.TestCase):
    @patch("app.PiperVoice.load")
    def test_reuses_one_model_and_replaces_it_when_the_model_changes(self, load_voice) -> None:
        chunk = SimpleNamespace(audio_int16_bytes=b"\x00\x00" * 10)
        danny = SimpleNamespace(
            config=SimpleNamespace(sample_rate=16_000, speaker_id_map={}),
            synthesize=lambda _text, _config: [chunk],
        )
        hfc = SimpleNamespace(
            config=SimpleNamespace(sample_rate=22_050, speaker_id_map={}),
            synthesize=lambda _text, _config: [chunk],
        )
        load_voice.side_effect = [danny, hfc]
        cache = VoiceCache()

        cache.synthesize(VOICE_PRESETS["danny-low"], "one")
        cache.synthesize(VOICE_PRESETS["danny-low"], "two")
        cache.synthesize(VOICE_PRESETS["hfc-male-medium"], "three")

        self.assertEqual(load_voice.call_count, 2)

    @patch("app.PiperVoice.load")
    def test_passes_every_audition_control_to_piper(self, load_voice) -> None:
        captured = []
        chunk = SimpleNamespace(audio_int16_bytes=b"\x00\x00" * 10)

        def synthesize(_text, config):
            captured.append(config)
            return [chunk]

        load_voice.return_value = SimpleNamespace(
            config=SimpleNamespace(sample_rate=22_050, speaker_id_map={}),
            synthesize=synthesize,
        )
        preset = VoicePreset(
            "en_US-kusal-medium",
            length_scale=1.3,
            noise_scale=0.333,
            noise_w_scale=0.3,
            normalize_audio=False,
            volume=1.25,
        )

        VoiceCache().synthesize(preset, "Hello")

        self.assertEqual(len(captured), 1)
        config = captured[0]
        self.assertEqual(config.length_scale, 1.3)
        self.assertEqual(config.noise_scale, 0.333)
        self.assertEqual(config.noise_w_scale, 0.3)
        self.assertFalse(config.normalize_audio)
        self.assertEqual(config.volume, 1.25)


class ApiTests(unittest.TestCase):
    def setUp(self) -> None:
        self.client = app.test_client()

    def test_health_reports_configured_runtime(self) -> None:
        response = self.client.get("/api/health")
        self.assertEqual(response.status_code, 200)
        body = response.get_json()
        self.assertTrue(body["configured"])
        self.assertEqual(body["stt_model"], "tiny.en")
        self.assertEqual(body["stt_settings"], default_rules().stt)
        self.assertTrue(body["tts_configured"])
        self.assertEqual(body["tts_default_voice"], DEFAULT_TTS_VOICE)
        self.assertEqual(
            body["tts_voices"],
            [
                {
                    "id": voice_id,
                    "label": voice.label,
                    "gender": voice.gender,
                    "tier": voice.tier,
                    "locale": voice.locale,
                }
                for voice_id, voice in VOICE_CATALOG.items()
            ],
        )

    def test_missing_upload_is_rejected(self) -> None:
        response = self.client.post("/audio/transcriptions")
        self.assertEqual(response.status_code, 400)

    @patch("app._transcribe_upload", return_value=("Hello CLIde", 1.234, 2.5, 180_224))
    def test_openai_transcription_contract(self, _transcribe_upload) -> None:
        response = self.client.post(
            "/audio/transcriptions",
            data={"file": (io.BytesIO(b"fake audio"), "recording.webm"), "model": "base.en"},
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json(), {"text": "Hello CLIde"})
        self.assertEqual(response.headers["X-Voice-Model"], "base.en")
        self.assertEqual(response.headers["X-Voice-Peak-Rss-KiB"], "180224")

    @patch("app._transcribe_upload", return_value=("Saved settings", 0.5, 1.0, 100_000))
    def test_saved_stt_settings_apply_to_the_next_clide_request(self, transcribe) -> None:
        original = rules_store.current()
        self.addCleanup(lambda: rules_store.save({
            "pronunciations": original.pronunciations,
            "voices": original.voices,
            "stt": original.stt,
            "tts": original.tts,
        }))
        saved = {
            "model": "base.en",
            "decoder_preset": "careful",
            "threads": 2,
            "initial_prompt": "CLIde, Codex",
            "capture": {
                "echo_cancellation": False,
                "noise_suppression": True,
                "auto_gain_control": True,
            },
        }
        self.assertEqual(self.client.put("/api/stt-settings", json=saved).status_code, 200)

        response = self.client.post(
            "/audio/transcriptions",
            data={"file": (io.BytesIO(b"fake audio"), "recording.webm"), "model": "whisper-1"},
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.headers["X-Voice-Model"], "base.en")
        self.assertEqual(response.headers["X-Voice-Threads"], "2")
        self.assertEqual(transcribe.call_args.args[2], saved)
        self.assertEqual(self.client.get("/api/health").get_json()["stt_settings"], saved)

    def test_unknown_model_is_rejected(self) -> None:
        response = self.client.post(
            "/audio/transcriptions",
            data={"file": (io.BytesIO(b"fake audio"), "recording.webm"), "model": "small.en"},
        )
        self.assertEqual(response.status_code, 400)

    def test_shared_inference_gate_rejects_parallel_transcription(self) -> None:
        self.assertTrue(inference_lock.acquire(blocking=False))
        try:
            response = self.client.post(
                "/audio/transcriptions",
                data={"file": (io.BytesIO(b"fake audio"), "recording.webm")},
            )
        finally:
            inference_lock.release()
        self.assertEqual(response.status_code, 429)

    @patch("app.voice_cache.synthesize", return_value=(b"RIFFfake", 22_050, 22_050))
    def test_every_selected_voice_returns_raw_wav(self, synthesize) -> None:
        for voice_id, preset in VOICE_PRESETS.items():
            with self.subTest(voice=voice_id):
                synthesize.reset_mock()
                response = self.client.post(
                    "/audio/speech",
                    json={"input": "Hello", "model": "tts-1", "voice": voice_id},
                )
                self.assertEqual(response.status_code, 200)
                self.assertEqual(response.content_type, "audio/wav")
                self.assertEqual(response.data, b"RIFFfake")
                self.assertEqual(response.headers["X-Voice-Voice"], voice_id)
                self.assertEqual(response.headers["X-Voice-Model"], preset.model_id)
                synthesize.assert_called_once_with(preset, "Hello", ANY, ANY)

    @patch("app.voice_cache.synthesize", return_value=(b"RIFFfake", 22_050, 22_050))
    def test_missing_and_openai_default_voice_use_selected_default(self, synthesize) -> None:
        for voice in (None, "", "alloy"):
            with self.subTest(voice=voice):
                synthesize.reset_mock()
                payload = {"input": "Hello"}
                if voice is not None:
                    payload["voice"] = voice
                response = self.client.post("/audio/speech", json=payload)
                self.assertEqual(response.status_code, 200)
                self.assertEqual(response.headers["X-Voice-Voice"], DEFAULT_TTS_VOICE)
                synthesize.assert_called_once_with(
                    VOICE_PRESETS[DEFAULT_TTS_VOICE], "Hello", ANY, ANY
                )

    def test_unknown_voice_is_rejected(self) -> None:
        response = self.client.post(
            "/audio/speech", json={"input": "Hello", "voice": "audition-residue"}
        )
        self.assertEqual(response.status_code, 400)

    @patch("app.voice_cache.synthesize", return_value=(b"RIFFfake", 22_050, 22_050))
    @patch("app.voice_cache.phonemize", return_value=[["h", "ə", "l", "oʊ"]])
    def test_audition_overrides_do_not_change_the_catalog_preset(
        self, _phonemize, synthesize
    ) -> None:
        response = self.client.post(
            "/audio/speech/audition",
            json={
                "input": "Hello",
                "voice": "kusal-medium",
                "length_scale": 1.3,
                "noise_scale": 0.333,
                "noise_w_scale": 0.3,
                "normalize_audio": False,
                "volume": 1.25,
                "sentence_silence_seconds": 0.2,
                "structure_silence_seconds": 0.4,
            },
        )

        self.assertEqual(response.status_code, 200)
        payload = response.get_json()
        self.assertEqual(payload["voice"], "kusal-medium")
        self.assertEqual(payload["phonemes"], ["həloʊ"])
        self.assertEqual(payload["settings"]["noise_scale"], 0.333)
        audition = synthesize.call_args.args[0]
        self.assertEqual(audition.length_scale, 1.3)
        self.assertEqual(audition.noise_w_scale, 0.3)
        self.assertFalse(audition.normalize_audio)
        self.assertEqual(audition.structure_silence_seconds, 0.4)
        self.assertIsNone(VOICE_PRESETS["kusal-medium"].length_scale)

    @patch("app.voice_cache.synthesize")
    @patch("app.voice_cache.phonemize", return_value=[["h"]])
    def test_prepare_an_audition_does_not_render_audio(self, _phonemize, synthesize) -> None:
        response = self.client.post(
            "/audio/speech/audition",
            json={"input": "Hello", "voice": "kusal-medium", "speak": False},
        )
        self.assertEqual(response.status_code, 200)
        self.assertIsNone(response.get_json()["audio_base64"])
        synthesize.assert_not_called()

    def test_audition_rejects_unsafe_or_ambiguous_settings(self) -> None:
        too_loud = self.client.post(
            "/audio/speech/audition",
            json={"input": "Hello", "voice": "kusal-medium", "volume": 9},
        )
        ambiguous = self.client.post(
            "/audio/speech/audition",
            json={
                "input": "Hello",
                "voice": "kusal-medium",
                "model": "en_US-kusal-medium",
            },
        )
        self.assertEqual(too_loud.status_code, 400)
        self.assertEqual(ambiguous.status_code, 400)

    @patch("app.voice_cache.synthesize", return_value=(b"RIFFfake", 22_050, 22_050))
    def test_tts_normalizes_only_the_speech_copy(self, synthesize) -> None:
        source = "# Hello ✅\n\nThis is **CLIde**."
        response = self.client.post(
            "/audio/speech", json={"input": source, "voice": "hfc-male-medium"}
        )
        self.assertEqual(response.status_code, 200)
        synthesize.assert_called_once_with(
            VOICE_PRESETS["hfc-male-medium"], "Hello. This is CLIde.", ANY, ANY
        )

    @patch("app.voice_cache.synthesize", return_value=(b"RIFFfake", 22_050, 22_050))
    def test_tts_uses_each_voice_family_separator_profile(self, synthesize) -> None:
        response = self.client.post(
            "/audio/speech",
            json={"input": "Open https://example.com/path", "voice": "agentvibes-jenny"},
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            synthesize.call_args.args[1],
            "Open example dot com stroke path",
        )

        response = self.client.post(
            "/audio/speech",
            json={"input": "Open https://example.com/path", "voice": "hfc-male-medium"},
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            synthesize.call_args.args[1],
            "Open example dot com slash path",
        )

    def test_unsupported_model_and_format_are_rejected(self) -> None:
        model_response = self.client.post(
            "/audio/speech",
            json={"input": "Hello", "voice": "hfc-male-medium", "model": "custom"},
        )
        format_response = self.client.post(
            "/audio/speech",
            json={"input": "Hello", "voice": "hfc-male-medium", "response_format": "mp3"},
        )
        self.assertEqual(model_response.status_code, 400)
        self.assertEqual(format_response.status_code, 400)

    def test_empty_normalized_text_and_oversized_input_are_rejected(self) -> None:
        empty_response = self.client.post(
            "/audio/speech", json={"input": "✅", "voice": "hfc-male-medium"}
        )
        oversized_response = self.client.post(
            "/audio/speech",
            json={"input": "x" * (MAX_TTS_INPUT_CHARS + 1), "voice": "hfc-male-medium"},
        )
        self.assertEqual(empty_response.status_code, 400)
        self.assertEqual(oversized_response.status_code, 400)

    @patch("app.voice_cache.synthesize", return_value=(b"RIFFfake", 22_050, 22_050))
    def test_measured_maximum_input_is_accepted(self, synthesize) -> None:
        response = self.client.post(
            "/audio/speech",
            json={"input": "x" * MAX_TTS_INPUT_CHARS, "voice": "hfc-male-medium"},
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(synthesize.call_args.args[1]), MAX_TTS_INPUT_CHARS)

    def test_shared_inference_gate_rejects_parallel_synthesis(self) -> None:
        self.assertTrue(inference_lock.acquire(blocking=False))
        try:
            response = self.client.post(
                "/audio/speech", json={"input": "Hello", "voice": "hfc-male-medium"}
            )
        finally:
            inference_lock.release()
        self.assertEqual(response.status_code, 429)

    @patch("app.voice_cache.synthesize")
    def test_cancellation_stops_the_matching_job_and_releases_inference(self, synthesize) -> None:
        synthesis_started = threading.Event()

        def wait_for_cancel(_preset, _text, cancel_event, _flags=None):
            synthesis_started.set()
            self.assertTrue(cancel_event.wait(2))
            raise SynthesisCancelled()

        synthesize.side_effect = wait_for_cancel
        speech_result = {}

        def request_speech() -> None:
            with app.test_client() as client:
                speech_result["response"] = client.post(
                    "/audio/speech",
                    headers={"X-Voice-Job-ID": "cancel-test"},
                    json={"input": "A response long enough to cancel", "voice": "hfc-male-medium"},
                )

        speech_thread = threading.Thread(target=request_speech)
        speech_thread.start()
        self.assertTrue(synthesis_started.wait(1))

        cancel_response = self.client.post(
            "/audio/speech/cancel",
            json={"job_id": "cancel-test"},
        )
        speech_thread.join(2)

        self.assertFalse(speech_thread.is_alive())
        self.assertEqual(cancel_response.status_code, 200)
        self.assertEqual(cancel_response.get_json(), {"cancelled": True, "released": True})
        self.assertEqual(speech_result["response"].status_code, 409)
        self.assertTrue(inference_lock.acquire(blocking=False))
        inference_lock.release()


if __name__ == "__main__":
    unittest.main()


class SpeechStageTests(unittest.TestCase):
    """Each stage is testable on its own, so a failure names its owner."""

    def test_lexicon_stage_is_independent_of_markdown_and_technical_stages(self) -> None:
        self.assertEqual(apply_lexicon("The runtime lives at the path"),
                         "The runtime livz at the path")
        self.assertEqual(apply_lexicon("Nine lives were saved"),
                         "Nine lives were saved")

    def test_prepare_endpoint_traces_a_reply_without_synthesizing(self) -> None:
        client = app.test_client()
        response = client.post(
            "/audio/speech/prepare",
            json={"input": "Open https://example.com/path.", "voice": "agentvibes-jenny"},
        )
        self.assertEqual(response.status_code, 200)
        payload = response.get_json()
        self.assertEqual(payload["voice"], "agentvibes-jenny")
        self.assertEqual(payload["separator"], "stroke")
        self.assertEqual(payload["stored"], "Open https://example.com/path.")
        self.assertEqual(payload["prepared"], "Open example dot com stroke path.")
        self.assertNotIn("phonemes", payload)

    def test_prepare_endpoint_rejects_empty_and_oversized_input(self) -> None:
        client = app.test_client()
        self.assertEqual(client.post("/audio/speech/prepare", json={}).status_code, 400)
        self.assertEqual(
            client.post(
                "/audio/speech/prepare",
                json={"input": "a" * (MAX_TTS_INPUT_CHARS + 1)},
            ).status_code,
            400,
        )


class UnspeakableCharacterTests(unittest.TestCase):
    def test_flow_arrows_become_sequence_words(self) -> None:
        self.assertEqual(prepare_speech_text("is live → is active"),
                         "is active, then is active")

    def test_arrows_use_their_sentence_context(self) -> None:
        self.assertEqual(
            prepare_speech_text(
                "Input → normalizer → audio. Tap ← to return, or → to continue. "
                "Phone ↔ server works both ways. Passing checks ⇒ release.",
                lexicon=[],
            ),
            "Input, then normalizer, then audio. Tap the left arrow to return, "
            "or the right arrow to continue. Phone and server works both ways. "
            "Passing checks means release.",
        )

    def test_typographic_unicode_preserves_the_words(self) -> None:
        self.assertEqual(
            prepare_speech_text(
                "Grayson said, “It’s ready”—then waited… Versions 3–5 use the "
                "voice‑first setup. Samsung • Firefox • Chrome.",
                lexicon=[],
            ),
            "Grayson said, \"It's ready\", then waited. Versions three to five "
            "use the voice-first setup. Samsung, Firefox, Chrome.",
        )

    def test_math_and_measurement_symbols_are_spoken(self) -> None:
        self.assertEqual(
            prepare_speech_text(
                "It is 20°C, ≤ 10 ms, ≥ 25 ms, ≈ 50%, and ±5%. "
                "Three × seven; twelve ÷ four; −5; √9; ∞.",
                lexicon=[],
            ),
            "It is twenty degrees Celsius, less than or equal to ten milliseconds, "
            "greater than or equal to twenty five milliseconds, approximately "
            "fifty percent, and plus or minus five percent. Three times seven; "
            "twelve divided by four; minus five; square root of nine; infinity.",
        )

    def test_status_legal_and_science_symbols_preserve_meaning(self) -> None:
        self.assertEqual(
            prepare_speech_text(
                "Complete ✓. Failed ✗. ⚠ Battery low. ℹ See Settings. "
                "The voice is marked ★. See §4. Copyright © 2026 Acme®. "
                "CLIde™ remains. Change Δ, wavelength λ, angle θ, 10 Ω.",
                lexicon=[],
            ),
            "Complete. Failed. Warning. Battery low. Information. See Settings. "
            "The voice is starred. See section four. Copyright twenty twenty six "
            "Acme. CLIde remains. Change delta, wavelength lambda, angle theta, "
            "ten ohms.",
        )

    def test_ipa_tokens_are_dropped_whole(self) -> None:
        # Stripping the modifiers out of "lˈaɪv" leaves "l a v", which is then
        # read aloud as three letters.
        self.assertEqual(prepare_speech_text("eSpeak gives lˈaɪv correctly."),
                         "eSpeak gives correctly.")

    def test_accented_latin_words_survive(self) -> None:
        self.assertEqual(prepare_speech_text("Café naïve résumé."), "Café naïve résumé.")

    def test_bare_second_suffix_expands(self) -> None:
        # eSpeak otherwise reads the trailing "s" as the letter "z".
        self.assertEqual(
            prepare_speech_text("It took 8.67s."),
            "It took eight point six seven seconds.",
        )


class StructurePacingTests(unittest.TestCase):
    def test_headings_list_items_and_paragraphs_are_flagged(self) -> None:
        text, flags = speech_segments(
            "## Results\n\n- First point\n- Second point\n\n"
            "This follows the list. And a second sentence."
        )
        self.assertEqual(
            text,
            "Results. First point. Second point. "
            "This follows the list. And a second sentence.",
        )
        self.assertEqual(flags, [True, True, True, False, False])

    def test_plain_prose_has_no_structure_boundaries(self) -> None:
        text, flags = speech_segments("Plain prose. Two sentences here.")
        self.assertEqual(text, "Plain prose. Two sentences here.")
        self.assertEqual(flags, [False, False])

    def test_prepared_text_never_leaks_the_boundary_marker(self) -> None:
        source = "## Head\n\n- One\n- Two\n\nTail."
        self.assertNotIn("￲", prepare_speech_text(source))
        self.assertNotIn("￲", speech_segments(source)[0])

    def test_structure_silence_defaults_to_twice_the_sentence_pause(self) -> None:
        for voice_id, preset in VOICE_PRESETS.items():
            with self.subTest(voice=voice_id):
                effective = (
                    preset.sentence_silence_seconds * 2
                    if preset.structure_silence_seconds is None
                    else preset.structure_silence_seconds
                )
                self.assertGreaterEqual(effective, preset.sentence_silence_seconds)


class SpeechRulesTests(unittest.TestCase):
    """The editable rules are data. A bad edit must never stop speech."""

    def test_defaults_reproduce_the_shipped_pronunciations(self) -> None:
        lexicon = default_rules().compiled()
        self.assertEqual(
            prepare_speech_text("The fix is live.", lexicon=lexicon),
            "The fix is active.",
        )
        self.assertEqual(
            prepare_speech_text("The runtime lives here.", lexicon=lexicon),
            "The runtime livz here.",
        )
        self.assertEqual(
            prepare_speech_text("Nine lives were saved.", lexicon=lexicon),
            "Nine lives were saved.",
        )

    def test_replacement_preserves_the_matched_words_capitalization(self) -> None:
        lexicon = default_rules().compiled()
        self.assertEqual(
            prepare_speech_text("Lives here.", lexicon=lexicon),
            "Livz here.",
        )
        self.assertEqual(
            prepare_speech_text("LIVES here.", lexicon=lexicon),
            "LIVZ here.",
        )
        self.assertEqual(
            prepare_speech_text("The runtime lives here.", lexicon=lexicon),
            "The runtime livz here.",
        )

    def test_match_text_is_escaped_not_treated_as_a_pattern(self) -> None:
        lexicon = validate({
            "pronunciations": [{"match": "c++", "say": "C plus plus", "mode": "word"}],
        }).compiled()
        self.assertEqual(prepare_speech_text("I use c++ daily.", lexicon=lexicon),
                         "I use C plus plus daily.")

    def test_phrase_mode_tolerates_extra_spacing(self) -> None:
        lexicon = validate({
            "pronunciations": [{"match": "is live", "say": "is active", "mode": "phrase"}],
        }).compiled()
        self.assertEqual(prepare_speech_text("It  is   live.", lexicon=lexicon),
                         "It is active.")

    def test_validation_rejects_bad_rules(self) -> None:
        for payload, reason in [
            ({"pronunciations": [{"match": "", "say": "x"}]}, "empty match"),
            ({"pronunciations": [{"match": "a", "mode": "regex"}]}, "unknown mode"),
            ({"pronunciations": [{"match": "a", "mode": "before"}]}, "no following words"),
            ({"voices": {"hfc-male-medium": {"length_scale": 99}}}, "out of range"),
            ({"voices": {"hfc-male-medium": {"model_id": "x"}}}, "not editable"),
        ]:
            with self.subTest(reason=reason):
                with self.assertRaises(ValueError):
                    validate(payload)

    def test_stt_validation_is_complete_and_bounded(self) -> None:
        self.assertEqual(validate_stt(None), default_rules().stt)
        for payload in [
            {"model": "../../small.en"},
            {"decoder_preset": "creative"},
            {"threads": 5},
            {"initial_prompt": "x" * 401},
            {"capture": {"echo_cancellation": "yes"}},
        ]:
            with self.subTest(payload=payload):
                with self.assertRaises(ValueError):
                    validate_stt(payload)

    def test_null_override_means_use_the_model_default(self) -> None:
        rules = validate({"voices": {"agentvibes-jenny": {"length_scale": None}}})
        self.assertEqual(rules.voices["agentvibes-jenny"], {})

    def test_unreadable_rules_file_falls_back_to_defaults(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "speech_rules.json"
            path.write_text("{ this is not json")
            store = RulesStore(path)
            with self.assertLogs("voice-shim", level="ERROR"):
                rules = store.current()
        self.assertEqual(
            [rule["match"] for rule in rules.pronunciations],
            [rule["match"] for rule in default_rules().pronunciations],
        )

    def test_saved_rules_apply_without_a_restart(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            store = RulesStore(Path(directory) / "speech_rules.json")
            self.assertEqual(prepare_speech_text("A boinko here.", lexicon=store.compiled()),
                             "A boinko here.")
            store.save({"pronunciations": [
                {"match": "boinko", "say": "boyn ko", "mode": "word"},
            ]})
            self.assertEqual(prepare_speech_text("A boinko here.", lexicon=store.compiled()),
                             "A boyn ko here.")


class SpeechRulesApiTests(unittest.TestCase):
    def setUp(self) -> None:
        self.client = app.test_client()

    def test_get_reports_every_voice_and_its_editable_bounds(self) -> None:
        payload = self.client.get("/api/speech-rules").get_json()
        self.assertEqual(set(payload["voices"]), set(VOICE_PRESETS))
        self.assertEqual(payload["stt"], rules_store.current().stt)
        self.assertIn("length_scale", payload["editable_fields"])
        for voice in payload["voices"].values():
            self.assertIsNotNone(voice["length_scale"])
            self.assertTrue(voice["label"])
            self.assertTrue(voice["gender"])
            self.assertTrue(voice["tier"])
            self.assertTrue(voice["locale"])

    def test_put_rejects_an_unknown_voice(self) -> None:
        response = self.client.put("/api/speech-rules", json={"voices": {"nope": {}}})
        self.assertEqual(response.status_code, 400)
        self.assertIn("nope", response.get_json()["error"])

    def test_put_rejects_a_bad_rule_without_writing(self) -> None:
        response = self.client.put(
            "/api/speech-rules",
            json={"pronunciations": [{"match": "x", "mode": "regex"}]},
        )
        self.assertEqual(response.status_code, 400)


class VoiceSettingsApiTests(unittest.TestCase):
    def setUp(self) -> None:
        self.client = app.test_client()
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        patcher = patch(
            "app.VOICE_LABELS_PATH",
            Path(self.directory.name) / "voice-labels.json",
        )
        patcher.start()
        self.addCleanup(patcher.stop)
        current = rules_store.current()
        self.original_rules = {
            "pronunciations": current.pronunciations,
            "voices": current.voices,
            "stt": current.stt,
            "tts": current.tts,
        }
        self.addCleanup(lambda: rules_store.save(self.original_rules))

    def test_settings_publish_installed_favorites_and_stt_models(self) -> None:
        saved = self.client.put("/api/voice-labels", json={
            "key": "en_US-hfc_male-medium",
            "favorite": True,
            "gender": "male",
            "length_scale": 0.8,
        })
        self.assertEqual(saved.status_code, 200)

        payload = self.client.get("/api/voice-settings").get_json()
        self.assertTrue(payload["capabilities"]["installed_voices"])
        self.assertGreater(len(payload["tts"]["installed_models"]), len(VOICE_CATALOG))
        self.assertEqual(payload["tts"]["favorites"][0]["id"], "hfc-male-medium")
        self.assertEqual(
            {model["id"] for model in payload["stt"]["models"]},
            {"tiny.en", "base.en"},
        )

    def test_selection_uses_a_safe_installed_voice_and_can_reset_to_default(self) -> None:
        selected = self.client.put(
            "/api/voice-settings", json={"selected_voice": "en_GB-alan-medium"}
        )
        self.assertEqual(selected.status_code, 200)
        self.assertEqual(selected.get_json()["tts"]["effective_voice"], "en_GB-alan-medium")

        defaulted = self.client.put(
            "/api/voice-settings", json={"selected_voice": None}
        )
        self.assertEqual(defaulted.status_code, 200)
        self.assertEqual(defaulted.get_json()["tts"]["effective_voice"], DEFAULT_TTS_VOICE)

    def test_runtime_default_uses_a_safe_model_and_speaker(self) -> None:
        updated = self.client.put(
            "/api/voice-settings",
            json={"default_voice": "en_US-libritts_r-medium#546"},
        )
        self.assertEqual(updated.status_code, 200)
        self.assertEqual(
            updated.get_json()["tts"]["default_voice"],
            "en_US-libritts_r-medium#546",
        )

        reset_selection = self.client.put(
            "/api/voice-settings", json={"selected_voice": None}
        )
        self.assertEqual(
            reset_selection.get_json()["tts"]["effective_voice"],
            "en_US-libritts_r-medium#546",
        )

    def test_new_multi_speaker_favorite_gets_a_stable_speaker_label(self) -> None:
        saved = self.client.put("/api/voice-labels", json={
            "key": "en_US-libritts_r-medium#546",
            "favorite": True,
        })
        self.assertEqual(saved.status_code, 200)
        favorite = self.client.get("/api/voice-settings").get_json()["tts"]["favorites"][0]
        self.assertEqual(favorite["source_key"], "en_US-libritts_r-medium#546")
        self.assertEqual(favorite["speaker_name"], "Speaker 546")
        self.assertIn("Speaker 546", favorite["label"])

    def test_friendly_name_round_trips_independently_of_studio_metadata(self) -> None:
        voice_id = "en_US-libritts_r-medium#546"
        studio_metadata = self.client.put("/api/voice-labels", json={
            "key": voice_id,
            "favorite": True,
            "gender": "male",
            "notes": "Audition note",
        })
        self.assertEqual(studio_metadata.status_code, 200)

        renamed = self.client.put("/api/voice-settings", json={
            "voice_display_name": {
                "id": voice_id,
                "display_name": "  Evening narrator  ",
            },
        })
        self.assertEqual(renamed.status_code, 200)
        self.assertEqual(
            renamed.get_json()["tts"]["display_names"],
            {voice_id: "Evening narrator"},
        )

        restored = self.client.put("/api/voice-settings", json={
            "voice_display_name": {"id": voice_id, "display_name": None},
        })
        self.assertEqual(restored.status_code, 200)
        self.assertEqual(restored.get_json()["tts"]["display_names"], {})
        labels = self.client.get("/api/voice-labels").get_json()["voices"]
        self.assertTrue(labels[voice_id]["favorite"])
        self.assertEqual(labels[voice_id]["gender"], "male")
        self.assertEqual(labels[voice_id]["notes"], "Audition note")

    def test_friendly_name_rejects_unknown_voices_and_overlong_text(self) -> None:
        unknown = self.client.put("/api/voice-settings", json={
            "voice_display_name": {"id": "../unsafe", "display_name": "Nope"},
        })
        too_long = self.client.put("/api/voice-settings", json={
            "voice_display_name": {
                "id": "en_US-danny-low",
                "display_name": "x" * 81,
            },
        })
        self.assertEqual(unknown.status_code, 400)
        self.assertEqual(too_long.status_code, 400)

    def test_speech_pace_scales_speed_and_gaps_without_changing_the_baseline(self) -> None:
        response = self.client.put(
            "/api/voice-settings", json={"speech_pace": 1.25}
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json()["tts"]["speech_pace"], 1.25)

        _, baseline = _resolve_voice("hfc-male-medium")
        paced = _with_speech_pace(baseline)
        self.assertAlmostEqual(paced.length_scale, baseline.length_scale / 1.25)
        self.assertAlmostEqual(
            paced.sentence_silence_seconds,
            baseline.sentence_silence_seconds / 1.25,
        )
        self.assertIsNone(paced.structure_silence_seconds)
        self.assertAlmostEqual(
            paced.sentence_silence_seconds * 2,
            (baseline.sentence_silence_seconds * 2) / 1.25,
        )

    def test_selected_voice_tuning_round_trips_and_can_reset(self) -> None:
        tuned = self.client.put("/api/voice-settings", json={
            "selected_voice": "hfc-male-medium",
            "voice_tuning": {
                "length_scale": 0.75,
                "sentence_silence_seconds": 0.15,
                "structure_silence_seconds": 0.35,
            },
        })
        self.assertEqual(tuned.status_code, 200)
        self.assertEqual(tuned.get_json()["tts"]["tuning"], {
            "voice_id": "hfc-male-medium",
            "length_scale": 0.75,
            "sentence_silence_seconds": 0.15,
            "structure_silence_seconds": 0.35,
        })

        reset = self.client.put(
            "/api/voice-settings", json={"voice_tuning": None}
        )
        self.assertEqual(reset.status_code, 200)
        self.assertEqual(reset.get_json()["tts"]["tuning"]["length_scale"], 0.9)

    def test_dictation_preset_round_trips_through_shared_settings(self) -> None:
        preset = {
            "model": "base.en",
            "decoder_preset": "careful",
            "threads": 2,
            "initial_prompt": "CLIde, Piper",
            "capture": {
                "echo_cancellation": False,
                "noise_suppression": True,
                "auto_gain_control": False,
            },
        }
        response = self.client.put(
            "/api/voice-settings", json={"stt_settings": preset}
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json()["stt"]["settings"], preset)

    def test_selection_rejects_paths_unknown_models_and_ambiguous_speakers(self) -> None:
        for selected_voice in (
            "../../etc/passwd",
            "not-installed-medium",
            "en_US-libritts_r-medium",
        ):
            with self.subTest(selected_voice=selected_voice):
                response = self.client.put(
                    "/api/voice-settings", json={"selected_voice": selected_voice}
                )
                self.assertEqual(response.status_code, 400)
