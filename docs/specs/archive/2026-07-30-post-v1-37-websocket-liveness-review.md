# Post-v1.37 WebSocket liveness review

- Date: 2026-07-30
- Status: Deferred until the upstream v1.37 integration is complete and
  live-verified
- Scope: Reassess ADR 0006 and the final integrated WebSocket implementation;
  do not change the active `chore/upstream-1.37` worktree as part of this review
- Related decision:
  [ADR 0006 — WS liveness is client-driven via app-level ping](../../decisions/0006-app-level-ws-liveness.md)
- Integration prerequisite:
  [Upstream v1.37.0 integration](2026-07-29-upstream-1-37-integration.md)

## Why this is deferred

The active v1.37 integration changes the shared WebSocket gateway and imports
upstream's tested protocol-level heartbeat. Reviewing or changing liveness
semantics before that merge settles would evaluate a transient implementation
and risk conflicting with the in-progress integration work.

Begin this review only after the v1.37 worktree has:

1. completed source integration;
2. passed its focused tests, typecheck, lint, and builds;
3. been live-verified by Grayson in isolation; and
4. been merged into `main`.

Use the then-current integrated source as the baseline. Do not assume that
either the pre-integration CLIde implementation or upstream v1.37 survived
unchanged.

## Findings to carry forward

The central ADR 0006 decision remains sound: browser JavaScript cannot observe
WebSocket protocol Ping/Pong control frames, so protocol pings alone do not give
the page a deterministic way to detect and replace a silent half-open socket.
CLIde therefore still needs a browser-visible liveness mechanism in addition to
the server's protocol heartbeat.

Upstream v1.37 overlaps only the server half. Its shared gateway sends protocol
pings, requires a protocol pong, and terminates an unresponsive connection.
It does not add a browser `chat.ping`/`chat_pong`, watchdog, visibility/online
probe, reconnect banner, or delivery-aware Stop feedback.

Several statements in ADR 0006 are stronger than the evidence supports:

- An arbitrary inbound frame proves current server-to-browser delivery, but it
  does not prove that the server received and answered that particular probe.
- Streaming does not inherently prevent the server from answering
  `chat.ping`; strict echo matching should not be rejected solely on that basis.
- Client initiation is a reasonable design choice, not an API requirement.
- Forty seconds is a nominal foreground idle-detection bound, not an absolute
  worst case, because browsers can throttle or suspend background timers.
- The server protocol heartbeat is both zombie cleanup and reverse-proxy
  keepalive, not purely the former.

These are review findings, not permission to rewrite ADR 0006. ADRs are
append-only. If the implementation semantics change materially, write a new
ADR that supersedes 0006.

## Questions for the post-integration review

### 1. What does a successful probe prove?

Compare the retained "any inbound frame clears the watchdog" behavior with a
matched-echo design:

- Send a unique nonce or monotonically increasing probe ID.
- Clear an explicit wake/Stop/idle probe only when its matching
  `chat_pong` arrives.
- Track ordinary inbound activity separately as `lastInboundAt`.
- Consider suppressing periodic probes while recent useful traffic is already
  flowing, without allowing unrelated traffic to satisfy an explicit probe.

The decision must state which directions are being proven:

- arbitrary inbound traffic proves server-to-browser delivery;
- a matching echo proves browser-to-server-to-browser round-trip handling; and
- neither proves that a user action was accepted unless that action has its own
  acknowledgement.

### 2. Which server heartbeat behavior should survive?

Compare the integrated server implementation with upstream's extracted
`attachWebSocketHeartbeat` helper. Prefer a testable helper with injected
scheduling and immediate cleanup on ping failure.

Specifically decide whether arbitrary inbound application messages should mark
the server-side connection alive. A client message proves the client-to-server
direction, while the protocol pong proves that the server-to-client ping also
reached the peer and was processed by its WebSocket stack.

### 3. Are the timing and reconnect policies appropriate?

Re-evaluate the 30-second interval, 10-second client timeout, fixed three-second
reconnect delay, and immediate wake/online probes against:

- foreground desktop;
- installed mobile PWA;
- screen lock and resume;
- airplane mode;
- Wi-Fi-to-cellular or Tailscale path changes;
- a slow or temporarily busy Raspberry Pi; and
- prolonged offline state.

Consider exponential backoff with jitter for repeated connection failures while
retaining an immediate attempt on a genuine wake or `online` transition.

### 4. Is liveness distinct from delivery?

Retain the current warning that `WebSocket.send()` returning does not mean the
frame was delivered. Decide whether Stop, permission decisions, and user-input
responses need explicit application acknowledgements rather than relying on the
general heartbeat.

Do not broaden this review into a general reliable-message protocol unless
observed failure evidence requires it. `chat.subscribe`, run IDs, sequence
replay, and pending-interaction recovery remain the primary missed-server-frame
recovery layer.

## Required verification

Add deterministic automated coverage before changing the liveness semantics:

1. Server echo test with matching and malformed probe identifiers.
2. Client fake-timer test for an unanswered idle probe.
3. Matching-pong and mismatched-pong tests.
4. A test documenting whether an ordinary frame clears or merely records
   activity during an outstanding probe.
5. `visibilitychange` to visible and `online` event tests.
6. Replacement-socket test proving stale handlers are detached and cannot
   dispatch or schedule another reconnect.
7. Server protocol heartbeat tests for pong, missed pong, ping failure,
   close/error cleanup, and the chosen application-message policy.

Then perform live checks:

- Desktop browser Network panel: confirm application ping/pong cadence and
  reconnect behavior.
- Installed PWA: airplane-mode loss and recovery.
- Screen-lock wake.
- Network/path transition where practical.
- An active streamed response during a probe.
- Stop and one interactive request during a simulated or real connection loss.
- Reconnect replay with no duplicate or missing sequenced frames.

Record the distinction between source tests and each live environment. Do not
mark the existing TODO item complete solely because the automated suite passes.

## Expected outcome

The likely retained architecture is still two complementary layers:

1. strict protocol Ping/Pong on the server for keepalive and server-side socket
   cleanup; and
2. a browser-visible application probe that owns client reconnection and UI
   state.

The open decision is narrower: whether CLIde should retain its permissive
"any frame" watchdog or move to activity-aware, matched application echoes.
Make that decision from the integrated implementation and the verification
results above, then either retain ADR 0006 as-is or supersede it with a new ADR.
