# Desktop panes: chat in the centre, a tabbed side panel, a terminal drawer

- Status: not started
- Next: Phase 0 — a desktop frame in the probe harness, then the layout probe
- Context: ADRs [0048](../decisions/0048-mobile-navbar-five-roles-plugin-overflow.md),
  [0077](../decisions/0077-terminal-tab-replaces-shell-open-in-cli.md),
  [ARCHITECTURE.md](../../ARCHITECTURE.md) invariants 3 and 17,
  [design system](../design-system.md), [testing](../testing.md)
  · related plans: [Diffs and Previews](source-control-truthfulness.md),
  [Sidebar rail](sidebar-rail.md) · TODO item: More IDE-like desktop layout

Desktop shows one tab at a time today: a single app-wide `activeTab`, driven by the
header's pill tabs, picks Chat, Files, Terminal, Git or Browser, and every tab but
Chat unmounts when left. The only split is the file editor beside it. This plan
gives desktop fixed regions: chat always in the centre, the worktree's surfaces in a
tabbed panel on the right, the terminal in a drawer along the bottom. The phone keeps
its bottom bar and one surface at a time; both read one list of surfaces.

Product bar, read 2026-10-13 from each app's docs or source (Cursor from April 2026
forum posts and release notes, so possibly stale):

- **Claude Code desktop:** chat in the centre; Changes, Browser, Files, plan, tasks
  and subagent panes from title-bar buttons and a ⋮ menu; terminal toggled with
  Ctrl+`. Panes drag by their header, resize, and pop out into windows;
  Ctrl-click a session for two side by side.
- **Codex app:** fixed layout. Review (diff) pane on the right; a terminal per thread
  at the bottom, Cmd+J. No rearranging.
- **Cursor 3 Agents Window:** agent chats tile (3.1, layout persists); terminal,
  browser and changes open from a top-right button and cannot be split.
- **T3 Code:** one tabbed right panel per thread (browser preview, diff, files, a
  file, pull requests), a sheet on narrow screens; terminal drawer, mod+J, split
  mod+D.

The shared shape is the target: sessions left, chat centre, what the agent touched
right, terminal bottom. Free drag-docking is Claude's alone and is not in this plan.

## Phases

- [ ] 0. **The layout is agreed — M.**
  - The probe harness gains a desktop frame: full window width, the real header,
    and the sidebar at its real width, since today it draws only a phone-sized
    frame.
  - One desktop probe with real panels on fake data. Axes: header toggles vs a
    thin icon strip on the right edge; right panel open on first visit or closed;
    drawer height; whether open files share the right panel's tabs or get their
    own row.
  - Grayson picks on the laptop. The picks become `docs/designs/desktop-panes.md`
    with the pillar pass done: contract, state ownership, lifecycle, budgets,
    failure handling, testing. He marks it agreed before Phase 1.
- [ ] 1. **One list of surfaces, read by both breakpoints — M.** No visible change.
  - Each surface is described once: id, icon, label, whether it needs a worktree,
    whether it can be a desktop pane and in which region, what happens when it is
    hidden (stays mounted or unmounts), and its mobile bottom-bar slot.
  - `MobileBottomNav` and the desktop header both read it. Git's
    entry is written so the Diffs plan's rename to Diffs, and its new Preview,
    is a change to this list, not a new path.
  - Cases in the existing main-content and navbar test files.
- [ ] 2. **Desktop layout state, per worktree — M.** No visible change.
  - A store holding the right panel's open tabs, active tab and width, and the
    drawer's open state and height, keyed by worktree and saved per device. It is
    not a synced preference: the phone and the laptop lay out differently.
  - A worktree that no longer exists drops its layout; a surface that went away
    (Browser turned off) drops its tab.
  - Desktop stops reading `activeTab`; the phone still uses it. Opening a file,
    a diff or the browser from chat targets the desktop panel on desktop and
    `activeTab` on the phone, through one function.
  - Unit tests for the store's fallbacks in an existing hooks test file.
- [ ] 3. **The three regions on desktop — L.**
  - `react-resizable-panels` for the splits: a deliberate `package.json` edit,
    with its size before and after measured and recorded.
  - Chat fills the centre and never leaves it. The right panel holds Files,
    Git (Diffs once that lands), Browser and open files as tabs; the
    file editor stops being its own sidebar and becomes those tabs.
  - The bottom drawer hosts the Terminal tab's existing panel, its tabs included.
  - Open panes stay mounted while hidden behind another tab, so scroll and
    expanded folders survive. Each pane gets its own error boundary, so a crash
    in one leaves chat working.
  - The header's pill tabs become toggle buttons, with a ⋮ overflow when the
    window is narrow.
  - Removed in the same change: `MainContentTabSwitcher` on desktop, the editor's
    hand-written resize handle, and `editorExpanded`'s hide-the-chat path, which
    the panel's own maximise replaces.
  - You: open a session, open Files and Git, open the terminal, then switch
    sessions in the same worktree and back. All three are where you left them,
    and chat still scrolls and sends.
- [ ] 4. **Keyboard, focus and budgets — M.**
  - Ctrl+J and Ctrl+` toggle the drawer; one shortcut each for Diffs, Browser and
    Files; one to close the focused pane. None fire while the composer or a
    terminal has focus unless the terminal is the one being toggled.
  - The focused pane is visibly marked, and Escape returns focus to the composer.
  - A cap on terminals open at once in the drawer, each holding a shell process on
    the server. Set the number from a measurement on the Pi, and say so when the
    cap refuses one.
  - Cases added to existing test files, within the per-half file budget.
- [ ] 5. **Narrow desktop and tablet — S/M.**
  - Below a width set in the design, the right panel opens as a sheet over chat
    instead of squeezing it; below the phone breakpoint, nothing changes from today.
  - You: narrow the laptop window slowly from full width to phone width. Chat never
    gets narrower than readable, and the bottom bar appears only at phone width.

## Done when

- On desktop, chat, a right-panel tab and the terminal are visible together, each
  resizable, and the layout returns per worktree after a reload.
- Leaving a pane open and switching sessions in the same worktree loses nothing in it.
- The phone is unchanged: same bottom bar, same destinations, invariant 17 holds.
- `ARCHITECTURE.md` gains the region rule as an invariant, and this plan and its
  design are deleted.

## Not doing

- **Two sessions side by side.** Chat state and the page address assume one
  selected session; that is its own plan if wanted.
- **Free drag-docking or pop-out windows.** Claude's model; fixed regions cover
  the same uses with a fraction of the states to test.
- **Shell as a pane.** Its CLI locks Chat on the same session (invariant 3), so
  beside Chat it would show a chat that cannot send. It stays where ADR 0077 put it.
- **The left sidebar.** The Sidebar rail plan owns it; this plan only assumes its
  width can change.
