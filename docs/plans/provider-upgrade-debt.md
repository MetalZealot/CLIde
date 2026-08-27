# Clearing the backlog the 0.3.246 / 0.150.0 audit exposed

- Status: 3/5
- Next: Phase 4 — classify the Codex dispositions at 0.150.0
- Context: [maps README maintenance flow](../maps/README.md), [Claude ledger](../maps/claude-upgrade-ledger.md), [Codex ledger](../maps/codex-upgrade-ledger.md), ADR 0008 (abort), ADR 0025 (model picks)

Two providers moved 13 and 3 releases while CLIde stood still, and the audit
that caught up was hand-run. The mechanical half is now `npm run
check:providers`. This plan is the reading half: the findings that audit
produced, in the order that stops the next one costing a session.

Phases 2–4 are independent; take them in whatever order suits the week.

## Phases

- [x] 1. Detection is mechanical and the notes are not skippable — `b9a9baa2`, `fb7ef0e4`
- [x] 2. The Claude command surface map covers 2.1.246, not 2.1.235
- [x] 3. Session order stops coming from file mtime
- [ ] 4. Codex dispositions are current at 0.150.0, not 0.147.0
- [ ] 5. `check:providers` covers Cursor and OpenCode

### 2. The command surface map covers 2.1.246 — done

Eleven settings keys were added since 0.3.233, not the five this plan first
named, and none was removed. `/config` gained one row and the command table two.
All of it now carries a destination or a stated non-mapping in
[the command surface map](../maps/claude-command-surface.md), and its
re-measuring recipe is a version-to-version diff rather than a re-read.

The survey found one real defect and fixed it: the runtime loads skills synced
from a claude.ai account out of `~/.claude/skills/synced/<name>/`, one level
below the root CLIde scanned, so those skills ran in a session while being
absent from CLIde's list. `claude-skills.provider.ts` now scans the synced root
as its own source; the shared direct-mode scan keeps the sibling `.trash` and
`.staging` folders out on its own.

Two findings it deliberately left open, both one line each in the map:

- `modelPicker` lets a user curate the `/model` list from `~/.claude/settings.json`.
  CLIde builds its catalog from the runtime registry and never reads it, so the
  two pickers disagree for anyone who sets it.
- Synced *plugins* may be invisible the same way synced skills were. CLIde reads
  only `enabledPlugins` × `installed_plugins.json`; whether the runtime also
  registers `~/.claude/plugins/synced` there could not be observed, because no
  synced plugin was installed. Enable one and read the file before building.

### 3. Session order stops coming from file mtime — done

Three synchronizers were affected, not two: Claude, Codex and Cursor. OpenCode
was already right, reading `time_updated` from its own database.

The trigger is more ordinary than a `touch`. Claude appends untimestamped
`last-prompt` and `permission-mode` rows when a transcript is opened, so simply
opening a session advanced its mtime while the conversation had not — measured
here at 30 minutes past the last message on a real transcript.

`readLastJsonlTimestamp` reads a bounded tail (64 KB, doubling once for a fat
final row) and walks backwards to the last row carrying a usable timestamp;
each provider supplies its own extractor, because Cursor keeps the value in a
`<timestamp>` tag inside the message text rather than a field. mtime stays the
fallback, so a transcript with no parseable row behaves as it did.

**No backfill, deliberately.** The watcher re-upserts a session on every change
event, so any row that can go wrong is rewritten correctly the next time its
file is touched. A one-shot full rescan would recompute rows that are already
right by construction, at the cost of a boot-time pass over every transcript.

Tagged upstreamable, and recorded in `docs/upstream-candidates.md` with the
search that found no upstream report.

### 4. Codex dispositions are current at 0.150.0

The map's disposition table was compiled at 0.147.0 and the 0.150.0 pass only
corrected the counts around it. Two things to classify: the new `Interrupt`
hooks, which fire when a top-level turn is interrupted and are the first real
candidate CLIde's abort path has had in a while, and the 20 experimental client
requests and 9 notifications added since 0.147.0, none of which is consumed.

### 5. `check:providers` covers Cursor and OpenCode

Both are adapters CLIde must keep working and neither has a map, a ledger, or a
row in the script. Adding the version rows is small; the maps are the work, and
they are what make the rows mean anything.

## Done when

- `npm run check:providers` names every provider CLIde ships, not two of four.
- Starring, renaming or reopening a session does not move it in the sidebar.
- Every settings key in the installed SDK's type appears in the command surface
  map with a destination or a stated non-mapping.
- Both provider maps' dispositions carry the version they were compiled at, and
  it is the installed one.

## Not doing

- Declaring `perTaskStopAffordance`. Absence is the fail-closed side: interrupt
  kills background tasks, which is right until CLIde renders a per-task stop
  control. Declaring it without that control makes a runaway task unstoppable.
- Chasing 0.3.247 / 2.1.247. Already published, signature diff is comments only.
  The point of the gates is that lagging is cheap.
- Pinning the `claude` runtime. It self-updates by design; the version-pair
  recorder exists because the gap is expected, not because it is a fault.
