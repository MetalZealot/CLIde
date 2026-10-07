# 0071 — The sidebar is a rail of views over one project-scoped list

- Date: 2026-10-07
- Status: Accepted

## Decision

The sidebar has two controls for two questions: an icon rail picks the kind of
list (Sessions, Scheduled, Board), and one project picker picks the scope every
view shows — All projects, a project, or one of its worktrees. Sessions is a
single flat list with no repository rows; pinned sessions lead it under a
Pinned heading. The scope, view and sort are one per-device state, restored on
reload. Archive is a Show archived toggle in the view's sort menu, not a
destination. [The sidebar design](../designs/sidebar-rail.md) holds the rest.

## Rejected

ADR 0038's split, where Sessions is the cross-project list and choosing a
project or worktree belongs to Projects: it made scope a property of a
repository row, so the same question had two places to answer it. Round 1 of
the 2026-10-07 probe — a project chip row, status dots, stars and a segmented
view switch — read as a control panel rather than a list. Tabs in the header
and the bottom nav were rejected because neither has room for a fourth view.

## Why

Grayson opens sessions, not projects, and the rail grows one icon per view
without touching the rest. A Pinned heading over a flat list does not repeat
ADR 0036's problem, which was the same row shown twice in two sections; here
the pinned row moves rather than copies. This supersedes ADR 0038, ADR 0029
(per-row views go with the rows) and ADR 0036's repository-row pins.
