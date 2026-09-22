# 0060 — A call's detail opens flat, in place, on every screen

- Date: 2026-09-22
- Status: Accepted; supersedes 0046 and 0059 on where raw detail opens

## Decision

Tapping an operation row opens that call's full input and output directly
under it, in the chat, on every screen: one flat panel with no header, badge,
coloured strip or second disclosure. Long lines wrap; nothing scrolls
sideways. Blocks stop at 12 lines behind "Show all". The old tool card and the
full-screen code-editor overlay are not used inside an activity.

## Rejected

Full screen on phones (0046, kept by 0059), and a panel that scrolls sideways.

## Why

0046's defect was code squeezed to about 200px by nested cards; one flat panel
at the list's indent gets about 355px on a 412px phone, so wrapping reads like
a phone terminal rather than a broken layout. Reusing the old card made each
call a second disclosure inside a first, which Grayson rejected on the phone,
and the Claude app shows a call's detail inline as one box.
