# 0002 — PWA icons declare purpose "any" only, never "maskable"

- Date: 2026-07-21
- Status: Accepted

## Decision

Every icon entry in the web app manifest uses `"purpose": "any"`. No icon
declares `"maskable"` (alone or as `"any maskable"`).

## Rejected

Providing a dedicated maskable icon variant with proper safe-zone padding —
the spec-correct approach, and it was actually built and tested.

## Why

Samsung Internet renders a white box behind the splash-screen icon whenever
*any* manifest icon declares the `maskable` purpose — even when the maskable
icon itself is correctly padded and dark. The white box comes from the purpose
declaration, not from icon content, so a "better" maskable icon cannot fix it;
maskable is a dead end on Samsung. Dropping the purpose entirely (`3aad3be`)
removes the white box at the cost of Android potentially letterboxing the icon
in some launcher shapes — an acceptable trade for the primary device. If a
future contributor re-adds `maskable` to be spec-nice, this bug comes back.
