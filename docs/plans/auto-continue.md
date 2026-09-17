# Auto-Continue offered, remembered, and defaulted

- Status: 4/6
- Next: phase 5 — the default new sessions take for the standing mode
- Context: [Scheduled messages and Auto-Continue](scheduled-messages.md) built
  everything below this; that plan's "one message, one firing" choice
  (2026-09-08) is what phase 4 reverses

Scheduled messages already send a `usage-reset` message: the REST route, the
dispatcher, the waiting card with its cancel, the sidebar clock, and the reset
monitor that fires them all exist and are verified. What is missing is every
way of asking for one that is not long-pressing the send button and typing
"Continue" — which is exactly the moment usage has just run out.

## What a new surface must reuse

- **The reset instant is not the button's problem.** A `usage-reset` row waits
  on `provider-usage-reset-monitor.service.ts` and carries no time of its own.
  Nor is a provider's predicted instant binding — see phase 0. The offer reads
  one only to stop advertising itself once it has passed.
- **The pending row is the dedupe.** `useScheduledMessages` already lists a
  session's pending rows, so an offer hides itself once taken — and a row held
  for editing must count, or the offer comes back mid-edit.
- **`supportsUsageResetAlerts` gates the offer**, as it already does in the
  send menu. True for Claude and Codex, false for Cursor and OpenCode.

## How a limit stop is recognised

By the provider's own fields, never the notice's wording — Claude's `quotaLimits`
and Codex's `codex_error_info`, both carried as the shared `usageLimit` since
phase 2. Field names, the spent-balance case, the SDK's duplicate throw, and why
early resets are read from usage: [code anchors](../maps/code-anchors.md).

## Phases

- [x] 0. A usage window that resets early fires the message waiting on it,
      within one poll. Today it does the opposite: `scheduleUsage` cancels any
      armed timer whose identity has left the fresh poll, and the identity is
      built from `resetsAt`, so an early reset cancels the timer and re-arms for
      the *next* boundary — deferring the message by up to a week at the one
      moment it should go. Providers do grant goodwill resets, and Codex reports
      bankable ones as `rateLimitResetCredits`, which CLIde already reads. The
      trigger has to be "usage is available again", not "the predicted instant
      arrived"
- [~] 1. A limit stop draws one row, identical live and after a reload, and the
      same shape on Claude and Codex. Claude's pair is diagnosed, observed live
      2026-09-09: the CLI streams the synthetic row that becomes the muted
      notice, then the SDK *throws* ``Claude Code returned an error result:
      `` + that same text, which the runtime's catch re-emits as a red
      `kind: 'error'` row. Only the notice is a transcript row, so a reload
      drops the red one. Claude's half is done: the catch drops the wrapper,
      but only when the notice row actually went out, so an error result
      nothing announced is never silenced. Codex still shows a pair and its
      shape is unconfirmed — its synchronizer skips a `task_complete` carrying
      no agent message, so the second row is not the transcript one and needs a
      live capture before anything is changed
- [x] 2. A limit stop offers Auto-Continue in one tap, as a button beneath the
      limit notice itself; tapping it puts the scheduled bubble from the [message
      edit model](message-edit-model.md) directly beneath that. The card above the
      composer is gone, and the offer names the live notice by identity so an
      older limit further up the thread never grows a button. Verified on the
      branch server 2026-09-17 by appending a *recorded* limit row to a real
      session's transcript: offer drawn, tapped, real pending row, bubble, sidebar
      clock, and *Send now* produced a real turn. **A live limit stop remains
      unverified** — it cannot be triggered on demand
- [x] 3. The message Auto-Continue sends is editable in Settings › Chat, stored
      in `appConfigDb` so phase 4 can read it with no browser open. Saved on
      blur; clearing the field stores nothing and the default comes back, so a
      send is never empty. The offer reads it at tap time rather than caching
      it, so an edit on another device is the one that goes. Verified on the
      branch server 2026-09-17: edited, persisted across a reopen, tapped the
      offer and the bubble carried the edited text, cleared it back to default
- [x] 4. A session can be set to Auto-Continue every time it hits the limit,
      from the **chat header kebab** — decided with Grayson 2026-09-17: the
      send button's long-press menu acts on the message being composed, and a
      standing mode is a property of the session, like Pin or Rename. Three
      pieces: `auto_continue` and `auto_continue_streak` columns on `sessions`;
      the gateway classifying a run that ended on a resumable limit
      (`chat-run-registry`, on the provider's own `usageLimit` field, reported
      at the terminal `complete`); and a cap of three consecutive firings, after
      which the mode turns itself off. Anything the user sends clears the count.
      The cap notice is a live frame only — nothing writes it to a transcript —
      so a closed client finds the mode off in the menu instead. Verified on the
      branch server 2026-09-17: the entry toggles, persists across a reload, and
      shows on Claude and Codex. **The arming itself is unit-tested only**: a
      real limit stop cannot be triggered
- [ ] 5. Settings carries the default that new sessions take for phase 4

## Done when

- Hitting the limit shows an offer on the notice that, tapped, produces the same
  scheduled bubble and sidebar clock a long-press schedule produces
- The offer is absent on a session that already has a pending `usage-reset` row
- The offer is absent on Cursor and OpenCode
- A session set to Auto-Continue resumes after a reset with no client connected
- Two consecutive limit stops do not produce an unbounded chain of retries

## Not doing

- Recurring or repeating schedules, still. Phase 4 is per-limit-stop, capped
- A second reset monitor, a second timer, or a second send path
- Waiting for the bottom navbar. Phase 4 lives in the chat header kebab, beside
  the other per-session actions
