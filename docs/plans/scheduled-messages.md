# Scheduled messages and Auto-Continue

- Status: not started
- Next: Phase 1 — the table, the repository, and the dispatcher's time trigger
- Context: [gap inventory](../maps/upstream-sync.md) holds the verdict and why
  upstream's `#1239` interrupt behaviour is not wanted here; ADR 0031 governs
  the sidebar status visuals phase 4 touches

A message you write now and CLIde sends later: at a time you pick, or the
moment the provider's usage limit resets. The second is the one that started
this — when usage runs out mid-task you want work to resume the instant it
can, not whenever you next look at your phone.

## What already exists, and must be reused

- **The reset time is already known.** `provider-usage-reset-monitor.service.ts`
  polls each provider's usage, derives the reset instant, arms a timer, and
  records delivered resets so a restart cannot re-fire one. Auto-Continue is a
  second consumer at that same fire point, not a second monitor.
- **Busy sessions are already handled.** `useQueuedMessageAutoSend.ts` queues
  against a running session and sends when the run ends. A scheduled message
  that fires into a busy session queues the same way. This is why upstream's
  `#1239` interrupt is explicitly not wanted: CLIde chose waiting, and has
  shipped it.

## Two traps at the fire point

- **`isEnabled` there gates the notification preference.** Auto-Continue must
  not inherit it, or turning reset alerts off silently stops sending messages
  the user scheduled.
- **The `notified` identity list dedupes alerts.** Auto-Continue needs its own
  dedupe record, or delivering one suppresses the other for that reset.

## Phases

- [ ] 1. A scheduled message survives a restart — `scheduled_messages` table and
      repository, the dispatcher, and the time trigger. Server only, no UI
- [ ] 2. Auto-Continue — a second consumer at the reset monitor's fire point,
      with its own enablement and its own dedupe, per the traps above
- [ ] 3. Composing one — long-press the send button offers "when usage resets"
      (only where the provider supports it) and "at a time". Cancel and inspect
      from the same surface
- [ ] 4. A session with one pending shows a timer in its status column,
      resolved against the existing running / attention / unread order

## Provider answer

`supportsUsageResetAlerts` is true for Claude and Codex, false for Cursor and
OpenCode. Custom-time scheduling is provider-neutral and offers everywhere;
Auto-Continue offers only where the capability is true, and the long-press menu
omits it rather than showing it disabled. The dispatcher sends through the same
chat websocket path every adapter already uses, so no adapter changes.

## Done when

- A message scheduled for a time in the future is sent at that time, and still
  is after a server restart between scheduling and firing
- Auto-Continue fires when usage resets with reset notifications turned off
- A scheduled message firing into a busy session queues rather than interrupts
- The long-press menu omits Auto-Continue on Cursor and OpenCode
- A session with a pending scheduled message is distinguishable in the sidebar

## Not doing

- Upstream `#1239`'s interrupt-a-busy-run behaviour. CLIde queues; see above
- The "+" popover menu with Attachment and Skills entries. Skills already reach
  the composer through the slash menu, and the composer is due a restyle with
  the bottom navbar — doing it twice is the waste this avoids
- Recurring or repeating schedules. One message, one firing
