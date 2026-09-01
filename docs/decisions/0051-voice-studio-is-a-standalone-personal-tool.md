# 0051 — Voice Studio is a standalone personal tool

- Date: 2026-08-31
- Status: Accepted
- Refines: [0050 — The voice runtime owns shared settings](0050-voice-runtime-owns-shared-settings.md)

## Decision

Voice Studio is a standalone personal audition tool and will move out of the CLIde repository.
CLIde depends only on an optional voice runtime and the capabilities that runtime advertises.
The shared runtime contract keeps installed inventory, favorites, selection, default, optional display aliases, tuning, and STT settings.
Gender balance, heard state, audition notes, recordings, comparisons, and experiments belong to Studio-owned data.
This keeps CLIde useful with familiar installed voices or its built-in preview and tuning without requiring Voice Studio.
