# 0013 — Abort is signal-first; the provider id is only the graceful tier

- Date: 2026-07-27
- Status: Accepted

## Decision

Every run owns an `AbortController`, created in `startRun` and handed to the
runtime at spawn time via `runtimeOptions`. `beginAbort` trips it
synchronously. This is the tier that always applies. The id-keyed provider
interrupt (`abortFns[provider]` → `abortClaudeSDKSession` → `interrupt()`) is
kept as the *preferred* tier when the provider session id is known, because it
is the provider's own graceful unwind — but it is no longer required for an
abort to work, and its absence is not a failed abort.

Corollary: a run cancelled with `seq` still at zero never emitted anything, so
the provider never took the turn. That is reported to the client as
`deliveredToProvider: false` on the aborted `complete`, and the optimistic user
row is retracted rather than left as a bubble with no transcript behind it.

## Rejected

- **Keying abort solely on the provider session id** — the shipped design until
  `e5ede32`. It cannot work in the window it most needs to: the id is announced
  mid-stream (`claude-sdk.js`, `addSession` inside the `for await` loop) and is
  `null` for the entire first leg of a new session.
- **Guarding re-entrancy on `run.status` alone** — `status` only flips to
  `completed` after the awaited interrupt resolves, so mashed Stops all land
  while it is still `running`. `abortInFlight` exists for this.
- **Tripping the controller in `handleChatAbort` instead of `beginAbort`** —
  the runtime is spawned concurrently with the handler, so an abort committed
  after an await can be observed by a runtime that already passed its last
  cancellation checkpoint.
- **Inferring "never delivered" client-side from a missing transcript uuid** —
  JSONL indexing lags on purpose (`pruneRealtimeSupersededByServer` retains
  rows not yet on disk), so absence right after a `complete` proves nothing.

## Why

Three bugs were fixed in sequence, and only the third was the reported one:
duplicate/mashed Stop (`abortInFlight`), dangling events after the terminal
event, then this. The second actively camouflaged the third — dropping
everything after the terminal `complete` silenced the live stream of a run that
had never stopped, so it *looked* aborted while the query ran to completion and
wrote a full reply to the transcript. Verified against the on-disk transcript
of a test session: two Stops pressed immediately after send left no rows at
all, while the one allowed to start recorded `[Request interrupted by user]`.

The SDK exposes `options.abortController` (`sdk.d.ts`: "Controller for
cancelling the query"), which needs no session id, so the signal is live from
the first tick.

Two consequences worth keeping in mind:

- `wasRunAborted()` in `claude-sdk.js` must fold the signal into terminal-
  complete suppression. A signal-only abort leaves `capturedSessionId` null, so
  the id-keyed `abortedSessionIds` check alone returns false and the runtime
  emits its own `complete` and reports the run "completed".
- The `deliveredToProvider` flag is derived from `seq`, not from anything
  provider-specific, so it holds for every adapter without per-adapter work.
  Cancellation itself is not yet universal: only the Claude adapter honors the
  signal. Cursor/Codex/OpenCode ignore the unused option and keep the previous
  id-keyed behavior — no worse than before, but not fixed either. Each can opt
  in by forwarding the signal to its own runtime.
