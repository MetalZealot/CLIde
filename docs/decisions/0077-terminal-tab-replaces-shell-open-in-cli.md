# 0077 — A plain Terminal tab takes Shell's place; Shell opens from the chat kebab

- Date: 2026-10-10
- Status: Accepted; replaces the second item of 0057's bar

## Decision

The bar reads Chat, Terminal, Files, Source Control and 0057's slot. Terminal is a
plain shell in the selected checkout. The Shell view, which reopens the open chat in
its provider's own CLI, leaves the bar and opens from "Open in CLI" in the chat's
header menu, shown only once the chat has a session.

## Rejected

Keeping Shell as a tab: no compared app (T3 Code, Codex and Claude desktop) puts a
resume-in-the-CLI view in its tab bar, and all of them offer a plain terminal, which
CLIde lacked.

## Why

The phone bar has five places, so a terminal could only arrive by displacing Shell,
which is a per-chat action rather than a place to work.
