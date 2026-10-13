# 0078 — Agents and background commands sit behind one header button

- Date: 2026-10-10
- Status: Accepted; supersedes 0076 for agents and background commands, and for a finished plan; its header button and list superseded by 0080; its finished plan superseded by 0081

## Decision

A session's agents and background commands share one full-screen list behind a
layers button beside the usage ring, always present in a session's chat (muted
when idle, so the header never shifts) and badged with a running count; each opens full
screen and has Stop while it runs, and finished ones stay under Done until
cleared. The Working line no longer counts agents, a finished plan keeps its
banner muted until a new plan replaces it, and the title replaces the kebab as
the header menu's trigger, headed by the full title, which renames the session
in place.

## Why

The live check (2026-10-10) found finished agents unreachable once the Working
line left with the turn, and finished plans vanishing; peers (Claude desktop's
Background tasks pane, Codex `/ps`, Cursor's jobs list, VS Code 1.141) keep agents
and shells in one list outside the transcript, and Cursor and Codex both fixed
checklists that disappeared. The maintainer chose the header button (round-3
variant N) as the place for work tied to the chat.
