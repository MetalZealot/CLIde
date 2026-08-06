# WebSocket liveness: keep or replace the permissive watchdog

- Status: not started
- Next: baseline the *integrated* v1.37 gateway, then answer question 1 — does a
  probe clear on any inbound frame, or only on its matching echo?
- Context: [ADR 0006 — WS liveness is client-driven via app-level ping](../decisions/0006-app-level-ws-liveness.md)
  · reviewed 2026-07-30, unblocked when v1.37 merged in `658d536`

This is a decision to make, not a feature to build. ADR 0006's core holds:
browser JavaScript cannot observe protocol Ping/Pong control frames, so protocol
pings alone give the page no deterministic way to detect and replace a silent
half-open socket. CLIde still needs a browser-visible mechanism alongside the
server heartbeat. Upstream v1.37 overlaps only the server half — it sends
protocol pings, requires a pong, and terminates unresponsive connections, but
adds no `chat.ping`/`chat_pong`, watchdog, visibility/online probe, reconnect
banner, or delivery-aware Stop feedback.

Baseline against the merged source. Do not assume either the pre-integration
CLIde implementation or upstream v1.37 survived the merge unchanged.

## Where ADR 0006 overreached

Findings from the 2026-07-30 review. They are corrections to the *reasoning*,
not permission to rewrite the record — ADRs are append-only, so a material change
means a new ADR superseding 0006.

- An arbitrary inbound frame proves current server-to-browser delivery. It does
  **not** prove the server received and answered that particular probe.
- Streaming does not inherently stop the server answering `chat.ping`, so strict
  echo matching should not be rejected on that basis alone.
- Client initiation is a reasonable design choice, not an API requirement.
- Forty seconds is a nominal foreground idle bound, not a worst case — browsers
  throttle and suspend background timers.
- The server protocol heartbeat is both zombie cleanup *and* reverse-proxy
  keepalive, not purely the former.

## Phases

- [ ] **1. Decide what a successful probe proves.** Compare today's "any inbound
      frame clears the watchdog" against a matched echo: unique nonce or
      increasing probe ID, cleared only by its matching `chat_pong`, with ordinary
      traffic tracked separately as `lastInboundAt` and periodic probes possibly
      suppressed while useful traffic already flows. State which direction each
      signal proves — inbound traffic proves server-to-browser, a matching echo
      proves the round trip, and neither proves a user action was *accepted*
      unless that action carries its own acknowledgement.
- [ ] **2. Decide which server heartbeat survives.** Compare the integrated
      implementation with upstream's extracted `attachWebSocketHeartbeat`. Prefer
      a testable helper with injected scheduling and immediate cleanup on ping
      failure. Decide explicitly whether arbitrary inbound application messages
      mark the server-side connection alive — a client message proves only
      client-to-server, while the protocol pong proves the ping reached the peer's
      WebSocket stack and was processed.
- [ ] **3. Re-evaluate timing and reconnect policy.** The 30s interval, 10s client
      timeout, fixed 3s reconnect delay, and immediate wake/online probes, against
      foreground desktop, installed PWA, screen lock and resume, airplane mode,
      Wi-Fi↔cellular and Tailscale path changes, a busy Pi, and prolonged offline.
      Consider exponential backoff with jitter for repeated failures while keeping
      an immediate attempt on a genuine wake or `online`.
- [ ] **4. Decide whether liveness is distinct from delivery.** `WebSocket.send()`
      returning does not mean the frame was delivered. Decide whether Stop,
      permission decisions, and user-input responses need explicit application
      acknowledgements. Do **not** broaden this into a general reliable-message
      protocol without observed failure evidence — `chat.subscribe`, run IDs,
      sequence replay, and pending-interaction recovery remain the primary
      missed-frame recovery layer.
- [ ] **5. Retain ADR 0006 or supersede it**, based on the above plus verification.

## Done when

The likely outcome is the same two complementary layers — strict protocol
Ping/Pong on the server for keepalive and socket cleanup, plus a browser-visible
application probe owning reconnection and UI state. The narrow open decision is
permissive "any frame" versus activity-aware matched echoes. Decide it from the
integrated implementation and these results, then either retain 0006 or write its
successor.

Automated coverage first, before any semantics change: server echo with matching
and malformed probe IDs; client fake-timer test for an unanswered idle probe;
matching and mismatched pong; a test documenting whether an ordinary frame clears
or merely records activity during an outstanding probe; `visibilitychange` to
visible and `online`; a replacement-socket test proving stale handlers are
detached and cannot dispatch or schedule another reconnect; server heartbeat tests
for pong, missed pong, ping failure, close/error cleanup, and the chosen
application-message policy.

Then live: desktop Network panel for ping/pong cadence and reconnect; installed
PWA airplane-mode loss and recovery; screen-lock wake; a network path transition
where practical; an active streamed response during a probe; Stop and one
interactive request during connection loss; reconnect replay with no duplicate or
missing sequenced frames. Record which of these is a source test and which is a
live environment — a passing suite alone does not close this.
