# Composer edits merge readiness

- Status: complete
- Next: None — live accepted for merge on 2026-08-09.
- Context: [code anchors](../../maps/code-anchors.md), [permission modes](../../maps/provider-permission-modes.md), [ADR 0032](../../decisions/0032-summary-first-composer-usage-popover.md)

## Phases

- [x] 1. Model selection fails visibly — `ComposerModelMenu` awaits selection, retains pending/error state, and covers rejection without undoing ADR 0003/0025 precedence.
- [x] 2. The usage-ring credit marker means credits remain — spend credits must be enabled and below their cap; an exhausted Claude cap is covered.
- [x] 3. The accepted summary-first usage popover has a durable decision — ADR 0032 supersedes ADR 0015 without rewriting its history.
- [x] 4. `/models` has one implementation — unreachable `CommandResultModal` model code and dead cache plumbing are gone; hard refresh now lives in `ComposerModelMenu`.
- [x] 5. Non-Claude `/context` has one data path — the unused server headline expansion is reverted, leaving the client token budget as the summary source.

## Done when

- No reviewed path can fail silently or display false credit availability.
- `/models`, `/usage`, and `/context` each have one reachable presentation path and no dead compatibility-free payload types.
- The decision index, living maps, and TODO describe the merged behavior without contradicting one another.
- Diff check, focused tests, full tests, typecheck, docs check, lint, and client/server builds pass.

## Not doing

- Production restart or installed-PWA production acceptance.
- The broader backend-owned desired/effective session-settings redesign.
