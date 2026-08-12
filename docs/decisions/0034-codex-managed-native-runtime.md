# 0034 — Codex uses one explicitly approved native runtime

- Date: 2026-08-12
- Status: Accepted

## Decision

Codex interactive Chat uses App Server by default; the SDK is an explicit escape
hatch and an initialization-only fallback, never a retry after accepted work. One
persisted, explicitly approved installation serves Chat, Shell, jobs, models,
authentication, and usage, with a new store seeded to the bundled runtime.
Promotions are compatibility-checked, identify installations by path rather than
version, and recycle a long-lived App Server only after its active turn becomes idle.

## Rejected

Following whatever `PATH` resolves, silently falling back when the approved runtime
is unavailable, selecting per facet, accepting browser-supplied paths, and killing a
running turn during promotion are rejected; rollback is an explicit selection of the
previous installation.

## Why

Two distinct 0.147.0 installations proved that version is not installation identity,
and isolated live gates showed all Codex facets resolving the same executable while a
mid-turn promotion left the active turn uninterrupted.
