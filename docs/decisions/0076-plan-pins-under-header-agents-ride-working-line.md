# 0076 — The plan pins under the header; running agents ride the Working line

- Date: 2026-10-09
- Status: Accepted; narrows 0060 for an agent's whole transcript

## Decision

A session's plan (Claude's task list, Codex's plan) is one collapsible banner
under the chat header with a progress bar, and its tool calls fold into the
activity rows instead of drawing rows of their own. Running agents show as a
robot and a count at the right end of the turn's Working line, which lists them
in place with Stop. An agent opens its whole transcript full screen; 0060 still
governs a single call's detail. Background commands get no surface beyond their
chat row, which shows running or done. Sidebar session rows show plan progress
and running agents.

## Why

The maintainer chose variant K from two probe rounds (2026-10-09) measured
against Claude Code, Claude desktop, Codex, VS Code and Cline, all of which take
the checklist and running agents out of the transcript. Agents keep the turn
open, so their count belongs on the line that says the turn is still working; a
"2 agents" label there truncated the Working text at 412px, so it is an icon and
a number. Agents ran in 8 of 66 recent sessions and a plan in 3, so neither may
add chrome when absent.
