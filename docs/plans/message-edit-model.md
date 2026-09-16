# One edit model for queued, scheduled, and earlier messages

- Status: 2/5
- Next: Phase 2 — scheduled messages as bubbles in the thread, queues in one row
- Merged to `main` 2026-09-15; phases 0 and 1 are live
- Context: [Auto-Continue](auto-continue.md) puts its offer on the scheduled bubble
  this plan introduces; placement reasons in [UI standards](../maps/ui-standards.md);
  rewind semantics are ADRs 0012 and 0013

Three kinds of message can be edited in the composer: one sent while a run is busy
(queued), one set to send later (scheduled), and an earlier message being rewound.
They are one mechanic — a message in the conversation, loaded into the composer,
committed by sending — so they share one edit model. Where each sits, and what
sending does, differ.

## Where phase 1 left the code

- **The server owns whether a message can send.** `scheduled_messages.state` is
  `pending | paused | sent | cancelled | failed`; only a `pending` row is armed
  or claimed. Pause, resume, and save-an-edit are three calls in the
  scheduled-messages module, and the dispatcher re-arms from the row each time.
- **Paused counts as waiting** everywhere a count is taken: the sidebar clock,
  the reset monitor's keep-alive, and the Auto-Continue offer's dedupe.
- **Resuming catches up.** A time that passed fires at once; a usage reset that
  arrived while paused is recorded on the row (`reset_missed`) because the
  monitor's recovery is a one-time transition.
- **Every send path saves into an open edit** — button, Enter, voice, command —
  through one intercept in the composer state hook.
- **Do not reintroduce a lease.** An editor-renewed hold was built and removed:
  it needed the phone to keep the page awake, and sent messages out from under
  an open edit. Anything that expires on its own has the same defect.
- **Verify with real sends.** Faking "page hidden" and marking a row sent in
  SQLite both passed while the real path was broken. A scheduled send needs a
  session whose transcript exists in that server's home, or the turn produces
  nothing and the row still reads `sent`.

## Today, per surface — scheduled row current, the rest read 2026-09-14

| | The original, while editing | Above the composer | Backing out | Attachments |
|---|---|---|---|---|
| Queued | leaves the queue | nothing | leaves an ordinary draft | restored |
| Scheduled | pauses, stays listed | "Paused while you edit…" | *Discard edit* resumes it | restored |
| Earlier | stays, with an amber ring | "Editing earlier message…" | × restores the draft typed before | cannot be edited at all |
| Queued answer to a Codex question | — | its own card | remove only | — |

Both queues live in the browser that made them; scheduled messages live on the
server and appear on every device. The queues already have an order: a typed
queued message goes first, then Codex answers one per turn, oldest first. A Codex
question stays above the composer — like a permission prompt, it waits on you.

## The model

- **A scheduled message lives in the conversation**, as a dimmed bubble at the end
  of the thread saying when it goes. It may be hours away and the agent tools have
  no equivalent; Google Messages is the reference.
- **Queued messages share one compact row just above the composer**, in send order
  — a typed one first, then Codex answers. They go when the current turn ends and
  are often changed just before, so they sit by the input as upstream does (read)
  and the desktop agent tools do (recalled). It is the one unsent thing allowed in
  that strip, and it is a single row, never stacked cards.
- **Queues stay in the browser that made them**, as upstream's do: a queued message
  sends only while that browser is open. Scheduled messages stay on the server.
- **Tapping an unsent message** offers *Send now*, *Edit*, and *Cancel*. Earlier
  messages keep the edit button they have.
- **Editing leaves the original in place, marked** with rewind's amber ring, text
  and attachments loaded into the composer, the existing draft set aside. While
  marked, it offers only *Cancel edit*; sending is the composer's job, so
  "send the original or the edit?" never arises.
- **Editing pauses the original** — it stays listed, and cannot send until the
  edit is saved or discarded, however long the editor is away. Nothing times
  out, so nothing depends on a phone keeping a page awake. A paused message says
  so on its row and offers *Resume*, which is what keeps it from being forgotten.
- **Resuming catches up on what the pause missed.** A time that passed already
  fires on resume. A usage reset does not announce itself twice: the monitor's
  recovery is a one-time transition, so it is recorded on the paused row and
  fires when the message resumes.
- **Cancelling puts everything back** — the set-aside draft, and the original still
  queued or scheduled. Starting a second edit cancels the first, releasing its
  hold; cancel then restores the draft from before either.
- **The send button shows what it will do**: an arrow when sending goes now, a clock
  when it re-arms a schedule; held down, the arrow turns into the clock. Driven by
  `useLongPress`'s `isPressing`, never `:active`, and its accessible name changes
  with the icon.
- **A rewind edit marks what it will drop** with a treatment unlike the unsent
  dimming — dimmed already means "not sent yet", and cannot also mean "about to
  go". A rewind leaves waiting messages alone: they still send, stay visible, and
  cancel in one tap, as upstream's do. Revisit only if that bites.
- **Losing the banners must not lose the announcement.** The edit state reaches a
  screen reader without moving focus (WCAG 4.1.3).

## Phases

- [x] 0. Decided with Grayson 2026-09-14: queued messages share one compact row
      above the composer, queues stay per-browser, and a rewind leaves waiting
      messages to send. Upstream, read that day, handled neither of the last two —
      they are edge cases, not a convention being departed from
- [x] 1. Editing pauses a scheduled message: it cannot send until saved or
      resumed, keeps its attachments, and catches up on a time or reset that
      passed meanwhile. The monitor's keep-alive, the sidebar clock and the
      Auto-Continue offer all count a paused row as waiting, and every send path
      saves into an open edit. A lease that the editing client had to renew was
      built first and removed: it depended on a phone keeping the page awake, and
      sent messages out from under an open edit. Verified with real sends on the
      branch server 2026-09-15
- [ ] 2. Scheduled messages render as bubbles at the end of the thread with their
      tap menu, and both queues merge into one compact row above the composer; the
      scheduled, queued, and queued-answer cards are removed
- [ ] 3. All three edit through the model above; the rewind and schedule banners
      are removed, with the announcement kept
- [ ] 4. A rewind edit marks what it will drop, in its own treatment

## Done when

- Nothing above the composer reports a scheduled message or an edit, and queued
  messages there take one row however many are waiting
- A queued message looks the same whether typed or answering a Codex question,
  and the list reads in send order
- Cancelling any edit restores the earlier draft and leaves the original unchanged
- Closing the app mid-edit leaves the message paused, not sent, until it is resumed
- A usage reset that lands during an edit still sends the message once it resumes
- Editing a scheduled message with an attachment keeps the attachment
- Holding the send button shows the clock before the menu opens
- A screen reader hears that an edit started and ended

## Not doing

- A `+` popover as a scheduling entry. Long-press on send stays the only one
- New entry points for editing an earlier message
