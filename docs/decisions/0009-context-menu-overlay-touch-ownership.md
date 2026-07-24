# 0009 — Long-press menus: one shared overlay, and touch belongs to `useLongPress`

- Date: 2026-07-23
- Status: Accepted

## Decision

All long-press / right-click menus render through one component,
`ContextMenuOverlay` (`src/shared/view/ui/`), used by the file tree
(`FileContextMenu`) and the sidebar (`SidebarContextMenu`). It owns anchoring
to the *row* (below it, flipped above when the row sits low), a transparent
catcher that freezes the list behind it, dismissal on `touchstart`/`mousedown`
rather than `click`, Escape, and arrow-key navigation. Two rules that came out
of the touch work are load-bearing:

1. **A component that wires up `useLongPress` must not override its
   `onContextMenu`.** That handler exists only to `preventDefault`. On Android
   the browser fires its own `contextmenu` at roughly the same ~500 ms as the
   long-press timer, so a component that replaces it with "open the menu here"
   opens the menu twice per press. `FileContextMenu` keeps a cursor handler for
   real right-clicks but ignores any `contextmenu` within 1 s of touch activity.
2. **The post-dismissal tap shield is plain DOM, armed imperatively**
   (`armTapShield`), not React state, and it is released on
   `touchend`/`touchcancel`/`mouseup` — never on a timer.

## Rejected

- **Duplicating the behaviour per menu.** The sidebar and file tree menus had
  already drifted (only one had scroll-lock, anchoring, or the PWA fix from
  [0010](0010-pwa-mode-fixed-inset-override.md)); every fix would have needed
  applying twice.
- **A React-state shield inside the overlay.** The menu's owner unmounts the
  overlay the instant it's dismissed (the sidebar renders it as
  `{contextMenu && …}`), which would kill the shield mid-gesture.
- **Releasing the shield on a ~300 ms timer after `touchend`.** Tried, shipped,
  and reported as a bug: one or two swipes did nothing after dismissing a menu.
  A swipe that *starts* on the still-mounted shield is locked non-scrolling for
  its whole life, because the browser fixes an element's `touch-action` when the
  gesture begins on it and never revisits that decision.
- **Dismissing on `click`.** A scroll gesture could complete with the menu still
  floating in place.
- **Measuring with `getBoundingClientRect()`.** The `zoom-in-95` enter animation
  (`animation-fill-mode: both`) has the menu at `scale(0.95)` when the layout
  effect runs, so the rect is 5% short and the flipped-above placement landed on
  top of its own row. `offsetWidth`/`offsetHeight` are transform-independent.

## Why

The pieces only look arbitrary in isolation; each one came from a symptom on the
S20 PWA — the list scrolling out from under a fixed popup, the menu floating far
from the row it acted on, dead swipes after dismissal, a menu flashing at the
finger before jumping to its anchor. Consolidating them means the sidebar
inherited the fixes for free, and the tap shield's DOM-level implementation is
what makes "dismiss instantly, scroll on the very next touch" possible without
the menu's owner having to stay mounted.
