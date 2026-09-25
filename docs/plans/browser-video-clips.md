# Browser video clips an agent can record, inspect, and hand over

- Status: not started
- Next: Phase 0 — live recording proof on a branch-test slot, measuring CPU and clip size
- Context: [Browser map](../maps/chat-browser-activity.md), [ADR 0053](../decisions/0053-browser-tools-are-official-playwright-mcp-over-http.md), [bridge](../../server/modules/browser-use/browser-use-mcp-endpoint.service.ts)

An agent records the Browser page as WebM within one turn. Two readers use the
clip: Grayson downloads and watches it, and the agent inspects it as still frames,
because no provider's model accepts video input. It records the Browser page
only: not the phone screen and not CLIde's own interface.

Facts this rests on, read from Playwright MCP 0.0.80's source:

- `browser_start_video` / `browser_stop_video` are gated by the `devtools`
  capability, which also enables 11 other tools: tracing, the action recorder,
  highlight/annotate, `browser_resume`, and the video chapter/action overlays.
- Recording starts on every open page and on pages opened while it runs; each
  page writes its own file.
- Disposing a connection stops a running recording. The bridge then deletes the
  connection's output directory, and providers reconnect every turn, so an
  unmoved clip dies at the end of the turn.
- The bridge already strips the agent's `filename` argument, so clips land in
  CLIde's per-connection directory by default.
- Playwright has no maximum duration; `size` is chosen by the agent.

## Phases

- [ ] 0. **Proof on a branch-test slot, with numbers.** Enable `devtools` in the
  worktree only; start, navigate, open a second tab, stop through CLIde's hosted
  context. Measure CPU while recording and MB per minute at two sizes. Record
  past the 32 MiB output budget and check whether the clip is evicted, and
  confirm that `browser_stop_video`'s own path check accepts the file.
  Also confirm a turn ending mid-recording stops it. Gate: if recording makes
  the Pi unusable at a readable size, stop here and record why in the map.
- [ ] 1. **Only start and stop are exposed, with limits CLIde enforces.** Tools
  gated by `devtools` pass through an allow list rather than the deny list, so a
  Playwright upgrade cannot add one silently. Size is clamped; a server timer
  stops a recording at the duration cap; the caps come from Phase 0's numbers.
  On stop, finished files move into a clip store under CLIde's config home, keyed
  to the chat's Browser session, with an expiry and a total-bytes cap. The stop
  result gives the agent a clip id, never a path. New ADR superseding 0053's
  tool-set clause, in the same commit.
- [ ] 2. **The Browser tab shows recording and offers the clip.** A recording
  indicator while it runs; each finished clip downloads through an
  authenticated route. The tab stays view-only. Agree the visual end state with
  Grayson before building.
- [ ] 3. **The agent inspects a clip as frames.** A second CLIde-authored tool
  takes a clip id plus a frame count or timestamps and returns timestamped,
  downscaled JPEG frames extracted with the host's `ffmpeg`, with duration and
  dimensions as text. Frames per call and per clip are capped; one extraction
  runs at a time, with a timeout. Frames use the same image result path as
  `browser_take_screenshot`, so a provider that drops screenshot images drops
  these too, in the same way. Same ADR as Phase 1, or its own, stating why a
  second CLIde tool is allowed.
- [ ] 4. **Durable facts move to the Browser map;** this plan is archived.

## Done when

- In one turn an agent records a flow that opens a second tab, and both clips
  appear in the Browser tab; one downloaded on the phone plays.
- The same agent requests frames from that clip and describes what changed
  between them.
- A recording the agent never stops ends at the duration cap, and the clip
  store stays under its byte cap after repeated recordings.
- The endpoint lists `browser_start_video` and `browser_stop_video`, and none
  of the other `devtools` tools.

## Not doing

- Recording that spans turns: the connection, and with it the recording's
  owner, is replaced every turn.
- Recording the phone screen, CLIde's own interface, or audio.
- Tracing, the action recorder, highlight/annotate, and chapter overlays.
- Agent-chosen file names or paths, for recording or for frames.
