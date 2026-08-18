# Naming checkouts by place and state

- Status: complete
- Next: nothing. Merged to `main` 2026-08-17 and archived; [ADR 0041](../../decisions/0041-checkouts-are-named-by-place-and-state.md) is the authority.
- Context: [repository-grouped checkouts](../../decisions/0016-repository-grouped-checkouts.md),
  [discovered-checkout selection](../../decisions/0035-discovered-checkout-selection-registers-first.md)

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

- [x] **1. One label helper, returning a pair.** `getCheckoutLabel` in the
      sidebar utils returns `{ state, place, isMain }` — branch or `detached @
      sha` as state, the folder basename as place, never `displayName`.
      `getLauncherCheckoutLabel` is gone; the discovered/not-added flag stays
      orthogonal.
- [x] **2. The launcher.** Two-line menu rows, state over muted place; main
      carries a `main` chip instead of its own naming scheme. The collapsed
      trigger stays one line and carries both in `title` and `aria-label`.
- [x] **3. The other checkout-naming surfaces.** The session-menu worktree filter
      takes the launcher's two-line pair. The session-row badge — a fourth
      surface, unlisted here — now names the folder with a folder icon rather
      than the branch with a branch icon (ADR 0016: never the same icon as a
      branch), and the worktree sort orders by that same folder. The chat header
      subtitle reads `place · state` from the shared helper, so a rename cannot
      make it contradict the picker. The worktree manager and a single-checkout
      repository row already led with the place, and are unchanged.
- [~] **4. Locales, tests and a live pass.** No locale work was owed: the only
      string this plan adds is `worktrees.main`, a literal branch name that is
      itself in every language. `sidebar.json`'s `worktrees`, `sessionView`,
      `browseView` and `selection` blocks are absent from all nine non-`en`
      locales, but that gap predates this plan and is its own backlog item.
      Outstanding: on the installed PWA, find a worktree by its folder name, on
      a phone-width viewport, with two worktrees whose branch names share a
      prefix.
- [x] **5. ADR.** [0041](../../decisions/0041-checkouts-are-named-by-place-and-state.md).

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
