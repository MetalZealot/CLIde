# 0018 — Settings navigates by a history-backed drill-down stack, and each screen owns exactly one scroll container

- Date: 2026-07-29
- Status: Superseded by 0040

## Decision

Settings navigates as a **stack**, not as tabs. The mobile root is a grouped
list of destinations; tapping one pushes a screen; maximum depth is 2. Desktop
renders the same registry as a rail beside a detail pane, using the same screen
components.

Two rules come with it, and they are the substance of this ADR:

1. **Each push adds exactly one browser-history entry; each pop consumes one.**
   The hardware/Android back gesture pops one screen rather than closing
   Settings. Closing from depth 2 unwinds every entry, so the history is not
   left holding stale settings states. Every downward transition — the back
   chevron included — routes through `history.back()` and lands in the single
   `popstate` handler in `useSettingsNavigation`.
2. **Each screen owns exactly one scroll container**, `SettingsScreen`. Nothing
   rendered inside a screen may open its own `overflow-y-auto`.

The IA lives in one declarative registry (`settings/registry/registry.ts`) that
drives the root list, the rail, the command palette and deep links.

## Rejected

- **Keeping tabs and fixing the scrolling.** The pill bar shows about three of
  ten destinations on a phone, with no overview and nowhere to put search. The
  scroll bugs are a symptom of the nesting that tabs-inside-tabs invited.
- **Dispatching the stack change on click *and* on popstate.** The obvious
  shape, and wrong: a real back gesture then pops twice, because the click
  handler and the history event both fire. Routing every downward move through
  `history.back()` leaves exactly one path that mutates the stack downward.
- **Tracking the modal's open/closed state in history too.** Would make the
  back gesture close Settings from depth 0 for free, but it puts modal
  visibility under the router's control and widens the change well past
  Settings. Closing at depth 0 stays a button.
- **Putting the screen `component` in the registry**, as the design spec
  sketched. Keeping the registry pure data — icons as names, resolved through an
  exhaustive map — lets its invariants be unit-tested under `node:test` with no
  renderer, and keeps it clear of an import cycle with the views.

## Why

The pane had grown to ten top-level tabs, one of which (Agents) held a second
two-dimensional tab system, and `AgentCategoryContentSection` opened an
`overflow-y-auto` *inside* the modal's own scroller with two pinned tab rows
above it. That nesting is the direct cause of both reported Agents bugs,
including the Connection Status panel clipped at the bottom: the inner
container's height came from a flex chain that never accounted for the modal's
safe-area padding. A one-scroller rule makes that class of bug structurally
impossible rather than repeatedly patchable, which is why it is a rule and not a
convention.

The history rule matters most in the installed PWA, where the Android back
gesture is the primary back affordance and a modal that swallows it feels
broken. Note for future debugging: `history.length` does **not** shrink on
`history.go(-n)`, so it cannot be used to assert that unwinding worked — check
that `history.state` no longer carries the `__clideSettingsDepth` marker
instead.

Two hand-maintained nav arrays had already drifted apart before this work:
`voice` existed in the sidebar but not in `SETTINGS_MAIN_TABS`, so the command
palette could not reach Voice at all. One registry with tested invariants is the
part that keeps that from recurring.
