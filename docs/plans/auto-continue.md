# Auto-Continue offered, remembered, and defaulted

- Status: not started
- Next: Phase 1 — the button on the limit notice
- Context: [Scheduled messages and Auto-Continue](scheduled-messages.md) built
  everything below this; that plan's "one message, one firing" choice
  (2026-09-08) is what phase 3 reverses

Scheduled messages already send a `usage-reset` message: the REST route, the
dispatcher, the waiting card with its cancel, the sidebar clock, and the reset
monitor that fires them all exist and are verified. What is missing is every
way of asking for one that is not long-pressing the send button and typing
"Continue" — which is exactly the moment usage has just run out.

## What a new surface must reuse

- **The reset instant is not the button's problem.** A `usage-reset` row waits
  on `provider-usage-reset-monitor.service.ts`; it carries no time. Nothing
  here parses the epoch out of the limit notice.
- **The pending row is the dedupe.** `useScheduledMessages` already lists a
  session's pending rows, so an offer hides itself once taken.
- **`supportsUsageResetAlerts` gates the offer**, as it already does in the
  send menu. True for Claude and Codex, false for Cursor and OpenCode.

## Phases

- [ ] 1. A limit notice in the chat offers Auto-Continue in one tap, and the
      offer disappears once a message is waiting. The notice is matched by the
      text `formatUsageLimitText` already matches — *not* by `isSystemNotice`,
      which only the transcript path sets. First task is confirming against a
      real limit stop whether the live run delivers that string as an assistant
      row or inside the generic `kind: 'error'` frame; the matcher must handle
      whichever it is, and Codex's equivalent string is not yet known
- [ ] 2. The message Auto-Continue sends is editable in Settings › Chat.
      Server-side in `appConfigDb`, not `useUiPreferences` localStorage, so
      phase 3 can read it with no browser open
- [ ] 3. A session can be set to Auto-Continue every time it hits the limit,
      from the composer's long-press menu. This is the standing mode the
      scheduled-messages plan deliberately did not build, and it needs three
      things that plan avoided: persisted per-session state (an `auto_continue`
      column on `sessions`, shaped like `model`/`effort`), a server-side
      classification of "this run stopped on limits" at the runtime's run-end
      path, and a cap on consecutive firings so a continue that hits the limit
      again cannot re-arm forever
- [ ] 4. Settings carries the default that new sessions take for phase 3

## Done when

- Hitting the limit in a chat shows an offer that, tapped, produces the same
  waiting card and sidebar clock a long-press schedule produces
- The offer is absent on a session that already has a pending `usage-reset` row
- The offer is absent on Cursor and OpenCode
- A session set to Auto-Continue resumes after a reset with no client connected
- Two consecutive limit stops do not produce an unbounded chain of retries

## Not doing

- Recurring or repeating schedules, still. Phase 3 is per-limit-stop, capped
- A second reset monitor, a second timer, or a second send path
- Waiting for the bottom navbar. Phase 3 hangs off the composer's existing
  long-press menu; the chat-header kebab can adopt it later for free
