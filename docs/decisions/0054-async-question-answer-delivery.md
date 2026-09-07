# 0054 — Async question answers steer now or queue separately

- Date: 2026-09-07
- Status: Accepted

## Decision

CLIde presents each asynchronous structured question in an editor above the composer, with the first suggestion selected, an Other field, and the ordinary composer draft left untouched.
Send now appends the framed answer to the active turn when the runtime supports steering, or starts the next turn when the session is idle.
Queue persists answers in a separate FIFO and releases one per idle turn, after any ordinary composer draft.

## Rejected

The transcript card is not the editor, and the existing single composer queue does not own asynchronous-question answers.

## Why

OpenAI's asynchronous question flow continues the current turn and returns accepted answers as ordinary user input, while a durable handled ledger prevents answered questions reopening after reconnect or reload.
