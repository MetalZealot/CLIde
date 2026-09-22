# 0059 — An activity's operation list expands inline on every screen

- Date: 2026-09-21
- Status: Accepted; supersedes 0046's mobile bottom sheet

## Decision

An activity's operation rows expand inline in the chat on mobile, as on
desktop; there is no bottom sheet. Raw detail still never renders in the chat:
on mobile it opens the full-screen code-editor overlay, as
[ADR 0046](0046-tool-detail-leaves-the-chat-column.md) decided.

## Rejected

A bottom sheet with a grabber and detents holding the operation list on mobile.

## Why

0046's defect was code scrolling sideways inside nested containers, and
one-line, truncated operation rows never scroll sideways, so inline rows cannot
reproduce it. The Claude app, the Codex app, Cursor and T3 Code all expand
activities inline (screenshots, 2026-09-21, all desktop). With raw output
already full-screen, a sheet would be a third surface for the same content and
the largest unbuilt component in the plan. Revisit only if a long burst fails
on a real phone.
