# Tool activity stream

What each provider reports about its own tool calls, what CLIde keeps, and what
the shape of a real transcript is. Measured 2026-08-23 against one 295-call
Claude session and 60 Codex rollouts on the maintainer's machine; Cursor and
OpenCode rows are source inspection only, as neither has local data.

Renderer entry points: `src/components/chat/utils/toolGrouping.ts`,
`view/subcomponents/ToolGroupContainer.tsx`, `tools/ToolRenderer.tsx`,
`tools/configs/toolConfigs.ts`.

## Per-provider fields

| | Claude | Codex | Cursor | OpenCode |
|---|---|---|---|---|
| Tool identity | real names (`Read`, `Bash`, `Edit`) | everything is one `exec` call, unwrapped to `Bash`/`Edit` by the adapter | renamed to Claude's names | raw lowercase (`read`, `bash`) |
| Per-call description | **always** (103/103) | none | none | none |
| Structured result | `toolUseResult` (`numFiles`, `filenames`, `numLines`, `structuredPatch`, `stdout`) on transcript reload only | `exitCode`, `status`, aggregated output | `toolUseResult` for high-level calls | `state.output`/`state.error` |
| Cluster key from provider | none | `turnId` on every item, live and on disk | none | none |
| Running state | yes — `tool_use` arrives before its result | **no** — only `item/completed` is forwarded | n/a | `state.status` |

Both Claude paths (live SDK and transcript reload) run through the same
`normalizeMessage`, so the live stream carries no `toolUseResult`;
`parseSearchResult` in `toolConfigs.ts` exists to reconstruct counts from raw
output until a reload fills it in.

One Codex `Bash` row can hold several shell commands: the adapter joins the
commands nested inside an `exec` payload with newlines
(`translateCodexExecInput`). A command count is lines, not tool calls.

## What CLIde drops

- **`tool_result` timestamps.** `normalizedToChatMessages` folds a result into
  `{content, isError, toolUseResult}` and discards its own timestamp, so no
  duration reaches the client. Both timestamps exist server-side. Measured
  Claude durations: median 0.10 s, p90 4.8 s, max 310 s.
- **Codex `turnId` and `completedAtMs`**, present on every `item/started` and
  `item/completed` and in the rollout's
  `internal_chat_message_metadata_passthrough`. `turnId` is an explicit
  burst boundary that CLIde currently re-derives.
- **Claude's Bash `description`** reaches the client inside `toolInput` and
  renders inside the expanded card, but `ToolGroupContainer` builds its
  collapsed preview from `config.getValue` — the raw command — and never reads
  it.

## Shape of a real transcript

295 Claude tool calls, compressed by three candidate rules:

| Rule | Rendered rows |
|---|---|
| Adjacent same `toolName` (shipped) | 172, of which 116 are runs of one |
| Adjacent same category | 162 |
| Bounded by assistant prose | **51**, 6 of them single-call |

Adjacency barely compresses because real work alternates
(`Read, Bash, Read, Edit, Bash`). Assistant prose is the only boundary that
matches how the work is actually punctuated, and it is provider-neutral: Codex
interleaves prose at the same rate (452 calls, 124 clusters, 3.6 avg).

Prose-bounded clusters are **mixed**: of 51, only 14 were one category, 26 were
two, 11 were three. A single-verb activity title is wrong for two thirds of
them.

The prose itself means opposite things per provider — Claude's precedes the
burst as a heading (*"Now the server test."*), Codex's follows it as a result
(*"The shim baseline is clean: 5/5 tests pass"*) — so it is usable as a
boundary and not as a title.

## Codex has no reasoning summaries here

3,010 reasoning rows across 40 rollouts carry an empty `summary` array and
`encrypted_content` instead, under `gpt-5.6-sol` with no
`model_reasoning_summary` configured. The live transport does map
`reasoning.summary` into a `thinking` message, so a differently configured
model could populate it — nothing in CLIde may depend on it.

## Existing seams

- `getToolCategory` (`ToolRenderer.tsx`) already sorts tools into
  edit/search/bash/todo/task/agent/plan/question. It is case-sensitive, which
  is why every OpenCode tool falls through to the `Default` config.
- Consecutive assistant rows already suppress the repeated avatar
  (`isGrouped`, `MessageComponent.tsx`), so vertical cost is the tool cards
  themselves, not the headers.
- `visibleMessages` is a tail slice of 20 raw messages; under prose-bounded
  clustering that is 3–4 activities per page.
- `groupConsecutiveTools` has no test coverage.
