# Source Control: review a session's work, then commit, merge or open a pull request

- Status: 1/7
- Next: Grayson agrees the design; then Phase 0 item 1, starting with a live check of the commit-error path
- Context: ADRs [0016](../decisions/0016-repository-grouped-checkouts.md),
  [0028](../decisions/0028-worktree-creation-precedes-phase-0.md),
  [0029](../decisions/0029-per-row-session-views-load-before-they-filter.md),
  [0033](../decisions/0033-discovered-checkouts-are-derived-not-stored.md)
  · TODO item: Source Control
- Design: [Source Control](../designs/source-control.md) binds every phase

Upstream v1.37's Worktrees feature is not exposed as shipped. Its parsing, listing,
validation and rollback primitives get harvested onto ADR 0016's model, and its
identity, integration and cleanup behaviour get replaced.

## Phases

- [~] **0. Make existing Git state truthful and switching safe.** This gates
      everything below. Each item is small and ships alone, and several can go
      upstream.
  1. Return structured errors from every consequential operation, show them beside
     the action that failed, and keep what was typed. The commit path already
     returns hook stderr to the panel header (`6dc05b23`, read from source): check
     that live, then give push, pull, checkout, merge and discard the same shape.
  2. Return conflicts separately from ordinary modifications.
  3. Detect merge, rebase, cherry-pick and revert in progress.
  4. Render a detached `HEAD` as `Detached at <sha>`, never as a branch. Report an
     unborn branch (a new repository with no commits yet) separately.
  5. Keep canonical local and remote refs intact end to end, so `origin`,
     `upstream` and other remotes stay distinguishable.
  6. Let a new repository's initial branch be chosen, suggesting Git's own setting
     or `main`.
  7. Build **one** shared checkout-mutation preflight, used by the branch
     switcher, merge and removal. It refuses dirty or conflicted switches, reports
     a branch already checked out in another worktree, and refuses or elevates
     mutations of the checkout serving CLIde.

- [~] **1. Repository and checkout inventory.** Read-only.
  - [x] Repository identity from `git rev-parse --git-common-dir`, and one
        sidebar row per repository with sessions labelled by branch (ADRs 0016,
        0029).
  - [x] Worktree *creation* (ADR 0028), and listing worktrees made outside CLIde
        (ADR 0033).
  - [ ] Structured local and remote refs in place of the branch string arrays.
  - [ ] Per checkout: branch, tracking ref, dirty, conflict and in-progress state,
        last activity, and the occupancy CLIde can prove (agent, terminal, dev
        service, branch test, serving).

- [ ] **2. Review in the Git tab.** Start with one probe page covering every
      level: Changes, a file's diff, a line comment, the commit, merge and
      pull request sheets, History, Branches, and the chat's `+N −M` link. It
      gets checked on the phone before any of it is built. Then build Changes with
      on-demand per-file diffs, collapsed large and generated files, viewed chips,
      line comments drafted per `session_id`, and "Send N comments" filling the
      composer. Add the chat link, and restyle History and Branches onto the same
      components.

- [ ] **3. Commit, push and pull request from the review.**
  1. A commit sheet with the generated message, file checkboxes and Commit, then
     Push on the default branch.
  2. A host capability read: whether the GitHub CLI is installed and signed in
     for the remote's host, shown when it is missing.
  3. A pull request sheet that resolves `owner/repo` from the push remote and
     passes it explicitly. Test it against a fork fixture where `origin` and
     `upstream` differ.
  4. "Ask for a review": each adapter declares its review command or none.
     Verify Codex, Cursor and OpenCode before declaring theirs.
  5. The commit message's model is a provider and model pair chosen in the
     sheet, kept per user on the server. Claude and Codex generate it as a
     one-off job that leaves no transcript or session, never changes the chat's
     model, and shows a provider failure instead of canned text.

- [ ] **4. Isolated sessions.**
  1. Live-check worktree creation. What shipped in Phase 1 has only static
     coverage (`worktree.service.test.ts`).
  2. The launcher's worktree choice becomes one Isolated toggle with a base ref.
  3. A per-project worktree setup command, run once with streamed output. A
     failure keeps the checkout and shows the output.
  4. Occupancy in the review header and the sidebar: other live sessions in the
     same checkout.

- [ ] **5. Merge into the base and remove a worktree.**
  0. A read-only Compare (upstream `#1369`): pick a base ref, list the files that
     differ from the merge base, and load each diff on demand. It may come before
     the rest of this phase, but not before Phase 0 item 1.
  1. A merge sheet with explicit source and target. Squash by default;
     fast-forward and a merge commit under Advanced. It runs only in the resolved,
     clean target checkout. A conflict aborts and the target is shown to be
     restored. Merging into the serving checkout says whether a build or restart
     follows.
  2. Removal as a separate action that keeps the branch by default. It refuses
     while there is uncommitted, unmerged (by tree comparison, so a squashed branch
     counts as merged) or unpushed work. The Worktrees page shows each worktree's
     age and size.
  3. Verification, push, pull request, worktree and branch stay **separate**
     actions. There is no single "Finish".

- [ ] **6. Per-hunk stage and revert**, on the line addressing from Phase 2.

## Done when

On the phone, with no terminal:

> An agent's edits sit uncommitted on `main`. I open the review from the chat,
> comment on two lines and send them, see the fix land, then commit with the
> generated message and push. In an isolated session I do the same and end with a
> squash merge into `main` or a pull request on my own fork. The worktree goes only
> when I remove it. The review header warns me when another session is live in the
> same checkout.

Mutating worktree routes stay unregistered, and their controls unreachable, until
every one of these holds: the preflight protects dirty, occupied, locked, active and
serving checkouts; conflicts, detached `HEAD` and in-progress operations can be
represented; every server refusal reaches the screen; and no modal uses backdrop
filtering (ADR 0001).

Tests needed, at minimum:
- ref parsing that keeps same-named refs on `origin` and `upstream` distinct
- a detached `HEAD` with a short SHA and no fake branch
- conflicted files kept separate from staged and modified
- operation-in-progress detection
- dirty and conflicted switches refused before `git checkout` runs
- an occupied branch returning the existing checkout's path
- a mutation of the serving checkout refused without elevation
- each mutation's failure shape
- the pull request resolving its target from a fork
- a squashed branch counting as merged
- the comment-to-composer message format

## Not doing

- Everything in [the design's](../designs/source-control.md) "Not doing".
- Stable opaque checkout IDs. Identity stays derived from the path, so moving a
  worktree directory breaks continuity with its sessions. That is accepted, because
  providers key their transcripts by path too.
- Keeping unused, unregistered upstream code to claim parity. A primitive lands only
  once something uses and tests it.
