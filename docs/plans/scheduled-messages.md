# Scheduled messages and Auto-Continue

- Status: 4/4
- Next: nothing — verified end to end in a browser
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

## Where the runtime is joined

The module owns rows and timers and nothing that can start a turn, and imports
neither the websocket nor the providers module — both import it. Startup
registers the missing half through `setScheduledMessageRuntime`
(`scheduled-message-wiring.service.ts`), which also supplies the
`onPendingChanged` hook that reconciles the usage-reset monitor: without it a
message scheduled while reset alerts are off waits on a monitor that was never
started. `hasPendingUsageResetMessages` returns false until that registration
happens, so nothing keeps a monitor awake for sends that cannot go out.

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

## Who a scheduled turn is written to

Nobody sent it, so there is no originating socket and no client subscribed to
the run: the writer is given a connection that fans out to every listening
client, and a `scheduled_message_sent` frame draws the user bubble the composer
never drew and clears the waiting card. `chat.subscribe` must not re-attach
such a run — replacing its connection hands the stream to one client and
silences every other, terminal `complete` included, so `attachConnection` is a
no-op for a broadcast run and subscribers catch up through replay.

## Phases

- [x] 1. A scheduled message survives a restart — `scheduled_messages` table and
      repository, the dispatcher, and the time trigger. The sender is written
      against an injected `runTurn`; wiring that to the real runtime waits for
      phase 3, since nothing can create a row until there is a surface
- [x] 2. Auto-Continue — a second consumer at the reset monitor's fire point.
      One message, one firing: the pending row *is* the enablement and the
      dedupe, so nothing new is persisted and no standing per-session mode
      exists. A pending row also keeps a provider's monitor alive on its own
- [x] 3. Composing one — long-press or right-click the send button offers "when
      usage resets" (only where the provider supports it) and "at a time"; a
      card above the composer shows what is waiting, with a cancel. The turn
      itself goes through `buildChatRuntimeOptions`, the same builder
      `chat.send` uses, so a stored message is re-validated at firing time
      rather than trusting options snapshotted when it was written
- [x] 4. A session with one pending shows a timer in its status column. The
      server broadcasts the whole pending set, since a row can be created,
      cancelled or fired from any client; the clock yields to a run and to
      attention, and shows over unread

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
