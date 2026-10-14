# 0082 — CLIde runs `!` commands itself, for every provider

- Date: 2026-10-13
- Status: Accepted

## Decision

A `!` draft goes out as `chat.shell`. CLIde's server runs the command in the
session row's folder as a chat run of its own. When it finishes, the server starts
the agent's turn itself, with Claude Code's `<bash-input>`/`<bash-stdout>` block as
the prompt.

## Rejected

Asking each provider to run it: the Claude Agent SDK has no `!` input (0.3.293), and
Codex's native `thread/shellCommand` would cover one provider of four. Having the
browser start the reply turn: a phone that locks mid-command would never send it.

## Why

One path works for all four providers. Being a run gives Stop, the busy state and
reconnect replay for free. The transcript reads the same as a CLI `!` command.
