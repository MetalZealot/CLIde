# Auto-Continue offered, remembered, and defaulted

- Status: not started
- Next: Phase 0 — an early reset must fire the message that waits on it
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
  on `provider-usage-reset-monitor.service.ts`; it carries no time, and the
  notice has no machine-readable one to parse anyway. Nor is a provider's
  predicted instant binding — see phase 0.
- **The pending row is the dedupe.** `useScheduledMessages` already lists a
  session's pending rows, so an offer hides itself once taken.
- **`supportsUsageResetAlerts` gates the offer**, as it already does in the
  send menu. True for Claude and Codex, false for Cursor and OpenCode.

## What the notice actually is

Read from 47 real notices across the transcripts and from the CLI binary's own
template, 2026-08-11 to 2026-09-09. Upstream's `formatUsageLimitText` matches
`Claude AI usage limit reached|<epoch>`, which occurs in none of them: it is
dead code, and neither the offer nor anything else should be built on it.

- **Claude** writes an assistant row stamped `model: "<synthetic>"` and
  `isApiErrorMessage: true`, which `normalizeMessage` already flags
  `isSystemNotice` on both the live and reload paths, so it renders as the
  muted banner: `You've hit your session limit · resets 10:20pm
  (America/Edmonton)`. The label varies with the window — session, weekly,
  Opus, Sonnet, Fable, usage credit — and ` · progress saved` may follow.
- **Codex** ends the turn with a `task_complete` carrying
  `codex_error_info: "usage_limit_exceeded"`, which the adapter drops in favour
  of the human string, so the chat gets a red `type: 'error'` row instead:
  `You've hit your usage limit. Upgrade to Pro ... or try again at 12:59 PM.`
  That code is the right input for phase 4's classifier.
- **Neither carries a parseable reset time** — both are localized prose. So the
  offer does not expire on the notice. A stale tap simply fires promptly, which
  is harmless; real expiry can come later from `resetsAt` on the usage window,
  which the chat already receives and ignores.
- **`You're out of usage credits`** wants payment, not a wait, and the prefix
  match excludes it. So does the still-running warning `You've used 90% of...`.

## Phases

- [ ] 0. A usage window that resets early fires the message waiting on it,
      within one poll. Today it does the opposite: `scheduleUsage` cancels any
      armed timer whose identity has left the fresh poll, and the identity is
      built from `resetsAt`, so an early reset cancels the timer and re-arms for
      the *next* boundary — deferring the message by up to a week at the one
      moment it should go. Providers do grant goodwill resets, and Codex reports
      bankable ones as `rateLimitResetCredits`, which CLIde already reads. The
      trigger has to be "usage is available again", not "the predicted instant
      arrived". A defect in the unmerged branch, not in `main`
- [ ] 1. A limit stop draws one row, identical live and after a reload, and the
      same shape on Claude and Codex. Claude's pair is diagnosed, observed live
      2026-09-09: the CLI streams the synthetic row that becomes the muted
      notice, then the SDK *throws* ``Claude Code returned an error result:
      `` + that same text, which the runtime's catch re-emits as a red
      `kind: 'error'` row. Only the notice is a transcript row, so a reload
      drops the red one. Every error result also arrives as a synthetic row, so
      the whole wrapper class is a duplicate and the catch can drop it — but
      confirm Codex's pair separately, since `180352d4` deduped a different one
- [ ] 2. A limit notice in the chat offers Auto-Continue in one tap, and the
      offer disappears once a message is waiting. Matched on the text prefix
      `You've hit your `, which both providers share, across the two row shapes
      they produce; `isSystemNotice` is a hint, never the test. `Continue` goes
      through `buildSendOptions`, which reads the composer text only for a
      notification label, so the session's own model and permission mode carry
      over — minus `rewindToMessageId`, which an offer must not inherit
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

- Recurring or repeating schedules, still. Phase 3 is per-limit-stop, capped
- A second reset monitor, a second timer, or a second send path
- Waiting for the bottom navbar. Phase 3 hangs off the composer's existing
  long-press menu; the chat-header kebab can adopt it later for free
