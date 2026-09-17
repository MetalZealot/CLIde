# 0057 — Mobile bottom navigation ends in a swappable slot and a kebab

- Date: 2026-09-16
- Status: Accepted; supersedes 0048's fifth role

## Decision

The bar is Chat, Shell, Files, Source Control, then one slot showing the last overflow destination picked (Browser, Tasks, or a plugin), then a narrow icon-only kebab listing every overflow destination. The pick is device-local, defaults to the first entry, falls back to it when the pick disappears, and the slot hides when the list is empty.

## Rejected

A full-width sixth "More" item narrowed every label; a permanent item per plugin stays rejected for 0048's reasons.

## Why

The maintainer switches between a small number of overflow destinations, and one tap back into the last one beats two; the kebab is a menu, not a destination, so the bar still holds five destinations.
