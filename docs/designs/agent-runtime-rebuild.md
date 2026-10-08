# Agent runtime design: long-lived Claude sessions, one typed wire, a home for every message

- Status: agreed 2026-10-06
- Plan: [Rebuild the agent runtime](../plans/agent-runtime-rebuild.md)
- Context: `scripts/verify-claude-session-sdk.ts` (its FINDINGS block holds the
  phase-0 probe results), `scripts/runtime-scorecard.mjs`,
  [code anchors](../code-anchors.md),
  [provider capabilities](../providers.md),
  [architecture](../../ARCHITECTURE.md) invariants 3 and 11;
  ADRs 0003, 0007, 0008, 0012, 0013, 0025, 0056, 0063, 0064, 0065–0068

This design fixes the layer between each provider's SDK and the chat view, Claude
first. The shell around it stays: sidebar, settings, Git, terminal, PWA, login,
voice, scheduled messages. It binds every phase of the plan and changes only
with Grayson; the plan holds the phases and their progress.

It merges three drafts written on 2026-10-04 (an interactive Claude.ai session,
and branches `ccr-a929207f-vys16r` and `ccr-1aa6a311-vle29l`). Every factual
claim in them was checked against source and `sdk.d.ts` at SDK 0.3.286. The
interactive draft is the base; the branches' verified ideas are folded in; their
errors are dropped. Labels: **source** = read in code, **sdk.d.ts** = read in
the pinned types, **measured** = run, **probe** = needs the phase-0 live check.

## Starting point (source, SDK 0.3.286)

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

## Settled with Grayson

- 2026-10-04: today's UI moves onto the typed wire in this rebuild; the mockup's
  mobile layout is a follow-on plan at `/next`.
- 2026-10-04: Claude gets a native long-lived session. Codex, Cursor and OpenCode
  keep per-turn runtimes behind the same session host. Codex's App Server is
  already long-lived, so a native Codex adapter waits for a concrete gain.
- 2026-10-04: runtime, gateway and chat-event code stop tracking upstream (ADR).
- 2026-10-04: verification is a fake `Query` in tests, small live turns, and
  acceptance on the Pi per phase.
- 2026-10-05: the rebuild is the priority, and its plan may exceed the plan size cap.
- 2026-10-06: ADRs 0065–0068 accepted as written; that settles the plan's call 3
  (Stop ends only the reply).
- 2026-10-08: a tool call is one row updated by id (phase 3); tool kinds take
  ACP's names where they overlap; ACP itself is not the wire.

## Design positions

Each is a technical call, with its reason.

- **The bar is a Claude client built today, not CloudCLI's past.** Grayson kept
  this codebase instead of restarting on the strength of this design, so existing
  behaviour earns no weight by being there. Every phase is reviewed against what
  a from-scratch client would do; a workaround that exists only because of the
  old design is listed in the plan's inherited workarounds, with the phase that
  removes it.
- **Fix in place; no new app.** A rewrite rebuilds resume, approvals, tool
  display, PWA quirks, login, terminal, Git, Browser, voice and scheduled
  messages before gaining anything; what is wrong is concentrated in about
  4,500 lines.
- **No second event model.** Today's message kinds are typed in place, so live
  and history rows stay one shape and `useSessionStore`'s pagination, scroll
  restoration and reconciliation keep working. Both branch drafts deleted the
  client store's layer instead, unflagged: about 2,500 lines and 132 tests, with
  no mention of scrolling, history loading or ADR 0056.
- **ACP's vocabulary, not ACP as the wire.** The Agent Client Protocol (Zed's
  open standard for one client and many agents) is the nearest from-scratch
  reference, and its shape matches this one: a typed union, a tool call as one
  item updated by id, a tool kind. It is a common denominator by design, while
  phase 7 gives every Claude message a home; Claude-only frames (background
  tasks, `command_lifecycle`, rewind, usage-limit stops) would need its
  extensions (not checked against the spec), and each agent would add a bridge
  process on a 4 GB host. Borrowing its names keeps an ACP adapter, for agents
  CLIde cannot test natively, one adapter folder away.
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
  persisted kinds (text, thinking, tool, error, compact_boundary,
  interactive_prompt, task_notification, agent_status, …), each with only its
  own fields. The index signature goes. REST history, live frames and the
  external SSE agent API all carry the same shape.
- A tool call is one `tool` row with a status (`running`, `completed`,
  `failed`), sent when the call starts; its result arrives as an update keyed by
  tool id. History sends the finished row, so live and reload share one shape.
  Codex's `item/started`/`item/completed` map onto it directly instead of being
  split into two rows and joined again. An update that arrives before its row is
  held, not dropped.
- `events.ts`: ephemeral frames, never persisted: today's status, permission,
  complete and gateway kinds, the five kinds the server sends today that belong
  to no union, and new ones as phases add them (`turn_started`,
  `session_state`, `input_queued`, `text_delta`, `commands_changed`,
  `settings_changed`, `client_outdated`). The envelope carries `v`.
- `tools.ts`: `ToolKind` (execute, read, edit, write, search, fetch,
  web_search, todo, plan, question, agent, mcp, other), set on tool rows by each
  provider's normalizer; the raw tool name and input are kept. Kinds that
  overlap ACP's use its names.
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
  ([code anchors](../code-anchors.md)).
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

### Options and hooks this design turns on

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
- No instant first message (`prewarm`) in this rebuild.

## Not doing

- The `/next` mobile layout: its own follow-on plan.
- Native long-lived adapters for Codex, Cursor or OpenCode.
- Codex live-versus-reload parity (follow-on, per the plan's call 2).
- `prewarm()` spares; the SDK session store; replacing hand-parsed history with
  `listSessions`.
- Anthropic's bridge and remote-control surfaces: a separate product.
