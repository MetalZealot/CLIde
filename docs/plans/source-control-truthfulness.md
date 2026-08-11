# Source Control: truthful Git state, then worktree lifecycle

- Status: 1/4
- Next: Phase 0 item 1 — make server-side Git failures visible in the UI. Nothing
  else in this plan is safe to build until a refusal can reach the screen.
- Context: [repository and checkout identity, and the current truth gaps](../maps/repository-checkout-identity.md)
  · ADRs [0016](../decisions/0016-repository-grouped-checkouts.md),
  [0028](../decisions/0028-worktree-creation-precedes-phase-0.md),
  [0029](../decisions/0029-per-row-session-views-load-before-they-filter.md),
  [0033](../decisions/0033-discovered-checkouts-are-derived-not-stored.md)
  · TODO items: Source Control worktrees and branch integration; Git branch remote
  labels; Git branch-switcher safety; silent commit failures

Merged 2026-08-06 from two documents that described this same sequence with two
different phase lists: the Source Control UX spec and the post-v1.37 worktree
review. Both are archived.

## The decision this plan encodes

Upstream v1.37 ships a Worktrees feature. **Do not expose it as shipped.** Its
backend primitives are useful and testable, but its product contract conflicts
with ADR 0016's identity model, and it adds destructive operations to a panel
that cannot yet represent conflicts, detached `HEAD`, in-progress operations,
remote identity, or self-hosting risk. Adopt compatible non-worktree Git
improvements now; harvest its parsing, listing, validation and rollback
primitives onto CLIde's model later; replace its identity, integration and
cleanup behaviour; reject its destructive defaults, hidden cleanup, hardcoded
layout, and standalone tab.

## Phases

- [ ] **0. Make existing Git state truthful and switching safe.** Prerequisite for
      everything below; each item is small, independently shippable, and several
      are upstreamable.
  1. Return structured server errors on every consequential operation and show
     them. Retain commit input after failure; preserve hook stderr. **This one
     gates the rest** — today `commitChanges` returns `false` for both non-2xx and
     thrown fetches, so a `commit-msg` rejection is a dead button.
  2. Return conflicts separately from ordinary modifications.
  3. Detect merge, rebase, cherry-pick, and revert state.
  4. Render detached `HEAD` as `Detached at <sha>`, never as a branch; report
     unborn-branch state distinctly.
  5. Preserve canonical local and remote refs end to end, keeping `origin`,
     `upstream`, and other remotes distinguishable.
  6. Build **one** shared checkout-mutation preflight — refusing dirty or
     conflicted switches, reporting a branch occupied by another linked worktree,
     and refusing or elevating mutations of the checkout serving CLIde. The
     branch switcher and the later merge flow both use it rather than
     accumulating operation-specific warnings.

- [~] **1. Repository and checkout inventory.** Read-only; no mutation needed.
  - [x] Repository identity from `git rev-parse --git-common-dir`, path-keyed
        project rows grouped by it, sessions still bound to their checkout —
        `repository-identity.service.ts`, ADR 0016.
  - [x] One sidebar row per repository, sessions merged across its checkouts and
        labelled by branch, with per-row session sort and filter (ADR 0029).
  - [x] Worktree *creation*, which shipped here rather than in Phase 2 — ADR 0028
        records why the additive half was allowed to precede Phase 0.
  - [ ] Structured local/remote refs replacing the branch string arrays,
        preserving remote namespaces.
  - [x] Inventory worktrees from `git worktree list --porcelain`, so one created
        outside CLIde is listed rather than invisible — ADR 0033. Locked and
        prunable are parsed but not shown.
  - [ ] Per checkout: branch, tracking ref, dirty/conflict/operation state, last
        activity, and occupancy CLIde can prove (agent, terminal, dev service,
        branch test, serving).

- [ ] **2. Occupancy and workspace lifecycle.**
  1. Show shared-checkout thread counts so concurrent agents are visible. *This
     is the point of the whole plan.*
  2. Safe worktree removal, retaining the branch by default — the destructive
     half, blocked on Phase 0 by ADR 0028.
  3. Live-verify creation. Items shipped in Phase 1 have static coverage only
     (`worktree.service.test.ts`).

- [ ] **3. Explicit integration.**
  1. Choose and display source and target checkout/ref.
  2. Refresh and report merge base, unique commits, changed files,
     fast-forwardability, dirty/operation state, occupancy, and push state.
  3. Default to fast-forward; explicit merge commit when divergence requires one;
     squash, rebase and cherry-pick stay under Advanced.
  4. Execute only in the resolved clean target checkout, protecting the checkout
     serving CLIde. Abort conflicts and prove target recovery.
  5. Report verification, push, pull request, worktree, and branch state as
     **separate** remaining actions. There is no single "Finish" that silently
     verifies, pushes, removes a directory, and deletes a branch.

## Guardrail policy

- **Read-only** (status, log, diff, listings, fetch and merge previews): no
  confirmation. Fetch moves remote-tracking refs, not working files.
- **Working-tree mutations** (switch, restore, discard, delete-untracked, merge,
  worktree removal): state-aware preflight; refuse by default when the target is
  dirty or conflicted.
- **History and remote mutations** (commit, amend, branch deletion, push, tag
  deletion): explicit targets, and never an unqualified force push.
- **Self-hosting protection**: CLIde must know which repository and checkout hold
  its own runtime source, plus any registered dev/test service workspaces, and
  block or elevate actions that rewrite them. A dirty-tree warning does not cover
  runtime disruption.

## Done when

The acceptance test, on a phone, without opening a terminal:

> I can see that CLIde has three checkouts, which branch each is on, and that two
> agent threads are live in the same directory — and I can create a fourth
> worktree from a chosen base and start a session in it.

Mutating worktree routes stay unregistered and their controls unreachable until
all of these hold: identity conforms to ADR 0016; canonical refs and remote
identity survive end to end; conflicts, detached `HEAD` and in-progress
operations are representable; the shared preflight protects dirty, occupied,
locked, active and serving checkouts; creation has a bootstrap contract;
integration has explicit source, target, direction and history policy; removal
proves uncommitted, unintegrated, unpushed, ignored-file and occupancy risks;
branch deletion is independent and defaults off; every server refusal reaches a
visible surface; and no modal uses backdrop filtering (ADR 0001).

Automated coverage this needs, at minimum: canonical local/remote/remote-tracking
ref parsing; same-named refs on `origin` and `upstream` staying distinct; detached
`HEAD` carrying a short SHA and no fake branch; conflicted files separate from
staged and modified; merge/rebase/cherry-pick/revert detection; multiple checkouts
resolving to one repository identity; non-Git projects unchanged; dirty and
conflicted switches refusing before `git checkout`; occupied branches returning
the existing checkout path; serving-checkout mutation refusing without the
elevated policy.

## Not doing

- Upstream's standalone Worktrees tab, its destructive defaults, and its hidden
  cleanup.
- Stable opaque checkout IDs. Identity stays path-derived, so moving a worktree
  directory breaks continuity with its sessions and transcripts — accepted,
  because the provider's on-disk layout is path-keyed too.
- Retaining unused unregistered upstream code to claim parity. Primitives may
  land early only if read-only inventory actually uses and tests them.
