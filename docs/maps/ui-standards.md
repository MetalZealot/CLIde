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
| Interactive target ≥ 24×24 CSS px | WCAG 2.2 SC 2.5.8 (AA) | The floor at every input type, pointer included |
| Touch target ≥ 44px (Apple) / 48dp (Material) | Platform HIGs | Touch only; reconcile a smaller visual with `.sidebar-utility-hit-target` |
| Text contrast 4.5:1, large text 3:1 | WCAG 1.4.3 (AA) | Large = ≥24px, or ≥18.66px bold |
| Icon and control-boundary contrast 3:1 | WCAG 1.4.11 (AA) | Catches muted-on-muted icon buttons |
| Visible keyboard focus | WCAG 2.4.7 (AA) | |
| Focus never fully hidden by sticky chrome | WCAG 2.4.11 (AA) | Sticky headers and footers are the usual cause |
| Hover/focus content is dismissable, hoverable, persistent | WCAG 1.4.13 (AA) | Tooltips and popovers need an Escape path |
| Reflow at 320px and 200% zoom, no 2-D scrolling | WCAG 1.4.4, 1.4.10 (AA) | Bounds how narrow a resizable panel may go |
| 16px minimum font on focusable inputs | iOS Safari behaviour | Anything smaller zooms the viewport |

### Mobile bottom navigation

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

### Mobile bottom-navigation contract

- Mobile defaults to five roles in order: Chat, Shell, Files, Source Control,
  Plugins. Desktop keeps its existing navigation.
- Plugins is a family of destinations, not an action: its control opens a menu
  of installed plugins, and choosing one switches the main workspace view.
- The bar is the final row in the app shell's normal flex layout, never a fixed
  overlay that makes individual views compensate with bottom padding.
- `--app-footer-height` and `.app-footer` are the live shared bottom-bar sizing
  contract. `--mobile-nav-*`, `.mobile-nav-float`, and `.chat-input-mobile` are
  remnants of upstream's removed overlay, not implementation guidance.
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
- Nine sidebar control sites miss the 44px touch guideline; table and fix in the
  sidebar map.
