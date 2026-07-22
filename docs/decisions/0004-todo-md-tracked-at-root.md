# 0004 — TODO.md is tracked in-repo, at the repo root

- Date: 2026-07-22
- Status: Accepted

## Decision

`TODO.md` (the fork's working backlog) is a tracked, committed file at the repo
root (`ac21a0f`). It doubles as the coordination board for concurrent sessions:
a session picking up an item on a topic branch tags it
`— in progress on <branch>` and commits the claim before touching code.
`UI Visual References/`, which TODO items link to, stays in `.git/info/exclude`.

## Rejected

- **Keeping it excluded** (`.git/info/exclude`, the status quo since 2026-07-14,
  chosen so a personal working file never showed in `git status`/diffs). This
  required a mandatory `cp TODO.md ~/TODO.pre-rebase.md` before every rebase,
  because an excluded file whose *old name* (`wishlist.md`) had a tracked
  add→delete arc in history got silently clobbered on every rebase replay
  (bit us 2026-07-17; recovered from Claude Code file-history).
- **Moving it to `docs/`** (considered at tracking time). `docs/` holds durable
  documentation — ADRs, specs — while TODO.md is live working state with a
  different lifecycle; a root-level TODO is the recognized convention and stays
  maximally visible at session start, when the workflow says "check the board."

## Why

The exclusion's benefit (a quiet `git status`) stopped paying for its costs:
the rebase-clobber hazard and backup ritual, and — decisive once concurrent
worktree sessions became a supported workflow — the fact that an untracked file
exists only in the main checkout, so other sessions can neither read the board
nor see claims. Tracked, git itself is the sync and safety mechanism: rebase
protects the file, worktrees see one shared board via commits, and `git log`
shows who claimed what. The file was reviewed before tracking — it contains
only project notes, fine to publish on the fork.
