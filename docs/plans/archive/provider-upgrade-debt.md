# Clearing the backlog the 0.3.246 / 0.150.0 audit exposed

- Status: complete
- Next: nothing. Candidates this produced live in the maps and ledgers it names
- Context: [maps README maintenance flow](../../maps/README.md), [Claude ledger](../../maps/claude-upgrade-ledger.md), [Codex ledger](../../maps/codex-upgrade-ledger.md), ADR 0008 (abort), ADR 0025 (model picks)

Two providers moved 13 and 3 releases while CLIde stood still, and the audit
that caught up was hand-run. The mechanical half is now `npm run
check:providers`. This plan is the reading half: the findings that audit
produced, in the order that stops the next one costing a session.

Phases 2–4 are independent; take them in whatever order suits the week.

## Phases

- [x] 1. Detection is mechanical and the notes are not skippable — `b9a9baa2`, `fb7ef0e4`
- [x] 2. The Claude command surface map covers 2.1.246, not 2.1.235
- [x] 3. Session order stops coming from file mtime
- [x] 4. Codex dispositions are current at 0.150.0, not 0.147.0
- [x] 5. `check:providers` covers Cursor and OpenCode

### 2. The command surface map covers 2.1.246 — done

Eleven settings keys were added since 0.3.233, not the five this plan first
named, and none was removed. `/config` gained one row and the command table two.
All of it now carries a destination or a stated non-mapping in
[the command surface map](../../maps/claude-command-surface.md), and its
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

`readLastJsonlTimestamp` reads a bounded tail (64 KB, growing 16x once for a fat
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

### 4. Codex dispositions are current at 0.150.0 — done

Recompiled across the 0.148.0–0.150.0 notes, tagged source, and the installed
state store. The two things this plan named both resolved downward, and a third
it did not know about is now the only real candidate.

- **`Interrupt` hooks are not a candidate.** A hook is the runtime's own
  extension point in the user's `config.toml`. CLIde issues the abort itself, so
  it already knows the turn ended.
- **The new experimental requests and notifications stay unconsumed**, as
  expected; the count rise is App Server MCP event streaming.
- **The thread store moved, and CLIde did not notice.**
  `~/.codex/session_index.jsonl` does not exist on a current install;
  `~/.codex/state_*.sqlite` holds a `threads` table with `title`, `archived`,
  `updated_at`, `cwd`, `model` and `reasoning_effort`. Upstream's own test
  removes the JSONL and asserts naming still resolves from SQLite. CLIde's Codex
  name lookup reads that dead path, gets nothing, and falls through to the last
  agent message — degradation, not breakage, which is why nothing surfaced it.

Two follow-ons this produced, neither started:

- Read the Codex thread store, the way the OpenCode adapter reads its own
  database. The filename carries a schema counter, so it must resolve the newest
  `state_*.sqlite` rather than hardcode one.
- CLIde's per-session permission mode lives in `localStorage`, so the same
  session resumed on another device falls back to the provider-wide last mode.
  Codex now persists the profile itself; CLIde is not asking for it.

### 5. `check:providers` covers Cursor and OpenCode — done

All four providers now have a row, but they are not symmetrical and the script
says so. Claude and Codex have a pinned SDK to compare against; Cursor and
OpenCode have none, so their rows answer a different question — is the binary
the adapter spawns present at all, and which one. Neither is installed on this
host, so both currently read "not on PATH — the adapter cannot run", which is
itself the useful answer.

Release notes follow the same asymmetry: `sst/opencode` tags every release on
GitHub and its npm versions match the tags, so it fetches like Codex does.
Cursor publishes only a web page, so that section is a pointer rather than a
scrape.

**`cursor-agent` on npm is an unrelated third-party package**, not Cursor's CLI,
which installs through Cursor's own script. The script carries that warning
inline, because wiring the npm name in would report a plausible-looking version
for the wrong software.

The maps stay unwritten, deliberately. Neither runtime is installed here, so a
map would be source inspection presented as measurement — the opposite of what
a map is for. Install one first, then write it.

## What this left open

None of these is queued; each is a candidate a phase produced.

- **Codex's thread store moved.** Read `~/.codex/state_*.sqlite`'s `threads`
  table the way the OpenCode adapter reads its own database, resolving the
  newest file rather than hardcoding a schema counter.
- **`modelPicker`** lets a user curate the `/model` list from settings; CLIde
  builds its catalog from the runtime registry and ignores it.
- **Synced Claude plugins** may be invisible the way synced skills were.
  Unconfirmed: enable one on claude.ai and read `installed_plugins.json`.
- **`promptCacheTtl` / `subagentPromptCacheTtl`** have a real product surface
  and no CLIde control.
- **Per-thread Codex credits and cost**, which `/status` gained at 0.148.
- **CLIde's per-session permission mode is `localStorage`**, so the same session
  resumed on another device falls back to the provider-wide last mode.
- **Cursor and OpenCode maps**, once either runtime is installed.

## Done when

- [x] `npm run check:providers` names every provider CLIde ships, not two of four.
- [x] Starring, renaming or reopening a session does not move it in the sidebar.
      Automated and probed against real transcripts; **not yet accepted live.**
- [x] Every settings key in the installed SDK's type appears in the command
      surface map with a destination or a stated non-mapping.
- [x] Both provider maps' dispositions carry the version they were compiled at,
      and it is the installed one.

## Not doing

- Declaring `perTaskStopAffordance`. Absence is the fail-closed side: interrupt
  kills background tasks, which is right until CLIde renders a per-task stop
  control. Declaring it without that control makes a runaway task unstoppable.
- Chasing 0.3.247 / 2.1.247. Already published, signature diff is comments only.
  The point of the gates is that lagging is cheap.
- Pinning the `claude` runtime. It self-updates by design; the version-pair
  recorder exists because the gap is expected, not because it is a fault.
