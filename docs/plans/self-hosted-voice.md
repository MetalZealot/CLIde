# Self-hosted dictation and read-aloud

- Status: 4/10
- Next: phone-accept Voice Library browsing and shared selection/favorite/default
  edits, then add lightweight label and gender editing.
- Context: [server voice module](../../server/modules/voice/voice.module.ts),
  [voice service contract](../../server/modules/voice/voice.service.ts),
  [client voice API](../../src/lib/voiceApi.ts),
  [shared voice settings decision](../decisions/0049-voice-runtime-owns-shared-settings.md),
  [UI standards](../maps/ui-standards.md), and the host-local voice README, which
  owns runtime, model, catalog, benchmark, and deployment facts

## Phases

- [x] **1. Combined backend contract.** The external service now exposes the
      OpenAI-compatible transcription and speech endpoints, speech-only
      normalization, serialized inference, and a bounded voice catalog.
- [x] **2. Direct Pi proof and safe bound.** Real Whisper and Piper requests
      worked; warm synthesis beat playback time. A controlled 12,000-character
      run hit the thermal cutoff, so 6,000 remains the read-aloud ceiling.
- [x] **3. Durable loopback service.** Install and enable the host-local user
      service, keep it on loopback, and prove both endpoints after restart.
- [x] **4. CLIde wiring and installed-PWA acceptance.** Phone acceptance covers
      editable unsent dictation; read-aloud controls,
      timing and cancellation; cross-session/background playback; notification
      and lock-screen state; and earbud pause. The auditable
      [speech front end](tts-speech-front-end.md) owns final listening behavior.
- [~] **5. Bounded catalog in Settings.** The agreed male/female, low/medium/
      size/locale/bonus catalog is implemented. Grayson accepted all eight
      picker paths, replaced Spike with US-medium Kusal, and saved final pacing
      for every chosen voice in Studio. Studio's saved STT preset also flows
      into CLIde. Custom backends retain free-text entry; Rocket remains
      user-installed because it lacks model-specific training provenance.
- [~] **6. Shared inventory and settings ownership.** Make the authenticated
      runtime authoritative for installed models, runtime default, favorites,
      per-voice baselines, chosen voice, STT preset, and capabilities. Publish
      safe IDs and labels, never browser paths; CLIde and Voice Studio edit the
      same contract, while custom backends expose only supported capabilities.
      Runtime, server, and client contracts cover these values. Missing pace
      defaults to neutral; a rejected mixed-version save stays rendered with an
      inline error. Grayson's phone pass confirmed the slider returns to 1.00;
      shared-value deployment remains.
- [~] **7. Daily TTS surface.** Keep ordinary Voice settings compact: current
      voice, runtime default, Favorites, editable preview with generation and
      playback timing, relative Speech pace, and a route to Voice Library.
      Installed inventory does not belong in the daily picker. Pace changes
      speed and pauses relative to the saved per-voice baseline; exact values
      and Reset stay under Fine tuning. Move connection and raw model fields to
      Custom backend. Direct Default and Favorite rows now replace the inventory
      dropdown. Voice selection groups the picker with its library route;
      Favorite rows retain speaker identity without Voice Studio gender tags.
      Playback groups a full-width speed row with Fine tuning. Preview timing
      stays above its controls instead of wrapping below them. Phone acceptance
      remains.
- [~] **8. Voice Library.** Group searchable rows by human name and language;
      nest sizes and select single-model/single-speaker voices directly.
      Multi-speaker families keep size selection and speaker browsing together;
      large sets such as LibriTTS-R use 32-speaker pages or exact-number search.
      Their Favorites view bypasses paging and preserves speaker identity.
      Selection, Favorite, and writable default pass focused tests. Never expose
      dataset names as voices. Label/gender editing and phone acceptance remain.
- [~] **9. Daily STT surface.** List every runtime-published installed Whisper
      model and expose decoder preset, Vocabulary hint, noise suppression, and
      echo cancellation as ordinary controls. Model choices name their speed/
      accuracy tradeoff, Vocabulary hint explains its input, and Advanced keeps
      thread count and microphone processing in the Dictation card. Changes
      round-trip without a restart; focused tests pass and phone acceptance remains.
- [ ] **10. Nearer-live dictation experiment.** Test phrase-level final insertion
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
- CLIde and Voice Studio show the same runtime-owned default, favorites,
  installed inventory, per-voice presets, and STT settings across devices.
- The ordinary Voice screen prioritizes Default and Favorites, needs no raw
  backend knowledge, and stays usable during a client/runtime version mismatch.
- Voice Library represents each voice family once, makes multi-speaker selection usable
  at both small and large scales, and edits shared favorite/default metadata.
- Custom backend remains available for OpenAI-compatible providers and degrades
  by capability instead of exposing Piper-only controls.
- Preview reports generation and playback time, and Speech pace changes speed
  and pauses relative to each voice's saved baseline without overwriting it.
- Installed STT models, decoder preset, Vocabulary hint, noise suppression, and
  echo cancellation are usable from the installed PWA.
- Runtime voices have human names and exact speaker mappings; training metadata
  is not presented as a voice, and licensing is not inferred from installation.
- Automated checks, direct endpoint proof, service state, device behavior, and
  Grayson's listening acceptance are recorded as distinct evidence.

## Not doing

- Exposing Piper, Whisper, model weights, Python, or voice-service lifecycle as
  CLIde npm dependencies or repository assets.
- LAN or public exposure, nginx or firewall changes, or browser-direct access to
  the loopback backend.
- Letting the browser scan or execute arbitrary model paths; inventory comes
  from the configured runtime root through safe IDs.
- Copying Voice Studio's batch audition, comparison, model installation/deletion,
  deep tuning, or diagnostic workflows into CLIde. CLIde owns daily use and
  lightweight library organization; Voice Studio remains the voice laboratory.
- Streaming or provisional word-level dictation before Phase 10 justifies it.
- Combining Piper or whisper.cpp upgrades with initial deployment; each needs
  separate performance and listening acceptance.
