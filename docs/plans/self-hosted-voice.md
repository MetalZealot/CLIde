# Self-hosted dictation and read-aloud

- Status: 4/6
- Next: live-verify Kusal and retest HFC on repeated zeroes with its restored
  preset, then resolve Rocket Raccoon's provenance and licence.
- Context: [server voice module](../../server/modules/voice/voice.module.ts),
  [voice service contract](../../server/modules/voice/voice.service.ts),
  [client voice API](../../src/lib/voiceApi.ts), and the host-local voice README,
  which owns runtime, model, catalog, benchmark, and deployment facts

## Phases

- [x] **1. Combined backend contract.** The external service now exposes the
      OpenAI-compatible transcription and speech endpoints, normalizes only the
      speech copy, keeps one Piper model warm, serializes inference, and accepts
      only the selected voice catalog. Its focused tests and the untouched Voice
      Studio tests pass.
- [x] **2. Direct Pi proof and safe bound.** Real Whisper and Piper requests
      returned valid transcript JSON and WAV audio. Warm synthesis is faster than
      playback. A 6,000-character response stayed within time, memory, and thermal
      limits; a controlled cold 12,000-character run reached the agreed thermal
      cutoff, so 6,000 remains the read-aloud ceiling.
- [x] **3. Durable loopback service.** Install and enable the host-local user
      service, keep it bound to loopback, prove it survives a clean restart, and
      repeat both direct endpoint checks. Do not alter nginx or firewall policy.
- [x] **4. CLIde wiring and installed-PWA acceptance.** The isolated
      server build and real proxied STT/TTS checks pass. Grayson's phone pass
      confirmed record → stop → editable unsent text, ordinary read-aloud,
      replay after completion, Play/Pause/Resume/Restart, and the elapsed/total
      readout. Continued dictation improved after the recorder-readiness fix;
      Bluetooth-earbud capture remains a separate diagnostic. TTS generation now
      shows elapsed time and a clear Cancel action; cancellation reaches Piper,
      releases its lock, and a newer read-aloud supersedes the older job. Shim,
      focused client/server, build, and direct live cancellation checks pass.
      Grayson's installed-PWA retest confirmed reliable cancellation and
      cross-session playback with no observed errors or inconsistent states.
      Final Markdown and technical-text behavior now depends on the auditable
      [TTS speech front end](tts-speech-front-end.md), which was accepted by
      listening on 2026-08-24. Grayson's final pass confirmed the last two:
      playback continues in the background, the earbud button pauses it, and
      the session appears in the notification shade and on the lock screen.
      Listening remains authoritative.
- [~] **5. Bounded catalog in Settings.** The agreed male/female, low/medium/
      size/locale/bonus catalog is implemented and HFC Male is the initial
      selection. The shim exposes labels and tiers, Settings renders that
      allowlist, and custom browser backends retain free-text voice entry.
      Grayson's cross-session pass accepted all eight picker paths; Spike was
      then replaced by US-medium Kusal. The original accepted HFC, Rocket, and
      Jenny pacing presets are restored; voices without one use model defaults.
      Source records cover the seven known upstream models; Rocket Raccoon's
      exact provenance and licence remain unresolved. Kusal and the restored
      HFC repeated-zero case need listening acceptance, and a later Settings
      speed control will adjust each starting point.
- [ ] **6. Nearer-live dictation experiment.** Test phrase-level final insertion
      after pauses against the accepted push-to-talk baseline. Add provisional
      word-level streaming only if that experiment proves the extra transport and
      composer-reconciliation complexity worthwhile.

## Done when

- The voice backend starts after reboot, listens only on loopback, and passes
  direct STT and TTS checks through its durable process.
- Installed-PWA dictation inserts editable text without sending, and read-aloud
  preserves the rendered, stored, copied, and exported response.
- Read-aloud uses the accepted auditable speech front end rather than integration-
  specific pronunciation patches.
- Playback stop/replay and chat switching behave correctly on the real device.
- The selected catalog is bounded, licensed, named, and backed by its exact
  speaker mappings; speed changes start from each model's own configuration.
- Automated checks, direct endpoint proof, service state, device behavior, and
  Grayson's listening acceptance are recorded as distinct evidence.

## Not doing

- Exposing Piper, Whisper, model weights, Python, or voice-service lifecycle as
  CLIde npm dependencies or repository assets.
- LAN or public exposure, nginx or firewall changes, or browser-direct access to
  the loopback backend.
- Treating Voice Studio history or installed audition models as selected voices.
- Streaming or provisional word-level dictation before Phase 6 justifies it.
- Combining Piper or whisper.cpp upgrades with initial deployment; each needs
  separate performance and listening acceptance.
