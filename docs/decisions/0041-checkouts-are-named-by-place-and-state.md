# 0041 — A checkout is named by its folder, with its branch as state

- Date: 2026-08-17
- Status: Accepted

## Decision

Every surface that names a checkout draws both names from `getCheckoutLabel`:
the **place** (the directory basename of `fullPath`, never `displayName`) and
the **state** (the branch, or `detached @ sha`). Lists show both — state on
top, place muted beneath — and the main checkout is one more row in that list,
marked by a `main` chip rather than named by its role. A surface with room for
one value shows whichever answers its own question and carries the other in
`title` and the accessible name, so neither is ever absent: the collapsed
launcher trigger shows the branch, a session row's badge shows the folder, and
sorting by worktree orders by the folder the rows display.

## Rejected

Naming worktrees by branch alone, which is unique but unsearchable — you cannot
find a folder by a name never shown. Full paths, which put `~/Projects/` on
every row.

## Why

Git names a checkout by place and treats the branch as state that place holds;
`git worktree list` prints the path first, and VS Code and JetBrains split the
two the same way. Showing state alone cost the maintainer a long hunt for
`cloudcli-wt-usage-dashboard`, on screen the whole time as `feature/stats`.
Deriving place from the directory rather than `displayName` means renaming a
project in CLIde cannot leave its folder unfindable under any name shown. ADR
0016 still governs the icons: a checkout and a branch never share one.
