# Auto-Continue offered, remembered, and defaulted

- Status: 1/6
- Next: see the offer on the branch-test slot, then phase 1's Codex half
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
  session's pending rows, so an offer hides itself once taken.
- **`supportsUsageResetAlerts` gates the offer**, as it already does in the
  send menu. True for Claude and Codex, false for Cursor and OpenCode.

## How a limit stop is recognised

Both providers classify it in a field. Read from real transcripts,
2026-08-11 to 2026-09-09. Nothing here reads the sentence: the wording is
localized prose that has already changed once — upstream's
`formatUsageLimitText` matches a `Claude AI usage limit reached|<epoch>` form
that occurs in none of 47 real notices, and is dead code.

- **Claude** stamps the row `error: "rate_limit"`, `apiErrorStatus: 429`, and a
  `quotaLimits` object: `status`, a true epoch `resetsAt`, `rateLimitType`
  (`five_hour`, `seven_day`, ...), and the overage fields. The row itself is an
  assistant message with `model: "<synthetic>"` and `isApiErrorMessage: true`,
  which `normalizeMessage` already flags `isSystemNotice` on both the live and
  reload paths.
- **A spent balance is `quotaLimits: null`** on an otherwise identical row —
  same `error` and status. No quota object means no reset is coming, so that is
  the test for "do not offer a wait", not an excluded sentence.
- **Codex** puts the classification on `task_complete` as
  `codex_error_info: "usage_limit_exceeded"`; that object carries nothing else.
  Its reset instants live on `token_count.rate_limits` — `primary` (300 min)
  and `secondary` (10080 min), each with a real `resets_at` — which the usage
  provider already consumes, so no new plumbing carries them. Its sibling
  `rate_limit_reached_type` is null in all 16,347 samples here: schema only.
- **CLIde reads none of this today.** `quotaLimits` and `apiErrorStatus` are
  read nowhere; the Codex adapter prefers `error.message` and drops
  `codex_error_info`. Carrying them through `normalizeMessage` is phase 2's
  real work, and phase 4's classifier wants the same fields.

## Phases

- [x] 0. A usage window that resets early fires the message waiting on it,
      within one poll. Today it does the opposite: `scheduleUsage` cancels any
      armed timer whose identity has left the fresh poll, and the identity is
      built from `resetsAt`, so an early reset cancels the timer and re-arms for
      the *next* boundary — deferring the message by up to a week at the one
      moment it should go. Providers do grant goodwill resets, and Codex reports
      bankable ones as `rateLimitResetCredits`, which CLIde already reads. The
      trigger has to be "usage is available again", not "the predicted instant
      arrived". A defect in the unmerged branch, not in `main`
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
- [~] 2. A limit stop in the chat offers Auto-Continue in one tap, and the
      offer disappears once a message is waiting. Detected on the fields above,
      never the wording, and absent when the row says no reset is coming.
      `quotaLimits.resetsAt` also expires a stale offer, so an old conversation
      that ended on a limit stops advertising one. `Continue` goes through
      `buildSendOptions`, which reads the composer text only for a notification
      label, so the session's own model and permission mode carry over — minus
      `rewindToMessageId`, which an offer must not inherit
- [ ] 3. The message Auto-Continue sends is editable in Settings › Chat.
      Server-side in `appConfigDb`, not `useUiPreferences` localStorage, so
      phase 4 can read it with no browser open
- [ ] 4. A session can be set to Auto-Continue every time it hits the limit,
      from the composer's long-press menu. This is the standing mode the
      scheduled-messages plan deliberately did not build, and it needs three
      things that plan avoided: persisted per-session state (an `auto_continue`
      column on `sessions`, shaped like `model`/`effort`), a server-side
      classification of "this run stopped on limits" at the runtime's run-end
      path, and a cap on consecutive firings so a continue that hits the limit
      again cannot re-arm forever
- [ ] 5. Settings carries the default that new sessions take for phase 4

## Done when

- Hitting the limit in a chat shows an offer that, tapped, produces the same
  waiting card and sidebar clock a long-press schedule produces
- The offer is absent on a session that already has a pending `usage-reset` row
- The offer is absent on Cursor and OpenCode
- A session set to Auto-Continue resumes after a reset with no client connected
- Two consecutive limit stops do not produce an unbounded chain of retries

## Not doing

- Recurring or repeating schedules, still. Phase 4 is per-limit-stop, capped
- A second reset monitor, a second timer, or a second send path
- Waiting for the bottom navbar. Phase 4 hangs off the composer's existing
  long-press menu; the chat-header kebab can adopt it later for free
