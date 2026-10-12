# Background-session notifications

- Status: 2/5
- Next: phase 5 — "finished" arrives silent.
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
  at that session. The OS pop-up interrupts and taps through to the session
  (Android's per-app "Show as pop-up", on since 2026-10-12); CLIde adds only a
  **lasting mark** on the sidebar button, because the pop-up slides away. An
  in-app banner was dropped 2026-10-12 as a duplicate of the pop-up.
- **C — app not visible** (backgrounded, screen off, another app, in a pocket).
  Web push is the only channel that reaches you → **OS notification**, as built.

Urgency tiers cut across state, so "done" pings do not drown out the ones that
matter:

- **Action required** — permission prompt, `AskUserQuestion`, `ExitPlanMode`, or
  the SDK `Notification` hook. The session is **blocked**. Interruptive.
- **Done / stopped** — informational. Quiet: arrives silent (phase 5).

| App state | Event | Surface |
|---|---|---|
| Focused, current session | anything | Nothing |
| Focused, other session | action required | OS pop-up + yellow mark on the sidebar button |
| Focused, other session | done / stopped | Silent OS notification + green mark on the sidebar button |
| Not visible | action required | OS notification (existing web-push path) |
| Not visible | done / stopped | OS notification, gated on the per-event toggle |

## Phases

- [x] **1. Push fixes, no new surface.** Verified on the phone 2026-10-11:
      opening a session closes its notifications; one notification per session
      (newer replaces older); `sw.js` shows nothing while that session is on
      screen, asking the window which session it shows (the window URL read
      `/` on Android); no push for a run you stopped (Claude, Cursor, OpenCode; Codex
      already skipped it).
- [x] **2. Other-sessions mark on the mobile sidebar button.** Verified on
      the phone 2026-10-12: yellow when another session waits on
      you, else green when one has an unread reply; the open session is the
      bottom bar's. Driven by the sidebar's attention and unread sets, which
      persist until the session is viewed. Moves onto the
      [sidebar rail](../designs/sidebar-rail.md) when that lands.
- [~] **3. The chime.** Probe chose E "Buzzy" (low-passed square taps) at
      today's 7.5% level, with a distinct three-tap "needs you"; built
      2026-10-12 with a per-device volume slider, played as a rendered
      `<audio>` clip because only a media element ducks other apps (probe: the
      Audio Session API is absent in Chrome), with 300 ms of lead-in silence so
      the duck settles first. Verified on the phone 2026-10-12. Left: the
      event toggles gate it as they gate push.
- [ ] **4. Reconnect blind spot** — runtime rebuild phase 5's fan-out and
      replay cover it; drop this phase if they do.
- [ ] **5. "Finished" arrives silent** (`silent: true`), so only "needs you"
      sounds; check on the S20 whether a silent notification still pops up.
      Settings › Notifications gains a one-line hint to turn on pop-ups in
      Android's app notification settings, which are off by default.

## Done when

On the installed PWA: a permission prompt in a background session pops up and
marks the sidebar button while the app is open, notifies while it is not, and
does **nothing at all** when you are already looking at that session; a
finished session lands silently.
