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
- Search input, with clear button and a `⌘K`/`Ctrl K` hint
- "Search inside messages" — appears once the query reaches 2 characters, and
  switches `searchMode` rather than opening a place

**Body** — three mutually exclusive modes off one `searchMode`
(`SidebarContent.tsx`): the project list, conversation search results, and
Archive.

**Project list**, in render order (`SidebarProjectList.tsx`)

| Element | Notes |
|---|---|
| Activity section | Icon, label, per-state count roll-up, collapse. A transient **copy** — rows also stay in their repository |
| Pinned section | Icon, label, count, collapse. A durable **move** — subtracted from repository session counts |
| Project picker | Scope filter wearing the "Projects" section label. Scopes repository rows only, never Activity or Pinned |
| Repository rows | One per repository, not per directory (ADR 0016) |
| New Project | Last in the list it adds to, deliberately faded |

**Repository row** (`SidebarRepositoryItem.tsx`) — accent strip · display name ·
session count · branch-or-worktree-count subtitle with its own icon · activity
roll-up · kebab (desktop, hover/focus) · chevron. Expanded, it grows a
"Sessions" subheader carrying the view menu and the create menu, and the header
sticks to the top of the scroll area.

**Session row** (`SidebarSessionItem.tsx`) — pin · name (`font-medium` marks
unread and nothing else) · status symbol **or** relative age, never both ·
message-count badge · project label (flat sections only) · branch badge ·
provider logo · kebab (desktop). Desktop is a real `<a href>`, so its native
context menu is left alone.

**Footer** (`SidebarFooter.tsx`) — restart-required banner · update banner ·
account button · New Session (mobile only) · version and OSS line (desktop).

**Collapsed rail** (`SidebarCollapsed.tsx`) — expand, Settings, activity
summary, version.

## Tier 2 — anchored menus

All four are built in `Sidebar.tsx` and rendered through the one
`ContextMenuOverlay` (ADR 0009).

| Menu | Opened from | Items |
|---|---|---|
| Session actions | Long-press, kebab | Pin · Rename · Copy session ID ‖ Archive · Delete |
| Repository actions | Long-press, kebab, right-click | Rename · Customize · Worktrees ‖ Archive · Delete |
| Create | `+` in the Sessions subheader | New Session · New Worktree |
| View | Filter icon in the Sessions subheader | Sort (newest, oldest, title, worktree) · filter by worktree · Reset |

Repository actions target the **lead checkout**, so a merged row keeps one
identity however many worktrees it has. Accent colour opens from Customize at
the same anchor the menu occupied.

## Tier 3 — containers

Settings and Account (via the account menu), Archive (a body mode, entered from
the account menu), the worktree manager modal, project delete and session delete
confirmations, and the version modal.

## Breakpoint parity

Only four components fork into separate mobile and desktop trees. Everything
else renders one tree at both widths, which flips the risk: a forked component
can silently drop an affordance on one side, while a shared one can carry
sizing tuned for the other.

**Forked** — `SidebarHeader`, `SidebarFooter`, `SidebarRepositoryItem`,
`SidebarSessionItem`. **Shared** — the project list, project picker, section
headers, session list, archive view, conversation results, every menu, and the
worktree manager. `SidebarCollapsed` is desktop-only by nature.

| Affordance | Mobile | Desktop | Status |
|---|---|---|---|
| Row action menu | Long-press | Kebab, plus right-click on repository rows | Parity — one menu builder, three anchors |
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

## Known drift

Four places where the tiers above are not what the code does. Each is a
[TODO](../TODO.md) item under "Sidebar information architecture".

- **Archive is a body mode entered from an identity control.** It is a view of
  your sessions living next to Log out. ADR 0030 placed it in the footer beside
  Settings; the account-menu consolidation fixed the footer and left Archive
  in the one container that is not about sessions.
- **Three entry points for New Session** — header (global), footer (global,
  mobile), per-row `+` (scoped). Nothing distinguishes the scoped one.
- **Activity and Pinned are visually identical and behave oppositely** — copy
  versus move, with no cue for which.
- **View state has two forms at two levels** — the project picker is a dropdown
  wearing a section header; the per-row view menu is an icon in a subheader.

## Dead surface

`TaskIndicator` had exactly one render site, inside the repository row's
`md:hidden` block while itself carrying `hidden md:inline-flex`, so it could not
appear at either breakpoint. Removed 2026-08-11 along with the `tasksEnabled`
and `mcpServerStatus` prop chain that fed it; `getTaskIndicatorStatus` and the
component remain. Whether the row should carry the indicator at all is a TODO
item, not a regression.
