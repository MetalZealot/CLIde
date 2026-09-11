# Mobile bottom navigation

- Status: 3/4
- Next: Grayson accepts the bar in an installed test PWA, then merge.
- Context: [ADR 0048](../decisions/0048-mobile-navbar-five-roles-plugin-overflow.md), [UI standards](../maps/ui-standards.md), [upstream removal](https://github.com/siteboon/claudecodeui/pull/632)

## Phases

- [x] 1. The five-role default, plugin overflow, upstream failure mode, and current platform guidance are recorded.
- [x] 2. The app shell owns safe-area insets once, including the bottom inset the navbar needs.  The shell pads the bottom inset, so the in-flow bar takes only `--app-footer-height`; `.app-footer`, which pads the inset itself, is for bars outside the shell.
- [x] 3. Agree the visible and interaction contract: selected and active-plugin states, attention, zero/one/many-plugin menu behavior, and software-keyboard visibility.  Settled: the fifth slot is labelled for overflow, not for plugins, so it can also hold Browser, Tasks, and later destinations; the bar switches view and never context, so changing session inside a project leaves the selected tab and the Files/Source surfaces in place; destinations live in the bar, actions live in the header kebab, so no surface is reachable only from a menu.  `StandaloneShell` (the Shell view) resumes the selected session's provider CLI and ends when it exits; the Terminal plugin is a general multi-tab shell unaware of sessions.  They are different destinations: Shell keeps its bar slot and Terminal lives in the overflow menu.  Keyboard, measured in the installed Samsung Internet 30 PWA (2026-09-10): the layout viewport shrinks with the keyboard (770→431px), `safe-area-inset-bottom` reads 0 open and closed, and `focusin` fires before the resize — so the bar hides on a large height drop while a text field is focused, never on focus alone.  Bar items are an icon over a short label (Source Control reads "Git"); More holds Browser, Tasks, then enabled plugins, shows selected while one is open and the header names it, always opens its menu, and when empty says so and links to plugin settings; a dot on Chat flags a waiting permission prompt from another view.
- [ ] 4. Replace the mobile top tabs with the in-flow bar and verify it in the installed PWA without changing desktop navigation.

## Done when

- Chat, Shell, Files, Source Control, and Plugins remain reachable from every mobile workspace view.
- Plugins opens one accessible installed-plugin menu without growing the permanent bar.
- No content, composer control, or navbar target sits under the bar, gesture area, or software keyboard.
- Grayson accepts the result in the installed PWA; desktop behavior remains unchanged.

## Not doing

- Treating the incomplete four-icon SVG as design authority.
- Shipping rearrangement or pinned-plugin customization with the default bar.
- Reintroducing upstream's fixed overlay or per-view compensation padding.
