# 0023 — On `/compact`'s duplicate transcript row, the wrapper is dropped, not the prompt

- Date: 2026-07-30
- Status: Accepted

## Decision

Claude writes `/compact` to the transcript twice: the user's real prompt row
(the rewind anchor) and, ~50ms later, the `<command-name>` wrapper row that
every local command uses to survive the harness's hidden-row filter. Both
normalized into identical chat bubbles. The fix keeps the plain prompt row and
drops the wrapper — a general "an identical non-wrapper user row already said
this within the last minute" rule in `fetchHistory`, not a `/compact` special
case — so `/model`, `/plugin`, `/agents`, `/config`, which write *only* the
wrapper, are untouched.

## Rejected

Keeping the wrapper and dropping the prompt row instead. It reads as the more
"authoritative" row (it's the one carrying `commandName`/`commandArgs`), but
`MessageComponent.tsx` suppresses the edit/rewind affordance on
`isLocalCommand` rows — so that choice would have silently made `/compact`
un-rewindable while looking, in the diff, like a content-preserving dedupe.

## Why

Measured across every transcript on the Pi: 18/18 `/compact` invocations
produced the duplicate pair; 0/31 other local commands did. The wrapper only
exists so commands with no plain prompt row (`/model` et al.) don't vanish
from history — `/compact` doesn't need that, since it already has one. Keeping
the prompt row preserves rewind; a content/time match against a general
"recent identical user text" rule (not a hardcoded `/compact` check) means any
future command that duplicates the same way is covered for free, and the
existing single-wrapper commands can't regress since they have no earlier row
to match against.
