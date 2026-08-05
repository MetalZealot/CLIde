# CLIde living maps

This folder contains current-state reference maps that are expected to change as
CLIde or its provider runtimes change.

## Start here

| Document | Role | Status |
|---|---|---|
| [Code anchors](code-anchors.md) | Symbol-anchored map of the code worth not blind-reading; the areas where a wrong assumption is expensive | Moved out of the local `CLAUDE.md` 2026-08-04 |
| [CLIde provider capability map](clide-provider-capability-map.md) | Canonical normalized behavior, implementation state, and provider/runtime bindings | Foundation baseline started 2026-07-30 |
| [Claude Code and Agent SDK map](claude-agent-sdk.md) | Claude-native SDK/CLI/control surface and CLIde destinations | Current through SDK 0.3.165 / runtime 2.1.220 |
| [Claude upgrade ledger](claude-upgrade-ledger.md) | Compact audit decisions and verification history | Current through 2026-07-30 |
| [Codex CLI, SDK, and App Server map](codex-cli-sdk-app-server.md) | Codex-native current surface and CLIde destinations | Current through 0.146.0 |
| [Codex upgrade ledger](codex-upgrade-ledger.md) | Compact release decisions and verification history | Current through 0.146.0 |

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

- Dated feasibility audits, investigations, and proposed designs stay in
  [`../specs/`](../specs/).
- Implementation sequences stay in [`../plans/`](../plans/).
- Lasting decisions stay in [`../../decisions/`](../../decisions/).
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
