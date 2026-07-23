# 0006 — WS liveness is client-driven via app-level ping, not protocol ping

- Date: 2026-07-22
- Status: Accepted

## Decision

The client is responsible for detecting a dead websocket, and it does so with an
**application-level** echo: it sends a `chat.ping` JSON frame every 30s and arms
a 10s watchdog that is disarmed by **any** received frame (not just the
`chat_pong` echo). Watchdog expiry, a `visibilitychange`→visible wake, or an
`online` event with a silent socket all force a reconnect, and `connect()`
**explicitly tears down the previous socket** (detach handlers, `close()`)
before opening a new one. The server keeps a protocol-level ping sweep
(`isAlive` + `terminate()`) purely for its own zombie-socket hygiene.
Introduced in `dd47ddd` (TODO §89).

## Rejected

1. **Relying on WS protocol ping/pong for client-side detection.** The server
   already pinged every 30s, which looks like liveness detection — it isn't,
   for the client: browsers answer protocol pings inside the network stack and
   never surface them to page JS. No JS event fires on ping, pong, or their
   absence. A page cannot observe protocol-level liveness at all; only a data
   frame that round-trips to `onmessage` proves the path to the *page*.
2. **Strict pong matching** (watchdog cleared only by the matching `chat_pong`).
   Any received frame proves the transport; demanding the specific echo would
   flag a healthy connection as dead the moment the server is busy streaming.
3. **Trusting `onclose` + the reconnect loop to recover.** A half-open TCP path
   (phone screen-lock, wifi power-save, Tailscale path change) leaves
   `readyState` OPEN indefinitely — an idle client writes nothing, its TCP
   never errors, `onclose` never fires. This is why detection must be active
   and why the forced reconnect cannot wait for the old socket to close
   gracefully.

## Why

The symptom this fixes (TODO §89): prompts, permission requests, and stream
text silently vanishing while the UI shows stale "thinking" text, with Stop
buffering into the void — for as long as the dead socket goes unnoticed
(previously: forever, until a manual refresh). The server-side recovery
(`chat.subscribe` re-attach, `seq` replay, `pendingPermissions` in the ack)
already existed; the missing half was *detection*, and the browser API shape
dictates the design: if the page can't see protocol pings, liveness must ride
an app-level data frame, and it must be the client that initiates, because
only the client can act on the answer (reconnect, show the banner).

Client-initiated app ping looks redundant next to the server's protocol ping —
both exist deliberately, they serve different observers. Do not "simplify" one
away.

Consequences accepted: worst-case detection is ~40s idle (~10s after a Stop
press or PWA wake, which probe immediately); reconnects happen more often by
design, which promoted two latent replay-layer bugs (duplicate frames on
re-subscribe, per-run vs per-session `seq` mismatch) to active — tracked in
TODO under §89's follow-up item.
