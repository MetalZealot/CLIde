# Rebuild the agent runtime: long-lived Claude sessions, one typed wire, a home for every message

- Status: 1/11
- Next: Grayson's checks on 3001 once Pi-Ops' Deploy has run: phase 1 (a mode
  switch mid-reply) and phase 1b (copy a recorder block); then phase 2
- Context: [SDK map](../maps/claude-agent-sdk.md) (§2 holds the phase-0 probe results),
  `scripts/verify-claude-session-sdk.ts`, `scripts/runtime-scorecard.mjs`,
  [command surface](../maps/claude-command-surface.md),
  [tool activity stream](../maps/tool-activity-stream.md),
  [code anchors](../maps/code-anchors.md),
  [provider contract](../maps/CLIde_Provider_Architecture_Current_Contract.md),
  [capability map](../maps/clide-provider-capability-map.md),
  [permission modes](../maps/provider-permission-modes.md),
  [Codex App Server](../maps/codex-cli-sdk-app-server.md), [architecture](../../ARCHITECTURE.md) invariants 3 and 11;
  ADRs 0003, 0007, 0008, 0012, 0013, 0025, 0056, 0063, 0064, 0065–0068

This plan fixes the layer between each provider's SDK and the chat view, Claude
first. The shell around it stays: sidebar, settings, Git, terminal, PWA, login,
voice, scheduled messages. It is over the 8 KB plan cap by Grayson's decision
(2026-10-05): it is the plan that decides whether CLIde stays his daily driver,
so detail wins over size.

It merges three drafts written on 2026-10-04 (an interactive Claude.ai session,
and branches `ccr-a929207f-vys16r` and `ccr-1aa6a311-vle29l`). Every factual
claim in them was checked against source and `sdk.d.ts` at SDK 0.3.286. The
interactive draft is the base; the branches' verified ideas are folded in; their
errors are dropped. Labels: **source** = read in code, **sdk.d.ts** = read in
the pinned types, **measured** = run, **probe** = needs the phase-0 live check.

## Where it stands (source, SDK 0.3.286)

- **One `claude` process per message.** Each send builds a new `query()` whose
  input closes at `result`, so the process exits. Since `8ac0bd16` the input is
  held while background tasks run, with a 30-minute silence backstop. Costs: a
  "Starting" respawn on every message, nothing reachable between messages, and
  the provider can never start a turn on its own. "Starting" is the spawn, not
  the transcript (measured 2026-10-05): run start to first frame is 3.3 s median
  over 246 production turns, the spawn alone 2.7–2.9 s, loading even a 16.9 MB
  transcript 0.4 s; a warm turn on one process reaches `init` in 50–80 ms.
- **Mid-turn controls are already reachable; nothing calls them.** The
  per-message prompt is an input stream (`createClaudeInputChannel`), and the
  SDK requires exactly that, not a long-lived process, for `setPermissionMode`,
  `setModel` and `applyFlagSettings` (sdk.d.ts:2861, 2890, 2936). Both branch
  drafts assumed the opposite and pushed these fixes behind the rebuild. Probe 2
  confirmed both mode and model changes apply inside the running turn.
- **SDK use:** 3 of 30 typed `Query` methods (`interrupt`, `getContextUsage`,
  `supportedModels`) plus the untyped `askSideQuestion`; 20 of 69 `Options`;
  1 of 33 hooks (`Notification`); 14 of 39 message types handled, the other 25
  dropped silently.
- **No word-by-word replies.** `includePartialMessages` is never set, and the
  normalizer's stream branch tests an unwrapped `content_block_delta` the SDK
  never sends (it wraps deltas in `stream_event`), so the option alone would
  stream nothing.
- **Stop kills everything.** The gateway hands the run's AbortController to
  `query()` and trips it before `interrupt()` runs (`beginAbort`), which ends
  the process. A bare `interrupt()` would spare background shells but kill
  background subagents unless `Options.perTaskStopAffordance` is set (measured
  2026-10-05; sdk.d.ts:1786-1805 says "background agents/workflows"). CLIde
  never sets it.
- **A held run blocks the chat.** While background tasks hold the input, the
  run stays "running": `chat.send` gets RUN_IN_PROGRESS, the Shell refuses,
  scheduled sends wait, and the turn-end notification fires only when the hold
  ends. A dev server left running keeps the chat busy for up to 30 minutes.
- **The run registry drops every frame after a run's `complete`**
  (`decorateAndRecordEvent`, `chat-run-registry.service.ts`), and `seq`/`runId`
  are per run. A turn the provider starts after `result` would vanish.
- **Three message shapes.** `NormalizedMessage` (`server/shared/types.ts`) has 50
  named fields plus `[key: string]: unknown`. The client hand-copies it in
  `useSessionStore.ts` (already drifted: 4 fields only on the client, 2 only on
  the server), receives untyped frames (`ServerEvent` in `WebSocketContext.tsx`),
  then converts again to `ChatMessage` (`type: string` plus 7 boolean flags, 26
  files) in `useChatMessages.ts`. That file also holds the live/history folds and
  the display cache the history-performance budgets rely on.
- **Live versus reload is mostly a Codex problem.** Claude already uses one
  normalizer for live and history; its remaining gaps are the snake_case
  `tool_use_result` and where the cross-row folds run. Codex has three mappers
  (App Server live, rollout history, SDK fallback), and its rollout rows are
  whole scripts where live items are single commands.
- **Provider-name checks in `src/`:** 76 comparisons on 70 lines in 26 files.
  39 of them are on per-provider settings, login, MCP and logo screens, where a
  provider check is correct.
- **Nothing budgets memory.** No `MemAvailable` or process cap anywhere in
  `server/`. Side questions, model-list reads, commit messages and the agent API
  each spawn their own `claude` outside any limit. Measured 2026-10-05: an idle
  `claude` holds ~234 MB resident, ~122 MB of it private (freed on close); three
  open took available memory from 637 to 434 MB under the host's normal load.
- **Lifecycle gaps.** SIGTERM never closes Claude queries or the Codex App Server
  client; nothing sweeps orphans at start. The CLI update lease is held for one
  `run()`, so a process that outlives `run()` would block updates forever. The
  sessions watcher knows nothing of live runs (chokidar, 500 ms debounce).
- **Queues and requested settings live in each browser.** Queued messages sit in
  `localStorage` (`queued_message_<id>`) and are flushed by a 5-second poll of
  running sessions. Permission mode lives in `useChatProviderState` and travels
  with each send. Approvals are tracked only for the session on screen.

## What each daily pain waits for

| Pain | Phase |
|---|---|
| A mode or model change waits for the next message | 1 |
| The slash menu has 11 commands; the CLI reports about 56 (measured, in the command map) | 1 |
| Aborting a new chat's first message leaves two sidebar rows | 1 |
| Search counts and diffs show only after a reload | 1 |
| Thinking comes back empty | 1 |
| Replies don't stream word by word | 2 |
| A background job keeps the chat busy, blocking sends, Shell and scheduled messages | 4 |
| Phone and laptop disagree about a live chat; a message queued on a closed phone never sends | 5 |
| Background-task notices appear only after a reload (inferred: frames after `complete` are dropped) | 5–6 |
| "Starting" before every message (3.3 s median); a background job can't wake the chat after the reply ended | 6 |
| Stop kills background jobs | 6 (ADR 0066) |
| Claude tool rows look different after a reload | 7 |
| Codex tool rows look different after a reload | follow-on plan (Grayson's call 2) |

## Settled with Grayson

- 2026-10-04: today's UI moves onto the typed wire in this plan; the mockup's
  mobile layout is a follow-on plan at `/next`.
- 2026-10-04: Claude gets a native long-lived session. Codex, Cursor and OpenCode
  keep per-turn runtimes behind the same session host. Codex's App Server is
  already long-lived, so a native Codex adapter waits for a concrete gain.
- 2026-10-04: runtime, gateway and chat-event code stop tracking upstream (ADR).
- 2026-10-04: verification is a fake `Query` in tests, small live turns, and
  acceptance on the Pi per phase.
- 2026-10-05: this plan is the priority, and it may exceed the plan size cap.
- 2026-10-06: ADRs 0065–0068 accepted as written; that settles call 3 below
  (Stop ends only the reply).

## Grayson's calls (the recommended default applies until he answers)

1. **Priority.** Recommended: start phases 0–2 now. Finish
   [message-edit-model](message-edit-model.md) phase 3 before this plan's
   phase 5, because phase 5 moves the queue that plan's rows sit on.
2. **Codex's before/after-reload tool rows.** Recommended: a follow-on plan.
   The likely fix is reading Codex history through its App Server
   (`thread/read`, `thread/turns/list`, `thread/items/list`: found in the 0.153.4
   binary's strings, never tried live), which is a different job from Claude's.
3. **What Stop means.** Settled by ADR 0066: Stop ends the reply only;
   background jobs keep running, each with its own stop button.

## Design positions

Each is a technical call, with its reason.

- **The bar is a Claude client built today, not CloudCLI's past.** Grayson kept
  this codebase instead of restarting on the strength of this plan, so existing
  behaviour earns no weight by being there. Every phase is reviewed against what
  a from-scratch client would do; a workaround that exists only because of the
  old design is named here, with the phase that removes it. Open ones: the
  transcript wait for aborted new chats and the idle `claude` per project for the
  command list (phase 6), and the hidden `/model`, `/effort`, `/fast`, `/clear`,
  `/rename` (phase 7).
- **Fix in place; no new app.** A rewrite rebuilds resume, approvals, tool
  display, PWA quirks, login, terminal, Git, Browser, voice and scheduled
  messages before gaining anything; what is wrong is concentrated in about
  4,500 lines.
- **No second event model.** Today's message kinds are typed in place, so live
  and history rows stay one shape and `useSessionStore`'s pagination, scroll
  restoration and reconciliation keep working. Both branch drafts deleted the
  client store's layer instead, unflagged: about 2,500 lines and 132 tests, with
  no mention of scrolling, history loading or ADR 0056.
- **Row ids never change.** React keys, the scroll-restore anchors
  (`data-chat-message-id`), the rewind anchor, Find and the server's history
  bookmarks all key on them. Live streamed text is the one exception today
  (`finalizeStreaming` gives it a random id); phase 2 fixes that.
- **Controls before the process model.** Mid-turn controls, the slash menu and
  id pre-allocation work on today's runtime (phase 1). The long-lived process
  buys what happens *between* messages.
- **The host evolves `chatRunRegistry`.** Its 20 tests stay as the turn spec.
- **Stop interrupts the turn; only close ends the process.** This supersedes
  ADR 0013's tier order for Claude, and its corollary that "delivered" means
  `seq > 0`. That corollary already almost never reports false, because the
  "starting" status frame takes a seq before the CLI spawns. Delivery is read
  from the CLI's `command_lifecycle` frames instead: `queued`, `started`,
  `completed` or `cancelled`, keyed by the sent message's uuid (probe 1). The CLI
  never echoes sent input; its `isReplay` frames carry local-command output.
- **One send queue, on the server.** Queued sends live per session on the
  server, are acknowledged as `input_queued`, and are delivered when the session
  is idle; every browser shows them. The CLI's own queue (message priority and
  uuid, `still_queued`) is used only for an explicit *Send now*. One queue
  instead of three (browser, server, CLI), and it survives a closed phone.
- **Requested settings live on the server, per session.** Permission mode,
  model, effort and fast mode are held server-side with requested and effective
  values. Otherwise phone and laptop on one live session each send their own
  browser-held mode and flip it back and forth. The per-device value becomes the
  default for new sessions only; that supersedes ARCHITECTURE.md invariant 11 for live
  sessions (ADR in phase 0).
- **"Default" is resolved before it is sent.** Clearing `effortLevel` or `model`
  through the flag layer falls back to the model's built-in effort or Claude
  Code's fallback model (sdk.d.ts:2929-2935), not ADR 0063's Default or the
  picker's. CLIde sends the resolved value. Measured: `effortLevel: null` ran
  sonnet at medium while `settings.json` said high, and `model: null` went to
  Fable 5.1, which this account cannot use without usage credits (probe 6).
- **No `prewarm`.** It cannot resume (its claim options have no `resume` or
  `sessionId`, sdk.d.ts:311-361), and a parked spare holds about 230–260 MB
  (sdk.d.ts:2769, the SDK's own figure). Reopening is a cold resume, as today;
  `startup({options:{resume}})` could later save the spawn.
- **Live changes before reopening.** MCP changes go through `setMcpServers`,
  plugin and skill changes through `reloadPlugins`/`reloadSkills`; a session is
  marked stale and reopened at idle only when no live method covers the change.
- **Hand-parsed history stays.** `listSessions`/`getSessionMessages` are
  Claude-only and bypass the multi-provider watcher.
- **Untyped SDK methods only behind a feature check.** `askSideQuestion`,
  `renameSession`, `listPermissionRules`, `cancelAsyncMessage` and others exist
  in `sdk.mjs` but not in `sdk.d.ts`; each is guarded the way `askSideQuestion`
  is today.

## Target design

### Typed wire: `shared/chat-protocol/`, imported by server and client

`shared/` is already imported by both (`synced-preferences.ts`), so no build
plumbing is needed.

- `rows.ts`: `TranscriptRow`, a discriminated union on `kind` covering today's
  persisted kinds (text, thinking, tool_use / tool_result, error,
  compact_boundary, interactive_prompt, task_notification, agent_status, …),
  each with only its own fields. The index signature goes. REST history, live
  frames and the external SSE agent API all carry the same shape.
- `events.ts`: ephemeral frames, never persisted: today's status, permission,
  complete and gateway kinds, the five kinds the server sends today that belong
  to no union, and new ones as phases add them (`turn_started`,
  `session_state`, `input_queued`, `text_delta`, `commands_changed`,
  `settings_changed`, `client_outdated`). The envelope carries `v`.
- `tools.ts`: `ToolKind` (shell, file_read, file_edit, file_write, search,
  web_fetch, web_search, todo, plan, question, agent, mcp, other), set on tool
  rows by each provider's normalizer; the raw tool name and input are kept.
  This moves the client's existing classifiers (`getToolCategory`,
  `describeInput`, `toolConfigs.ts`) to the server. Claude's tool names are
  already the shared vocabulary that Codex's adapter maps onto.
- Capabilities: the existing matrix gains a mode per control (`live`,
  `next-turn`, `none`) for model, permission mode, effort and fast mode.
  `session_state` says whether the session has a live process. The client gates
  on these, never on provider id.

### Session host: evolve `chatRunRegistry` and `ChatSessionWriter`

- An outer per-session handle holds turns. `seq` and `runId` become
  session-scoped; replay covers the current turn; the log is trimmed at turn
  boundaries. The after-`complete` drop becomes per turn.
- Every subscribed socket gets every frame. `chat.subscribe` replaces a
  socket's subscription set instead of adding to it.
- "Busy" splits three ways: `turnRunning`, `pinned` (background tasks or a
  pending request), `alive` (a process exists). Shell, fork, scheduled sends,
  the sidebar and `chat_subscribed` each use the right one.
- One writer per transcript. An idle live process counts as a writer: "Open in
  CLI" and the Shell close it first. A second writer (the agent API with a
  session id, an idle side question) uses the live handle or is refused. Today
  the agent API bypasses `chatRunRegistry` entirely and runs with bypass
  permissions.
- Notifications are keyed by turn and fire when a turn ends with no held tasks.
- Memory: a `MemAvailable` floor plus an idle timeout, both env-configurable.
  Either one evicts the oldest *unpinned* process. A pinned session is never
  evicted automatically; when everything is pinned and memory is under the
  floor, a new open waits and says why. The budget counts every `claude`
  spawn, not only chats.
- Lifecycle: SIGTERM closes every Claude handle and the Codex App Server client;
  start-up sweeps orphans. The update lease is taken per turn, and an update
  drains idle processes first.
- Dispatch: the host calls `runtime.open()` when a runtime has it, otherwise
  `runtime.run()` per turn. `run()` stays for one-shot jobs. Runtimes are
  addressed by the app `session_id` only.

### Claude session: TypeScript, `providers/list/claude/`, the only module importing the SDK

- One `query()` per open session; its input closes only on `close()`. A
  `TurnState` per turn holds today's ~15 per-turn locals, extracted into a typed
  module that the old per-turn path also uses. The 1,596-line runtime is not
  converted wholesale; what survives phase 9 is small.
- New sessions get their provider id up front through `Options.sessionId`
  (sdk.d.ts:2085-2091; new sessions and forks only). The stream is still
  watched for id changes: `/clear`, plan-mode exit and similar flows send
  `conversation_reset` with a new id, which is remapped before the watcher
  indexes the new file.
- Stop: `interrupt()` first; a stopping state drops frames until `result` or idle
  and holds sends; if the interrupt has not settled within a few seconds, close
  and reopen lazily. `perTaskStopAffordance: true` ships together with a stop
  button per background task (`stopTask`), because the option promises that
  control.
- Reconcile table for per-send options: `setPermissionMode`; `setModel` plus
  the sessions-row update ADR 0025 requires; `applyFlagSettings` for effort and
  fast mode; the tool allow and deny lists through a mutable reference that
  `canUseTool` reads; MCP, plugins and skills through their live methods.
- State changed from inside the session (`/model`, `/effort`, `/fast` typed as
  text) is read back and persisted, never silently reverted.
- Per-turn cost and tokens are the difference between consecutive `result`s:
  `total_cost_usd` and `modelUsage` are running totals in a streaming session
  (sdk.d.ts:5736-5744). The synthetic-row token guard stays
  ([code anchors](../maps/code-anchors.md)).
- Side questions ride the live handle. Context usage is read while idle with
  `detail: 'summary'`.
- `loadMcpConfig`'s hand-merge goes: its project branch reads a
  `claudeProjects` key that Claude's config file doesn't have (it uses
  `projects`), and the CLI loads project MCP servers itself through
  `settingSources`. CLIde's own browser MCP server stays in `mcpServers`.

## Every SDK surface has a home

### Messages: all 39 `SDKMessage` members at 0.3.286

"Needs" names the switch without which the type never arrives. "Today" is what
CLIde does now.

| Type | Home | Shows as | Needs | Today |
|---|---|---|---|---|
| `assistant` | row | text, thinking, tool call | — | handled |
| `user` | row | user text; tool result incl. `tool_use_result` | — | handled; `tool_use_result` lost live |
| `compact_boundary` | row | compaction divider | — | handled |
| `local_command_output` | row | command output (`/usage`, …) | — | wrong branch, mangled |
| `conversation_reset` | session + row | divider; provider id remapped | — | dropped |
| `model_refusal_fallback` | row | "retried on fallback model" notice | — | dropped |
| `model_refusal_no_fallback` | row | refusal notice | — | dropped |
| `stream_event` | turn | words as they arrive | `includePartialMessages` | dropped |
| `status` | turn | status line | — | handled |
| `api_retry` | turn | "retrying" on the activity row | — | handled |
| `thinking_tokens` | turn | thinking progress | — | handled |
| `tool_progress` | turn | elapsed time on the tool row | — | dropped |
| `tool_use_summary` | turn | one-line tool summary | env `CLAUDE_CODE_EMIT_TOOL_USE_SUMMARIES=1` (confirmed, probe 8) | dropped |
| `hook_started` / `hook_progress` / `hook_response` | turn | hook lines in the activity | `includeHookEvents` | dropped |
| `control_request_progress` | turn | side-question progress | — | dropped |
| `result` | turn | turn end; summary line (time, cost, denials) | — | handled |
| `init` | session | effective model, mode, tools, MCP, commands; terminal-only list cached | — | id capture only |
| `session_state_changed` | session | idle / running, the authoritative turn-over signal; reports idle while background shells still run (probe 11) | env `CLAUDE_CODE_EMIT_SESSION_STATE_EVENTS=1` (confirmed, probe 8) | dropped |
| `commands_changed` | session | slash menu refresh | — | dropped |
| `background_tasks_changed` | session | task strip | — | handled |
| `task_started` / `task_updated` / `task_progress` / `task_notification` | session (+ row for the notification) | task strip rows | — | handled |
| `auth_status` | session | signed-out banner | — | dropped |
| `files_persisted` | diagnostic | counted (undocumented in `sdk.d.ts`) | — | dropped |
| `plugin_install` | diagnostic | never arrives locally | env `CLAUDE_CODE_SYNC_PLUGIN_INSTALL` | dropped |
| `worker_shutting_down` | diagnostic | never arrives locally (bridge only) | — | dropped |
| `notification` | interaction | toast by priority | — | dropped |
| `informational` | interaction | banner (hook block reasons, command text) | — | dropped |
| `prompt_suggestion` | interaction | suggestion chip in the composer | `promptSuggestions` | dropped |
| `permission_denied` | interaction | "auto-denied: <tool>" notice | — | dropped |
| `memory_recall` | interaction | "recalled from memory" line | — | dropped |
| `elicitation_complete` | interaction | closes a URL-mode elicitation card | — | dropped |
| `rate_limit_event` | account | usage ring | — | handled |
| `mirror_error` | diagnostic | never (needs `sessionStore`, declined) | — | dropped |
| `user` with `isReplay` | drop | local-command output the CLI echoes (`setModel` sends one); sent input is never echoed (probe 1–2) | — | dropped |
| `command_lifecycle` (outside the union) | turn | the delivery receipt: `queued`, `started`, `completed` or `cancelled` per sent uuid, on every turn (probe 1) | — | dropped |

The disposition record is keyed on type, subtype and `isReplay`, and has a
runtime default: the SDK yields at least five frame types outside the union,
so the type checker alone cannot catch everything. Callbacks: `canUseTool`
(approvals, questions, plan exit) feeds the request tray; `onElicitation`
feeds a request card; `onUserDialog` needs `supportedDialogKinds` listing the
kinds CLIde renders, or it is never called (sdk.d.ts:1765-1785).

### `Query` methods: 30 typed, plus untyped ones

| Method | Home | Phase |
|---|---|---|
| `interrupt` | Stop (first, not after the signal) | 6 |
| `setPermissionMode`, `setModel`, `applyFlagSettings` | composer controls, live | 1 (mid-turn), 6 (between turns) |
| `setMaxThinkingTokens` | not used: deprecated for the `thinking` option | — |
| `setMcpPermissionModeOverride` | not surfaced: tighten-only per-server override, no UI asks for it | — |
| `updateSettings` | candidate for persisting effort through the CLI's own writer (allowlist: `effortLevel`, `outputStyle`) | 8 |
| `initializationResult`, `supportedCommands`, `supportedModels`, `supportedAgents`, `accountInfo` | read the cached `initialize` answer, so an idle query that never sends a message can answer: slash menu, models (already), account | 1, 7 |
| `reinitialize` | not needed: over stdio a live process has no transport gap | — |
| `mcpServerStatus`, `reconnectMcpServer`, `toggleMcpServer`, `setMcpServers` | MCP status and controls in the session strip; live MCP changes | 7, 6 |
| `getContextUsage` | context ring: mid-turn today, idle with `detail: 'summary'` | 6 |
| `usage_EXPERIMENTAL_…` | not used: unstable; the usage service stays | — |
| `readFile`, `readMcpResource`, `seedReadState` | not surfaced: CLIde reads files itself and never trims context | — |
| `reloadPlugins`, `reloadSkills`, `reloadOutputStyles` | after Tools-page changes, on live sessions | 7 |
| `rewindFiles` | rewind Phase B (ADR 0007) | 7 |
| `streamInput` | internal: the input channel | — |
| `stopTask`, `backgroundTasks` | per-task stop; task strip's initial state | 6, 7 |
| `close` | eviction and session close | 6 |
| untyped: `askSideQuestion` (today), `renameSession`, `generateSessionTitle`, `listPermissionRules`, `cancelAsyncMessage` | feature-checked: titles in 7, permission rules in 8; `cancelAsyncMessage` unused because the queue is CLIde's | 7, 8 |

### Options and hooks this plan turns on

`sessionId` (1), `thinking: {display: 'summarized'}` (1),
`allowDangerouslySkipPermissions` (1: probe 5 found a live switch to bypass is
refused without it, and other modes still ask with it), `includePartialMessages`
(2), `perTaskStopAffordance` (6), `includeHookEvents`, `onElicitation`,
`onUserDialog` + `supportedDialogKinds`, `promptSuggestions`, `forwardSubagentText`
(7). Env switches: `CLAUDE_CODE_EMIT_STARTUP_TIMING=1` (1, per-turn timing for the
scorecard), `CLAUDE_CODE_EMIT_SESSION_STATE_EVENTS=1` and
`CLAUDE_CODE_EMIT_TOOL_USE_SUMMARIES=1` (6–7; both confirmed by probe 8). Hooks:
none new. Probe 4 found AskUserQuestion reaches `canUseTool` in auto and bypass,
so the planned `PreToolUse` hook is dropped; `Notification` stays. The other 32
hook events are the user's own: they appear through `includeHookEvents` rows, not
CLIde registrations.

### Codex on the same contract

- Codex keeps per-turn runs behind the session host; its App Server process is
  already long-lived and shared.
- Its eight item types map onto the same rows: `userMessage` → user,
  `agentMessage` → text, `reasoning` → thinking, `plan` → plan,
  `commandExecution` → tool (shell), `fileChange` → tool (file_edit),
  `mcpToolCall` → tool (mcp), `webSearch` → tool (web_search). Its six handled
  notifications map onto the same events: `item/started` and `item/completed`
  → rows, `turn/completed` → turn end, `thread/tokenUsage/updated` → session
  state, `serverRequest/resolved` → request resolved, `error` → notice. Anything
  else the App Server sends is dropped today.
- A Codex drift test needs the App Server's own generated schema as input. One
  against CLIde's hand-written protocol file (six notifications) checks nothing.
- Cursor and OpenCode: per-turn behind the host, typed rows and `ToolKind`,
  capabilities declared `none` where unknown. Neither is installed to test
  against, so beyond that they are frozen.

## Phases

Sizes are estimates in focused agent sessions, not measurements. Each phase
ships on its own, keeps all four providers working, and updates `docs/TODO.md`
and this plan in the same commit as its code. "You" is Grayson's under-a-minute
check; "Agent, live" is what a session on the Pi verifies before calling the
phase done.

- [x] 0. **Ground rules and probes — est. 2.** Done 2026-10-05; ADRs accepted 2026-10-06.
  - ADRs: 0065, the runtime layer is
    rebuilt in place and stops tracking upstream (with the upstream sync map's
    matching line); 0066, one long-lived Claude process per chat, Stop ends only
    the turn, delivery read from `command_lifecycle`, superseding ADR 0013 for
    Claude; 0067, one typed message shape shared by server and client; 0068, a
    live session's settings and queue on the server, superseding ARCHITECTURE.md invariant 11
    for open sessions.
  - Probes: `scripts/verify-claude-session-sdk.ts`, the 13 checks plus a
    background-subagent interrupt, run on the Pi; results in the
    [SDK map](../maps/claude-agent-sdk.md)'s §2 table and the script's FINDINGS,
    sanitized frame streams in `server/modules/providers/tests/fixtures/claude-session-sdk/`.
    The SDK map's §4 counts are fixed (14 of 39 handled).
  - What the probes changed here: no `PreToolUse` hook (phase 1);
    `allowDangerouslySkipPermissions` on every chat (phase 1); delivery from
    `command_lifecycle`, not an input echo (design positions, phase 6); "Sent"
    from `message_start`, not `rate_limit_event` (phase 2); `perTaskStopAffordance`
    needed for subagents only, the session's idle state is not the pinned signal,
    and an error-then-close exits 1 (phase 6).
  - Runtime scorecard, the one runtime change in this phase (logging only): every
    `[turn]` line of a turn carries the app session id (a new chat's `start` said
    `session=new`), and `end`/`failed` carry `dropped=`, the SDK frame kinds
    nothing handled. `scripts/runtime-scorecard.mjs` reports per turn run start →
    first frame and → result, the live `claude` processes with their memory, and
    available memory. Baseline from the logs before any phase-1 change (246 turns,
    2026-09-28 → 10-05): run start → first frame p50 3.3 s resumed, 3.1 s new,
    p90 4.4 s; run start → result p50 61 s, p90 500 s; 20 failed runs, 8 error
    results, 12 aborts. Probe split of "Starting": spawn 2.7–2.9 s, transcript
    load ≤ 0.4 s, warm turn to `init` 50–80 ms. Memory: an idle `claude` ~122 MB
    private; three open took available memory down 203 MB.
  - Overlapping plans' Next lines edited: TypeScript conversion phase 5 is
    superseded by phase 6; subagent visibility phase 5 and rewind Phase B wait on
    phase 7; chat history performance phase 13 lands with phase 2 and its phase 11
    is coordinated with phase 3; Claude permission default and Claude settings
    phase 6 read session state from phase 5; the flight recorder's chat-path core
    is phase 1b.

- [ ] 1. **Quick wins on today's runtime — est. 2–3.**
  - Done: the id-space slips (context refresh, abort record, forked resume),
    with fake-`Query` turn tests in `provider-runtime.test.ts` that phase 6 extends.
  - Built, not yet live-checked: `chat.control`. A composer change during a
    running turn calls `setPermissionMode`, `setModel` or `applyFlagSettings` on
    the live query, gated by the capability matrix's new `controlModes` (`live`
    for Claude, `next-turn` elsewhere). The sessions row is still written by the
    composer's own requests; "Default" effort resolves to the model's own level,
    and `max` waits for the next send (the flag layer cannot carry it).
  - Done, no code: AskUserQuestion in bypass does not reproduce. All 12 calls in
    CLIde transcripts from 2026-09-16 to 10-06 were shown and answered, 4 of
    them in bypass; `canUseTool` never short-circuits interactive tools.
  - Built, with `chat.control`: `allowDangerouslySkipPermissions: true` on every
    Claude chat query, so a live switch to bypass works (probe 5).
  - Built: `CLAUDE_CODE_EMIT_STARTUP_TIMING=1` on chat queries. `[turn]
    first-frame` carries `ready_ms` (spawn to input ready), `[turn] result` carries
    `request_ms` and `ttft_ms`, and the scorecard summarises all three.
  - Built, not yet seen in the app: the slash menu adds `supportedCommands()` from
    an idle query per project (49 rows here, 2.1 s), cached 30 minutes, minus the
    last `init`'s terminal list and the commands whose state CLIde does not yet
    read back. CLIde's own 11 stay and win name clashes.
  - Built and checked against the real CLI (aborts at 0.6–4.2 s, all mapped,
    including one with no frames): `Options.sessionId` for new sessions. The
    mapping is recorded at the first frame as before, or once a frame-less run's
    transcript appears (the CLI writes it as it exits); recording it before spawn
    would map a chat whose spawn failed to a transcript that never existed.
  - Built: the live `tool_use_result` reaches tool rows, and chat queries ask for
    `thinking.display: 'summarized'` (measured: Opus's thinking text is empty
    without it, 141 characters with it; Haiku accepts it).
  - You: during a running Claude reply, switch the mode in the composer; the
    next tool call follows it without a new message. Agent, live (done
    2026-10-06): aborted new chats map their transcript, against the real CLI;
    the slash menu on a test server lists 69 commands, 41 from the CLI.

- [ ] 1b. **Chat-path flight recorder — est. 1–2.** The chat-path core of the
  [diagnostics flight recorder](diagnostics-flight-recorder.md), built before
  phases 2–3 change what the client receives, so a "nothing appeared" report from
  the phone says which of its five causes it was.
  - Built, not yet seen on the phone: `src/utils/flightRecorder.ts`. Per frame
    reaching the WebSocket listener: kind, short session and run ids, `seq`,
    listener count, and handler notes (`stored`, `buffered`, `subagent`,
    `no-session`, `dup`, `threw` with a redacted message and top stack frames);
    the store adds `no-id`, `cap`, `detached` or `hidden` when a live row does
    not reach the merged view. Also sends (type, session, sent or not), socket
    connect/open/close/watchdog/wake and page visibility. Never contents.
  - `?clideRecord=1` turns it on per origin before React starts (`=0` turns it
    off and deletes what it kept). Each page load keeps its own storage key, 300
    events, newest three loads; identical consecutive frames fold into one line.
    A Copy / Clear / Off bar, built outside React, sits top right below the
    header. No Settings screen: that stays in the flight-recorder plan's phase 3,
    with its boot, service-worker and auth probes.
  - Off costs one null check per call site; 12 recorder tests plus a store case.
  - Agent, live (done 2026-10-06, main's client on Vite against the 3002 test
    server): a Haiku turn recorded subscribe → send → status, thinking and text
    `stored` → complete, with no message text; Copy, and Off clearing storage.
  - You: open a chat on the phone with the parameter, send a message, copy the
    block; it lists the turn's frames by kind and nothing you wrote.

- [ ] 2. **Word-by-word replies — est. 1–2.**
  - `includePartialMessages`; the normalizer reads the wrapped `stream_event`;
    the server coalesces deltas into `text_delta` frames that take no replay
    slot; subagent `stream_event`s are dropped.
  - The client reuses the existing `stream_delta`/`stream_end` path and its
    100 ms buffer, never a parallel one. The final row reconciles by API message
    id plus block index, replacing the store's text matching, and keeps its real
    row id.
  - A session not on screen updates one buffered row, not one row per chunk.
    Today each delta appends its own row and counts against the 500-row live
    cap, so background sessions would show duplicated text.
  - The "Sent" stage moves from the first `rate_limit_event`, which can arrive
    after the reply or not at all on a warm turn (probe 1), to the `message_start`
    stream event.
  - [Chat history performance](chat-history-performance.md) phase 13 (cost per
    chunk) lands here.
  - You: ask something with a long answer; it appears word by word; reload, and
    the same reply shows once. Agent, live: the scroll benchmark and history
    budgets hold.

- [ ] 3. **Typed wire in place, no behaviour change — est. 2–3.**
  - `NormalizedMessage` moves to `shared/chat-protocol/` as the row and event
    unions. The client's copy is deleted, `WebSocketContext` frames are typed,
    and `ChatMessage` is typed. Type errors drive the fixes; no index signature
    remains.
  - Every normalizer sets `ToolKind`; the client renders tools by kind with
    per-name overrides. The tool-name branches in `MessageComponent`,
    `ToolRenderer`, `toolActivity.ts`, `operationDetail.ts` and `toolConfigs.ts`
    go.
  - `MessageComponent` switches exhaustively on row kind.
  - The history bench patches exact source text in `MessageComponent.tsx` and
    `useChatMessages.ts` and fails with "Counter seam changed" if it moves; move
    those markers in the same commit.
  - You: Claude and Codex tool rows look unchanged on phone and laptop, before
    and after a reload. Agent: full `npm test` (a protocol change).

- [ ] 3b. **Failure pass and product bar: research, no code — est. 1.** Gaps
  the [pillar check](../../ARCHITECTURE.md#quality-goals-pillars) found.
  - Failure pass: for every call out of CLIde (provider processes, the APIs
    behind them, WebSocket, Git, MCP, scheduled sends), what you see when it
    fails, hangs or half-succeeds. Each silent case becomes an item in phases
    4–6, or a TODO line if it is outside the runtime.
  - Product bar: what Claude Code's CLI and desktop app, T3 Code and Happy do
    that CLIde lacks. Each gap is mapped to a phase here, to the `/next` mobile
    plan, or declined with a reason. It runs before phase 5 so anything that
    needs the protocol lands in it.
  - You: read both lists and say which gaps matter.

- [ ] 4. **Session host, part 1: busy states, writers, lifecycle — est. 1–2.**
  - The three busy predicates, each caller moved to the right one. A send to a
    pinned session (background tasks running, no turn) becomes a new turn on the
    held input instead of RUN_IN_PROGRESS.
  - The one-writer rule for idle processes and for the agent API.
  - The update lease per turn; updates drain idle processes.
  - SIGTERM closes every handle; start-up sweeps orphans.
  - The memory floor and idle timeout, counting every `claude` spawn. Measured
    sizes to set them by: an idle `claude` ~122 MB private, ~150 MB shared-fair
    (PSS), one mid-turn with tool children ~170 MB; three open took available
    memory from 637 to 434 MB with the host's usual load.
  - No wire change. You: start a dev server in a chat, then send another
    message; it goes through. Agent, live: Claude and Codex send, stop, resume
    and approve; a scheduled message fires; a CLI update with an idle session.

- [ ] 5. **Session host, part 2: protocol v2 — est. 2–3.** Needs
  [message-edit-model](message-edit-model.md) phase 3 first.
  - The envelope's `v`, with `client_outdated` on a mismatch.
  - Session-scoped `seq` and `runId`, turns inside the session handle, replay of
    the current turn, and the per-turn after-`complete` drop.
  - Fan-out to every socket; subscribe replaces the set.
  - The server-side queue (`input_queued`, delivered at idle); the browser's
    `localStorage` queue migrates to it.
  - Server-held session state with requested and effective values, pushed as
    `session_state` on change and on subscribe. It extends the store's existing
    per-session model, effort and fast-mode fields rather than adding a parallel
    path.
  - Notifications keyed by turn.
  - Tests: extend `chat-run-registry.test.ts` and the conformance cases in
    `chat-session.test.ts`. Each provider, with app and provider ids unequal:
    send, stream and request round trip; abort before and after the provider id
    exists; exactly one turn completion; replay after reconnect; two sockets on
    one session; a send while busy is queued, not rejected.
  - You: open one Claude chat on phone and laptop, send from the laptop; the
    phone shows the reply live, and a mode change on one shows on the other.
    Queue a message on the phone and close it; it still sends.

- [ ] 6. **Claude long-lived session, behind `CLIDE_CLAUDE_SESSIONS=persistent` — est. 3–4.**
  - Everything under "Claude session" above.
  - The idle signal is `session_state_changed` (its env var works, probe 8). It
    reports idle while background shells still run (probe 11), so `pinned` comes
    from `background_tasks_changed`, not from it.
  - `perTaskStopAffordance` matters for background subagents: a bare interrupt
    already spares background shells and kills subagents (probe 3).
  - Error results never end the session (probe 7), but closing the input after
    one makes the CLI exit 1 and the iterator throw; the host treats that as a
    normal close. A process that exits on its own (crash, OOM kill) marks the
    session closed and fails its running turn; the next send reopens it.
  - Delivery is the `command_lifecycle` `queued`/`started` frame for the sent
    uuid; a send whose uuid is `cancelled` is reported undelivered.
  - Eviction and reopen as under "Session host"; reopening is a cold resume.
  - Phase 1's workarounds for the per-message process go: an aborted new chat's
    mapping waits on the process exit, not a 5-second file check; the command
    list comes from the open session, and the idle `claude` per project stays
    only if a project with no open chat still needs it — decided by measuring.
  - Tests on an injected fake `Query`: user- and provider-initiated turns;
    interrupt and stopping; live controls and the reconcile table; idle close
    and reopen, stale reopen, rewind reopen, `/clear` remap, replaying
    the phase-0 fixtures. Re-run the probe through the adapter, and on every SDK or
    CLI bump after: `command_lifecycle` and both env switches are undocumented.
  - You: send two messages in a row; the second shows no "Starting". Start a
    background job, press Stop on the reply; the job keeps running and has its
    own stop. Leave a chat idle past the timeout, then send; it resumes normally.
  - Agent, live: no `[turn] start` respawn between messages; a background job
    wakes the chat after an hour; resident memory with three open sessions,
    against the floor. The flag defaults on after Grayson accepts.

- [ ] 7. **Every Claude message and control has a home — est. 3–4.**
  - The disposition record, filled from the table above; one per-row mapper for
    live frames and JSONL rows; the cross-row folds (tool-result attachment,
    subagent files, token crediting, compact references, echo removal) move to
    `shared/`; a golden test holds live-then-folded equal to `fetchHistory` for
    the same recorded session. History-only row types get their own list from
    real transcripts.
  - Commands: `supportedCommands()` and `commands_changed` feed the menu; slash
    text is sent natively; `local_command_output` becomes a command-output row;
    terminal-only commands are hidden. `/model`, `/effort`, `/fast`, `/clear` and
    `/rename` leave the hide list once their state is read back
    (`conversation_reset`, the session title, the composer controls).
  - A task strip from `task_*`, `background_tasks_changed` and
    `backgroundTasks()`.
  - Requests: `onElicitation`; `onUserDialog` with `supportedDialogKinds`.
  - Notices: `informational`, `notification`, `model_refusal_*`,
    `permission_denied`, `auth_status`, `memory_recall`.
  - A one-line turn summary from `result` (the mockup's "read 6 files · edited
    3, +42 −7 · tests passed").
  - `rewindFiles` (rewind Phase B), `forwardSubagentText`, `promptSuggestions`,
    `includeHookEvents`, MCP status and controls, `accountInfo` (replacing
    credential-file inference), plugin and skill reloads, session titles.
  - The SDK map's coverage table is generated from the record by a test; `tsc`
    fails when an SDK bump adds a message type.
  - Drift reaches past message types: every `Options` field, `Query` method and
    hook event in `sdk.d.ts` gets an entry (the phase that uses it, or why it is
    not surfaced), and a test fails by name on one the record lacks, the way the
    settings catalog test does for settings keys.
  - You: run `/usage` in the composer; its output appears as a row. A finished
    turn shows its one-line summary. Agent: the golden test passes.

- [ ] 8. **Controls from capabilities, requests across sessions, the provider kit — est. 2–3.**
  - The composer applies `live` controls immediately and `next-turn` ones at
    send, from the capability modes, and shows requested against effective.
  - One client store of pending approvals and questions for every session, not
    only the one on screen. This is what lets the mockup's Home answer a
    request from a card.
  - Permission unification stays with [the Claude settings plan](claude-settings-surface.md)
    phase 6; this phase gives it the session state it needs.
  - The provider kit: one provider id list in `shared/`; a server descriptor
    endpoint (label, logo key, capability defaults) that drives the client's
    provider lists; `docs/maps/adding-a-provider.md` replaces the README
    section; phase 5's conformance suite is the gate a new provider passes.
  - Provider-name checks a capability can replace go; per-provider settings,
    login, MCP and logo screens keep theirs. Capability flags nothing reads are
    consumed or deleted.
  - Provider updates name what has no home: the Codex protocol test also lists
    App Server notifications CLIde does not handle (from the bindings
    `check:providers --protocol` already generates); `check:providers` ends
    with each provider's surfaces that have no home; the capability map's
    tables are generated from the descriptors.
  - You: in a Codex chat the composer offers only controls Codex can change; in
    a Claude chat a mode change applies to the running reply.

- [ ] 9. **Cleanup — est. 1.**
  - The from-scratch review: every workaround named under design positions is
    gone, or has a written reason a client built today would keep it.
  - Remove the phase-6 flag and Claude's per-message chat path. `run()` stays
    for one-shot jobs (commit messages, the agent API).
  - Update the SDK map (snapshot and bottom line), the capability map, code
    anchors, the websocket and providers READMEs, and the `AGENTS.md` routing
    table. Narrow the TypeScript conversion plan to Codex, Cursor, OpenCode and
    notifications. Archive this plan.

## Done when

- Two messages in a row in one Claude chat start no new process, and a
  background job can wake the chat by itself.
- A mode or model change applies to the running reply, and the composer shows
  the mode the session is actually in.
- Replies stream word by word, and a reload shows the same rows.
- `npm test` fails, naming the type, when an SDK bump adds a message type
  nothing handles.
- Phone and laptop on one chat see the same live turn, the same queue and the
  same mode.
- Three open Claude chats stay above the memory floor, and a chat with a
  running background job is never closed to make room.
- Adding a provider is one adapter folder plus passing the conformance suite.
- After any provider update, one command lists what is new and has no home yet.

## Pre-mortem

It failed in six months. The likeliest reasons, each already a work item:

- A CLI update dropped an undocumented frame or switch the session relies on
  (`command_lifecycle`, the session-state env var): the probe re-runs on every
  bump (phase 6), and `dropped=` in the scorecard shows new kinds (phase 0).
- Memory ran out with a few chats and a language server open: the floor reads
  available memory, so other processes count (phase 4); the scorecard shows who
  holds it (phase 0).
- A crashed process left a chat stuck "running": phase 6's unexpected-exit rule.
- A phone showed nothing after a wire change and nobody could say why: phase 1b
  before phases 2–3.

## Reuse, don't rebuild

- Requests: `interactiveRequestRegistry`. Session rows:
  `sessionsDb.assignProviderSessionId`. Shell exclusivity:
  `isSessionOpenInShell`. Account usage: `providerUsageService`.
- Claude pieces: `createClaudeInputChannel`, `claude-rewind.util.ts`, the
  `claude-context-usage.ts` cache, `claude-settings-cascade.ts`.
- The attachment trust boundary in `buildChatRuntimeOptions`.
- `chatRunRegistry`'s tests and abort machinery (ADR 0013 still holds for the
  per-turn providers).
- The client's streaming path (`updateStreaming`/`finalizeStreaming`) and the
  store's per-session model, effort and fast-mode fields.

## What Grayson gives up

- Upstream fixes to runtime, gateway and chat-event code stop arriving; each
  one is reimplemented by hand or skipped. Other areas keep taking upstream work.
- Each open Claude chat holds a `claude` process (~234 MB resident, ~122 MB of
  it private, measured idle).
  Idle chats close, so a chat left long enough pays a cold start again.
- During phases 6–9, Claude has two paths behind a flag.
- Cursor and OpenCode get no new features.
- No instant first message (`prewarm`) in this plan.

## Not doing

- The `/next` mobile layout: its own follow-on plan.
- Native long-lived adapters for Codex, Cursor or OpenCode.
- Codex live-versus-reload parity (follow-on, per Grayson's call 2).
- `prewarm()` spares; the SDK session store; replacing hand-parsed history with
  `listSessions`.
- Anthropic's bridge and remote-control surfaces: a separate product.
