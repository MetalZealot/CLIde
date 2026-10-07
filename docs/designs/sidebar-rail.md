# Sidebar design: a rail of views over one project-scoped list

- Status: draft
- Plan: [Sidebar rail](../plans/sidebar-rail.md)
- Context: [ADR 0071](../decisions/0071-sidebar-is-a-rail-of-views-over-one-scoped-list.md)
  (supersedes 0029, 0038 and part of 0036); ADRs 0016, 0028, 0031, 0033, 0035,
  0040, 0041, 0044, 0055; [design system](../design-system.md);
  plans [scheduled tasks](../plans/scheduled-tasks.md),
  [project board](../plans/markdown-project-board.md),
  [threads with no project](../plans/no-project-threads.md),
  [environments](../plans/environments.md)

This design replaces the sidebar's repository rows, browse modes and footer with
an icon rail of views, one project picker that scopes every view, and a flat
session list. What stays: the session row's look and menu, the New Session
launcher, the session signals (running, needs you, unread, scheduled), the
mobile overlay and swipe, and the desktop resize handle. It binds every phase
of the plan and changes only with Grayson.

The visual reference is the round-2 probe Grayson accepted on 2026-10-07. It
lives outside the repository and holds real session titles, so **this document
is the spec**; where the two differ, this document wins and the difference is
raised with Grayson.

## Starting point (source, 2026-10-07)

- **Scope lives in two places.** A Projects / Sessions / Archive menu
  (`SidebarHeader`) switches modes, and each repository row has its own sort and
  worktree filter (`SidebarSessionViewMenu`, per-row and memory-only by ADR
  0029). ADR 0038 forbids listing projects or worktrees in the global menu.
- **No server list spans projects.** `GET /api/projects` returns 20 sessions per
  project (`DEFAULT_PROJECT_SESSIONS_PAGE_SIZE`); rows show 5 at a time
  (`SESSION_PAGE_SIZE`) behind "Show all". The flat Sessions mode is built in the
  browser from whatever pages happen to be loaded, and so is name search, so
  both silently miss older sessions. Measured: 452 session rows, 70 not
  archived.
- **A live update can unstar a session.** The run registry's `session_upserted`
  payload omits the session's `isStarred` (`broadcastCanonicalSessionUpsert`);
  the watcher's payload includes it. The client spreads the update over the old
  row, so a known session keeps its pin, but one it has never seen arrives
  unpinned.
- **Archive is a mode** (`searchMode === 'archived'`) with its own list grouped
  by project, built from two archived-only endpoints.
- **The footer** holds restart and update banners, the avatar (Settings), Usage,
  and on mobile the round New Session button, which clears the selected project
  before opening the launcher (`handleOpenNewSession`).
- **Desktop** has a separate 48px collapsed rail (`SidebarCollapsed`) and puts
  New Session and the collapse button in the header.
- **Project actions** sit in the repository row's menu: New Session, Rename,
  Customize colour, Sort and filter, Worktrees, Archive, Delete. Project starring
  has an API (`toggle-star`) and no UI. `WorktreeManagerModal` (1019 lines)
  creates worktrees, adds discovered ones, and archives or deletes what CLIde
  tracks; nothing runs `git worktree remove` or a merge.
- **Settings** has App › "Projects & Git", which holds only the global Git name
  and email. No screen lists projects.
- **Nothing in the sidebar shows scheduled work as a list.** One-off scheduled
  messages appear only as a clock symbol on their session row.

## Settled with Grayson

- 2026-10-07: round 1 (project chip row, status dots, stars, a segmented view
  switch, a wide New Session bar) rejected as incoherent. Nothing from it
  carries over.
- 2026-10-07: round 2 accepted as the goal: an icon rail, the existing picker
  row listing projects with worktrees beneath them, a sessions-only list, a
  round button that changes with the view, and Show archived in the sort menu.
- 2026-10-07: no close button on mobile (swipe closes); Search and Sort are
  icons at the header's right, so the picker has its own row.
- 2026-10-07: the expandable project groups go. The picker decides what is in
  view, so the sidebar stops feeling like a control dashboard.
- 2026-10-07: Scheduled and Board show every project under All projects and
  follow the picker. Board reads plans from the main checkout only; a blocker in
  another project stays visible; items with no project hide under a project
  scope, with a note saying so.
- 2026-10-07: project controls stay reachable: a project sheet from the picker,
  and a Settings › Projects screen.

## Design positions

- **Two axes, two controls.** The rail answers "what kind of list", the picker
  "which project". It rejects a chip row (round 1), header tabs (no room for a
  fourth view) and the bottom nav, which belongs to the open chat's workspace
  (ADRs 0048, 0057).
- **One scope for every view.** Picking a project scopes Sessions, Scheduled and
  Board alike, and switching views keeps it. One client store owns the view, the
  scope, each view's sort and the show-archived and show-paused toggles; it is
  saved per device and restored on reload. It is device state, not account
  state: the phone and the desktop may reasonably look at different projects.
  This replaces ADR 0029's memory-only per-row views.
- **Opening a session from outside the sidebar moves the scope to it.** A
  notification or link into a session in another project switches the picker to
  that project, because the sidebar must be able to show the selected row. Under
  All projects nothing changes.
- **Sessions only, no project rows.** The list never groups by project. The
  Project sort of today's Sessions mode goes too; the picker is the one project
  tool.
- **Pinned keeps a heading.** Pinned sessions lead under "Pinned", then
  "Recent" (or "A–Z" when sorted by name). ADR 0036 rejected a Pinned section
  because the same row appeared twice; here the row moves.
- **A row's second line earns its place.** Under All projects it names the
  project, plus the worktree folder when it is not the main checkout. Under one
  project it appears only for worktree sessions. Under one checkout it is absent.
  The provider logo leads the title; pin, status symbol and age trail (ADRs 0031,
  0044). The probe left out status symbols; they stay exactly as today.
- **Worktrees are worktrees.** The picker's second level is the project's
  checkouts, named by folder with the branch as state and the main checkout
  marked `main` (ADR 0041). "Environment" stays reserved for the environments
  plan (machines); when that lands it becomes an outer level of the same picker,
  not a new control.
- **The picker lists registered checkouts only.** A discovered worktree (ADR
  0033) holds no sessions, so as a filter it could only ever be empty. It
  appears in the project sheet's Worktrees page with Add, and stays in the New
  Session launcher as NOT ADDED (ADR 0035).
- **The round button is the current view's create action.** Sessions: New
  session, with the launcher preset to the picker's scope instead of cleared.
  Scheduled: New scheduled task. Board: Start a plan, which opens the launcher
  for the scoped project with the composer prefilled to draft a plan. A view
  without a create action yet falls back to New session.
- **Archive is a toggle.** Show archived puts archived sessions inline, dimmed,
  restorable from their menu. Archived projects leave the picker and come back
  from Settings › Projects. Most apps bury archive in Settings; a toggle on the
  list keeps it one tap from where you notice something missing.
- **Project controls live in one sheet.** It opens from a project's ⋯ in the
  picker, a long-press on the project in the picker, and its row in Settings ›
  Projects. Settings › Projects follows the manager-panel rule: a plain tap does
  nothing.
- **Desktop keeps the rail; collapse hides the panel.** The rail replaces
  `SidebarCollapsed`, so collapsed and expanded share one rail; the collapse
  button moves to the rail's foot, as in VS Code.
- **Rebuilt, not re-housed.** The sheet's Worktrees page, the picker and
  Settings › Projects are drawn new, in the sheet and settings styles. Data
  helpers and API calls are reused; old containers (`WorktreeManagerModal`,
  repository rows, the archive list) are not dropped in as "the level below".

## Target design

### Rail

A 56px column on the sidebar's left edge, full height. Top: the CLIde logo.
Then the views, in fixed order: Sessions, Scheduled, Board; a future view (pull
requests) is appended below them. Foot: restart-required and update icons when
they apply (replacing the footer banners), Usage, and the avatar, which opens
Settings; desktop adds the collapse toggle. The current view's icon sits on a
filled square with a short bar at the rail's edge.

A view's icon carries a dot only when something in it needs Grayson: Scheduled
when a task waits for approval or its last run failed; Sessions when a session
is blocked on a permission while another view is open. Board carries none,
because its Needs-you lane is never empty and a permanent dot means nothing.

A view joins the rail when it has real content: Sessions at once; Scheduled at
once, listing today's one-off scheduled messages until the scheduled-tasks plan
adds tasks; Board when the project-board plan's read-only panel ships.

### Header and search

The current view's name on the left; Search and Sort icons on the right. No
logo (it moved to the rail) and no close button on mobile. Search replaces the
header with a field and Cancel. It searches the current view within the current
scope; on Sessions it matches names on the server, so unloaded sessions count,
and keeps today's "search inside messages" toggle inside the field.

### Picker

Its own row beneath the header, styled like today's browse button (folder icon,
small uppercase label, chevron), allowed the full width. The folder icon takes
the scoped project's accent colour. The label reads ALL PROJECTS, the project,
or PROJECT · FOLDER.

The menu lists, in order: All projects; each project, pinned projects first,
then by last activity, each with a ⋯; beneath a project with more than one
checkout, its checkouts indented; "No project" when no-project threads exist;
then Manage projects, which opens Settings › Projects. Choosing a project shows
all its checkouts; choosing a checkout shows only that one. There are no counts
and no status marks in the menu. With "Each worktree separately" set in
Settings, every checkout is its own top-level entry instead.

### Sessions

One list, served by one paged query that takes the scope, sort and archived
flag and returns rows ordered pinned first, then last activity, then
`session_id`. More rows load as the list scrolls. A live update places a row
where a reload would. Run chats of scheduled tasks are not listed here; they
live under their task (scheduled-tasks plan).

### Scheduled and Board

They follow the picker and use the session row's anatomy: a leading mark, a
title, a trailing value, a second line only when it says something. Their
content, actions and storage belong to their plans; this design fixes placement,
row shape, scope behaviour, sort options and the round button.

- **Scheduled** groups Needs you (approval waiting, last run failed), Upcoming,
  Paused. The trailing value is the next run. A task opens its sheet.
- **Board** groups by lane under headings: Needs you, Active, Blocked, Ready.
  No filter chips; this supersedes the chips of the board plan's phase-1 layout
  for this surface. The leading mark is a progress ring, the trailing value
  `done/total`. A blocker in another project shows as "Blocked by Project ›
  Plan"; the blocking side shows "Blocks 1 in Project". Plans come from the main
  checkout; scoped to a worktree, a one-line note says so and the plans still
  show.
- Under a project scope, items with no project are hidden and a note counts
  them, with a link to All projects.

### Sort menu

A small menu from the header's Sort icon, per view. Sessions: Last activity or
Name; Show archived. Scheduled: Next run or Name; Show paused. Board: By lane or
By progress.

### Project sheet

A bottom sheet on mobile, an anchored popover on desktop. Header: name and
path. Then:

- New session here
- Rename (inline)
- Pin to top of picker (the existing `toggle-star` API)
- Colour (today's accent choices)
- Icon, when the custom-icon backlog item ships
- Worktrees › — a second page: each checkout (folder, branch, `main` mark) with
  today's actions (open, Source Control, rename, archive, delete), discovered
  worktrees with Add, and New worktree (branch name, start from). The launcher's
  New Worktree opens this same page.
- Archive (no confirmation, restorable, as today)
- Delete… — today's choice of archive or delete all CLIde data; the folder on
  disk is never touched.

### Settings › Projects

Replaces App › "Projects & Git", in the same place in the registry:

- **Worktrees in the picker**: under their project, or each separately.
- **Projects**: every project, with path and checkout count. A tap does
  nothing; ⋯ and long-press open the project sheet; Select mode archives or
  deletes several.
- **Add project**: the existing creation wizard (path or clone).
- **Archived projects**, with Restore.
- **Git identity**: today's name and email.

### Desktop

The rail stays at the sidebar's left; the panel beside it keeps today's
resizable width. Collapsing hides the panel and leaves the rail, which then also
shows New session under the views. The round button replaces the header's New
Session button, so both breakpoints have one create action in one place.
Hover, focus and pointer sizes follow ADRs 0044 and 0055.

### Empty, loading and failure

- An empty list names its scope: "No sessions in oney-index yet."
- A failed page keeps the rows already shown and adds a retry row at the end.
- A scope whose project was archived or removed falls back to All projects.
- Rename, colour, pin and archive stay optimistic with rollback, as today.

## Quality goals

- **Contract.** The paged list is one typed request and response in the shared
  types, used by the server and the client.
- **Capabilities.** Nothing in the sidebar branches on provider; rows show each
  provider's logo. Scheduled lists only providers that declare they can run
  tasks.
- **One owner per state.** The session list is server truth; the scope is the
  client store; signals keep their current sources. The run registry's upsert
  gains `isStarred`, so both live paths match the fetch.
- **Lifecycle.** A reconnect or `projects_changed` refetches the first page of
  the current scope; deeper pages reload as needed.
- **Live equals reload.** The list's order key is the same on both paths.
- **Speed.** The plan's first phase measures the paged query and first render
  on the Pi and records the budget it must keep.
- **Phone first.** Mobile is designed first; targets keep the 44px floor of ADR
  0055; the round button stays in the thumb zone.
- **Builds itself.** Each phase leaves a working sidebar; the old one stays
  until the new list replaces it in a single switch.
- **Testing.** New cases go into the existing sidebar and grouping test files,
  and the server's projects tests, not new files.
- **Memory.** No new process or poller; paging keeps the client from holding
  every row.
- **Trust.** The list endpoint sits behind the same authentication as
  `/api/projects`. **Seeing what happened**: nothing new; it is a plain read.
- **Product bar.** The rail is the pattern of Discord's mobile drawer, Codex
  and VS Code; flat recents with a scope picker is T3 Code's.

Pre-mortem — it failed in six months, because:

- **"My sessions vanished."** The scope was left on one project. Answered by
  the always-visible picker label, the empty state naming the scope, and the
  stale-scope fallback (plan phase 2).
- **The old sidebar survived inside the new one.** Each phase removes what it
  replaces, and the plan's Done when checks that nothing renders the old parts.
- **Desktop rotted.** Phase 3 builds both breakpoints and checks both.
- **The list slowed at scale.** Phase 1 sets a budget at 5,000 rows.
- **Scheduled and Board grew their own styles.** Their plans link here, and
  their rows share the session row's anatomy.

## What goes

- The Projects / Sessions / Archive menu and its stored mode.
- Repository rows, their expand state, 5-row slicing and Show all.
- The per-row sort and worktree filter (`SidebarSessionViewMenu`).
- The Archive mode and its grouped list.
- The footer row and its banners; the mobile close button; the desktop header's
  New Session and collapse buttons.
- `SidebarCollapsed`, replaced by the rail.
- The "New Project" row at the end of the list (Add project moves to Settings ›
  Projects; the launcher keeps New Project…).
- `WorktreeManagerModal`, once the sheet's Worktrees page and the launcher cover
  it.
- The Project sort in Sessions, and the "sorting" keywords on the old Projects &
  Git screen.

## What Grayson gives up

- A view of every project at once with its session counts; the picker is now
  the only project list.
- Two projects' sessions side by side in labelled groups.
- Per-project sort settings.
- One extra tap to change project.
- 56px of list width on the phone, about 14% of the S20's 412px (width
  derived from a screenshot with a recalled pixel ratio, not measured).

## Not doing

- The content of Scheduled tasks and the Board beyond rows and placement; their
  plans own them.
- A pull-request view; the rail only leaves room for one.
- Machines as a picker level; the environments plan decides that.
- Changes to the bottom nav, the session row menu or the New Session launcher
  beyond presetting its scope.
- Running `git worktree remove` or merges from the Worktrees page.
