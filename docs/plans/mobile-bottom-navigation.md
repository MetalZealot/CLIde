# Mobile bottom navigation

- Status: 1/4
- Next: Measure software-keyboard and bottom-inset behavior in an installed test PWA, then agree the phase 3 defaults.
- Context: [ADR 0048](../decisions/0048-mobile-navbar-five-roles-plugin-overflow.md), [UI standards](../maps/ui-standards.md), [upstream removal](https://github.com/siteboon/claudecodeui/pull/632)

## Phases

- [x] 1. The five-role default, plugin overflow, upstream failure mode, and current platform guidance are recorded.
- [ ] 2. The app shell owns safe-area insets once, including the bottom inset the navbar needs.  The shell currently pads the bottom inset and `.app-footer` pads it again, so the inset moves to the bar in the same change that adds the bar; removing it first would put mobile views under the gesture strip.
- [ ] 3. Agree the visible and interaction contract: selected and active-plugin states, attention, zero/one/many-plugin menu behavior, and software-keyboard visibility.  Settled so far: the fifth slot is labelled for overflow, not for plugins, so it can also hold Browser, Tasks, and later destinations; the bar switches view and never context, so changing session inside a project leaves the selected tab and the Files/Source surfaces in place; destinations live in the bar, actions live in the header kebab, so no surface is reachable only from a menu.  `StandaloneShell` (the Shell view) resumes the selected session's provider CLI and ends when it exits; the Terminal plugin is a general multi-tab shell unaware of sessions.  They are different destinations: Shell keeps its bar slot and Terminal lives in the overflow menu.
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
