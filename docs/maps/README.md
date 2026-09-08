# CLIde living maps

This folder contains current-state reference maps that are expected to change as
CLIde or its provider runtimes change.

## Start here

| Document | Role | Status |
|---|---|---|
| [Orientation](orientation.md) | Plain-language map of CLIde's nine governing assumptions, written for Grayson rather than for an agent | Written 2026-09-01; verified against the code |
| [Upstream sync](upstream-sync.md) | How this fork takes work from `siteboon/claudecodeui`, what has been refused, and the release ledger | Written 2026-09-08 for the v1.37.3 span |
| [Code anchors](code-anchors.md) | Symbol-anchored map of the code worth not blind-reading; the areas where a wrong assumption is expensive | Moved out of the local `CLAUDE.md` 2026-08-04 |
| [Test suite](test-suite.md) | What the suites own, their measured cost, and what they cannot establish | Measured 2026-08-15 after consolidation to 82 files |
| [Sidebar surface](sidebar-surface.md) | Every sidebar affordance, the tier it sits in, and where the tiers and the code disagree | Inventory taken 2026-08-11 |
| [UI standards](ui-standards.md) | What the interface is objectively required to do, what is only house convention, and which is which | Updated 2026-08-28 with mobile bottom-navigation guidance |
| [Typography](typography.md) | Font-family routing, unchanged interface sizing, reading presets, and fixed-metric boundaries | Implemented and accepted 2026-08-21 |
| [CLIde provider capability map](clide-provider-capability-map.md) | Canonical normalized behavior, implementation state, and provider/runtime bindings | Foundation baseline started 2026-07-30 |
| [Provider permission and mode surfaces](provider-permission-modes.md) | How Claude and Codex permission concepts differ and how CLIde exposes them | CLIde mapping revalidated 2026-08-12 against Codex 0.147.0 |
| [Claude Code and Agent SDK map](claude-agent-sdk.md) | Claude-native SDK/CLI/control surface and CLIde destinations | Snapshot re-measured at SDK 0.3.258 / runtime 2.1.258, 2026-09-01; the prose below it still reads 0.3.165 / 2.1.220 |
| [Claude command surface](claude-command-surface.md) | The `/help` commands, `/config` rows and 159 settings keys, each with a CLIde destination | Settings keys re-counted 2026-09-01 at 2.1.258 / 0.3.258; commands and `/config` rows still 2.1.246's, and the live `/help` and `supportedCommands()` counts 2.1.235's |
| [Claude upgrade ledger](claude-upgrade-ledger.md) | Compact audit decisions and verification history | Current through SDK 0.3.258 / runtime 2.1.258, 2026-09-01 |
| [Codex CLI, SDK, and App Server map](codex-cli-sdk-app-server.md) | Codex-native current surface and CLIde destinations | Pin, protocol, model rows, and dispositions current at 0.153.4, 2026-09-07 |
| [Codex upgrade ledger](codex-upgrade-ledger.md) | Compact release decisions and verification history | Current through 0.153.4, 2026-09-07 |
| [Tool activity stream](tool-activity-stream.md) | What each provider reports about its own tool calls, what CLIde drops, and the measured shape of a real transcript | Measured 2026-08-23; Cursor/OpenCode rows are source inspection only |
| [Codex integration conformance](codex-integration-conformance.md) | Executable cross-layer regression matrix and live acceptance rows | Automated gate and full isolated live matrix passed at 0.153.4, 2026-09-08 |

Future provider maps should use stable, undated filenames:

- `cursor-cli.md`;
- `opencode-cli-server.md`;
- `antigravity.md` only after a provider-fit assessment selects an integration
  surface;
- `<provider>-upgrade-ledger.md`.

## What belongs here

A map belongs here when it answers current questions such as:

- What behavior does CLIde expose now?
- Which provider/runtime surface supplies it?
- Is the mapping exact, approximate, app-owned, runtime-dependent, or absent?
- Where is it implemented and consumed?
- What degrades when a transport or version lacks it?
- What current integration candidates or compatibility watches remain?

Maps are curated current truth. They do not retain every old release delta.

## What stays elsewhere

- Remaining work and implementation sequences stay in [`../plans/`](../plans/),
  under the caps in [the plan format](../plans/README.md).
- Lasting decisions stay in [`../decisions/`](../decisions/).
- `../specs/` is retired; its archive is frozen and not read by default. A dated
  investigation is either current truth (a map), a decision (an ADR), or work
  left to do (a plan). It is not a fourth thing.
- Generated schemas, raw CLI help, and exhaustive diffs remain temporary audit
  artifacts.
- Git history and compact provider ledgers preserve prior states and decisions.

The focused
[Claude Code settings audit](2026-07-28-claude-code-settings-surface-audit.md)
is a good example of a dated assessment that informs a living map without
becoming one.

## Maintenance flow

Start with `npm run check:providers`. It reports pinned/installed/published
versions for all four providers, and **fetches the release notes by itself
whenever a version moved** — that step is the one that gets skipped when it is
merely written down, so it is not opt-in. `--types` adds the signature-only
`.d.ts` diff, `--protocol` regenerated Codex protocol counts. It reports; it
never gates. The gates are the drift tests, which fail by name when a pin or a
parsed contract moves.

The four are not symmetrical. Claude and Codex have a pinned SDK to compare
against; Cursor and OpenCode have none, so their rows report whether the binary
the adapter spawns is present at all. Neither SDK publishes release notes.
`anthropics/claude-code`'s `CHANGELOG.md` covers every runtime version;
`openai/codex` and `sst/opencode` tag each release on GitHub; Cursor publishes
only a web page. Read the whole span between the installed and published
versions — an artifact diff shows contract changes but never behaviour, and the
0.3.246 audit missed six CLIde-relevant fixes by reading only the newest entry.

1. Audit official sources, installed artifacts, generated contracts, and live
   runtime behavior for one provider.
2. Update that provider's native map and append one compact ledger entry.
3. Classify every material native change against the canonical CLIde map.
4. Change the canonical map only when normalized behavior, implementation,
   fidelity, runtime availability, or disposition changes.
5. Add a TODO only for deliberately selected integration work.
6. Add or supersede an ADR only when ownership, identity, persistence,
   fallback, or a security boundary changes.
7. Validate relative links and map-to-code conformance before committing.

Mechanical capability tables should eventually be generated from or checked
against typed provider descriptors. Human-maintained prose remains responsible
for semantics, tradeoffs, degradation, and explicit non-mappings.
