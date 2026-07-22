# Decision log (ADRs)

Short records of non-obvious decisions in this fork: what we chose, what we
rejected, and why. The goal is to stop future work (or future contributors)
from re-trying dead ends or "fixing" things that are deliberate.

## Rules

- **Append-only.** ADRs record the past — never edit one to match new reality.
  If a decision changes, write a new ADR and set the old one's status to
  `Superseded by 000X`.
- **Write at decision time**, while the rationale is fresh — typically when a
  piece of work ends with "we tried X, it didn't work, we did Y."
- **Keep it short.** Five sentences is a fine ADR. The bar for writing one:
  the decision was non-obvious — alternatives were considered, or one was
  tried and backed out.

## Template

```markdown
# NNNN — Title

- Date: YYYY-MM-DD
- Status: Accepted | Superseded by NNNN

## Decision

What we chose, in a sentence or two.

## Rejected

What else was considered or tried.

## Why

The reasoning, including evidence (commits, testing, measurements).
```

## Index

- [0001 — No backdrop-filter blur / glassmorphism](0001-no-backdrop-blur.md)
- [0002 — PWA icons declare purpose "any" only, never "maskable"](0002-no-maskable-icon-purpose.md)
- [0003 — Active model is tracked per session; transcript is ground truth](0003-per-session-model-tracking.md)
