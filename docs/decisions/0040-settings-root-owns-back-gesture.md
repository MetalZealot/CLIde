# 0040 — Mobile Settings root owns the Back gesture

- Date: 2026-08-17
- Status: Accepted

## Decision

In mobile stack mode, opening Settings pushes one root history entry, then one
additional entry per drill-down screen. Back pops a drill-down screen first;
at the root it consumes the root entry and closes Settings, while the close
button unwinds every Settings-owned entry.

## Rejected

Leaving modal visibility outside browser history, as ADR 0018 specified.

## Why

Without a root entry, Android Back closes the installed PWA whenever Settings
is already at its root, making the gesture appear intermittent. Desktop pane
navigation remains outside browser history, and ADR 0018's stack and
one-scroll-container decisions remain unchanged.
