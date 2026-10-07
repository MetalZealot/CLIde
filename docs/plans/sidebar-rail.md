# The sidebar becomes a rail of views over one project-scoped list

- Status: not started
- Next: Phase 0 — Grayson reads the design and marks it agreed
- Context: [ADR 0071](../decisions/0071-sidebar-is-a-rail-of-views-over-one-scoped-list.md),
  [design system](../design-system.md), [testing](../testing.md)
- Design: [sidebar rail](../designs/sidebar-rail.md) — binds every phase; it
  changes only with Grayson

Each phase leaves a working sidebar. Visible phases end with a check on the
S20 against 3001.

## Phases

- [ ] 0. **The design is agreed — S.** Grayson reads it against the probe and
  sets its Status to agreed, or says what differs.
- [ ] 1. **One paged, scoped session list on the server — M.**
  - A typed request and response in the shared types: scope (project, checkout,
    No project), sort (activity or name), archived flag, name query, cursor.
    Order: pinned, last activity, `session_id`.
  - The run registry's `session_upserted` carries the session's `isStarred`.
  - Cases added to the existing projects and websocket test files, including a
    starred session arriving through each live path.
  - Measure the query and its first page on the Pi with today's 452 rows and a
    synthetic 5,000; write the budget into the design's Speed goal with Grayson.
- [ ] 2. **The flat list replaces the browse modes — L.**
  - The scope store: view, scope, per-view sort, Show archived and Show paused,
    saved per device; a stale project falls back to All projects; opening a
    session from a notification or link moves the scope to it.
  - Header with the view name, Search and Sort; search as a header field; the
    picker row and menu (projects, checkouts, No project, Manage projects).
  - Session rows with the second-line rules; Pinned and Recent headings; paging
    on scroll; the empty state names the scope; a failed page shows a retry row.
  - Removed in the same change: the browse menu and its stored mode, repository
    rows and Show all, `SidebarSessionViewMenu`, the Archive mode and its list,
    the Project sort.
  - You: pick CLIde, then one worktree, and see only its sessions; turn on Show
    archived and see archived rows dimmed in place.
- [ ] 3. **The rail and the round button, on both breakpoints — M.**
  - The rail: logo, Sessions and Scheduled, foot icons for restart, update,
    Usage and the avatar; dots per the design's rules.
  - Scheduled lists today's one-off scheduled messages within the scope.
  - The round button follows the view and presets the launcher to the scope
    instead of clearing it.
  - Desktop: the rail replaces `SidebarCollapsed`; collapse hides the panel and
    moves to the rail's foot; the header loses New Session.
  - Removed: the footer row and banners, the mobile close button.
  - You: swipe the sidebar open, tap Scheduled, and see a scheduled message;
    the round button reads as a new session in the scoped project.
- [ ] 4. **The project sheet and Settings › Projects — L.**
  - The sheet with every action in the design, from ⋯ and long-press in the
    picker; Pin to top uses the existing project-star API.
  - The Worktrees page: checkouts with today's actions, Add for discovered
    worktrees, New worktree; the launcher's New Worktree opens it.
  - Settings › Projects in place of Projects & Git: worktree display, the
    project list under the manager-panel rule with Select mode, Add project,
    archived projects with Restore, Git identity.
  - Removed: `WorktreeManagerModal` and the list's New Project row.
  - You: long-press CLIde in the picker, rename it, change its colour, and see
    both in the picker; restore an archived project from Settings.
- [ ] 5. **Close-out — S.**
  - The fifteen-control target audit from the backlog, run on the new controls.
  - What became true moves to `ARCHITECTURE.md` and the reference docs; this
    plan and its design are deleted.

Board joins the rail through [the project-board plan](markdown-project-board.md)'s
phase 3, and tasks fill Scheduled through
[the scheduled-tasks plan](scheduled-tasks.md)'s phase 5. Both build to the
design; neither blocks this plan.

## Done when

- No code path renders repository rows, the browse menu, the Archive mode, the
  footer row or `SidebarCollapsed`.
- Under All projects, the list shows every non-archived session in activity
  order, including ones older than the first page.
- A session pinned before a live update is still pinned after it, on both live
  paths.
- The scope, view and sort survive a reload on the phone.
- Every project action in today's repository menu is reachable from the project
  sheet, and every archived project from Settings › Projects.

## Not doing

- Everything in the design's Not doing list.
