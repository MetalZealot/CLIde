# Diffs and Previews: each chat in its own copy, reviewed, previewed and merged

- Status: 0/8
- Next: after the runtime rebuild — Phase 0 item 1, starting with a live check of the commit-error path
- Context: ADRs [0016](../decisions/0016-repository-grouped-checkouts.md),
  [0028](../decisions/0028-worktree-creation-precedes-phase-0.md),
  [0029](../decisions/0029-per-row-session-views-load-before-they-filter.md),
  [0033](../decisions/0033-discovered-checkouts-are-derived-not-stored.md)
  · TODO item: Diffs and Previews
- Design: [Diffs and Previews](../designs/source-control.md) binds every phase

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

- [ ] **2. A copy per chat.**
  1. Live-check worktree creation; what shipped in Phase 1 has only static coverage
     (`worktree.service.test.ts`).
  2. The launcher's Own copy toggle: on for git projects, last choice remembered per
     project, base ref chosen. Branch `clide/<slug>-<short id>`.
  3. A per-project setup command (CLIde: `npm ci` and the Claude memory link), run
     once in the background with streamed output; setups queue one at a time; the
     first turn waits with a timer. Failure: output, Retry, or Continue on `main`.
  4. `main` chats: occupancy (other live sessions) in the Diffs header and sidebar.
  5. Measure the setup wait in real use; if it drives chats back to `main`, keep one
     prepared copy ready.

- [ ] **3. Diffs.** One probe page first, covering every level on the phone: the
      bar with Diffs and Preview, the review, a file's diff, a line comment, the
      merge and pull request sheets, the Repository sheet, the scope picker and view
      toggles, the per-turn edited-files card (short list and folder tree) and the
      finished-session card. Then build:
  1. Turn snapshots: a tree via a temporary index at each turn's start and end,
     pinned under a hidden ref, deleted with the copy. Hooks the rebuilt runtime's
     own turn start and end; if it exposes neither, add that there first.
  2. The review (branch against base plus uncommitted; on-demand per-file diffs;
     collapsed large and generated files; viewed chips; line comments drafted per
     `session_id`; "Send N comments" filling the composer), "base moved".
  3. Scopes This chat, Last turn, Turn ▸, Not committed yet; wrap and whitespace
     toggles; split view on wide screens only.
  4. The per-turn card in the chat, counted from snapshots.
  5. The Repository sheet (History, Branches, fetch, pull, push on the shared row
     and diff components).

- [ ] **4. Previews.**
  1. A per-project preview command; CLIde's generalises `cloudcli-branch-test`
     (database snapshot, fake home, build, serve).
  2. Each preview a systemd user unit on a tailnet-bound port range; builds queue one
     at a time; idle stop after 30 minutes; a MemAvailable floor (600 MiB to start
     with), set from a measured build peak.
  3. The Preview tab: start, build log, the live page inline (Open in browser when a
     project refuses framing), Open in browser, Have the agent check it (the chat's
     Browser on the same address), Restart, Stop, why it stopped.
  4. Phone addresses: 3002 and 3003 become proxies behind the existing 9442 and 9443
     routes, pointed at any preview without `sudo`.
  5. Reconcile Pi-Ops (`reconcile-pi-ops`) to list previews and drop the fixed slots.

- [ ] **5. Commit, merge and pull request.**
  1. Merge sheet: explicit source and target, squash by default, the preflight,
     what follows for a serving checkout (build offered, restart left explicit),
     "Remove this copy" ticked. A conflict aborts, restores the base and offers
     Update from main, which the chat's agent resolves in its copy.
  2. Copy removal refuses uncommitted, unmerged (tree comparison) or unpushed work
     and keeps the branch unless asked; the Worktrees page shows age, size and chat.
  3. Commit sheet for `main` chats: generated message, file checkboxes, Commit, Push.
  4. Host capability read (GitHub CLI installed and signed in for the remote's host)
     and a pull request sheet that resolves `owner/repo` from the push remote and
     passes it explicitly; tested against a fork fixture.
  5. "Ask for a review": each adapter declares its review command or none; verify
     Codex, Cursor and OpenCode before declaring theirs.
  6. The commit message's model is a provider and model pair chosen in the sheet,
     kept per user on the server, run as a one-off job that leaves no session.

- [ ] **6. Switch the workflow.** Update `AGENTS.md` and both global rules files:
      chats work in their own copy and commit freely on its branch; Grayson tests in
      the Preview; Merge is his. Retire the two branch-test slots once previews cover
      them.

- [ ] **7. Per-hunk stage and revert**, on the line addressing from Phase 3, and
      **Undo the latest turn** from its card: preflight, refusal naming files changed
      since, and a note to the agent in the next message.

## Done when

On the phone, with no terminal:

> I start a chat with its own copy and send while it sets up. When it finishes, I
> open Diffs, comment on two lines and send them, see the fix land, start its
> Preview, try it on phone address A, then squash-merge it into `main` and remove
> the copy. Two chats running at once never see each other's edits. A quick job on
> `main` still works, and its Diffs header names the other sessions there.

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
- a copy's setup queued behind another, and a first turn that waits for it
- a preview refused under the memory floor, and stopped after idle
- a phone address re-pointed between previews
- a squashed branch counting as merged
- the comment-to-composer message format
- a turn's diff including a shell-command edit, and excluding the turn before
- a turn snapshot leaving the index, branch and files untouched, and surviving gc
- a `main` chat's turn scope refused when another session overlapped it
- Undo refused when a touched file changed after the turn

## Not doing

- Everything in [the design's](../designs/source-control.md) "Not doing".
- Stable opaque checkout IDs. Identity stays derived from the path, so moving a
  worktree directory breaks continuity with its sessions. That is accepted, because
  providers key their transcripts by path too.
- Keeping unused, unregistered upstream code to claim parity. A primitive lands only
  once something uses and tests it.
