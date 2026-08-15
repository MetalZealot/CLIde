# 0037 — The sidebar view menu owns Archive and global list controls

- Date: 2026-08-14
- Status: Accepted

## Decision

Projects, Sessions, and Archive are destinations in one view menu; a contextual Filter control sorts Projects or sorts and filters the flat Sessions list.
Repository menus retain separate session options that affect only their own rows, and project sorting no longer lives in Settings.

## Rejected

A permanent Archive button and duplicate project-sort controls were rejected because both made navigation or state ownership ambiguous.

## Why

The control beside Search now changes the list currently in view, while Archive remains reachable without occupying a second permanent action.
