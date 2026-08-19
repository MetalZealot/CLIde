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
  permanently shaded Search field · contextual Sort button, absent in Archive.
  Clear appears only for a non-empty query. Its visible 32px controls fill the
  44px hit area through the reserved 4px above and 8px below; desktop compacts
  the selector to its icon.
- "Search inside messages" — appears inside the field once the query
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
controls of its own. Expanding past the first five sessions pins “Show less” to
the bottom of the visible list until its natural position scrolls into view.

**Session row** (`SidebarSessionItem.tsx`) — project accent strip (Sessions view
only) · pin · name (`font-medium` marks unread and nothing else) · status symbol
**or** relative age, never both · message-count badge · project label (Sessions
view only) · branch badge · provider logo · kebab (desktop). Nested Projects-view
sessions use the repository rail instead of repeating the strip. Desktop is a
real `<a href>` for modified clicks, while right-click opens the session actions
menu.

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
| Global view | Header Sort | Projects: sort by name or date · Sessions: sort by date, title, or project · Reset |
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

The header Sort affects only the active Projects or Sessions view. Project
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

## Budget compliance (ADR 0042)

Measured 2026-08-18, against the three rules in
[ADR 0042](../decisions/0042-input-type-sets-the-sidebar-budget.md).

**Only rule 3 is an external standard** — 44px is Apple's published guideline,
48dp is Google's. Rules 1 and 2 are house conventions: defensible, widely
followed, and overrulable without anything breaking. Read the two lists
differently.

**Rule 1 — one permanent trailing control on touch.** Every row passes. No row
carries more than one permanent trailing control at either breakpoint, and the
repository and session rows carry none: their trailing slot holds a transient
status symbol, and the desktop's New Session and kebab are hover-revealed.
*Known gap:* the rule governs controls. The session row's trailing **marks** —
relative age and provider logo — are permanent on touch and unbudgeted.

**Rule 2 — identity leads, state trails.** The expand chevron is *state*, so its
trailing position is compliant; ADR 0042's example list was wrong to call it
identity. One violation remains: the session row's
provider logo trails, but a provider is what the session *is*, not what is true
now. Leading the title would satisfy the rule and take the logo out of the
desktop kebab's path for good.

**Rule 3 — 44px hit area on touch.** Nine control sites fall short, all on touch.
`.sidebar-utility-hit-target` (`index.css`) is the existing fix and reconciles a
32px visual with a 44px hit area without resizing anything.

| Control | Where | Visible | Hit area |
|---|---|---|---|
| Search field | header utility row | 32px | 32px |
| Search-inside-messages toggle | inside the field | 24px | 24px |
| Clear search | inside the field | 24px | 24px |
| Close sidebar | mobile app bar | 32px | 32px |
| Cancel | batch selection bar | 28px | 28px |
| Archive / Delete | batch selection bar | 32px | 32px |
| Restore / Delete | archive view rows | 28px | 28px |
| Save / Cancel rename | repository row, editing | 32px | 32px |
| New Project | end of the project list | ~40px | ~40px |

The browse selector and Sort button are the compliant pair to copy: both are 32px
visuals already wearing the helper class.

## Dead surface

`TaskIndicator` had exactly one render site, inside the repository row's
`md:hidden` block while itself carrying `hidden md:inline-flex`, so it could not
appear at either breakpoint. Removed 2026-08-11 along with the `tasksEnabled`
and `mcpServerStatus` prop chain that fed it; `getTaskIndicatorStatus` and the
component remain. Whether the row should carry the indicator at all is a TODO
item, not a regression.
