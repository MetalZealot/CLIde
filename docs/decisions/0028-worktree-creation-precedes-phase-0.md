# 0028 — Creating a worktree ships ahead of ADR 0016's Phase 0; removing one does not

- Date: 2026-08-05
- Status: Accepted

## Decision

ADR 0016 rejected "adding worktree creation/removal UI first" and sequenced it
behind a Phase 0 of truthfulness fixes. That rejection is narrowed here to the
half it was actually arguing about:

- **Creating a worktree may ship before Phase 0.** `git worktree add -b` is
  purely additive — a new directory, a new branch, no change to any existing
  working tree — and it reports its own failures.
- **Removing a worktree, deleting a branch, and integrating one branch into
  another stay behind Phase 0**, unchanged.

The boundary is destructiveness, not the `git worktree` command family.

## Rejected

- **Holding creation until Phase 0 lands**, as ADR 0016 read literally. It would
  have blocked the only Phase 2 capability that carries no risk behind four
  status-rendering fixes it does not depend on.
- **Reversing the branch's worktree work to restore the original order.** The
  work is sound and non-destructive; the sequence was the thing that was wrong,
  and only in the sense that nobody had written down why it was allowed.
- **Editing ADR 0016.** ADRs are append-only.

## Why

ADR 0016's stated reason was: *"Guarded destructive operations cannot be built
on a panel that cannot display a refusal."* Every Phase 0 gap it lists is a
**status-rendering** defect — conflicts folded into `modified`, no
`MERGE_HEAD`/`REBASE_HEAD`/`CHERRY_PICK_HEAD` detection, detached HEAD rendered
as a branch named `HEAD`, and commit failures discarded silently. Each one
matters when the UI must show *why an operation was refused*, or must be trusted
before something is destroyed.

Creation touches none of that. It reads no status, refuses nothing, and its only
failure modes (branch exists, path taken, branch already checked out elsewhere)
come back as git's own stderr and are shown verbatim
(`worktree.service.ts`, `WORKTREE_ADD_FAILED`). A user who creates an unwanted
worktree has an extra directory; a user who removes one on an untruthful panel
can lose committed work. Those are not the same risk and were sequenced as if
they were.

Recorded after the fact: the work on `feat/repository-grouped-checkouts` landed
creation while Phase 0 remained open, and this ADR ratifies that rather than
pretending it was planned. The value of writing it down is the boundary — a
future session reading ADR 0016 alone would either "fix" creation back out, or
take it as licence to add removal and merge on the same footing. Neither is
right.

Phase 0 is still the gate for everything else, and the spec's implementation
sequence keeps it as Phase 0
(`docs/specs/2026-07-26-git-source-control-workspace-ux.md`).
