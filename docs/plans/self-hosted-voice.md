# Self-hosted dictation and read-aloud

- Status: 10/11
- Next: decide whether the nearer-live dictation experiment is worthwhile.
- Context: [server voice module](../../server/modules/voice/voice.module.ts),
  [voice service contract](../../server/modules/voice/voice.service.ts),
  [client voice API](../../src/lib/voiceApi.ts),
  [shared voice settings decision](../decisions/0049-voice-runtime-owns-shared-settings.md),
  [standalone Studio decision](../decisions/0050-voice-studio-is-a-standalone-personal-tool.md),
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
      editable dictation, read-aloud controls/cancellation, background playback,
      notification state, and earbud pause. The auditable
      [speech front end](tts-speech-front-end.md) owns listening behavior.
- [x] **5. Bounded catalog in Settings.** The agreed male/female, low/medium/
      size/locale/bonus catalog is implemented. Grayson accepted all eight paths,
      replaced Spike with US-medium Kusal, and saved final pacing in Studio.
      Studio's STT preset flows into CLIde. Custom backends retain free-text; Rocket remains
      user-installed because it lacks model-specific training provenance.
- [x] **6. Shared inventory and settings ownership.** Make the authenticated
      runtime authoritative for installed models, runtime default, favorites,
      per-voice baselines, chosen voice, STT preset, and capabilities. Publish
      safe IDs and labels, never browser paths; CLIde and optional companion
      tools edit the same contract, while custom backends expose only supported capabilities.
      Runtime, server, and client contracts cover these values. Missing pace
      defaults to neutral; a rejected mixed-version save stays rendered with an
      inline error. Grayson's phone pass confirmed the slider returns to 1.00.
- [x] **7. Daily TTS surface.** Keep ordinary Voice settings compact: current
      voice, runtime default, Favorites, editable preview with generation and
      playback timing, relative Speech pace, and a route to Voice Library.
      Pace changes speed and pauses relative to the saved per-voice baseline;
      exact values and Reset stay under Fine tuning. Connection and raw model
      fields belong to Custom backend. Default and Favorite rows replace the
      inventory dropdown; Favorite rows retain speaker identity. Preview timing
      stays above its controls.
- [x] **8. Voice Library.** Group searchable rows by human name and language;
      nest sizes and select single-model/single-speaker voices directly.
      Multi-speaker families keep size selection and speaker browsing together;
      large sets such as LibriTTS-R use 32-speaker pages or exact-number search.
      Their Favorites view bypasses paging and preserves speaker identity.
      Selection, Favorite, and writable default pass focused tests. Never expose
      dataset names as voices. Optional friendly names are searchable, preserve
      original identity, and round-trip by stable voice ID. Personal gender,
      heard, and audition notes do not belong here. Grayson's phone pass
      confirmed friendly-name saving, search, and original-name restoration.
- [x] **9. Separate Voice Studio.** Move `voice/studio` into a private,
      independently run personal tool. CLIde depends only on runtime capabilities.
      Keep favorites, default/selection, optional display aliases, tuning, and STT
      in the runtime contract; keep gender balance, heard state, audition notes,
      recordings, and experiments in Studio-owned data. Preserve existing data
      and the host service during migration. The standalone repository, stable
      service symlink, 19 tests, loopback listener, and private HTTPS route are
      verified. Grayson's browser pass confirmed the tabs and saved data after
      extraction.
- [x] **10. Daily STT surface.** List every runtime-published installed Whisper
      model and expose decoder preset, Vocabulary hint, noise suppression, and
      echo cancellation as ordinary controls. Model choices name their speed/
      accuracy tradeoff, Vocabulary hint explains its input, and Advanced keeps
      thread count and microphone processing in the Dictation card. Changes
      round-trip without a restart; focused tests and Grayson's phone acceptance
      pass.
- [ ] **11. Nearer-live dictation experiment.** Test phrase-level final insertion
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
- CLIde and optional companion tools share runtime-owned default, favorites,
  installed inventory, per-voice presets, and STT settings across devices.
- A CLIde checkout neither contains nor requires Voice Studio; personal audition
  metadata is absent from CLIde's runtime contract.
- The ordinary Voice screen prioritizes Default and Favorites, needs no raw
  backend knowledge, and stays usable during a client/runtime version mismatch.
- Voice Library groups families, handles large casts, and edits shared
  favorite/default metadata.
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
- Streaming or provisional word-level dictation before Phase 11 justifies it.
- Combining Piper or whisper.cpp upgrades with initial deployment; each needs
  separate performance and listening acceptance.
