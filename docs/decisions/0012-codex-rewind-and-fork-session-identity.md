# 0012 — Codex rewind replaces a stable session; fork creates another

- Date: 2026-07-25
- Status: Accepted

## Decision

CLIde exposes two distinct Codex App Server operations. `/rewind` and the
user-message pencil create a provider fork before the selected turn, then move
the existing stable CLIde `session_id` to that child thread; `/fork` preserves
the parent and allocates a separate stable CLIde session for the full-thread
child. Rewind records the superseded provider id as an alias and updates the
new transcript path with the mapping, while disk-discovered top-level children
retain their `forked_from_id` context through a `(fork)` lineage title.

## Rejected

- App Server `thread/rollback`, because it is deprecated and does not restore
  files.
- Treating every provider child as a new CLIde session, which makes an
  edit/rewind appear as a duplicate conversation.
- Silently merging every disk-discovered Codex child into its parent: Codex
  writes the same `forked_from_id` for shell prompt editing and explicit
  `/fork`, so persisted metadata cannot recover the user's intent.
- Showing rewind/fork controls while CLIde is on the Codex SDK transport.

## Why

CLIde owns stable public session identity while provider thread ids are
replaceable implementation details. Codex App Server 0.144.6 can fork through
`lastTurnId` but cannot fork directly before a turn, so a middle rewind forks
through the selected turn's predecessor and a first-turn rewind starts a clean
thread. This matches the existing Claude edit/rewind UX, preserves intentional
forks, and prevents both stale-history races and watcher-resurrected duplicate
rows.
