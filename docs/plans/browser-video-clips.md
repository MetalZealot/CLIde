# Browser video clips an agent can record and inspect

- Status: not started
- Next: Phase 0 — live recording proof on a branch-test slot, measuring CPU and clip size
- Context: [ADR 0069](../decisions/0069-a-chats-browser-belongs-to-the-chat-not-the-connection.md), [ADR 0053](../decisions/0053-browser-tools-are-official-playwright-mcp-over-http.md), [bridge](../../server/modules/browser-use/browser-use-mcp-endpoint.service.ts)

An agent records the Browser page as WebM within one turn, then inspects the
clip as still frames, because no provider's model accepts video input. This
catches what a screenshot misses: animation, flicker, loading states. It records
the Browser page only, not the phone screen or CLIde's own interface.

Facts this rests on, read from Playwright MCP 0.0.80's source:

- `browser_start_video` / `browser_stop_video` are gated by the `devtools`
  capability, which also enables 11 other tools: tracing, the action recorder,
  highlight/annotate, `browser_resume`, and the video chapter/action overlays.
- A tool's capability is internal to Playwright. `tools/list` carries names
  only, so the bridge can filter by name and nothing else.
- Recording starts on every open page and on pages opened while it runs; each
  page writes its own file.
- Disposing a connection stops a running recording. The bridge then deletes the
  connection's output directory, and providers reconnect every turn, so an
  unmoved clip dies at the end of the turn, and a recording cannot outlive it.
- The bridge already strips the agent's `filename` argument, so clips land in
  CLIde's per-connection directory by default.
- `@playwright/mcp` is pinned exactly, so the tool set changes only on a
  deliberate bump.

## Phases

- [ ] 0. **Proof on a branch-test slot, with numbers.** Enable `devtools` in a
  worktree only and drive the slot's endpoint directly. Start, navigate, open a
  second tab, stop. Measure CPU while recording and MB per minute at two
  sizes. Record past the 32 MiB output budget and see whether the clip
  survives. Confirm `browser_stop_video` accepts its own file path, and that
  closing the MCP session mid-recording leaves a playable file. Time a
  frame extraction with the host's `ffmpeg` on a real clip. Gate: if recording
  makes the Pi unusable at a readable size, stop here and record why in the map.
- [ ] 1. **Only approved tools reach the agent, and clips outlive the turn.**
  The bridge replaces its deny list with an allow list of every tool CLIde
  exposes, plus start/stop video; a test fails when Playwright's list and the
  allow list differ, so a bump means deciding on each new tool. Size is
  clamped. When a connection closes, finished clips move out of its output
  directory into a clip store under CLIde's config home before the directory is
  deleted. Clips over the size cap are deleted, and the store has an expiry
  and a total-bytes cap. The stop result gives the agent a clip id, never a
  path. New ADR superseding 0053's tool-set clause, in the same commit.
- [ ] 2. **The agent inspects a clip as frames.** A CLIde-authored tool takes a
  clip id plus a frame count or timestamps and returns timestamped, downscaled
  JPEG frames extracted with `ffmpeg`, with duration and dimensions as text.
  Frames per call and per clip are capped from Phase 0's numbers; one
  extraction runs at a time, with a timeout. Frames use the same image result
  path as `browser_take_screenshot`, so providers handle them the same way.
- [ ] 3. **Durable facts move to the Browser map;** this plan is archived.

## Done when

- In one turn an agent records a flow that opens a second tab, stops, and in a
  later turn requests frames from the clip and describes what changed.
- A recording the agent never stops still yields a clip after the turn ends,
  and the store stays under its byte cap after repeated recordings.
- The endpoint lists exactly the allow list, and none of the other `devtools`
  tools.

## Not doing

- A duration timer. The turn's end already stops a recording, and stopping one
  from the host mid-turn has no proven path.
- Downloading clips from the Browser tab, until frames prove the feature is used.
- Recording that spans turns, the phone screen, CLIde's own interface, or audio.
- Tracing, the action recorder, highlight/annotate, and chapter overlays.
- Agent-chosen file names or paths, for recording or for frames.
