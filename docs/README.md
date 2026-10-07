# CLIde docs

The system's shape, code map, invariants and quality goals live in
[`ARCHITECTURE.md`](../ARCHITECTURE.md); read it before these.

- [`TODO.md`](TODO.md) — the backlog.
- [`decisions/`](decisions/README.md) — ADRs: what was chosen, and why.
- [`plans/`](plans/README.md) — ordered work that outlives one session.
- [`designs/`](designs/README.md) — the target design a long plan builds toward.

## Reference

How CLIde works today, where a session would otherwise rebuild it by reading a
lot of code.

| Document | Role | Status |
|---|---|---|
| [Upstream](upstream.md) | How this fork takes work from `siteboon/claudecodeui`, and which of its fixes could go back; each verdict is a line in [`upstream-verdicts.tsv`](upstream-verdicts.tsv) | Candidates merged in 2026-10-07 |
| [Code anchors](code-anchors.md) | Symbol-anchored map of the code worth not blind-reading; the areas where a wrong assumption is expensive | 90 of 93 named symbols present, 2026-10-06 |
| [Testing](testing.md) | What the suites own, their measured cost, and what they cannot establish | Measured 2026-08-15 after consolidation to 82 files |
| [UI standards](ui-standards.md) | What the interface is objectively required to do, what is only house convention, and typography's ownership and boundaries | Typography merged in 2026-10-07 |
| [Providers](providers.md) | What CLIde does with each provider, how exactly, and what it refuses | Stale Claude and Codex rows corrected 2026-10-06 |

## What belongs here

A reference doc holds what CLIde itself does, where a script or test cannot
hold it. It never copies a provider's SDK, CLI or settings surface — read the
provider's own types and docs ([providers §7](providers.md#7-provider-native-sources)).
A measurement lives with the script that took it, a decision in
[`decisions/`](decisions/), remaining work in [`plans/`](plans/), and history in
git. Nothing is archived here: finished plans, designs and TODO items are
deleted, and their closing commit is the record.
