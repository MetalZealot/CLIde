# 0025 — Per-session model picks live in the sessions table, behind transcript truth

- Date: 2026-08-04
- Status: Accepted
- Supersedes the storage half of
  [0003 — Active model is tracked per session; transcript is ground truth](0003-per-session-model-tracking.md).
  0003's precedence rule is unchanged and still governs.

## Decision

A session's model pick is stored on its `sessions` row, in upstream 1.37's
`model` column, plus a `model_updated_at` column of ours. The pre-existing
sidecar file `~/.cloudcli/provider-session-active-model-changes.json` is gone;
its entries are imported once, on migration.

The pick does **not** outrank the transcript. `pickSupersedesTranscript` is
untouched: a pick applies only while it is at least as recent as the last
recorded turn. Upstream reads their column first; we read it second.

## Rejected

**Keeping the sidecar.** It sat outside `auth.db`, so outside the backup
routine, outside the migration system, and outside any transaction with the
session rows it described. Nothing about a per-session value justified storing
it beside the database rather than in it.

**Taking upstream's column as-is, without `model_updated_at`.** Their column
records what the last send used and is read ahead of transcript evidence, so it
needs no timestamp. Ours has to lose an argument with the transcript, and a
timestamp is the only thing that can settle it. Adopting the bare column would
have quietly converted ADR 0003's precedence into "the pick always wins" — the
exact behaviour 0003 exists to prevent — while looking, in the diff, like pure
storage cleanup.

**Adopting upstream's precedence and retiring 0003.** Their model cannot see a
model changed outside the app. Typing `/model` in the Shell, or toggling fast
mode, writes a turn to the transcript and touches no column; upstream's stored
value is then wrong with no way to notice. A web UI that sits beside a CLI the
user also drives directly cannot assume it saw every change.

## Why

The two designs were never in conflict — they answer different questions.
Upstream answered "where is this kept?", and a database column is the right
answer. CLIde answered "who wins when two sources disagree?", which upstream
never asked. Taking one answer from each is not a compromise between them; it
is the union.

Sharing upstream's storage also shrinks the permanent divergence in the single
hottest contested file set. What remains uniquely ours is one precedence rule in
one function, which is far cheaper to carry across an upstream bump than a
parallel storage mechanism plus its file format, its path helper, and its own
serialization.

The migration is deliberately non-destructive in both directions: rows that
already carry a model are never overwritten, and the sidecar file is left on
disk rather than deleted, so a rollback to before this change still finds its
data where it expects.

## Notes

The `<synthetic>` incident (`422411f`, upstream PR siteboon#1056) is often read
as evidence against the transcript being consulted at all. It is not. The
unguarded extraction predates this fork — it is present at the merge base,
v1.36.3, and upstream still has it. What differed was reachability: upstream
consults the transcript only for display, so a placeholder shows up in the
`/models` popup, whereas here it reached the send path. The lesson recorded for
next time is to validate a transcript-derived model against the catalog at the
boundary rather than guarding each extraction site — see TODO.md.
