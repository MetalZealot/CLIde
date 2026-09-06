# 0052 — Reads reach the workspace and temp roots; writes stay in the project

- Date: 2026-09-06
- Status: Accepted

## Decision

`readTextFile`, `openFile`, and message-link resolution accept any real path under the project root, the workspace root, or the OS temporary directory. Every mutation — save, create, rename, move, delete, upload — and every directory listing or search stays contained by the project root. A match outside the project reports its absolute path as its `relativePath`, because a `../../..` string is not a useful reference.

## Rejected

Containing reads to the project root, as upstream does, makes a chat link to a snapshot in the temp directory or to a file in another checkout fail with 403 in the Files tab. Removing containment entirely, or widening writes to match reads, gives the HTTP surface reach it has no reason to have.

## Why

CLIde is single-user and already ships a shell and an agent with full filesystem access under the same login, so the read guard was never the security boundary — it only stopped links from opening. Keeping writes project-scoped preserves the boundary that still does work: a traversal bug cannot overwrite anything outside the project. This is a fork-only divergence; an upstream rebase that restores the narrow guard is reverting a deliberate choice, not fixing a bug.
