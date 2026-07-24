# 0010 — Viewport-positioned overlays set inset inline, never via `inset-0`

- Date: 2026-07-23
- Status: Accepted

## Decision

A full-screen overlay whose children are positioned from viewport coordinates
(`getBoundingClientRect`, `clientX/Y`) must not carry the `inset-0` utility
class. Set `top/right/bottom/left` inline instead, as `ContextMenuOverlay` does.
`src/index.css` has an app-global rule:

```css
body.pwa-mode .fixed.inset-0 { top: var(--header-total-padding); … }
```

which matches *any* element with both classes and shifts its origin down by the
header's safe-area padding. Coordinates measured against the viewport are then
off by that amount — inside the installed PWA only.

## Rejected

- **Scoping the override to the modals it was written for.** It predates this
  fork and an unknown number of dialogs rely on it; narrowing it risks breaking
  surfaces that can only be checked by hand on a phone.
- **Cancelling it per-overlay with `!important` / a `top-0` override.** Works,
  but leaves the trap armed for the next overlay and reads as noise.

## Why

Found the slow way: the file-tree context menu had a generous gap below rows
near the top of the screen and none at all above rows near the bottom, but only
in the installed PWA — the same build inspected in a browser tab measured equal
on both sides, since `Sidebar.tsx` only adds `pwa-mode` in standalone display
mode. Avoiding the class is a one-line,
zero-blast-radius fix; inline styles also win against the rule regardless. Note
for future debugging: any PWA-only vertical offset on a `fixed inset-0` element
is this rule until proven otherwise.
