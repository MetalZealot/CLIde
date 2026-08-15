# 0038 — The sidebar view menu owns Archive and global sorting

- Date: 2026-08-14
- Status: Accepted

## Decision

Projects, Sessions, and Archive are destinations in one view menu; the contextual control sorts Projects or Sessions but does not filter the flat Sessions view by project or worktree.
Repository menus retain separate session sorting and filtering that affect only their own rows, and project sorting does not live in Settings.

## Rejected

A permanent Archive button, duplicate project-sort settings, and listing every project and worktree in the global menu were rejected because they duplicate navigation or make ownership ambiguous.

## Why

The control beside Search changes the list currently in view, while Archive remains reachable without occupying another permanent action.
Sessions is the cross-project view; choosing a project or worktree belongs in Projects, where each repository already owns that scope.
