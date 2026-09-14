# One edit model for queued, scheduled, and earlier messages

- Status: not started
- Next: Phase 0 — see where Codex, Claude Code, and Cursor put queued and steered messages
- Context: [Auto-Continue](auto-continue.md) puts its offer on the scheduled bubble
  this plan introduces; rewind semantics are ADRs 0012 and 0013

Three kinds of message can be edited in the composer: one sent while a run is busy
(queued), one set to send later (scheduled), and an earlier message being rewound.
They are one mechanic — a message in the conversation, loaded into the composer,
committed by sending — so they get one presentation. Only what sending does
differs.

## Today, read from source 2026-09-14

| | The original, while editing | Above the composer | Backing out |
|---|---|---|---|
| Queued | leaves the queue | nothing | leaves an ordinary draft |
| Scheduled | its stored row is deleted | "Editing — still sends…" | only *Send normally*, which drops the schedule |
| Earlier | stays, with an amber ring | "Editing earlier message…" | × restores the draft typed before |
| Queued answer to a Codex question | — | its own card, "1 answer queued for the next turn" | remove only |

Rewind's model is the right one. Its banner repeats what the ring already shows.
A Codex question also stays above the composer, and rightly: like a permission
request it asks something, it is not a message waiting to go. Answering with
*Send now* while a run is going steers it and lands in the thread at once; *Queue*
adds a second, separate queue beside the composer's own.

## The model

- **A scheduled message lives in the conversation**, as a dimmed bubble at the end
  of the thread saying when it goes — "at 3:40 PM", "when usage resets". Google
  Messages is the reference; the agent tools have no scheduling to follow.
- **Queued messages have one presentation**, whether typed into the composer or
  answering a Codex question. Where it sits follows the agent tools, settled in
  phase 0 — recalled, not checked, they keep a compact queue just above the input,
  which would put it there rather than in the thread.
- **Tapping an unsent message** offers *Send now*, *Edit*, and *Cancel*. Earlier
  messages keep the edit button they already have.
- **Editing leaves the original where it is, marked** with rewind's amber ring. An
  unsent one is held — kept, but not sendable — rather than removed, so it cannot
  go out mid-rewrite and does not vanish from view.
- **Its text loads into the composer**, and whatever was already typed is set aside.
- **Cancelling puts everything back**: the set-aside draft returns, and the
  original resumes exactly as it was — still queued, still scheduled. *Cancel edit*
  is on the marked bubble.
- **The send button shows what it will do**: an arrow when sending goes now, a
  clock when it re-arms a schedule. Held down, the arrow turns into the clock, so
  the long-press menu announces itself. Driven by `useLongPress`'s `isPressing`,
  never `:active`.
- **A rewind edit dims every message after the marked one**, since those leave the
  thread on send. The dimming replaces "Sending rewinds the conversation to this
  point".

Sending stays per kind: a queued edit re-queues, a scheduled edit re-arms the same
schedule, an earlier-message edit rewinds and continues from there.

## Phases

- [ ] 0. Where Codex, Claude Code, and Cursor show a queued message and a steered
      one is recorded from the tools themselves, and decides where CLIde's single
      queue sits
- [ ] 1. A scheduled message being edited is held, not deleted, and an abandoned
      edit leaves it scheduled. A held row is skipped by the dispatcher but still
      counted as waiting, so the Auto-Continue offer cannot reappear mid-edit
- [ ] 2. Scheduled messages render as bubbles at the end of the thread with their
      tap menu, and both queues merge into the one presentation phase 0 places;
      the scheduled, queued, and queued-answer cards are removed
- [ ] 3. Editing any of the three marks the original and restores the set-aside
      draft on cancel; the rewind and schedule banners are removed, and the send
      button shows its outcome and previews the long-press
- [ ] 4. A rewind edit dims the messages it will drop

## Done when

- Nothing above the composer reports a scheduled message or an edit
- A queued message looks the same whether it was typed or answers a Codex question
- Cancelling any edit restores the earlier draft and leaves the original unchanged
- A scheduled message cannot send while being edited, and is still scheduled after
  an abandoned edit
- A rewind edit visibly marks both the message and everything it will drop
- Holding the send button shows the clock before the menu opens

## Not doing

- A `+` popover as a scheduling entry. Long-press on send stays the only one
- New entry points for editing an earlier message
