# Upstream v1.37.3 picks and a repeatable sync procedure

- Status: 4/5
- Next: Phase 3 — `0d517749`, staged `dist-server` build, awaiting the maintainer's go-ahead
- Context: [upstream sync map](../maps/upstream-sync.md) holds the buckets, the
  refusals and the ledger; [upstream candidates](../upstream-candidates.md) is
  the outbound ledger and is unaffected

Three upstream fixes are worth taking from the 37 commits since `v1.37.0`, and
the assessment that found them was ad-hoc for the fourth release running. This
lands the fixes and the procedure that makes the next assessment mechanical.

## Phases

- [x] 1. `.mts`, `.cts`, `.mjs` and `.cjs` highlight in the editor — four `case`
      lines in `editorExtensions.ts`. `aa2755b8` sits after `#1206`, so it
      touches `src/modules/` and was applied by hand, not cherry-picked
- [x] 2. An archived session survives a rescan — hand-port `bfe7c495`'s
      `CASE WHEN` guard onto both write paths in `sessions.db.ts`, with its
      three tests. Back up the user database first; this touches a session
      write path
- [ ] 3. A failed server build can no longer leave the app without an
      entrypoint — cherry-pick `0d517749`, which stages tsc output into
      `dist-server.next` and promotes it only after `tsc-alias` finishes, with a
      `preserver` recover step. CLIde currently `rmSync`s the live
      `dist-server` before tsc runs, so an out-of-memory build on a small host
      crash-loops until someone rebuilds by hand
- [x] 4. `npm run check:upstream` reports the merge base, the commit span, the
      changelog delta, the PR numbers already carried, and which commits sit
      after the `#1206` restructure — it found `0d517749`, which both assessments
      had missed
- [x] 5. `docs/TODO.md` carries the deferred items and the two bugs above;
      `#1159` is recorded as permanently refused in the map, with the reason

## Done when

- Opening a `.mts` file in the editor shows syntax colour, not plain text
- A session archived immediately after it ends is still archived after the
  sidebar reloads its project list
- `npm run test:server` passes, including the three new `sessions.db` cases
- Interrupting `npm run build:server` leaves `dist-server/server/index.js`
  intact and the app still starts
- `npm run check:upstream` on an unchanged tree names `264e0946` as the merge
  base and lists no unassessed commit
- `npm run check:docs` passes with the new map and this plan

## Not doing

- The Codex SDK move to 0.153.x and the GPT-6 Astra model row. A branch is
  already doing that work along with Send/Queue; this branch must not touch
  `package.json` or the Codex adapter
- Scheduled messages. Already an item in `docs/TODO.md`; the interrupt-versus-
  wait semantics have to be decided before any of it is built
- Extracting the sidebar's inline `t()` fallback strings into locale keys. Real,
  but it would dominate review of two small fixes
- Anything from `#1206`. Adopting the restructure is a separate decision, and
  its performance work is unmeasured on this fork's architecture
- Assessing the capabilities CLIde lacks. That is
  [the harvest plan](upstream-feature-harvest.md), which starts when this one
  finishes
