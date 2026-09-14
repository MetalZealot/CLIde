# One edit model for queued, scheduled, and earlier messages

- Status: 1/5
- Next: Phase 1 — hold a scheduled message under a lease while it is edited
- Context: [Auto-Continue](auto-continue.md) puts its offer on the scheduled bubble
  this plan introduces; placement reasons in [UI standards](../maps/ui-standards.md);
  rewind semantics are ADRs 0012 and 0013

Three kinds of message can be edited in the composer: one sent while a run is busy
(queued), one set to send later (scheduled), and an earlier message being rewound.
They are one mechanic — a message in the conversation, loaded into the composer,
committed by sending — so they share one edit model. Where each sits, and what
sending does, differ.

## Today, read from source 2026-09-14

| | The original, while editing | Above the composer | Backing out | Attachments |
|---|---|---|---|---|
| Queued | leaves the queue | nothing | leaves an ordinary draft | restored |
| Scheduled | its stored row is deleted | "Editing — still sends…" | only *Send normally*, which drops the schedule | **dropped** |
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
- **An unsent original is held** — kept, not sendable. The hold is a lease the
  editing client renews while the edit is open; when it lapses — app closed,
  session switched, phone asleep — the message returns to waiting. A hold that
  outlived its editor would never send and never say so.
- **Releasing a held message catches up on what it missed.** A time that passed
  already fires on release. A usage reset does not: the monitor's recovery is a
  one-time transition, so release checks whether its reset passed and fires if so.
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
- [ ] 1. A scheduled message being edited is held under a lease, keeps its
      attachments, and catches up on release. The dispatcher skips a held row;
      the monitor's keep-alive, the sidebar clock, and the Auto-Continue offer all
      count it as waiting
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
- Closing the app mid-edit leaves a scheduled message that still sends
- A usage reset that lands during an edit still sends the message once it is released
- Editing a scheduled message with an attachment keeps the attachment
- Holding the send button shows the clock before the menu opens
- A screen reader hears that an edit started and ended

## Not doing

- A `+` popover as a scheduling entry. Long-press on send stays the only one
- New entry points for editing an earlier message
