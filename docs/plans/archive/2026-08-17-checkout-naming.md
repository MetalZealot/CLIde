# Naming checkouts by place and state

- Status: not started
- Next: Phase 1 — one label helper returning a place/state pair instead of a
  single string.
- Context: [repository-grouped checkouts](../decisions/0016-repository-grouped-checkouts.md),
  [discovered-checkout selection](../decisions/0035-discovered-checkout-selection-registers-first.md)

## Why

Git names a checkout by **place**, and treats the branch as **state** the place
currently holds. `git worktree list` prints the path first with the branch in
brackets; the directory is the "working tree", the branch is a ref it points at.
Editors agree by splitting the two: VS Code puts the folder in the title bar and
the branch in the status bar, JetBrains the same. Neither invents a worktree
browser, because the folder already is the unit.

CLIde's new-session picker shows state only. `getLauncherCheckoutLabel`
(`src/components/chat/utils/newSessionLauncher.ts`) labels every non-main
checkout with its branch and drops the path. That reads fine while you think in
branches — and breaks the moment you are hunting for the *worktree*, because the
thing you are looking for is not on screen under any name. On 2026-08-17 that
cost Grayson a long search for `cloudcli-wt-usage-dashboard`, which was present
the whole time, listed as `feature/stats`.

The list also mixes two naming schemes: the main checkout is named by role
("Main"), its siblings by branch, so rows that are the same kind of thing do not
read like it.

The branch is not a wrong label — one branch can be checked out in exactly one
worktree, so it is a unique key. It is an incomplete one. Show both, place
first in meaning if not in pixels, and the picker answers "which folder is
this?" without opening a session.

## Phases

- [ ] **1. One label helper, returning a pair.** Replace
      `getLauncherCheckoutLabel`'s single string with `{ state, place }` — branch
      or "Main" as state, the folder basename as place — and derive every caller
      from it. Keep the discovered/not-added flag orthogonal to both. Unit-cover
      the main checkout, a worktree whose folder and branch differ, a detached
      HEAD, and a non-repository project.
- [ ] **2. The launcher.** Two-line menu rows: state on top, place beneath in
      muted text. The collapsed trigger stays one line for width, but carries
      both in its `title` and accessible name. Name the main checkout the same
      way its siblings are named, so the scheme stops changing halfway down the
      list.
- [ ] **3. The other checkout-naming surfaces.** `SidebarRepositoryItem`,
      `SidebarSessionViewMenu` and `WorktreeManagerModal` each call
      `getCheckoutRefLabel` directly. Audit what each has room for and apply the
      same pair where it fits; where it does not, make the one shown value the
      place, not the state. The chat header subtitle already shows the folder —
      leave it, and check it now agrees with the picker rather than contradicting
      it.
- [ ] **4. Locales, tests and a live pass.** Keys in every locale for any new
      copy. Then on the installed PWA: find a worktree by its folder name, on a
      phone-width viewport, with two worktrees whose branch names share a prefix.
- [ ] **5. ADR.** Record the accepted convention — place and state are both
      shown, place identifies — so the next surface that names a checkout does
      not have to re-derive it.

## Done when

- Every row of the new-session picker names the directory it will run in.
- A worktree can be found by the name it has on disk, without opening a session
  or the worktree manager.
- The main checkout and its worktrees read as one list of one kind of thing.
- No surface shows a branch where the user needs a place, or a place where the
  branch is the fact that matters.

## Not doing

Full paths in the UI — basenames only; `~/Projects/` on every row is noise.
Renaming worktree folders, a worktree browser, changes to how sessions are
grouped under a repository, and anything touching the Source Control branch
switcher, which performs real checkouts and is a different surface with its own
[plan](source-control-truthfulness.md).
