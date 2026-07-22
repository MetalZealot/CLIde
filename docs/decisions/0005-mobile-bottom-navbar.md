# 0005 — Mobile bottom navbar, restored as in-flow layout (intentional divergence from upstream #632)

- Date: 2026-07-22
- Status: Accepted

## Decision

Mobile navigation moves to a bottom navbar (Chat / Files / Git / plugins),
replacing the top tab strip. This deliberately re-adds a pattern upstream
removed in `a8dab0e` (PR #632, April 2026) — but with the implementation flaw
that killed it fixed: the navbar is the **last row of the app's normal flex
column**, never `position: fixed` floating over content, so no view needs
compensating bottom padding. Height is kept compact (icon-only) so the composer
doesn't ride too high; the navbar slides away when the composer is focused
(keyboard open). Desktop keeps its existing navigation — this is
mobile-breakpoint only. Design mockup: `CLIde UI.svg` (repo root, untracked).

## Rejected

- **Upstream's current model (top tabs + sidebar/menu-driven nav)** — the top
  bar is out of thumb reach on a phone, and plugin tab buttons cramp the
  session title (long-standing TODO item). Both problems are structural to
  top placement.
- **Upstream's original implementation** (`git show a8dab0e^:src/components/app/MobileNav.tsx`)
  — `fixed bottom-0 z-50`, which forced `pb-mobile-nav` compensation padding
  into git-panel views, quick settings, sidebar footer, and terminal
  shortcuts. That maintenance tax, not the pattern, is what PR #632 cites for
  removal ("dual nav paradigms" + dead bottom padding). Its feature set
  (plugin "More" overflow, hide-on-input-focus, safe-area padding) is still a
  useful reference to mine.

## Why

Reaching to the top of the screen for every tab switch is the worst part of
the current mobile UX, and the header title gets cramped whenever plugins add
buttons. Upstream's own PR body confirms the removal was about implementation
cost and nav duplication — not user testing of the pattern — so the fix is to
keep the pattern and remove the cost (in-flow layout = zero compensation
padding anywhere). Known cost accepted: permanent divergence near
`AppContent.tsx`, so every upstream rebase around their removal commit may
conflict there.
