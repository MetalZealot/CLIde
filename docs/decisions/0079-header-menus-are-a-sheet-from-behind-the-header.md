# 0079 — On phones, header menus are one sheet from behind the header

- Date: 2026-10-11
- Status: Accepted

## Decision

On phones the title menu and the usage ring open
one full-width sheet that slides out from behind the header, rounded at the
bottom, covering the plan bar; the header stays above it, so tapping the same
control closes it and tapping another swaps its contents. It closes on a drag
up, a tap outside, Escape or back, and an item's action runs once it has gone.
Wide screens keep the popovers.

## Why

Popovers changed size and position with their content; the maintainer chose
the attached variant (B, plan bar covered) on the header-sheet probe, and the
drag rules are BottomSheet's, mirrored.
