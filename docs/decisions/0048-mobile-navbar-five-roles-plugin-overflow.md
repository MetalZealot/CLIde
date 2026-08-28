# 0048 — Mobile bottom navigation has five roles; plugins share overflow

- Date: 2026-08-28
- Status: Accepted; supersedes 0005

## Decision

The default mobile bar contains Chat, Shell, Files, Source Control, and Plugins,
in that order. Plugins opens a menu of installed plugin destinations instead of
adding one permanent item per plugin; desktop navigation is unchanged, and the
bar remains the final row of the app's normal flex column.

## Rejected

The four-icon SVG is not design authority: it was an incomplete sketch, and its
omission of Shell was not a product decision. Rearrangement and pinned-plugin
slots are deferred until the default bar has been accepted in use.

## Why

Five stable roles fit current mobile guidance while keeping unbounded plugin
destinations out of permanent chrome. This retains 0005's in-flow correction to
upstream's fixed overlay without treating an old mockup as the specification.
