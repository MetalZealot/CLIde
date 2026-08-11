# 0033 — A worktree with no project row is listed, not registered

- Date: 2026-08-10
- Status: Accepted

## Decision

The projects API lists every worktree of an already-listed repository, including
those with no row in the `projects` table. Such a checkout is **derived per
request and never written**: it carries `isDiscovered: true` and a synthetic
`projectId` (`discovered:<path>`), holds no sessions, and is not a valid target
for any project-scoped call. A single explicit action — the Add button in the
Worktrees panel — turns it into a real row via the existing `create-project`
endpoint. A path that already has a row, **archived or not**, is never offered.

## Rejected

- **Writing a project row on discovery.** It makes a checkout immediately
  starrable, renamable, and colourable, at the cost of a row for every throwaway
  worktree ever created and a dead row for every one deleted from disk. The
  sidebar would accumulate exactly the debris the user cannot currently see.
- **Rediscovering archived checkouts.** Archiving is deliberate; re-offering the
  path makes it unarchivable.
- **Deriving each discovery's `repositoryId` from the porcelain output.** It is
  read instead through `readCheckoutIdentity`, the same function that produced
  the registered rows' ids, so the grouping join cannot drift between the two.

## Why

Before this, a project row appeared in exactly two ways: the in-app creation
flow, or the session synchronizer recording a transcript's `cwd`. A worktree
created from a terminal, a script, or an agent session satisfied neither, so it
was invisible and unreachable — the only recovery was knowing to retype its
absolute path into the create-project dialog. On the development machine three
of ten worktrees were in that state.

Deriving rather than storing follows ADR 0016, which keeps repository identity
out of the schema so that no migration and no session rebinding is involved. The
same reasoning holds here and buys the property that matters: a worktree removed
from disk stops being listed, with nothing to clean up. Persisting on sight
would have made "it appeared on its own" and "it stayed after I deleted it" the
same feature.

Listing is read-only and additive, so ADR 0028's boundary — additive worktree
work may precede ADR 0016's Phase 0, destructive work may not — already covers
shipping it now. Nothing here refuses an operation or renders git status, which
is what Phase 0 is the gate for.

The synthetic id is the one deliberate oddity. Allowing `projectId: null`
instead would push a null check into every consumer of a project list to make
one transient case representable; the prefix keeps the type honest, and
`isDiscoveredCheckout` is what code actually branches on. Because such an id
matches no row, discovered checkouts are also excluded from the lead-checkout
choice and from the per-worktree session filter — a lead is the target of
rename, accent colour, and TaskMaster, and a checkout with no sessions filters
nothing.
