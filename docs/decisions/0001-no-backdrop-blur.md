# 0001 — No backdrop-filter blur / glassmorphism

- Date: 2026-07-17
- Status: Accepted

## Decision

The UI does not use CSS `backdrop-filter` blur anywhere. Overlays, scrims, and
floating surfaces use plain semi-transparent backgrounds instead (e.g.
`bg-black/50`).

## Rejected

Glassmorphism / frosted-glass styling on modals, sheets, and the sidebar —
present in upstream and in earlier versions of this fork.

## Why

`backdrop-filter` is expensive on mobile GPUs. On the primary test device
(Samsung Galaxy S20, installed PWA) it caused visible flicker during drag
interactions and general jank on overlay open/close. Removed app-wide in
`8a432fa`; the flat scrim look is also a deliberate aesthetic preference for
this fork. Don't reintroduce it when porting upstream UI that uses it.
