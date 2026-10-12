# Background-session notifications

- Status: 1/4
- Next: phase 2 — the in-app banner.
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
| Focused, other session | action required | In-app banner (sticky, tap-to-jump) + sidebar rail dot |
| Focused, other session | done / stopped | Sidebar dot, optional brief toast; no OS notification |
| Not visible | action required | OS notification (existing web-push path) |
| Not visible | done / stopped | OS notification, gated on the per-event toggle |

## Phases

- [x] **1. Push fixes, no new surface.** Verified on the phone 2026-10-11:
      opening a session closes its notifications; one notification per session
      (newer replaces older); `sw.js` shows nothing while that session is on
      screen, asking the window which session it shows (the window URL read
      `/` on Android); no push for a run you stopped (Claude, Cursor, OpenCode; Codex
      already skipped it).
- [ ] **2. In-app banner**, driven off the shared WebSocket. The dot is the
      rail's ([sidebar rail design](../designs/sidebar-rail.md)), not a header dot. Client-only. Prototype the feel on the dev server, but this is
      visibility-dependent PWA behaviour, so **final verification needs a build
      and the installed PWA on 3001** — the dev server is a plain browser tab
      with no PWA mode and no reliable service-worker push.
      Its list of pending requests is the first version of runtime rebuild
      phase 8's store; build it so phase 8 extends it.
- [~] **3. The chime.** Probe chose E "Buzzy" (low-passed square taps) at
      today's 7.5% level, with a distinct three-tap "needs you"; built
      2026-10-12 with a per-device volume slider, played as a rendered
      `<audio>` clip because only a media element ducks other apps (probe: the
      Audio Session API is absent in Chrome), with 300 ms of lead-in silence so
      the duck settles first. Verified on the phone 2026-10-12. Left: the
      event toggles gate it as they gate push.
- [ ] **4. Reconnect blind spot** — runtime rebuild phase 5's fan-out and
      replay cover it; drop this phase if they do.

## Decide during phase 2

- Does "done" for a background session warrant a banner, or is a dot enough?
  Leaning dot only — the banner is for action-required.
- `chatRunRegistry` evicts completed runs after 5 minutes. If a background
  session finishes and you don't look for longer than that, the dot must survive
  — so drive it from **client-side accumulated state**, not by querying the
  registry, and let it persist until you view the session.

## Done when

On the installed PWA: a permission prompt in a background session raises a
banner and dot while the app is open, an OS notification while it is not, and
**nothing at all** when you are already looking at that session.
