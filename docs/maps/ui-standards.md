# UI standards

What is objectively required of CLIde's interface, what is only a house
convention, and which is which. The point of the split is that a convention
stated confidently reads exactly like a published standard to anyone who cannot
check — so every UI proposal names its bucket before it is built.

Row budgets, where identity sits, and the input-type reasoning behind them are
[ADR 0044](../decisions/0044-input-capability-sets-targets-row-shortcuts-stay-bounded.md), which is
convention, not standard.

## External, and objectively checkable

These apply at **both** breakpoints unless the row says otherwise.

| Requirement | Source | Notes |
|---|---|---|
| Interactive target ≥ 24×24 CSS px, or a listed exception | WCAG 2.2 SC 2.5.8 (AA) | The compliance floor for pointer inputs; spacing and equivalent-control exceptions can apply |
| Text contrast 4.5:1, large text 3:1 | WCAG 1.4.3 (AA) | Large = ≥24px, or ≥18.66px bold |
| Icon and control-boundary contrast 3:1 | WCAG 1.4.11 (AA) | Catches muted-on-muted icon buttons |
| Visible keyboard focus | WCAG 2.4.7 (AA) | |
| Focus never fully hidden by sticky chrome | WCAG 2.4.11 (AA) | Sticky headers and footers are the usual cause |
| Hover/focus content is dismissable, hoverable, persistent | WCAG 1.4.13 (AA) | Tooltips and popovers need an Escape path |
| A status change is announced without moving focus | WCAG 4.1.3 (AA) | Removing a text banner removes its announcement too; an icon swap needs a changed accessible name |
| Reflow at 320px and 200% zoom, no 2-D scrolling | WCAG 1.4.4, 1.4.10 (AA) | Bounds how narrow a resizable panel may go |
| 16px minimum font on focusable inputs | iOS Safari behaviour | Anything smaller zooms the viewport |

## Platform ergonomics — guidance, not a CLIde requirement

- [Apple lists 44×44pt as the default iOS/iPadOS control size and 28×28pt as
  its minimum](https://developer.apple.com/design/human-interface-guidelines/accessibility).
  [Android recommends 48×48dp](https://developer.android.com/guide/topics/ui/accessibility/apps)
  for native touch interfaces. Neither figure is a universal CSS-pixel floor
  for this web app.
- Start with the size and rhythm of neighbouring CLIde controls. Prefer more
  room for frequent, isolated, edge-positioned, or consequential actions; a
  compact target can be appropriate when it meets WCAG, has safe separation,
  and works on the actual device.
- A small visual may use a larger invisible hit area when that does not overlap
  another target or distort the grouping. `44px` is one available value, not an
  automatic fix.

### Mobile bottom navigation

- CLIde keeps the bar visible while Chat scrolls. It hides for the software
  keyboard, not in response to scroll direction; the maintainer declined
  scroll-to-hide after reviewing the accepted installed-PWA behavior.
- [Apple's tab-bar guidance](https://developer.apple.com/design/human-interface-guidelines/tab-bars)
  treats the bar as navigation among top-level sections, recommends keeping it
  consistently available, including short labels, and using five or fewer
  default items. It also supports later user customization when an app has many
  sections, without making customization a requirement.
- [Android's navigation-bar guidance](https://developer.android.com/develop/ui/compose/components/navigation-bar)
  calls for three to five destinations of equal importance in compact windows,
  kept consistent across app screens. Each item represents one destination and
  exposes a distinct selected state.
- A web implementation uses a labelled [`nav` landmark](https://www.w3.org/WAI/ARIA/apg/patterns/landmarks/examples/navigation.html)
  with an accessible name for every control. The active destination must be
  programmatically exposed; exact link or tab semantics follow the implemented
  navigation behavior rather than its visual styling.
- Essential bottom controls remain inside the user agent's
  [`safe-area-inset-bottom`](https://www.w3.org/TR/css-env-1/#safe-area-inset-vars)
  rectangle. Input focus alone does not prove that a software keyboard is open;
  keyboard visibility is a house behavior that needs installed-PWA evidence.

## House conventions — defensible, not published

Overrulable; say so when citing one.

- **Hover-reveal is legitimate on a pointer only because the same function has a
  non-hover path** — long-press, kebab, right-click, all feeding one menu
  definition. Remove the alternative path and the hover control becomes a real
  accessibility defect rather than a style choice.
- **A row normally gets one permanent trailing touch control.** One primary
  shortcut may sit beside the overflow menu when removing it would require a
  subheader, another row, or a duplicate list entry.
- **A resizable panel gets a 4–6px visible handle with a wider hit zone and
  double-click to reset**, following VS Code and JetBrains.
- **Desktop rows answer right-click.**
- **Reduced motion is honoured** (`prefers-reduced-motion`). WCAG 2.3.3 is AAA,
  so this is a house floor rather than a required one.
- **Target comfort is contextual.** Review size together with separation,
  adjacency, frequency, consequence, input capability, and real-device use.
  Preserve established visual density unless evidence supports changing it.

### Placement around the composer

No published standard places anything in or around a chat composer, and every
tool differs. Four reasons sit under the conventions that last, and are the
tests to apply before choosing:

- **Reach.** A phone is held from the bottom, so a control tapped often belongs
  low and something only glanced at can sit high. Widely cited handling
  research, not a specification.
- **The keyboard's cost.** With the keyboard open, the strip above the composer
  is most of what remains of the conversation, so anything stacked there costs
  most while typing. Desktop tools pay nothing for it, which is why copying their
  layout to a phone backfires.
- **Next message or whole session.** What changes the next message — model,
  attachments, send — belongs in the composer. What describes the whole session
  — title, provider, branch — belongs in the header.
- **Waiting on you or not.** What needs an answer — a question, a permission
  prompt — sits by the input. What happens anyway goes where it will end up.

References the maintainer can open: upstream CloudCLI and T3Code for agent chat,
Google Messages for scheduling on a phone. Upstream, read 2026-09-14, stacks its
scheduled list, queued card and edit banner above the composer and schedules from
a toolbar button — a desktop layout, so it shows which features exist, not where
they fit on a phone.

### Mobile bottom-navigation contract

- Mobile defaults to five roles in order: Chat, Shell, Files, Source Control,
  Plugins. Desktop keeps its existing navigation.
- Plugins is a family of destinations, not an action: its control opens a menu
  of installed plugins, and choosing one switches the main workspace view.
- The bar is the final row in the app shell's normal flex layout, never a fixed
  overlay that makes individual views compensate with bottom padding.
- `--app-footer-height` is the shared bottom-bar height. The app shell pads the
  bottom safe-area inset, so the in-flow bar takes only that height; `.app-footer`,
  which adds the inset itself, is for bars outside the shell.
- View actions live in the header kebab, never in the bar. The kebab appears, on
  desktop and mobile, only on a view that registers actions; app-wide entries such
  as Settings stay in the sidebar.
- The bar hides while a software keyboard is open: a shrunken visual viewport with
  a text field focused, never focus alone.
- The old four-icon SVG was an incomplete sketch, not a specification. Labels,
  active-plugin presentation, attention state, and software-keyboard behavior
  are agreed against the implementation plan before visual work starts.
- Rearrangement and pinned-plugin slots are a later possibility. If pursued,
  their slot count and displacement rules must be decided against the published
  five-or-fewer default guidance rather than silently widening the bar.

## Standing findings

Re-measure rather than trusting this list; it records the last pass, not a
guarantee. Sidebar-specific compliance lives in
[the sidebar surface map](sidebar-surface.md).

- The desktop row kebab is 24px — exactly the SC 2.5.8 floor. Nothing in a row
  may be made smaller.
- The sidebar map records compact control measurements for contextual review;
  being below 44px alone is not a defect.
