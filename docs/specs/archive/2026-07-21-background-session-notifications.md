# Background-session notifications — design & implementation plan

**Status:** settled design, not yet implemented. Grew out of the "I got an OS notification
while looking at the very session that triggered it" annoyance after CLIde was installed as
a PWA on the S20. This doc locks the behavioral model (three app-states, urgency tiers), the
two visible surfaces (in-app banner + header roll-up dot), and a staged transport plan so the
UI can ship before the robust server channel exists.

Prerequisite context: web push is already fully wired end-to-end (VAPID keys persisted in the
`vapid_keys` table, `push_subscriptions`, `useWebPush.ts`, `sw.js` push/notificationclick
handlers, `notification-orchestrator.service.js` → `webPush.sendNotification`). This spec does
**not** touch that pipeline except to constrain *when* it fires. Enabling push is
Settings → Notifications → Enable; subscribing flips `channels.webPush` on and sends a
`push.enabled` confirmation push through the full pipeline.

## The core reframe (don't reopen)

The decision axis is **not** "current session vs other session." It's **"is the app actually
visible."** That yields three states, and the surface follows from the state:

- **State A — app focused, *this* session.** The in-session activity indicator already conveys
  done / needs-input. **No notification of any kind.** (This is the redundant OS notification
  that started the whole discussion.)
- **State B — app focused, *another* session.** You're looking at the screen but not that
  session. OS notification is heavy and redundant here → **in-app surface** (banner + header
  dot).
- **State C — app not visible** (backgrounded, screen off, different app, phone in pocket). The
  OS notification is the *only* channel that reaches you → **web push**, as already built.

Rule of thumb: **OS notification only in C; in-app surface only in B; nothing in A.**

## Urgency tiers (orthogonal to state)

Tier by urgency, not just location — otherwise "done" pings drown out the ones that matter.

- **Action required** — a permission prompt, `AskUserQuestion`, `ExitPlanMode`, or the SDK
  `Notification` hook. The session is **blocked** until you act. Interruptive: banner + amber
  dot; in state C, an OS notification.
- **Done / stopped** — informational, non-blocking. Quiet: a sidebar dot (and, if kept, a
  green header dot), maybe a brief auto-dismissing toast. Reserve the banner for action-required
  or it gets noisy fast.

## Surface matrix

| App state | Event | Surface |
|---|---|---|
| Focused, current session | anything | Nothing (in-session indicator already shows it) |
| Focused, other session | action required | In-app banner (sticky, tap-to-jump) + header/sidebar dot |
| Focused, other session | done / stopped | Sidebar dot (+ optional brief toast); no OS notification |
| Not visible | action required | OS notification (existing web-push path) |
| Not visible | done / stopped | OS notification, gated on the per-event toggle |

## Surface 1 — the header roll-up dot (the mobile fix)

**Problem it solves:** on the S20 PWA the sidebar is `MobileSidebarOverlay`, closed by default.
So while you're in a session, the ambient per-session status (dots on sidebar rows) is
**invisible**. The header needs a roll-up.

**Placement:** a dot/badge on the sidebar-toggle button in the header (next to the existing
sidebar icon). It is a **roll-up** of the per-session states hidden inside the collapsed
sidebar. Hierarchy:

```
header dot (something needs you)
  → tap → open sidebar
    → per-row dots (which session)
      → tap row → jump into that session (clears its state)
```

**Rules:**

- **Precedence, not two dots.** A single dot shows one state. Define it:
  **attention (amber) always wins over done (green).** Any background session needing action →
  amber, regardless of how many are merely "done."
- **Don't rely on color alone.** Amber/green is a classic colorblind-confusion pair. Pair the
  color with a **count badge** ("2") and/or a shape difference so it reads without color. Reuse
  the existing activity-indicator color tokens so it looks native, not bolted on.
- **Auto-clear "done."** Amber persists until you act on the session. Green loses meaning if it
  accumulates — clear it the moment you view that session, or drop green entirely.
- **v1 recommendation: amber-only.** Ship "attention" first; add the green "done" state later
  only if its absence is actually missed. Simpler precedence, less visual noise.

## Surface 2 — the in-app banner (state B)

A transient top banner for the *moment a background session transitions*:

- **Action required:** `"✋ Action required — <session name>"`, **sticky**, tap-to-jump. Stays
  until acted on (the session is blocked; a self-dismissing banner would lose the signal).
- **Done (if surfaced at all):** `"✓ Finished — <session name>"`, auto-dismiss after a few
  seconds. Optional; the sidebar/header dot may be enough.
- **Multiple background sessions:** collapse rather than stack infinitely — e.g.
  `"2 sessions need attention"` that opens the sidebar on tap. Don't paper the screen with
  banners.
- Tapping switches sessions in-app (no relaunch) — the whole point over an OS notification,
  which on mobile drags you out and back.

## Transport — how the signal reaches these surfaces

### What the trace established (the enabling facts)

- **The client already has one persistent pipe.** `WebSocketContext` holds a **single** `/ws`
  connection for the whole app (token-scoped, created once at provider mount). Its `subscribe`
  API dispatches **every** frame — each tagged with `sessionId` — to **all** listeners,
  regardless of which session is on screen. So a global listener can already observe a
  background session's `complete` and `permission_request` frames while you view a different
  one. **In-app cross-session notification is therefore mostly a client-side feature — the data
  is already arriving.**
- **The caveat is reconnects.** Each run's writer binds to *"the socket that asked"* — the last
  connection to `chat.subscribe` for that session (`chat-websocket.service.ts` ~line 291,
  `chatRunRegistry.attachConnection`). On a WS drop the client makes a **new** socket object and
  only re-subscribes to the **active** session. A background run's writer stays pointed at the
  now-dead socket, so:
  - Continuously connected → background events reach you. ✓
  - After drop + reconnect → background sessions go **silent** until you next open them. ✗
  - App fully backgrounded/closed → WS drops entirely → this is exactly **state C**, where OS
    push takes over. Clean handoff. ✓
- **A user-scoped broadcast primitive already exists.** `connectedClients`
  (`websocket-state.service.ts`) is iterated to broadcast `session_upserted` to every open
  socket; the **desktop** notification channel already keys a registry by `userId`. So a
  user-scoped fan-out for notifications is a known, existing pattern — not new infrastructure.

### Two flavors (they compose — build a, graduate to b)

**(a) Client-only, cheap — ship the UI now.**
A global frame listener off the existing shared ws: watch all frames, filter `complete` /
`permission_request` where `sessionId !== activeSessionId`, and drive the banner + header dot
from that. **Zero server change, near-zero risk.** Works whenever connected; the only weakness
is the reconnect blind spot above.

**(b) Server-side user-scoped notification channel — the "proper" target.**
Give `notification-orchestrator.service.js` a real in-app channel that broadcasts events to
**all** of the user's `connectedClients` (filtered by `userId`), independent of per-run writer
binding. This mirrors the existing **desktop** channel's userId-keyed registry, extended to
web/PWA. Benefits:
- Kills the reconnect blind spot — events reach the user's current socket(s) regardless of
  which session each run's writer is bound to.
- Robust across multiple tabs.
- **Unifies the event model:** the same orchestrator event feeds in-app *and* OS push, so the
  two surfaces can't drift. (Note: the orchestrator already receives `writer: ws` from callers
  but currently **ignores** it — there is no in-app WS channel today, only `webPush` and
  `desktop`. This flavor is where `writer` / a new `webInApp` channel finally gets used.)

**Recommendation:** target **(b)** as the architecture, but build **(a)** first for the visible
banner + dot. They share the same client surface — (a) points the listener at raw chat frames;
graduating to (b) swaps the listener's data source to the orchestrator channel without redoing
the UI. UI lands immediately with no server risk; robustness follows.

## Provider compatibility

`sw.js` and the banner/dot are provider-agnostic display logic — safe for Claude / Cursor /
Codex / OpenCode. Flavor (a) rides `complete` / `permission_request`, which are normalized
gateway frames all adapters already emit. Flavor (b) rides the orchestrator, which every
adapter already calls (`notifyRunStopped` / `notifyRunFailed` from `cursor-cli.js`,
`openai-codex.js`, `opencode-cli.js`; the richer `action_required` events are Claude-only for
now via the SDK hook + `canUseTool`, and degrade to nothing for providers without an equivalent
— acceptable).

## Also fix while here — the state-A suppression (the original bug)

`sw.js:94` calls `showNotification` **unconditionally**, so an OS notification fires even in
state A. Under the `userVisibleOnly: true` contract Chrome *requires* a visible notification per
push — but suppressing is tolerated **when a client is focused** (the "site updated in
background" penalty targets the no-visible-window case). So: in the `push` handler,
`clients.matchAll({ type: 'window' })`; if a focused client exists, **postMessage the page
instead of `showNotification`** and let the in-app surface handle it (states A/B). If none is
focused (state C), show the OS notification as today. Pairing suppression with a guaranteed
in-app surface keeps a visible signal happening, which is what keeps the contract safe in
spirit.

## Build order

1. **Header dot (amber-only) + in-app banner**, driven by flavor **(a)** off the shared ws.
   Client-only. Prototype on `cloudcli-dev` (:5173) for the UX feel — but note this is
   PWA/visibility-dependent behavior, so **final verification needs a build + SSH restart on
   3001** and testing on the installed PWA (the dev server is a plain browser tab: no PWA mode,
   no reliable service-worker push).
2. **`sw.js` state-A suppression** (focused-client check → postMessage vs showNotification).
   Verifiable only on the installed PWA.
3. **Flavor (b) server channel** — user-scoped in-app broadcast in the orchestrator; repoint the
   client listener from raw frames to the orchestrator channel. Removes the reconnect blind spot.
4. **(Optional) green "done" state** on the dot, if amber-only proves insufficient.

## Open questions

- Does "done" for a background session warrant a banner at all, or is a dot enough? (Leaning:
  dot only; banner is for action-required.)
- Should the header dot show a **count** or a bare dot? (Leaning: count badge — doubles as the
  colorblind-safe signal.)
- Retention: `chatRunRegistry` keeps completed runs for 5 min. If a background session finishes
  and you don't look for >5 min, the run is evicted — does the header dot survive that? (It
  should be driven by client-side accumulated state, not by querying the registry, so it
  persists until you view the session.)
