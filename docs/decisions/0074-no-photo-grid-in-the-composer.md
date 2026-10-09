# 0074 — No photo grid in the composer until Chrome can read its files

- Date: 2026-10-08
- Status: Accepted

## Decision

The + menu offers only Attach files (ADR 0070); 0073's Attach photos row is removed again.

## Why

A probe of 17 grid picks on the S20 (2026-10-08) found the reported size and the bytes
identical on every good read, yet about half the picks were refused, some only after a
first read had succeeded. Reading sooner cannot fix that, and a page cannot make Chrome take
a fresh reference. A non-image type in `accept` avoids the grid, but Android's chooser then
leads to the same file browser Attach files opens. Reopen this when Chrome or Android fixes
crbug 428394446; Grayson would then want Camera, Photos and Files rows.
