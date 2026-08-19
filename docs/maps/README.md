# CLIde living maps

This folder contains current-state reference maps that are expected to change as
CLIde or its provider runtimes change.

## Start here

| Document | Role | Status |
|---|---|---|
| [Code anchors](code-anchors.md) | Symbol-anchored map of the code worth not blind-reading; the areas where a wrong assumption is expensive | Moved out of the local `CLAUDE.md` 2026-08-04 |
| [Test suite](test-suite.md) | What the suites own, their measured cost, and what they cannot establish | Measured 2026-08-15 after consolidation to 82 files |
| [Sidebar surface](sidebar-surface.md) | Every sidebar affordance, the tier it sits in, and where the tiers and the code disagree | Inventory taken 2026-08-11 |
| [UI standards](ui-standards.md) | What the interface is objectively required to do, what is only house convention, and which is which | Written 2026-08-18 with ADR 0042 |
| [CLIde provider capability map](clide-provider-capability-map.md) | Canonical normalized behavior, implementation state, and provider/runtime bindings | Foundation baseline started 2026-07-30 |
| [Provider permission and mode surfaces](provider-permission-modes.md) | How Claude and Codex permission concepts differ and how CLIde exposes them | CLIde mapping revalidated 2026-08-12 against Codex 0.147.0 |
| [Claude Code and Agent SDK map](claude-agent-sdk.md) | Claude-native SDK/CLI/control surface and CLIde destinations | Snapshot re-measured at SDK 0.3.233 / runtime 2.1.233, 2026-08-16; the prose below it still reads 0.3.165 / 2.1.220 |
| [Claude command surface](claude-command-surface.md) | The 100 `/help` commands and 58 `/config` rows, each with a CLIde destination | Measured 2026-08-19 at CLI 2.1.235 / SDK 0.3.233 |
| [Claude upgrade ledger](claude-upgrade-ledger.md) | Compact audit decisions and verification history | Current through SDK 0.3.233 / runtime 2.1.233, 2026-08-16 |
| [Codex CLI, SDK, and App Server map](codex-cli-sdk-app-server.md) | Codex-native current surface and CLIde destinations | Current through 0.147.0 and managed runtime selection |
| [Codex upgrade ledger](codex-upgrade-ledger.md) | Compact release decisions and verification history | Current through 0.147.0 |
| [Codex integration conformance](codex-integration-conformance.md) | Executable cross-layer regression matrix and live acceptance rows | Harness current; live rows unverified since Codex 0.147 |

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
