# 0020 — The one-scroll-container rule has no exceptions; Plugins never needed one

- Date: 2026-07-29
- Status: Accepted

## Decision

[ADR 0018](0018-settings-drill-down-one-scroll-container.md)'s second rule —
each Settings screen owns exactly one scroll container, `SettingsScreen` —
stands **unqualified**. The Plugins carve-out that the Settings-IA build plan
reserved (decision 4, to be settled in P3c) is not granted, because the
conflict it was written to accommodate does not exist.

## Rejected

- **Documenting a Plugins exception**, as the build plan anticipated: that
  third-party plugin code mounts into `h-full w-full overflow-auto` and needs a
  bounded height, so the Plugins settings screen must be allowed a nested
  scroller.
- **Reworking plugin mounting** to avoid needing one. Also unnecessary, and it
  would have touched the third-party plugin contract for no reason.

## Why

The `overflow-auto` in question is `PluginTabContent.tsx`'s, and
`PluginTabContent` is mounted by `MainContent` to host a plugin's **tab** — it
is not, and never was, rendered by anything under `src/components/settings/`.
The two files sit in the same `src/components/plugins/view/` directory, which
is how the audit came to attribute one's constraint to the other. The plugin
tab host keeps its bounded-height scroller; it is simply not a Settings screen,
so ADR 0018 has nothing to say about it.

Confirmed empirically while porting `ExtensionsPluginsScreen` in P3c (`9505a00`):
a Playwright pass counted the scrollable descendants of the detail pane on all
four new screens — Plugins, Browser, Tasks, About — at desktop and 390px, light
and dark, with populated fixture data. Every combination reported exactly one.

Recorded because a granted-then-withdrawn exception is exactly the kind of thing
that gets re-litigated: the docstring on `ExtensionsPluginsScreen` explains it to
anyone who greps `overflow-auto` in the plugins tree, and this ADR explains it to
anyone who finds decision 4 in the build plan first.
