# Send a queued message into the running turn

- Status: 1/4
- Next: phase 3 — send now on both providers on branch-test slot A, then on the phone
- Context: the queued row belongs to [the edit model](message-edit-model.md);
  Codex already steers its question answers through `chat.steer`
  (`handleChatSteer`, `steer()` on the runtime interface); provider parity rules
  in [the provider maps](../maps/README.md)

A message typed while a reply runs is queued and goes when the turn ends. *Send
now* delivers it into the turn instead: the agent reads it after the tool call in
flight finishes and can change course without stopping. Enter keeps queueing, so
nothing about today's queue changes unless the button is used.

## What each provider has

- **Codex**: `turn/steer` accepts ordinary user input into the active turn, and the
  whole backend path is live, but only question answers use it. Free-form text
  through it is untested.
- **Claude**: the SDK can take more input (`streamInput`), but the adapter sends a
  string prompt, which the SDK treats as a single turn and closes stdin on the
  first result. `streamInput` also closes stdin once its own iterable ends, so it
  cannot be called once per message. Steering needs the adapter to own an input
  stream that stays open until the turn's result.
- **Cursor, OpenCode**: no steering; the capability stays off and the button
  never shows.

## Phases

- [x] 0. Probed against the real SDK 2026-09-28: text written during a tool call
      is read in the same turn, one result, and the transcript stores it as a
      `queued_command` attachment, not a user row. Text written while the final
      reply streams runs as a second turn in the same run, even with input closed
      at the first result — never lost. So the cut-off is the first result
- [~] 1. The queued row offers *Send now* beside *Edit* and *Delete* while a reply
      runs and the provider reports steering. Accepted, the message leaves the
      queue and appears in the thread; refused, it stays queued with a one-line
      reason and still sends when the turn ends. Text only — a queued message
      with attachments shows no *Send now*. An unconfirmed send returns the text
      to the input, never the queue, so it cannot go twice. Built, tests pass
- [~] 2. The Claude adapter runs every turn on an input stream it owns, closed on
      the turn's first result; `steer()` writes into it until then, Claude reports
      steering, and history reads `queued_command` rows as user messages. Built,
      tests pass
- [ ] 3. Both providers verified live on a branch-test slot, and accepted on the
      phone

## Done when

- While Claude or Codex is running tools, *Send now* puts the queued message in
  the thread and the agent answers it within the same turn
- A refused *Send now* leaves the message queued, and it sends when the turn ends
- A Claude turn where nothing was sent now ends exactly as before
- Cursor and OpenCode show no *Send now*

## Not doing

- Changing Enter: it still queues
- Attachments mid-turn
- A send-now key in the Shell view's toolbar (Claude Code's own `Ctrl+X Ctrl+S`)
