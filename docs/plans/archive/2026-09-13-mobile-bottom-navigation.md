# Mobile bottom navigation

- Status: complete
- Next: none
- Context: [ADR 0048](../../decisions/0048-mobile-navbar-five-roles-plugin-overflow.md), [UI standards](../../maps/ui-standards.md), [upstream removal](https://github.com/siteboon/claudecodeui/pull/632)

## Phases

- [x] 1. The five-role default, plugin overflow, upstream failure mode, and current platform guidance are recorded.
- [x] 2. The app shell owns safe-area insets once, including the bottom inset the navbar needs.  The shell pads the bottom inset, so the in-flow bar takes only `--app-footer-height`; `.app-footer`, which pads the inset itself, is for bars outside the shell.
- [x] 3. Agree the visible and interaction contract: selected and active-plugin states, attention, zero/one/many-plugin menu behavior, and software-keyboard visibility.  Settled: the fifth slot is labelled for overflow, not for plugins, so it can also hold Browser, Tasks, and later destinations; the bar switches view and never context, so changing session inside a project leaves the selected tab and the Files/Source surfaces in place; destinations live in the bar, actions live in the header kebab, so no surface is reachable only from a menu.  `StandaloneShell` (the Shell view) resumes the selected session's provider CLI and ends when it exits; the Terminal plugin is a general multi-tab shell unaware of sessions.  They are different destinations: Shell keeps its bar slot and Terminal lives in the overflow menu.  Keyboard, measured in the installed Samsung Internet 30 PWA (2026-09-10): the layout viewport shrinks with the keyboard (770→431px), `safe-area-inset-bottom` reads 0 open and closed, and `focusin` fires before the resize — so the bar hides on a large height drop while a text field is focused, never on focus alone.  Before worktree selection, the bar stays visible with Chat selected; Shell, Files, and Git are disabled. More still opens, with worktree-dependent destinations visibly disabled and plugin settings available when its destination list is empty. Bar items are an icon over a short label (Source Control reads "Git"); More holds Browser, Tasks, then enabled plugins, shows selected while one is open and the header names it, always opens its menu, and when empty says so and links to plugin settings.  Seen from another view, Chat carries the open session's status in the sidebar's shapes and colours, so colour is never the only cue (WCAG 1.4.1): the yellow alert icon for a waiting permission prompt, otherwise the green dot for a reply that finished off-screen.  It never shows another session's status, since Chat leads only to the open one, and never the running spinner or scheduled clock, since neither asks anything of you.  The header carries a kebab only on a view with its own actions, and Settings stays in the sidebar: Shell's status, Disconnect and Restart moved there from its desktop-only row; Chat's are the open session's Pin, Rename, Find in chat, Export…, Archive and Delete, followed by tap-to-copy app and provider IDs; the header replaces the floating export button on both layouts.  Heights accepted in the installed test PWA (2026-09-10): top bars 56px, bottom bars 60px.
- [x] 4. Replace the mobile top tabs with the in-flow bar and verify it in the installed PWA without changing desktop navigation.

## Final review

Rebased onto main's voice-availability and editable activity-message changes. The
three merge blockers are fixed and verified in the worktree:

- Find owns its input draft and waits for a typing pause before preparing history
  or collecting matches. A stale-header regression test and browser typing checks
  at three speeds pass.
- Find reveals the full cached transcript again after jump-to-bottom limits the
  display. The combined session-state/Find regression passes through two search
  cycles without a network fetch.
- Header menus and Export retain natural height with a viewport ceiling, scroll
  when needed, and reposition after resize. Browser checks at four viewport sizes
  confirm the final Export button remains reachable, including after shrinking an
  already-open panel.

Verification: 609 server and 358 client tests pass; typechecks, documentation checks,
client/server builds, and lint pass (zero errors, 190 existing warnings). Browser
checks mounted the actual components with synthetic data; they did not exercise a
running provider session. The maintainer authorized integration after this review,
then accepted the bar, Chat status, compact menus, and Browser preview in the installed
PWA on 2026-09-13.

## Done when

- Chat, Shell, Files, Source Control, and Plugins remain reachable from every mobile workspace view.
- Plugins opens one accessible installed-plugin menu without growing the permanent bar.
- No content, composer control, or navbar target sits under the bar, gesture area, or software keyboard.
- Grayson accepts the result in the installed PWA; desktop behavior remains unchanged.

## Not doing

- Treating the incomplete four-icon SVG as design authority.
- Shipping rearrangement or pinned-plugin customization with the default bar.
- Reintroducing upstream's fixed overlay or per-view compensation padding.
