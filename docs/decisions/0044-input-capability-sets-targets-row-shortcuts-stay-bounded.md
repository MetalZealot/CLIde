# 0044 — Input capability sets targets; row shortcuts stay bounded

- Date: 2026-08-22
- Status: Accepted

## Decision

Touch controls keep at least a 44px hit area without requiring a larger visible
icon, while pointer controls may use a 24–28px visual and hit area. A row may
show one high-frequency primary shortcut beside one overflow menu when removing
the shortcut would require another row, subheader, or duplicate list entry;
provider identity leads the title, while pin, activity and age trail as state.
Non-interactive marks do not consume the control budget, but still have to earn
permanent space through identity, state, or useful classification.

## Rejected

A hard one-control ceiling hid useful direct actions, and both a Project
subheader and a nested New Session entry added more structure than the shortcut
they replaced.

## Why

Input capability determines ergonomics independently of viewport width, so a
phone in Desktop View still needs a finger-sized target while keeping compact
iconography. The repository New Session shortcut is frequent and the kebab is
the only discoverable touch route to the remaining actions, so the pair earns a
bounded exception without reopening tier 1 generally. This supersedes ADR 0042.
