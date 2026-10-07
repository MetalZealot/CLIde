# CLIde maps

CLIde-owned facts a session would otherwise rebuild by reading a lot of code.
The system's shape, code map, invariants and quality goals live in
[`ARCHITECTURE.md`](../../ARCHITECTURE.md); read it before these.

| Document | Role | Status |
|---|---|---|
| [Upstream sync](upstream-sync.md) | How this fork takes work from `siteboon/claudecodeui`; each verdict is a line in [`upstream-verdicts.tsv`](upstream-verdicts.tsv) | Verdicts moved to data 2026-10-06 |
| [Code anchors](code-anchors.md) | Symbol-anchored map of the code worth not blind-reading; the areas where a wrong assumption is expensive | 90 of 93 named symbols present, 2026-10-06 |
| [Test suite](test-suite.md) | What the suites own, their measured cost, and what they cannot establish | Measured 2026-08-15 after consolidation to 82 files |
| [UI standards](ui-standards.md) | What the interface is objectively required to do, what is only house convention, and which is which | Updated 2026-09-14 with composer placement reasons and WCAG 4.1.3 |
| [Typography](typography.md) | Font-family routing, unchanged interface sizing, reading presets, and fixed-metric boundaries | Implemented and accepted 2026-08-21 |
| [CLIde provider capability map](clide-provider-capability-map.md) | What CLIde does with each provider, how exactly, and what it refuses | Stale Claude and Codex rows corrected 2026-10-06 |

## What belongs here

A map holds what CLIde itself does, where a script or test cannot hold it. It
never copies a provider's SDK, CLI or settings surface — read the provider's own
types and docs ([capability map §7](clide-provider-capability-map.md#7-provider-native-sources)).
A measurement lives with the script that took it, a decision in
[`../decisions/`](../decisions/), remaining work in [`../plans/`](../plans/), and
history in git.
