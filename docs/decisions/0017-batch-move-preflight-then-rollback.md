# 0017 — A batch move preflights everything, then rolls back in reverse

- Date: 2026-07-28
- Status: Accepted

## Decision

`PUT /api/projects/:projectId/files/move` takes the whole source set
(`sourcePaths[]`) and moves it in **one** server operation
(`file-move.service.ts`). The service validates the complete batch before the
first `rename` — every source exists and resolves under the real project root,
the destination is a directory outside the selection, no two sources share a
basename, no target already exists, nothing crosses a device — and only then
starts renaming. Renames that fail *anyway* are undone in reverse order.

Three consequences are load-bearing:

1. **Predictable failures change nothing on disk.** A conflict, a missing
   source, a destination inside a selected folder: all are rejections with a
   structured `code` (and `conflicts`), not partial work.
2. **A rollback that itself fails returns `MOVE_PARTIAL`, never a generic
   error.** It names the paths left in the destination. The client is not
   allowed to claim success it cannot verify.
3. **Sources already in the destination are explicit no-ops**, reported as
   `skipped` rather than errors, so a selection spanning several parents still
   moves the rest.

Canonicalization (drop duplicates, drop anything covered by a selected ancestor
directory) runs on both sides. The client copy exists for honest payloads and
counts; the server copy is the trust boundary.

## Rejected

- **Calling the existing single-item endpoint N times from the browser.** The
  obvious implementation, and the reason this ADR exists: a conflict on item 4
  of 6 leaves the user with a half-moved selection, no record of which half,
  and no way to undo it. Network flakiness makes it worse, not better.
- **Best-effort partial success** (move what you can, report the rest). It
  produces the same unrecoverable half-state, just with a friendlier message.
- **Treating "already in the destination" as an error.** It would reject the
  common real case — sweeping a mixed selection into a folder some of it is
  already in.
- **Auto-resolving duplicate basenames** by numbering or overwriting. Two files
  named `readme.md` from different folders is a question for the user, not a
  naming policy to invent; the batch is rejected with both paths named.
- **Realpath'ing the source itself** for the containment check. That would
  follow a symlink and move its target instead of the link. Only the source's
  *parent* is resolved — enough to stop an escape, without changing what moves.

## Why

Filesystems offer no database-style atomicity, so the safety has to come from
ordering: exhaust every knowable failure while the filesystem is still
untouched, and keep rollback for the genuinely unforeseeable (an `EACCES` on
one entry, a racing external delete). Rollback is a backstop, not the plan —
if it were the plan, every conflict would depend on it working.

Evidence: 23 temp-directory tests in
`server/modules/projects/tests/file-move.service.test.ts` cover the matrix,
including a simulated mid-execution failure with clean reverse rollback and a
simulated rollback failure surfacing as `MOVE_PARTIAL`. None touch a real
project or the user database.

The move response returns old-to-new mappings, which is what lets an open
editor follow a file it is holding instead of saving back to a path that no
longer exists (`51af9ba`).
