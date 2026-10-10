# Attach a screen recording and the agent sees it as frames

- Status: not started
- Next: Phase 0 — measure three real S20 screen recordings: size, codec, extraction time and memory
- Context: [image attachments](../../server/shared/image-attachments.ts), [assets routes](../../server/modules/assets/assets.routes.ts), [ADR 0075](../decisions/0075-photos-reads-before-asking-size.md), [Browser video clips](browser-video-clips.md), [Claude vision limits](https://platform.claude.com/docs/en/build-with-claude/vision)

Grayson attaches a phone screen recording, or an animated GIF, in the composer
and every provider's agent receives it as a short run of timestamped still
frames. No provider's model accepts video, and Claude reads only the first
frame of an animated GIF, so today a GIF attachment shows the agent one still
and a video arrives as an opaque file. One server-side extractor turns a clip
into frames; [Browser video clips](browser-video-clips.md) phase 2 reuses it.

Facts this rests on:

- Claude: JPEG/PNG/GIF/WebP only; animated images use the first frame; image
  cost is `ceil(w/28) × ceil(h/28)` tokens; more than 20 images in one request
  tightens the per-image limit to 2000 px. Read from the vision docs, 2026-10-08.
- Attachments today: images go to Claude as base64 blocks, to Codex as
  `local_image`, to Cursor/OpenCode as an `<images_input>` path tag; other files
  as a `<files_input>` path tag. Read from source.
- The general attachment upload is capped at 10 MB per file. Read from source.
  A real phone recording will often exceed it.
- `ffmpeg` 7.1 is on the host. A 20 s 1080×2340 synthetic H.264 clip gave 12
  frames at 1200 px tall in 3.5 s, 528 KB total, 554×1200 each — about 860
  tokens a frame by the formula above. Measured 2026-10-08; not a real recording.

## Phases

- [ ] 0. **Numbers from real recordings.** Grayson records three S20 clips
  (5 s, 20 s, 60 s) of CLIde itself. Record codec, resolution, frame rate and
  MB per second; time extraction and peak ffmpeg memory for each; attach the
  60 s one through the existing file row on the phone and confirm the
  read-first path (ADR 0075) survives a file that size. Set the size cap,
  duration cap, frame count and frame size from these. Gate: if extraction of
  a 60 s clip takes over ~15 s or the phone cannot attach it, stop and write
  down why here.
- [ ] 1. **One extractor, safe to point at an upload.** A server function
  takes a clip path and returns timestamped, downscaled JPEG frames plus
  duration and dimensions. Evenly spaced, about one a second, capped at the
  Phase 0 count. It spawns ffmpeg with an argument list, never a shell; a
  demuxer allow list (mp4/mov, webm/mkv, gif) and `-protocol_whitelist file`,
  so a crafted file cannot make ffmpeg fetch a URL or read another local file;
  one extraction at a time, with a timeout and a duration cap. Frames land in
  the assets folder next to the clip. One log line per run: codec, duration,
  frames, milliseconds, or the failure reason. Missing ffmpeg is detected at
  startup and turns the feature off rather than failing a send. Tests are new
  cases in the existing assets test file, skipped when ffmpeg is absent.
- [ ] 2. **Video and animated GIF attachments become frames.** Video MIME
  types get their own upload cap from Phase 0. On upload the server extracts
  frames and returns them linked to the clip, so a failure shows in the
  composer before send, not after. A GIF with one frame stays an ordinary
  image. On send each frame goes through the existing image path with a text
  label ("Frame 4 of 12 · 3.0 s · recording.mp4"), and the clip path goes in
  `<files_input>`, so an agent with a shell can pull denser frames when asked
  ("look closer at 3–5 s"). If extraction fails, the clip attaches as a plain
  file with a visible note and the send still works. One test drives all four
  providers and checks each receives the frames in its own image form.
- [ ] 3. **The chat shows one clip, not twelve images, live and after a
  reload.** Agree the end state with Grayson before building: the composer
  chip and the sent message show the clip as one item with its frame count;
  tapping plays the original. Each provider's history adapter recognises the
  frame labels and groups them back into that one item, so a reload looks
  the same as live.
- [ ] 4. **Durable facts move to the reference docs and `ARCHITECTURE.md`;**
  this plan is deleted.

## Done when

- On the installed phone app Grayson attaches a 20 s screen recording, the
  agent describes what changes across it with timestamps, and the same
  works with Codex.
- An animated GIF attachment reaches the agent as frames, not its first frame.
- A recording over the cap, a corrupt file, and a host without ffmpeg each
  attach as a plain file with a note and never block the send.
- After a reload the message shows one clip with its frame count.

## Not doing

- Converting anything to GIF. GIF is a sharing format; agents need frames,
  and the chat plays the original.
- Recording the phone screen from inside CLIde. Android's screen recorder
  already does it.
- Scene-change frame selection. Even spacing plus the clip path for a closer
  look covers it until a missed moment proves otherwise.
- Sending raw video to a provider that one day accepts it; that becomes a
  capability flag then.
