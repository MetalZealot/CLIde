# 0027 — The backlog lives at `docs/TODO.md`

- Date: 2026-08-04
- Status: Accepted
- Supersedes the location half of [0004](0004-todo-md-tracked-at-root.md)

## Decision

The tracked backlog moved from the repo root to `docs/TODO.md` in the docs
flattening (`666eb11`), which also replaced `docs/superpowers/{specs,maps,plans}`
with `docs/{specs,maps,plans}`. Everything else 0004 decided still holds: the
board is tracked and committed, it doubles as the claim board for concurrent
worktree sessions, and `UI Visual References/` stays in `.git/info/exclude`.

## Rejected

- **Leaving it at the root**, as 0004 chose. Root visibility was the argument,
  and it was a real one — but the root had accumulated enough top-level files
  that "maximally visible" had stopped being true, while every agent-facing
  document already routed readers into `docs/` for ADRs, specs, and maps.
- **Silently editing 0004** to say `docs/`. ADRs are append-only; a decision
  that reversed needs a visible reversal.

## Why

The move itself was incidental to a docs reorganization, but it left both agent
guides half-updated: `AGENTS.md` and `CLAUDE.md` each cited `docs/TODO.md` in
one place and bare `TODO.md` in another, and 0004 — titled "at the repo root" —
was the authority a reader would check to resolve the conflict. Recording the
move makes `docs/TODO.md` the single answer.

Note for future readers of 0004: its closing line ("it contains only project
notes, fine to publish on the fork") is the standing test for anything tracked
here. `AGENTS.md` is tracked and published on the fork, so host- and
deployment-specific detail — absolute home paths, the tailnet hostname, systemd
unit names — stays in the ignored local `CLAUDE.md` instead.
