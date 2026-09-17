# 0057 — The mobile bar's fifth item is a swappable slot

- Date: 2026-09-16
- Status: Accepted; supersedes 0048's fifth role

## Decision

The bar is Chat, Shell, Files, Source Control, then one slot showing the last overflow destination picked (Browser, Tasks, or a plugin), marked by a caret beside its label that flips while the list is open. Tapping the slot opens its destination; tapping it again while that destination is open, or long-pressing it, opens the overflow list. The pick is device-local, defaults to the first entry and falls back to it when the pick disappears; with no entries the slot is 0048's More item.

## Rejected

A trailing kebab beside the slot sat the bar between two kebab menus and looked cluttered; long-press as the only route hid the list.

## Why

One tap back into the last overflow destination beats two, and tap-again gives the list a visible route while long-press stays a shortcut.
