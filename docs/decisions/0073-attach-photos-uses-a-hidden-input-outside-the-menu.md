# 0073 — Attach photos clicks a hidden input outside the + menu

- Date: 2026-10-07
- Status: Accepted

## Decision

The + menu has Attach files (ADR 0070) and Attach photos. Attach photos calls `click()` on
a hidden `accept="image/*"` input that lives outside the menu surface, as the profile
picture does, so it opens Android's photo grid.

## Rejected

**The input stretched over the menu row (0070).** The menu hides as the row is tapped, and
photos the grid returned that way often could not be read: broken previews, then "Failed
to fetch" on send. The same photos read fine through the hidden input, in the app and in
a probe page; which detail of the old wiring broke the read was not isolated. **No photo
row (0072)** loses the grid; **a file browser limited to images** was two buttons to the
same place.

## Why

0026's "never `input.click()`" no longer holds: the profile picture and this row both
return files from `click()` in the installed PWA on the S20 (2026-10-07). A few photos
cannot be read through the grid at all (crbug 428394446); the composer reports them as
"couldn't be attached", and Attach files reaches them.
