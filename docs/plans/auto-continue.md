# Auto-Continue offered, remembered, and defaulted

- Status: 6/6
- Next: accept the compact presentation at a real limit stop
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
- [x] 1. A limit stop draws one row, identical live and after a reload.
      Claude: the SDK rethrows the streamed notice as a red error; the catch
      drops the wrapper only when the notice actually went out. Codex, captured
      live 2026-09-21: the transport's red row plus the transcript row, and the
      live one carried no `usageLimit` — so the offer never drew and phase 4
      never armed on Codex. The live row is now classified and gives way to the
      transcript's copy on refresh, and draws as the same muted notice as
      Claude's, offer included. Unit-tested; a live Codex stop has not been
      re-run since the fix
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
- [x] 5. Settings carries the default that new sessions take for phase 4, as a
      switch in the same Settings › Chat group as the message. The mode is
      stamped on the row at creation, not consulted later, so changing the
      switch never reaches a session that already exists — and it applies only
      where CLIde mints the row (a new chat, a fork), never to a transcript the
      watcher indexes off disk, which would otherwise turn the whole session
      backlog on at once
- [~] 6. Compact chat controls: the header kebab names the session mode as
      "Auto-Continue: On / Off". A live limit notice offers "Enable Auto-Continue
      for this chat" only when the mode is off and no reset message is waiting,
      including a paused message or one held for editing. Enabling queues the
      continue immediately. The scheduled bubble owns its editable text and
      "Waiting for usage reset" status; the notice alone names the reset time.
      Canceling that bubble skips one message without disabling the session mode;
      disabling the mode from the kebab also cancels its waiting continue.
      Settings still owns the message and new-session preference. Verified: 84
      component tests, client typecheck/build, and isolated component examples in
      Browser at 320, 412, and 1280 px, including RTL. The test account is at
      onboarding, so full-app interaction and real-stop acceptance remain. A real
      stop armed and sent correctly before this presentation change on 2026-09-24.

## Done when

- Hitting the limit offers enabling only when off with no reset message waiting;
  queued messages retain their bubble actions and sidebar clock
- The offer is absent on Cursor and OpenCode
- A session set to Auto-Continue resumes after a reset with no client connected
- Two consecutive limit stops do not produce an unbounded chain of retries

## Not doing

- Recurring or repeating schedules, still. Phase 4 is per-limit-stop, capped
- A second reset monitor, a second timer, or a second send path
- Waiting for the bottom navbar. Phase 4 lives in the chat header kebab, beside
  the other per-session actions
