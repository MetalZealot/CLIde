# Scheduled messages and Auto-Continue

- Status: 2/4
- Next: Phase 3 — long-press the send button to compose one
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

## How the two consumers stay independent

`isEnabled` gates the **alert** and nothing else. It gated the whole monitor
lifecycle too — `reconcileUser` and `refreshProvider` both stopped a provider
whose alerts were off — so `shouldMonitor` now also keeps a provider alive
while a message waits on its reset.

The `notified` identity list still dedupes alerts only. Auto-Continue is
deduped by its own rows: the dispatcher claims each out of `'pending'` in one
statement, which survives a restart and cannot be re-fired, so it neither
reads nor writes `notified` and the two cannot silence each other. The
post-reset usage re-fetch now runs when either consumer delivers.

## Phases

- [x] 1. A scheduled message survives a restart — `scheduled_messages` table and
      repository, the dispatcher, and the time trigger. The sender is written
      against an injected `runTurn`; wiring that to the real runtime waits for
      phase 3, since nothing can create a row until there is a surface
- [x] 2. Auto-Continue — a second consumer at the reset monitor's fire point.
      One message, one firing: the pending row *is* the enablement and the
      dedupe, so nothing new is persisted and no standing per-session mode
      exists. A pending row also keeps a provider's monitor alive on its own
- [ ] 3. Composing one — creating a row must register the dispatcher through
      `setActiveScheduledMessageDispatcher` at startup and call
      `reconcileProviderUsageResetMonitor` after create and cancel, or a
      message scheduled while reset alerts are off waits on a stopped monitor.
      Long-press the send button offers "when usage resets"
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
