# Sidebar surface

Every affordance the sidebar shows or can open, and the tier it sits in. The
point of the inventory is that a new idea gets placed against it instead of
wedged into whichever component is already open.

## The three tiers

Each affordance sits in exactly one. The tier decides what it costs.

| Tier | Costs | Holds |
|---|---|---|
| 1 — permanent | Pixels, always | Things you must *see* without acting: hierarchy, status, search, identity, the one highest-frequency action |
| 2 — anchored | Nothing at rest | Anything scoped to one row, in that row's menu (long-press, kebab, right-click) |
| 3 — contained | One entry point | Infrequent, or complex enough to own its own structure: Settings, Archive, worktree manager |

Tier 1 is the scarce one and the only one worth arguing about. Tier 2 is
effectively unbounded, which makes it the right default home for a new idea.

## Tier 1 — permanent chrome

**Header** (`SidebarHeader.tsx`, separate desktop and mobile trees)

- Logo and wordmark; links to the dashboard only under `IS_PLATFORM`
- New Session — desktop only; the mobile drawer puts it in the footer thumb zone
- Collapse sidebar
- Transparent 44px utility block: Projects/Sessions/Archive dropdown ·
  right-aligned Search and contextual Filter buttons; Search expands into a
  shaded field between them, while Filter is absent in Archive.
  Its visible 32px controls fill the 44px hit area through the reserved 4px
  above and 8px below; the open state compacts the selector to its icon in the
  288px desktop sidebar.
- "Search inside messages" — appears inside the expanded field once the query
  reaches 2 characters, and switches `searchMode` rather than opening a place

**Body** — Projects, Sessions, and Archive are view destinations; an expanded
query can temporarily replace either active list with conversation results.

**Project list**, in render order (`SidebarProjectList.tsx`)

| Element | Notes |
|---|---|
| Repository rows | One per repository, not per directory (ADR 0016); pinned sessions lead each row's own list |
| Sessions view | One flat cross-repository list; pinned sessions lead without a separate section |
| New Project | Last in the list it adds to, deliberately faded |

**Repository row** (`SidebarRepositoryItem.tsx`) — accent strip · display name ·
session count · branch (with its glyph) or worktree count (a `·` separator, no
glyph — ADR 0016 still holds: a branch and a checkout never share an icon) ·
"Filtered" cue when the row's view is non-default · activity roll-up · kebab
(desktop, hover/focus) · chevron. Expanded, the header sticks to the top of the
scroll area and the row grows nothing else: the list carries no permanent
controls of its own.

**Session row** (`SidebarSessionItem.tsx`) — pin · name (`font-medium` marks
unread and nothing else) · status symbol **or** relative age, never both ·
message-count badge · project label (Sessions view only) · branch badge ·
provider logo · kebab (desktop). Desktop is a real `<a href>` for modified
clicks, while right-click opens the session actions menu.

**Footer** (`SidebarFooter.tsx`) — restart-required banner · update banner ·
account button (Account, Settings, Log out) · New Session (mobile only) · version
and OSS line (desktop).

**Collapsed rail** (`SidebarCollapsed.tsx`) — expand, Settings, activity
summary, version.

## Tier 2 — anchored menus

Row-scoped menus are built in `Sidebar.tsx`; the header owns the global view
menu. All use `ContextMenuOverlay` (ADR 0009).

| Menu | Opened from | Items |
|---|---|---|
| Session actions | Long-press, kebab, right-click | Pin · Rename · Copy session ID ‖ Select… ‖ Archive · Delete |
| Repository actions | Long-press, kebab, right-click | Rename · Customize · Sort and filter sessions · Worktrees ‖ Archive · Delete |
| Global view | Header Filter | Projects: sort by name or date · Sessions: sort by date, title, or project; filter by project/worktree · Reset |
| Repository session view | Repository actions, or the row's "Filtered" cue | Sort by date, title, or worktree — retap the active one to reverse it · filter by worktree · Reset |

**Select…** puts the visible list into batch mode, opening with the row it was
invoked on ticked. In Projects view that scope is one repository row; in Sessions
view it is the complete flat list. Rows become tick boxes — no navigation, no
menu, no rename — and `SidebarSelectionBar` replaces the footer with the count,
Archive, Delete, and Cancel. Delete confirms with the count; Archive does not,
being recoverable. A Projects-view selection never spans two repositories and
does not survive collapsing its row.

Repository actions target the **lead checkout**, so a merged row keeps one
identity however many worktrees it has. Accent colour and the view menu both
open from it at the same anchor the menu occupied.

The header Filter affects only the active Projects or Sessions view. Project
sorting persists per browser; the global Sessions options and repository
options are in memory. A non-default row says "Filtered" on itself. Adding a
worktree is the manager's create form, which then opens the new checkout in a
new session.

## Tier 3 — containers

Settings and Account (via the account menu), Archive (a body view entered from
the view menu), the worktree manager modal, project delete and session delete
confirmations, and the version modal.

## Breakpoint parity

Only four components fork into separate mobile and desktop trees. Everything
else renders one tree at both widths, which flips the risk: a forked component
can silently drop an affordance on one side, while a shared one can carry
sizing tuned for the other.

**Forked** — `SidebarHeader`, `SidebarFooter`, `SidebarRepositoryItem`,
`SidebarSessionItem`. **Shared** — the project list, utility row, session list,
archive view, conversation results, every menu, and the worktree
manager. `SidebarCollapsed` is desktop-only by nature.

| Affordance | Mobile | Desktop | Status |
|---|---|---|---|
| Row action menu | Long-press | Kebab or right-click | Parity — one menu builder, three anchors |
| New Session | Footer, in the thumb zone | Header | Deliberate; the drawer's header is the far corner |
| Repository row tap | Expands | Selects **and** expands | Undocumented divergence |
| Session count | "3 sessions" | "3" | Inconsistent, no stated reason |
| Version / OSS line | Absent | Present | Gap — the version is unreachable on mobile |
| `⌘K` hint | Absent | Present | Deliberate |
| Footer while renaming | Hidden | Shown | Deliberate — keyboard room |
| Status symbol and age | Always shown | Fade on hover, ceding the slot to the kebab | Deliberate |

A touch device at desktop width gets the desktop tree, so long-press is absent
there. The kebab covers it: `touch:opacity-100` (`src/index.css`) reveals it
wherever `hover: none` matches, with a `.samsung-browser` fallback for the phone
browser that misreports itself as a fine pointer.

**The rule is enforced, not just written.** `src/components/breakpointParity.test.ts`
parses every `.tsx` under `src/` and fails on an element that its own container
hides at the other breakpoint — the shape that kept `TaskIndicator` off screen.
It carries a fixture of that original shape as a negative control.

## Dead surface

`TaskIndicator` had exactly one render site, inside the repository row's
`md:hidden` block while itself carrying `hidden md:inline-flex`, so it could not
appear at either breakpoint. Removed 2026-08-11 along with the `tasksEnabled`
and `mcpServerStatus` prop chain that fed it; `getTaskIndicatorStatus` and the
component remain. Whether the row should carry the indicator at all is a TODO
item, not a regression.
