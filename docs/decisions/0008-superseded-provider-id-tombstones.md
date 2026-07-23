# 0008 — Superseded provider ids are tombstoned, not deleted

- Date: 2026-07-22
- Status: Accepted

## Decision

When `assignProviderSessionId` *re*assigns a session row away from an earlier
provider id (a first-message rewind fresh-starts a new provider session; any
provider id rotation), the old id is recorded in a new
`session_provider_aliases` table. The synchronizer treats aliased transcripts
as claimed and never resurrects them as sidebar rows. Tombstones deliberately
have **no FK to sessions**, so they outlive a deleted owner. A collision guard
in `createSession` additionally refuses to let a discovered transcript clobber
a row whose provider mapping has moved elsewhere.

## Rejected

- **Deleting the abandoned jsonl** — never destroy user transcript data.
- **Archived tombstone rows in `sessions`** — the synchronizer upsert sets
  `isArchived = 0` on every touch (deliberate: terminal-CLI activity should
  resurrect archived sessions), so archiving is not sticky.
- **A `merged_into` column on `sessions`** — would require filtering every
  session list query; a separate table keeps the live table clean.
- **Avoiding the fresh start entirely** — `resumeSessionAt` demands an
  assistant uuid, and a first-message edit has no assistant ancestor, so a
  fresh provider session is unavoidable for that case.

## Why

Live testing (2026-07-22) surfaced it immediately: a first-message rewind left
the pre-rewind transcript orphaned on disk, and the synchronizer — correctly,
by its own rules — indexed it as a duplicate sidebar session. Worse, its
`ON CONFLICT(session_id)` upsert could overwrite the live row's new provider
mapping on a later full scan. Fixed in `8d4b8b6` with three regression tests;
the affected live DB was backfilled by hand. Upstream-relevant: any provider
that rotates session ids can hit the same duplication.
