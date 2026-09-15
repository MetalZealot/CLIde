# A running turn shows what the provider is actually doing

- Status: not started
- Next: Phase 0 — one short Opus turn logging every SDK frame, with and without `includePartialMessages`
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
`api_retry`, `status: requesting` and `thinking_tokens`, and logs none of them.
Measured the same morning: ~4 s between CLIde starting a run and Claude Code
writing the user message into the transcript.

What was established that shapes the phases:

- A live thinking count does **not** obviously need token streaming. The SDK
  defines `system/thinking_tokens` — a running estimate digested from
  `thinking_delta.estimated_tokens`, emitted even while thinking text is redacted
  (read from `sdk.d.ts` 0.3.258). Recent Opus 5 transcript rows carry empty
  thinking text (measured), so counting visible thinking text would show nothing.
  The binary emits the message from its internal `stream_event` handling; whether
  it reaches `query()` consumers without `includePartialMessages` is unverified.
- Streaming *reply text* is where the risk sits — placeholder finalisation, the
  unreachable `content_block_delta` branch, Cursor never sending `stream_end`
  ([Claude SDK map](../maps/claude-agent-sdk.md)). Counters and stages avoid it.
- `rate_limit_event` already reaches the usage cache and carries
  `status: allowed_warning` and `surpassedThreshold`: Anthropic decides when a
  warning is due, CLIde only has to show it.

## Phases

- [ ] **0. Probe what reaches the runtime loop.** Log type/subtype of every frame
      for one short thinking turn, first without then with
      `includePartialMessages`. Record in the Claude SDK map whether
      `thinking_tokens` and `requesting` need the flag and, if so, frames per
      second (Pi CPU and WebSocket cost). If they need it, partial frames are
      consumed for counters in the runtime and never normalized into messages.
- [ ] **1. Runtime events reach the server log.** One line per `api_retry`
      (attempt, max, delay, HTTP status, error class), per error result, per
      `requesting`, and per turn start / first frame / end, keyed by `session_id`.
      Metadata only — never prompt, reply, or tool content. After this, the log
      alone says whether a silent turn was retrying, erroring, or generating.
- [ ] **2. The activity label states the real stage.** A provider-neutral
      `status` stage replaces the rotating words wherever a runtime reports one:
      starting → sent (`requesting`) → thinking · N tokens → retrying · reason ·
      attempt n of m, next in Xs → compacting. Rotating words stay only as the
      fallback. Codex (App Server error and retry notifications), Cursor (its
      runtime's retry handling) and OpenCode each map an equivalent or explicitly
      no-op; no Claude-only field enters shared code.
- [ ] **3. Silence is named.** When no runtime frame has arrived for a threshold
      after `requesting`, the label says how long Claude has been silent instead
      of shimmering. The threshold comes from Phase 0–1 logs, not a guess.
- [ ] **4. Usage warning before the limit.** `allowed_warning` shows one
      dismissible in-chat notice per window per threshold, naming the window and
      its reset time; `rejected` states the reset time. Dismissal holds for the
      rest of that window. Codex derives the same from its rate-limit windows.
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
