# 0032 — The composer ring owns a summary-first usage popover

- Date: 2026-08-09
- Status: Accepted
- Supersedes [0015 — The composer ring opens `/context`; `/cost` became `/usage`](0015-ring-opens-context-and-usage-rename.md)

## Decision

The composer ring opens one compact summary containing the current session headline, provider-reported plan windows, and credits or balance. Claude's category breakdown and Codex's account activity drill into that popover in place; `/context`, `/usage`, the hidden `/cost` alias, and the near-compaction warning route to the appropriate view of the same surface.

## Rejected

Keeping separate Context and Usage modal implementations, or stacking Claude's full itemized breakdown above plan limits in one long mobile view.

## Why

The summary-first layout was accepted live, keeps Codex's real session usage visible without inventing a breakdown, and removes parallel presentation state that had already diverged.
