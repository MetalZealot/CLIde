# 0049 — The voice runtime owns shared settings

- Date: 2026-08-29
- Status: Accepted

## Decision

CLIde's primary Voice screen is the daily control surface for voice selection,
preview, relative pace, and ordinary dictation settings. The authenticated voice
runtime owns installed inventory, favorites, the runtime default, per-voice
baselines, chosen voice, STT settings, and capability metadata so CLIde and Voice
Studio edit the same values across devices.

## Rejected

The raw OpenAI-compatible Backend form does not remain the primary local-voice
surface, settings are not duplicated in browser storage, and the browser never
supplies filesystem paths to scan or execute.

## Why

Runtime ownership preserves one source of truth while capabilities let custom
backends expose only what they support. Fine tuning remains reachable without
making engine-specific controls or Voice Studio's laboratory workflows part of
the ordinary path.
