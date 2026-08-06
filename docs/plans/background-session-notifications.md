# Background-session notifications

- Status: not started
- Next: step 1 — the amber header dot and in-app banner, client-only, driven off
  the shared WebSocket.
- Context: web push is already wired end to end (`vapid_keys`,
  `push_subscriptions`, `useWebPush.ts`, `sw.js` push/notificationclick,
  `notification-orchestrator.service.js` → `webPush.sendNotification`). This plan
  does not touch that pipeline except to constrain **when** it fires.

Grew out of "I got an OS notification while looking at the very session that
triggered it" after CLIde was installed as a PWA.

## Settled — do not reopen

**The axis is not "current session vs other session". It is "is the app actually
visible".** That yields three states, and the surface follows from the state:

- **A — app focused, *this* session.** The in-session activity indicator already
  says done / needs-input. **Nothing.** This is the original bug.
- **B — app focused, *another* session.** You are looking at the screen but not
  at that session. An OS notification is heavy and redundant → **in-app surface**.
- **C — app not visible** (backgrounded, screen off, another app, in a pocket).
  Web push is the only channel that reaches you → **OS notification**, as built.

Urgency tiers cut across state, so "done" pings do not drown out the ones that
matter:

- **Action required** — permission prompt, `AskUserQuestion`, `ExitPlanMode`, or
  the SDK `Notification` hook. The session is **blocked**. Interruptive.
- **Done / stopped** — informational. Quiet. Reserve the banner for
  action-required or it gets noisy fast.

| App state | Event | Surface |
|---|---|---|
| Focused, current session | anything | Nothing |
| Focused, other session | action required | In-app banner (sticky, tap-to-jump) + header/sidebar dot |
| Focused, other session | done / stopped | Sidebar dot, optional brief toast; no OS notification |
| Not visible | action required | OS notification (existing web-push path) |
| Not visible | done / stopped | OS notification, gated on the per-event toggle |

## Phases

- [ ] **1. Header dot (amber only) + in-app banner**, driven off the shared
      WebSocket. Client-only. Prototype the feel on the dev server, but this is
      visibility-dependent PWA behaviour, so **final verification needs a build
      and the installed PWA on 3001** — the dev server is a plain browser tab
      with no PWA mode and no reliable service-worker push.
- [ ] **2. `sw.js` state-A suppression** — focused-client check, `postMessage`
      instead of `showNotification`. This is the original bug. Verifiable only on
      the installed PWA.
- [ ] **3. User-scoped in-app broadcast in the orchestrator**, with the client
      listener repointed from raw frames to that channel. Removes the reconnect
      blind spot that the client-only version has.
- [ ] **4. Optional green "done" state** on the dot, only if amber-only proves
      insufficient in use.

## Decide during step 1

- Does "done" for a background session warrant a banner, or is a dot enough?
  Leaning dot only — the banner is for action-required.
- Count badge or bare dot? Leaning count, since it doubles as the
  colourblind-safe signal.
- `chatRunRegistry` evicts completed runs after 5 minutes. If a background
  session finishes and you don't look for longer than that, the dot must survive
  — so drive it from **client-side accumulated state**, not by querying the
  registry, and let it persist until you view the session.

## Done when

On the installed PWA: a permission prompt in a background session raises a
banner and dot while the app is open, an OS notification while it is not, and
**nothing at all** when you are already looking at that session.
