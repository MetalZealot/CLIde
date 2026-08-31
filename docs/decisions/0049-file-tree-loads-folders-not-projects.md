# 0049 — File browsing loads folders, not whole projects

- Date: 2026-08-30
- Status: Accepted

## Decision

Files loads one cursor-paged directory at a time, while Files search, `@file`, Command Palette, and message-link resolution use cancellable project-wide services with deterministic results. The first root page warms a two-project, two-minute search index; CLIde mutations invalidate it, and Files Refresh rebuilds it after external writes. Directory targets are contained by real path, and legacy recursive trees plus complete ZIP subtrees stop at 10,000 entries.

## Rejected

Keeping one eager recursive tree, merely canceling the browser request, or trusting lexical path prefixes leaves backend traversal running and lets one broad project delay unrelated projects.

## Why

The home-folder project contains 113,759 visible entries under the old rules, and the old depth-10 `Promise.all` walk fed one shared filesystem queue. Shallow paging bounds response and metadata work; service-level aborts, bounded traversal, and ambiguous-match responses prevent the delayed editor takeovers that exposed the failure.
