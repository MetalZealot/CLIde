# Repositories, checkouts, and Git truth gaps

How CLIde currently models Git workspaces, and the specific places where the
data it exposes cannot express what Git is actually doing. Surveyed 2026-07-27,
rescoped 2026-08-05; identity decisions are [ADR 0016](../decisions/0016-repository-grouped-checkouts.md),
[0028](../decisions/0028-worktree-creation-precedes-phase-0.md), and
[0029](../decisions/0029-per-row-session-views-load-before-they-filter.md).
Remaining work: [the Source Control plan](../plans/source-control-truthfulness.md).

## The three objects CLIde has to keep apart

A **repository** is the history and lives once, in the `.git` object database. A
**checkout** is a directory of files produced by pointing that history at one
commit — the main checkout plus any `git worktree add` linked worktrees, each
with its own `HEAD`, index, uncommitted changes, and in-progress merge state. A
**branch** is a label on a commit; it holds no files.

The rule that makes this user-visible: Git refuses to check the same branch out
in two linked worktrees at once. CLIde must detect and name that state rather
than surfacing a generic checkout failure — the useful message says which
checkout already holds the branch and offers to open it.

## What CLIde does today

**A stored CLIde project *is* a checkout.** `projects.project_path` is `NOT NULL
UNIQUE` and is the identity everything downstream hangs off:
`sessions.project_path` is a foreign key to it, and the provider's own
transcript storage is separately keyed by encoded path
(`~/.claude/projects/<slug>`). Threads therefore remain pinned to the checkout
where they run.

**The sidebar presents repositories above those checkout rows.** Git-backed
projects sharing `git rev-parse --git-common-dir` appear as one repository row;
their sessions are merged and retain checkout labels. A linked worktree still
registers as its own stored project, but no longer becomes an unrelated
top-level sidebar entry. The Projects picker also scopes repository rows rather
than raw checkouts, while Activity and Pinned remain global navigation. Each
expanded repository has a sticky Sessions subheader whose create menu starts a
session in its lead checkout or creates a worktree and opens the resulting
checkout as a new session target; its adjacent menu owns session sorting and
worktree filtering.

**The New Session launcher uses the same repository grouping.** Its Project
choice resolves to the repository's main checkout when that checkout is
registered, while its Worktree choice names every registered checkout by its
actual branch or detached-HEAD label. Project and worktree creation reuse the
sidebar workflows; the selected checkout remains the session's `project_path`.

## Identity rules (ADR 0016)

- **`git rev-parse --git-common-dir` is the repository identity.** Every checkout
  of one repository resolves to the same common dir, so it is the join key, and
  it is derivable from a path CLIde already stores. No user input, no session
  migration.
- **`project_path` stays the checkout identity.** Grouping is a layer *above* the
  existing rows, deliberately additive.
- **Checkout identity stays path-derived**, so moving or renaming a worktree
  directory breaks continuity with its sessions and provider transcripts. This is
  an accepted deviation from stable opaque IDs: both CLIde's schema and the
  provider's on-disk layout are path-keyed, and the latter is not ours to change.
- **A checkout can hold several threads.** When it does, say so — those agents
  share one working tree and their edits can collide.
- **Non-Git projects stay ordinary projects.** Grouping enriches Git roots; it is
  not a precondition for using CLIde.
- A worktree registers as an ordinary project row and is absorbed into its
  repository's row by the grouping layer. Rename and archive apply to the
  individual checkout; delete covers the repository, because the row *is* the
  repository.

## What is already strong

Working-tree status grouped by modified/added/deleted/untracked; a real staged
model; stage and unstage; file diffs; commit and initial-commit flows; history
with topology and ref decorations; local-versus-remote branch sections; branch
creation and safe `git branch -d`; tracking status; fetch, pull, push, and first
publish; explicit confirmation on several consequential actions. Evolve this
foundation rather than replacing it.

## The truth gaps

**Consequential failures are discarded silently.** `commitChanges`
(`useGitPanelController.ts`) logs to console and returns `false` for both non-2xx
responses and thrown fetches, and `handleCommit` (`CommitComposer.tsx`) clears the
message box only on success. A commit rejected by a `commit-msg` hook is therefore
indistinguishable from a dead button. **This blocks everything else**: a panel that
cannot show a server-side error cannot host guarded destructive operations, and
every preflight refusal and conflict report depends on it.

**The status contract cannot express conflicts, operations, or detached HEAD.**
`GET /api/git/status` returns `{ branch, hasCommits, modified, added, deleted,
untracked, staged }`, and:

- Conflicts are folded into `modified` on purpose — `parseGitStatusOutput` detects
  `U`/`AA`/`DD` and pushes them there so they can never appear staged. Sound
  intent, but conflict state then cannot leave the server at all.
- No in-progress operation detection exists: no reference to `MERGE_HEAD`,
  `REBASE_HEAD`, or `CHERRY_PICK_HEAD` anywhere in the codebase.
- Detached `HEAD` renders as a branch literally named `HEAD` —
  `getCurrentBranchName` falls back to `git rev-parse --abbrev-ref HEAD`, and the
  UI displays the result as a branch.
- Ahead/behind lives in a separate `/remote-status` call covering only the current
  branch.

Fixing these is a server contract change, not a UI addition.

**Remote identity is lost.** `/api/git/branches` strips `remotes/<remote>/` from
every ref and deduplicates by basename, so the client cannot tell `origin/main`
from `upstream/main`, represent a branch existing on several remotes, or create a
tracking branch from the selected remote ref safely. The API should return
structured refs, not parallel string arrays. This one is an upstream defect — see
[`upstream-candidates.md`](../upstream-candidates.md).

**Checkout has no workspace preflight.** The route validates the branch name and
runs `git checkout <branch>`, with no structured check for dirty files that will
move or block, the intended local branch for a remote ref, a branch already
checked out in another worktree, detached `HEAD`, merge/rebase state, or the
checkout being the one currently serving CLIde.
