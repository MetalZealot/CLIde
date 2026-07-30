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
- [0004 — TODO.md is tracked in-repo, at the repo root](0004-todo-md-tracked-at-root.md)
- [0005 — Mobile bottom navbar, restored as in-flow layout](0005-mobile-bottom-navbar.md)
- [0006 — WS liveness is client-driven via app-level ping, not protocol ping](0006-app-level-ws-liveness.md)
- [0007 — Rewind is in-place tree-append; history must be branch-filtered](0007-rewind-in-place-tree-append.md)
- [0008 — Superseded provider ids are tombstoned, not deleted](0008-superseded-provider-id-tombstones.md)
- [0009 — Long-press menus: one shared overlay, and touch belongs to `useLongPress`](0009-context-menu-overlay-touch-ownership.md)
- [0010 — Viewport-positioned overlays set inset inline, never via `inset-0`](0010-pwa-mode-fixed-inset-override.md)
- [0011 — Codex App Server is the opt-in interactive Chat transport](0011-codex-app-server-chat-transport.md)
- [0012 — Codex rewind replaces a stable session; fork creates another](0012-codex-rewind-and-fork-session-identity.md)
- [0013 — Abort is signal-first; the provider id is only the graceful tier](0013-abort-is-signal-first-not-provider-id-keyed.md)
- [0014 — The context ring's ceiling is read from the SDK, not derived](0014-context-ceiling-from-sdk.md)
- [0015 — The composer ring opens `/context`; `/cost` became `/usage`](0015-ring-opens-context-and-usage-rename.md)
- [0016 — Projects group checkouts by repository; a project is not a directory](0016-repository-grouped-checkouts.md)
- [0017 — A batch move preflights everything, then rolls back in reverse](0017-batch-move-preflight-then-rollback.md)
- [0018 — Settings navigates by a history-backed drill-down stack, and each screen owns exactly one scroll container](0018-settings-drill-down-one-scroll-container.md)
- [0019 — QuickSettings panel removed; no second settings surface](0019-quicksettings-removal.md)
- [0020 — The one-scroll-container rule has no exceptions; Plugins never needed one](0020-no-plugin-exception-to-one-scroll-container.md)
- [0021 — Save confirmation is local to the action, and only where an action can fail](0021-local-save-confirmation-no-global-indicator.md)
- [0022 — The Settings search index is declared data, not screen registration](0022-settings-search-index-is-data.md)
- [0023 — On `/compact`'s duplicate transcript row, the wrapper is dropped, not the prompt](0023-compact-echo-drops-wrapper-keeps-prompt.md)
