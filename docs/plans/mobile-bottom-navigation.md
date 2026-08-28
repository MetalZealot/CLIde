# Mobile bottom navigation

- Status: 1/4
- Next: Finish one-owner safe-area handling, then agree labels, plugin state, and keyboard behavior.
- Context: [ADR 0048](../decisions/0048-mobile-navbar-five-roles-plugin-overflow.md), [UI standards](../maps/ui-standards.md), [upstream removal](https://github.com/siteboon/claudecodeui/pull/632)

## Phases

- [x] 1. The five-role default, plugin overflow, upstream failure mode, and current platform guidance are recorded.
- [ ] 2. The app shell owns safe-area insets once, including the bottom inset the navbar needs.
- [ ] 3. Agree the visible and interaction contract: labels, selected and active-plugin states, attention, zero/one/many-plugin menu behavior, and software-keyboard visibility.
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
