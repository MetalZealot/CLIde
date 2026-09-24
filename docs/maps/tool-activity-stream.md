# Tool activity stream

What each provider sends that the Activity line could show, what CLIde does with
it, and the measured shape of a real transcript.

**Evidence (2026-09-24).** Nothing was captured live. Live cells are read from
CLIde's adapters, the Claude SDK types (0.3.258) and the Codex App Server schema
(`codex app-server generate-ts`, 0.156.1). History cells for Claude and Codex
are counted in real transcripts: 6 Claude sessions (1,233 assistant rows, 649
tool calls; all 53 for rare tools) and 5 Codex rollouts (15 turns), 38 for
September-wide counts. Cursor and OpenCode are **CLIde source only**: neither
is installed and no session of either exists here, so their cells say what the
adapter expects, not what the tool sends.

Renderer entry points: `src/components/chat/utils/toolGrouping.ts` (the
clusterer), `utils/toolActivity.ts` (what each call counts as),
`view/subcomponents/ToolActivity.tsx`, `tools/ToolRenderer.tsx`,
`tools/configs/toolConfigs.ts`.

## In short

- **Every provider gives:** tool name, input and result; reply text; an error
  row. Design the Activity line on these.
- **Only some give:** thought text, a running state, exact durations, a
  per-call description, per-turn tokens. Show them where sent; leave a clean
  gap where not.
- **Sent but unused:** Codex exact tool, thought and turn durations; Claude's
  exact thinking-token count per step and turn cost; OpenCode tool timings,
  titles and cost; Codex's per-command action and path.
- **Settings CLIde never turns on** decide some of this — above all, Claude
  thoughts are empty because CLIde never asks for summaries. See
  [Settings that decide what is sent](#settings-that-decide-what-is-sent).
- **Defects found:** Codex history never flags a failed command; Cursor
  `ApplyPatch` edits count 0/0; OpenCode live tool rows read fields its history
  nests under `state` (unverified); Claude's live `tool_use_result` is dropped.

## What each provider sends

**Shown** = sent and used. **Unused** = sent, CLIde ignores it. **—** = not sent.
**?** = unknown. L = live, R = after reload.

| | Claude | Codex | Cursor | OpenCode |
|---|---|---|---|---|
| Tool names | real (`Read`, `Bash`, `Edit`) | one `exec`, unwrapped to `Bash`/`Edit` | raw; only `ApplyPatch` renamed `Edit` | raw lowercase, so every tool falls to the default |
| Thought text | Shown; 24 of 450 have text, the rest empty — summaries not requested | Shown; summaries in 59 of 66 after the setting, 0 of 275 before | R only | Shown |
| Thought streamed while written | not requested (`includePartialMessages`) | Unused (`summaryTextDelta`) | ? | ? |
| "Thinking now" | Shown (`thinking_tokens` event) | Shown (reasoning `item/started`) | — | — |
| Thought duration | guessed from row gap; exact thinking tokens per step Unused | guessed; exact start/end Unused, L and R (median 2.6 s) | guessed from made-up timestamps | guessed; `time.start/end` Unused (R) |
| Reply text | whole blocks; streaming not requested | whole; `agentMessage/delta` Unused | per event, delta or whole ? | ? |
| Tool running state | Shown | Shown for commands, edits, MCP; web search only on completion | — tools appear only after the reply ends | ? L; `state.status` R |
| Tool duration | from timestamps; live `tool_progress` elapsed Unused | from arrival times; exact `durationMs` Unused, L and R | — | `state.time` Unused (R) |
| Command output while running | — | Unused (`outputDelta`) | — | — |
| Per-call description | Shown, 2,771 of 2,772 Bash | no text; action + path/query (`commandActions`) Unused | — | `state.title` Unused |
| Edit line counts | Shown L and R; `structuredPatch` Unused | Shown L; R rebuilt from patch text, `FileChange` records Unused | Edit/Write Shown; `ApplyPatch` 0/0 | — |
| Failed call | Shown (`is_error`; no exit-code field) | Shown L; **never flagged R** | R only | Shown |
| Approval tied to its call | Shown | `itemId` sent, not forwarded | — no prompts | — no prompts |
| Turn id | `promptId` on disk, Unused | Shown (`turnId`) | — | stream end only |
| Turn duration | live `duration_ms` logged, not sent | `durationMs` Unused, L and R | — | `time.completed` Unused |
| Output tokens this turn | Shown | Shown, ~21 updates a turn | — | total at run end |
| Context use | Shown | Shown | — | Shown R |
| Cost | `total_cost_usd` Unused | — | — | Unused |
| Subagents | Shown R; dropped L | Task row R; dropped L | ? | empty container |
| To-do / plan | handled; 0 real calls to test | text L; hidden R on purpose | ? | ? name mismatch |
| Web / MCP | Shown; MCP server name stripped | Shown L; R from exec text | generic | generic |
| Compaction | Shown | dropped (16 in September) | — | — |
| Errors, limits | Shown | Shown; live/history duplicates removed | stderr as text | Shown, no limit handling |

Claude's live stream sends each result's details as snake_case
`tool_use_result`; `normalizeMessage` reads only camelCase `toolUseResult`, so
live rows lack them until a reload, and `parseSearchResult` in `toolConfigs.ts`
reconstructs counts from raw output meanwhile (source only). Codex live gets one
App Server item per inner command where history has one `exec` per script (307
commands, 43 MCP calls, 23 file changes against 265 `exec` in the sample), so
the same work can render as different rows before and after reload (inferred).
Cursor live shows prose only: thoughts and tools appear when the finished run
triggers a refetch.

One Codex `Bash` row can hold several shell commands: the adapter joins the
commands nested inside an `exec` payload with newlines
(`translateCodexExecInput`). Count rows anyway: across 6 rollouts, 690 of 727
rows held one command, while 247 commands were multi-line scripts, so counting
lines overshoots by ~2,600 where rows undershoot by 41 (measured 2026-09-21).

Codex history has no `FileChanges` rows. An edit is an untranslated `exec`
row whose input is source text calling `tools.apply_patch("*** Begin Patch…")`;
`write_stdin`, `web__run` and `view_image` arrive the same way.
`toolActivity.ts` reads the nested tool name and the patch text. The rollout's
own `FileChange` item, keyed `{ [path]: { unified_diff } }`, is not read.

## Settings that decide what is sent

What a provider sends depends partly on options CLIde passes when it starts a
run. CLIde's **Show Thinking** and **Show Raw Parameters** are not among them:
both are browser-only display toggles that never reach the server, so neither
blocks data. Raw Parameters only adds a JSON view to standalone tool cards, not
to Activity rows.

**Claude** (SDK 0.3.258 options; CLIde passes only `effort` of these):

| Option | What it changes | Evidence |
|---|---|---|
| `thinking.display: 'summarized'` | Thoughts carry summary text. Without it they come back empty: 0 characters by default, 137 with it, on `claude-opus-5` | measured 2026-09-24, one probe |
| `includePartialMessages` | Reply and thought text stream in pieces (28 on one short answer) | measured, same probe |
| `forwardSubagentText` | Subagent text and thoughts arrive live, not only tool calls | SDK docs |
| `agentProgressSummaries` | A subagent gets a present-tense status line about every 30 s, at small cost | SDK docs |
| `includeHookEvents` | Hook runs arrive as events | SDK docs |

**Codex** (App Server 0.156.1 thread config):

| Setting | What it changes | Evidence |
|---|---|---|
| `model_reasoning_summary` | `auto` (CLIde's since 2026-09-24), `concise`, `detailed`, `none`; `detailed` untested | schema |
| `model_verbosity` | Reply length; the maintainer's `config.toml` sets `low`, which CLIde does not override | config |
| `show_raw_agent_reasoning`, `hide_agent_reasoning`, `experimentalRawEvents` | Present in the binary, absent from the App Server schema; effect unverified. No raw reasoning text in 341 measured items | binary strings, measured |

Codex needs no opt-in for streaming: `summaryTextDelta`, `agentMessage/delta`
and `outputDelta` are always sent, and CLIde ignores them.

## What CLIde keeps and drops

- **Tool duration** is `toolResult.timestamp` minus the tool row's own
  timestamp, on Claude and Codex, whether the result was attached in history or
  joined from a live `tool_result`. Measured Claude durations: median 0.10 s,
  p90 4.8 s, max 310 s. Live rows time arrival at the server; history uses
  transcript line times. Codex's `startedAtMs`/`completedAtMs` are not used.
- **Codex `turnId`** rides on every tool row: live from the notification,
  in history from the item's `internal_chat_message_metadata_passthrough`,
  else the enclosing `turn_context`. Subagent child tools carry neither field.
- **Claude's Bash `description`** reaches the client inside `toolInput`; the
  activity row shows it verbatim while that command runs.
- **Permission prompts** are not message rows. Claude's carry the call's
  `toolId`, so a waiting call is cut out of its activity; Codex's approvals
  carry `itemId` but it is not forwarded, so they do not cut.

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

Thinking is not a boundary. Over 1,040 calls in 5 Claude sessions, cutting on
shown thinking took 197 activities to 219 and single-call ones from 37 to 47;
608 of 631 thinking blocks were empty (measured 2026-09-21). Thinking either
side of an activity joins it, so only a thought with no call beside it is its
own chat row; opened thoughts render Markdown.

## Codex reasoning in Activity

Chat requests `model_reasoning_summary: auto` per thread. App Server
`item/started` shows Thinking until `item/completed` turns the item into one
thought row; nonempty summaries expand, while an empty summary still leaves a
marker. Persisted reasoning items restore the same row on reload. Summary text
depends on the model and runtime; the token count remains tied to App Server
usage updates.

Before this configuration every reasoning item carried an empty `summary` and
only `encrypted_content`; after it, 59 of 66 carried text (measured
2026-09-24). Summaries arrive whole on `item/completed`.

## Existing seams

- `getToolCategory` (`ToolRenderer.tsx`) already sorts tools into
  edit/search/bash/todo/task/agent/plan/question. It is case-sensitive, which
  is why every OpenCode tool falls through to the `Default` config.
- Consecutive assistant rows already suppress the repeated avatar
  (`isGrouped`, `MessageComponent.tsx`), so vertical cost is the tool cards
  themselves, not the headers.
- `visibleMessages` is a tail slice of 20 raw messages; under prose-bounded
  clustering that is 3–4 activities per page.
- `groupToolActivities` keeps an activity's object identity across renders (`activityCache`); `chatUtils.test.ts` pins it.
