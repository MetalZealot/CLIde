# A running turn shows what the provider is actually doing

- Status: 1/6
- Next: Phase 1 — log `api_retry`, error results, and turn start / first frame / end to the server log
- Context: [Claude SDK map §4](../maps/claude-agent-sdk.md) (the stream messages CLIde drops),
  [Codex map](../maps/codex-cli-sdk-app-server.md), [tool activity stream](../maps/tool-activity-stream.md),
  ADR 0013 (abort). Client-side recording is the separate
  [diagnostics flight recorder](diagnostics-flight-recorder.md).

**Why this is worth building:** on 2026-09-15 a resumed Claude session (~178k
tokens, measured from the one turn that completed) gave no reply for 3 minutes
after a screenshot message. The activity indicator's words and timer are
client-side and start at send, so a model thinking, a request retrying, and a dead
request look identical. Seven Stop-and-resend cycles in 11 minutes followed, then
the 5-hour limit. **The cause of the silence cannot be recovered:** CLIde drops
`api_retry` and `thinking_tokens`, and logs neither.

What was established that shapes the phases (Phase 0 figures in the
[Claude SDK map §4](../maps/claude-agent-sdk.md)):

- **No phase needs `includePartialMessages`.** `thinking_tokens` (about one frame
  per 1.2 s while thinking) and `api_retry` both arrive without it. Only
  `status: requesting` needs it, and the first `rate_limit_event` marks the same
  moment — the API has answered — without it.
- Claude Code takes 3.3–4.2 s from `query()` to `init` on this host (5 runs), so
  "starting" is a real stage, not a flash.
- Streaming *reply text* is where the risk sits — placeholder finalisation, the
  unreachable `content_block_delta` branch, Cursor never sending `stream_end`
  ([Claude SDK map](../maps/claude-agent-sdk.md)). Counters and stages avoid it.
- `rate_limit_event` carries `status: allowed_warning` with `surpassedThreshold`
  and both windows in `unifiedWindows`: Anthropic decides when a warning is due,
  CLIde only has to show it. Below the threshold the frame omits `utilization`.

## Phases

- [x] **0. Probe what reaches the runtime loop.** Every frame logged for real Opus
      turns with and without `includePartialMessages`, a 55 s think, and a local
      529 stub; results in the Claude SDK map.
- [ ] **1. Runtime events reach the server log.** One line per `api_retry`
      (attempt, max, delay, HTTP status, error class), per error result, and per
      turn start / first frame / end, keyed by `session_id`.
      Metadata only — never prompt, reply, or tool content. After this, the log
      alone says whether a silent turn was retrying, erroring, or generating.
- [ ] **2. The activity label states the real stage.** A provider-neutral
      `status` stage replaces the rotating words wherever a runtime reports one:
      starting → sent (first `rate_limit_event`) → thinking · N tokens → retrying · reason ·
      attempt n of m, next in Xs → compacting. Rotating words stay only as the
      fallback. Codex (App Server error and retry notifications), Cursor (its
      runtime's retry handling) and OpenCode each map an equivalent or explicitly
      no-op; no Claude-only field enters shared code.
- [ ] **3. Silence is named.** When no runtime frame has arrived for a threshold
      after the turn was sent, the label says how long Claude has been silent
      instead of shimmering. Thinking frames never gapped more than 1.7 s in
      Phase 0; set the threshold from Phase 1 logs of ordinary turns, not a guess.
- [ ] **4. Usage warning before the limit.** `allowed_warning` shows one
      dismissible in-chat notice per window per threshold, naming the window and
      its reset time; `rejected` states the reset time. Dismissal holds for the
      rest of that window. The runtime must read the frame's `status`, which
      the usage normalizer ignores today. Codex derives the same from its rate-limit windows.
- [ ] **5. Acceptance.** Retry, silence and warning paths are proven by tests
      feeding recorded frames. Live, on the checkout's own test server: Grayson
      sends a turn and watches the stage advance and the thinking count climb.

## Done when

- A thinking turn shows a climbing token estimate; a retrying turn says so with
  its attempt count; a turn with no runtime frames says how long it has been
  silent.
- After any silent turn, the server log alone shows which of those it was.
- Nearing the 5-hour or weekly limit shows one notice per threshold, not repeated
  in that window once dismissed.
- Codex, Cursor and OpenCode show their equivalent stages or keep today's label.

## Not doing

- Rendering reply text progressively.
- Cost estimates, a resend guard, or automatic retry/resend by CLIde.
- A log viewer or diagnostics screen in Settings — the diagnostics plans own those.
