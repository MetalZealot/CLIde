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
- [0004 — TODO.md is tracked in-repo, at the repo root](0004-todo-md-tracked-at-root.md) *(location superseded by 0027)*
- [0005 — Mobile bottom navbar, restored as in-flow layout](0005-mobile-bottom-navbar.md)
- [0006 — WS liveness is client-driven via app-level ping, not protocol ping](0006-app-level-ws-liveness.md)
- [0007 — Rewind is in-place tree-append; history must be branch-filtered](0007-rewind-in-place-tree-append.md)
- [0008 — Superseded provider ids are tombstoned, not deleted](0008-superseded-provider-id-tombstones.md)
- [0009 — Long-press menus: one shared overlay, and touch belongs to `useLongPress`](0009-context-menu-overlay-touch-ownership.md)
- [0010 — Viewport-positioned overlays set inset inline, never via `inset-0`](0010-pwa-mode-fixed-inset-override.md)
- [0011 — Codex App Server is the opt-in interactive Chat transport](0011-codex-app-server-chat-transport.md) *(superseded by 0034)*
- [0012 — Codex rewind replaces a stable session; fork creates another](0012-codex-rewind-and-fork-session-identity.md)
- [0013 — Abort is signal-first; the provider id is only the graceful tier](0013-abort-is-signal-first-not-provider-id-keyed.md)
- [0014 — The context ring's ceiling is read from the SDK, not derived](0014-context-ceiling-from-sdk.md)
- [0015 — The composer ring opens `/context`; `/cost` became `/usage`](0015-ring-opens-context-and-usage-rename.md) *(superseded by 0032)*
- [0016 — Projects group checkouts by repository; a project is not a directory](0016-repository-grouped-checkouts.md)
- [0017 — A batch move preflights everything, then rolls back in reverse](0017-batch-move-preflight-then-rollback.md)
- [0018 — Settings navigates by a history-backed drill-down stack, and each screen owns exactly one scroll container](0018-settings-drill-down-one-scroll-container.md) *(superseded by 0040)*
- [0019 — QuickSettings panel removed; no second settings surface](0019-quicksettings-removal.md)
- [0020 — The one-scroll-container rule has no exceptions; Plugins never needed one](0020-no-plugin-exception-to-one-scroll-container.md)
- [0021 — Save confirmation is local to the action, and only where an action can fail](0021-local-save-confirmation-no-global-indicator.md)
- [0022 — The Settings search index is declared data, not screen registration](0022-settings-search-index-is-data.md)
- [0023 — On `/compact`'s duplicate transcript row, the wrapper is dropped, not the prompt](0023-compact-echo-drops-wrapper-keeps-prompt.md)
- [0024 — Token rotation does not restart auth bootstrap](0024-token-rotation-does-not-restart-auth-bootstrap.md)
- [0025 — Per-session model picks live in the sessions table, behind transcript truth](0025-session-model-picks-live-in-the-database.md)
- [0026 — Android's file chooser can't be shaped from the web; the composer keeps one plain input](0026-attachment-menu-accept-ceiling.md)
- [0027 — The backlog lives at `docs/TODO.md`](0027-todo-md-lives-in-docs.md)
- [0028 — Creating a worktree ships ahead of ADR 0016's Phase 0; removing one does not](0028-worktree-creation-precedes-phase-0.md) *(narrows 0016's sequencing)*
- [0029 — A repository row's session view is per row, in memory, and loads before it filters](0029-per-row-session-views-load-before-they-filter.md) *(pinned-session consequence superseded by 0036)*
- [0030 — Sidebar activity is a section; search is persistent and Archive is in the footer](0030-sidebar-activity-persistent-search-footer-archive.md) *(superseded by 0036 and 0037)*
- [0031 — Selection follows the theme; sidebar status uses symbols](0031-theme-relative-selection-and-symbolic-sidebar-status.md)
- [0032 — The composer ring owns a summary-first usage popover](0032-summary-first-composer-usage-popover.md)
- [0033 — A worktree with no project row is listed, not registered](0033-discovered-checkouts-are-derived-not-stored.md)
- [0034 — Codex uses one explicitly approved native runtime](0034-codex-managed-native-runtime.md)
- [0035 — Discovered checkout selection registers first](0035-discovered-checkout-selection-registers-first.md)
- [0036 — Pins belong to session lists; activity belongs to status](0036-pins-belong-to-session-lists-activity-belongs-to-status.md)
- [0037 — The sidebar view menu owns Archive and global list controls](0037-sidebar-view-menu-owns-archive-and-global-list-controls.md)
- [0038 — The sidebar view menu owns Archive and global sorting](0038-global-sessions-menu-sorts-only.md)
- [0039 — Usage reset alerts follow provider timestamps without catch-up](0039-provider-reset-timestamps-no-catch-up.md)
- [0040 — Mobile Settings root owns the Back gesture](0040-settings-root-owns-back-gesture.md)
- [0041 — A checkout is named by its folder, with its branch as state](0041-checkouts-are-named-by-place-and-state.md)
- [0042 — Input type sets the row budget; hover is a reveal channel](0042-input-type-sets-the-sidebar-budget.md)
- [0043 — Reading size is content-scoped and device-local](0043-reading-size-is-content-scoped-and-device-local.md)
