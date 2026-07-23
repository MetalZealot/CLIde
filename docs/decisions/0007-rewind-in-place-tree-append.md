# 0007 — Rewind is in-place tree-append; history must be branch-filtered

- Date: 2026-07-22
- Status: Accepted

## Decision

Chat rewind (edit a prior user message / `/rewind` picker) rides the existing
`chat.send` frame as a `rewindToMessageId` option — no new WS message type. The
server walks the transcript's `parentUuid` chain from the edited user message to
the nearest assistant ancestor and passes that uuid as the SDK's
`resumeSessionAt`. All transcript reading goes through `filterToActiveBranch`
(`claude-rewind.util.ts`), because a rewound jsonl is a **tree**, not a list.

## Rejected

- **A dedicated `chat.rewind` WS frame** — rewind is not an independent action;
  the edited text IS the resume prompt, so bundling it with the send keeps it
  atomic with the run registry (no window where a rewind is armed but no run
  exists).
- **Client-side anchor computation** — the client only knows message ids, not
  the sidechain-riddled `parentUuid` graph; the server computes the assistant
  anchor authoritatively. The client sends the *user* message's uuid, which is
  exactly what Phase B `rewindFiles(userMessageId)` will need.
- **Fork-based rewind (`forkSession`)** — unnecessary; probing proved in-place
  works, and forks would multiply sidebar sessions.
- **Assuming the jsonl gets truncated** — the plan's original mental model.
  Empirically false.

## Why

The SDK probe (`scripts/verify-rewind-sdk.ts`, committed with findings) showed:
`resumeSessionAt` requires an **assistant** uuid (inclusive anchor) and rewind
is **in-place** — same session id, but the jsonl is appended to with
`parentUuid` = anchor, leaving the abandoned tail in the file. Any linear
reader renders both branches interleaved. `filterToActiveBranch` keeps only
the chain ending at the newest non-sidechain user/assistant entry (plus
sidechains, uuid-less metadata, and compaction-disconnected segments), which
also fixed a pre-existing bug: sessions rewound from the terminal CLI rendered
their abandoned turns in CLIde as live conversation. Upstream-PR candidate.
Landed in commits `098493e`…`953eb92` on `feat/rewind` (15 unit tests).
