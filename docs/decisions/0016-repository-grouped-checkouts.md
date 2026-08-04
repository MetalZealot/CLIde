# 0016 — Projects group checkouts by repository; a project is not a directory (intentional divergence from upstream)

- Date: 2026-07-27
- Status: Accepted

## Decision

Source Control adopts the object model used by Codex, Cursor, Zed and VS Code's
worktree support: **repository, checkout and branch are three distinct objects**,
and a CLIde project is an organisational container that shows *every checkout of
its repository* — main checkout plus linked worktrees — with each one's branch,
tracking state, dirty state and agent occupancy visible in one place.

Concretely:

- **Repository identity is `git rev-parse --git-common-dir`.** Every checkout of
  one repository resolves to the same value, so it is a join key derivable from
  data CLIde already stores. No user input, no session-data migration.
- **`projects.project_path` stays the checkout identity**, and
  `sessions.project_path` stays the thread's target. Grouping is a layer added
  *above* the existing rows. The change is additive.
- **Checkout identity remains path-derived.** Accepted deviation: moving or
  renaming a worktree directory breaks continuity with its sessions and the
  provider's transcripts.
- **No `Environment` entity.** CLIde is single-host; execution location is a
  property of the server, not of a thread.
- Branch and checkout never share an icon, a label, or a list.

Design: `docs/specs/2026-07-26-git-source-control-workspace-ux.md`.

## Rejected

- **Upstream's model — "the current directory plus a branch picker".** It cannot
  express a second checkout at all: `git worktree add` plus a session in the new
  directory produces an unrelated top-level project, because `project_path` is
  `NOT NULL UNIQUE` and is the only identity in the schema. Nothing records that
  two directories share a repository. Upstream's own direction (a draft worktree
  *toggle*, PR #578, noted in `TODO.md`) treats worktrees as a display option
  rather than an object, which does not reach the goal.
- **Stable opaque checkout IDs**, the technically correct identity. Rejected as
  currently unreachable: CLIde's schema is path-keyed *and* Claude Code stores
  transcripts under `~/.claude/projects/<encoded-path>`, which is not ours to
  change. Path-derived identity is a known limitation, recorded rather than
  designed around.
- **Modelling `Environment` as a first-class entity**, as the external
  2026-07-27 UX reference proposed. There is no SSH-host, container or
  cloud-execution concept anywhere in the schema or the provider adapters; it
  would add a table with one row and a chip rendering a constant. Its useful
  half — never label the main checkout "Local" — is kept.
- **Adding worktree creation/removal UI first.** Sequenced behind a Phase 0 of
  truthfulness fixes instead (see Why).

## Why

The goal is observing concurrent agents in one project. Agents working in
parallel worktrees is the normal case this fork is being built for, and today
they scatter across unrelated sidebar entries with no indication they are the
same codebase — the single largest gap between CLIde's Source Control and what
a current agentic IDE offers.

Grouping by `--git-common-dir` buys that view without touching session binding,
which is why it is worth doing despite the divergence. It also makes the
concurrency hazard visible: several threads sharing one checkout are editing one
working tree and can collide, which the present one-project-per-directory view
hides completely.

**This must be settled before the sidebar revamp.** It changes the sidebar's
data shape from a flat list to a hierarchy; retrofitting that afterwards is the
expensive version.

Verified 2026-07-27, and the reason new power is sequenced behind Phase 0: the
existing panel is not yet truthful about state it already has. Conflicts are
folded into `modified` by `parseGitStatusOutput` and never reach the API; there
is no `MERGE_HEAD`/`REBASE_HEAD`/`CHERRY_PICK_HEAD` detection anywhere in the
codebase; `getCurrentBranchName` returns the literal string `HEAD` on a detached
checkout and the UI renders it as a branch; and a commit rejected by a hook is
discarded silently by `commitChanges`. Guarded destructive operations cannot be
built on a panel that cannot display a refusal.

Known cost accepted, as with ADR 0005: permanent divergence from upstream around
project/session identity and the Git panel, so rebases may conflict there.
