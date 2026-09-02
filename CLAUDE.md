# CLAUDE.md

@AGENTS.md

`AGENTS.md` above is the canonical guide for this repository and is shared by every
agent that works here.

Host-specific facts — absolute paths, ports, service and unit names, the deploy loop,
which port to verify on — are deliberately **not** in this repository, because it is
published. They live in each agent's own host-local config: `~/.claude/CLAUDE.md` for
Claude Code, `~/.codex/AGENTS.md` for Codex. That keeps this file publishable and lets
every checkout, including a worktree, get the same project guide straight from git
with no per-checkout setup.

If you are working in a git worktree of this repo, treat it as a topic branch: never
build or deploy it to the production port.
