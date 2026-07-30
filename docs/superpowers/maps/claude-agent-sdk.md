# Claude Agent SDK and Claude Code surface map

*Snapshot surveyed 2026-07-19 against the installed `@anthropic-ai/claude-agent-sdk` v0.3.165
(`node_modules/.../sdk.d.ts`, 6,128 lines) and `server/claude-sdk.js` +
`server/modules/providers/list/claude/claude-sessions.provider.ts`.*

> **Maintenance status:** This provider-native map has moved into the living
> maps collection but still reflects its original dated survey. Refresh it
> against the current SDK, standalone Claude Code runtime, official
> documentation, and CLIde bindings before treating counts or availability as
> current. The focused
> [Claude Code settings audit](../specs/2026-07-28-claude-code-settings-surface-audit.md)
> remains a separate companion.

Canonical CLIde bindings and cross-provider fidelity belong in the
[CLIde provider capability map](clide-provider-capability-map.md).

## Mental model (correction to "it makes API calls")

The Agent SDK is **not** a raw API client. `query()` spawns the full Claude Code CLI as a
subprocess (`pathToClaudeCodeExecutable`) and speaks a JSON control protocol with it over
stdio. Everything the terminal CLI can do — skills, hooks, settings files, MCP, plugins,
session JSONLs in `~/.claude/projects`, checkpointing, slash commands — exists inside that
subprocess, and the SDK is a remote control for it. (The raw API client is a different
package, `@anthropic-ai/sdk`.) This is why CLIde sessions are interchangeable with Shell
sessions: both are the same engine writing the same JSONL files.

**How CLIde drives it today:** one `query()` per user turn (fresh subprocess each turn,
`resume: sessionId` to continue), iterate the async generator, normalize messages, forward
over WS. Prompt is a plain string except image turns (async-generator streaming input).
The only live control method ever called is `interrupt()` (abort).

> **Architectural note — the single biggest unlock:** most `Query` control methods are
> documented as "only available in streaming input mode". CLIde already uses streaming
> input for image turns (`buildPromptPayload`); moving to a persistent streaming-input
> query per session (feed subsequent turns via the generator instead of new `query()`
> calls) would unlock mid-session `setModel`/`setPermissionMode`, `supportedCommands`,
> `getContextUsage`, MCP management, etc. — and skip per-turn subprocess spawn cost.

---

## 1. `query()` Options — ~15 of ~60 used

**Used:** `env`, `pathToClaudeCodeExecutable`, `cwd`, `permissionMode`, `allowedTools`,
`disallowedTools`, `tools` (claude_code preset), `model`, `effort`, `systemPrompt`
(claude_code preset), `settingSources`, `resume`, `mcpServers` (hand-read from
`~/.claude.json`), `hooks` (Notification only), `canUseTool`.

**Unused, with feature potential:**

| Option | What it unlocks |
|---|---|
| `includePartialMessages` | **Token-level streaming.** Today assistant text arrives as whole content blocks. The normalizer already has `content_block_delta`/`stream_delta` branches — they just never fire for Claude because this flag is off. |
| `enableFileCheckpointing` | File checkpoints per user message — prerequisite for `rewindFiles()` (wishlist `/rewind`, L). |
| `forkSession` + `resumeSessionAt` | Resume from an arbitrary message / branch the conversation — the transcript-rewind wishlist item (edit-a-past-message). |
| `thinking` (`ThinkingConfig`) | Explicit adaptive/enabled/disabled + budget control (effort is wired; thinking config is not). |
| `maxTurns`, `maxBudgetUsd`, `taskBudget` | Spend/runaway guardrails per run; result carries `error_max_turns` / `error_max_budget_usd` subtypes. |
| `fallbackModel` | Auto-failover when the primary model is overloaded (529s — see the `<synthetic>` incident). |
| `agents` | Define subagents programmatically (UI-managed agent library). |
| `outputFormat` (json_schema) | Structured output turns. |
| `onUserDialog`, `onElicitation` | MCP elicitation / trust dialogs surfaced to the web UI instead of being invisible. |
| `promptSuggestions` | SDK-generated next-prompt suggestions (emits `SDKPromptSuggestionMessage`). |
| `title` | Name a session at creation. |
| `sandbox`, `plugins`, `skills`, `betas`, `additionalDirectories`, `abortController`, `continue`, `sessionId` (explicit id), `persistSession`, `sessionStore` | Misc; note `abortController` could replace some interrupt/close plumbing. |
| `hooks` — 29 of 30 events unused | Only `Notification` is registered. Available: PreToolUse/PostToolUse(+Failure/Batch), UserPromptSubmit, SessionStart/End, Stop, Subagent*, Pre/PostCompact, PermissionRequest/Denied, TaskCreated/Completed, FileChanged, MessageDisplay, … |

## 2. `Query` control methods — 1 of ~20 used

**Used:** `interrupt()`.

**Unused:**

| Method | What it unlocks |
|---|---|
| `supportedCommands()` | The CLI's **real** slash-command list (built-ins + skills + plugins). CLIde reimplements this by scanning `.claude/commands/` dirs (`server/routes/commands.js`) — misses built-ins and plugin/skill commands. Directly serves wishlist "audit what CLI commands are missing" (L). |
| `supportedModels()` / `supportedAgents()` / `initializationResult()` | Live model list (vs the hardcoded `CLAUDE_FALLBACK_MODELS` catalog), agent list, output styles. |
| `getContextUsage()` | Per-category context breakdown (system prompt / tools / MCP / memory / messages) — a truthful context ring instead of usage-row arithmetic, plus a `/context`-style panel. |
| `accountInfo()` | Email, org, subscription type — Settings → Account card without touching credentials files. |
| `rewindFiles(userMessageId, {dryRun})` | Native file rewind (with checkpointing on). Pairs with `forkSession`/`resumeSessionAt` for full `/rewind`. |
| `setModel()` / `setPermissionMode()` / `applyFlagSettings()` / `setMaxThinkingTokens()` | Mid-session switches without waiting for the next `query()` — relevant to the whole model-picker subsystem (a pick could take effect immediately). |
| `mcpServerStatus()` / `reconnectMcpServer()` / `toggleMcpServer()` / `setMcpServers()` | A real MCP panel: connection state, needs-auth, reconnect/toggle from the UI. |
| `stopTask()` / `backgroundTasks()` | Ctrl+B equivalent — background a long-running Bash/subagent from the web UI. |
| `readFile(path, {maxBytes, encoding})` | Permission-gated file reads "for the remote sidebar viewer" — designed for exactly a UI like CLIde (file preview without shelling out). |
| `reloadPlugins()` / `reloadSkills()` / `seedReadState()` | Housekeeping. |

## 3. Stream messages — ~6 of 32 types consumed

`normalizeMessage` handles user/assistant messages, `thinking`, `tool_use`,
`tool_result`, stream deltas (dead branch — see `includePartialMessages`), and
`claude-sdk.js` uses `result` for completion + reads usage off assistant rows.
**Everything else falls through and is dropped:**

| Message type | What it carries |
|---|---|
| **`rate_limit_event`** (`SDKRateLimitInfo`) | **Pushed automatically mid-session**: `rateLimitType` (`five_hour` / `seven_day` / `seven_day_opus` / `seven_day_sonnet` / `overage`), `utilization` %, `resetsAt`, overage status/reason. The shipped usage feature (`5fc4a13`, OAuth endpoint, fetch-on-open) could get free **live** updates from this — no polling, no credentials file. |
| `status` (`compacting` / `requesting`) | "Compacting…" indicator instead of unexplained dead air. |
| `api_retry` | "Retrying (attempt N)…" instead of silence during 529 storms. |
| `task_notification` / `task_started` / `task_updated` / `task_progress` | Background-task tray (the `task_notification` string exists in `server/shared/types.ts` + `useSessionStore.ts` but nothing emits it for Claude). |
| `compact_boundary` | Render a "context compacted" divider in the transcript. |
| `thinking_tokens` | Live thinking-token counter. |
| `tool_progress`, `tool_use_summary` | Per-tool progress + summaries. |
| `auth_status`, `session_state_changed`, `commands_changed`, `permission_denied`, `elicitation_complete`, `memory_recall`, `files_persisted`, `plugin_install`, `hook_started/progress/response`, `prompt_suggestion`, `mirror_error`, `local_command_output` | Assorted; `commands_changed` pairs with `supportedCommands()` for a live-updating slash menu. |

## 4. Top-level session functions — 0 used

`listSessions`, `getSessionInfo`, `getSessionMessages`, `getSubagentMessages`,
`listSubagents`, `renameSession`, `deleteSession`, `forkSession`, `tagSession`,
`importSessionToStore`, `resolveSettings`. CLIde hand-parses the JSONL files in
`claude-sessions.provider.ts` instead. The hand-parsing exists to serve the
multi-provider abstraction, so wholesale replacement isn't obviously right — but the
Claude adapter could delegate internally (e.g. `renameSession`/`forkSession` for
features, `resolveSettings` for a settings inspector). Also present: `startup()` /
`WarmQuery` (pre-warmed subprocess, V2 preview) and `createSdkMcpServer()` / `tool()`
(in-process MCP servers — CLIde could expose its own UI actions as tools to the model).

---

## Suggested order of attack (vs wishlist)

1. **`rate_limit_event` → live usage** (S) — forward to a normalized WS frame, update the
   shipped usage UI opportunistically between its on-open fetches. Zero new requests.
2. **`status`/`api_retry` indicators** (S) — two small normalizer branches, big UX payoff.
3. **`supportedCommands()`** (S/M) — augment the filesystem scan; feeds the wishlist
   "audit missing CLI commands" item with ground truth.
4. **`includePartialMessages` streaming** (M) — flag + handle `stream_event`; the
   client-side delta path partially exists.
5. **`getContextUsage()` + `accountInfo()`** (M) — needs a control-request channel to the
   live query (see architectural note).
6. **Rewind stack** (L) — `enableFileCheckpointing` + `rewindFiles` + `forkSession`/
   `resumeSessionAt`; matches two existing wishlist L items.

**Multi-provider caveat** (per project CLAUDE.md): items 1–5 touch shared surface
(WS message kinds, composer UI). Design the frames as normalized kinds that other
adapters can emit or no-op — e.g. Codex/Cursor have no `rate_limit_event`, so the UI
must render absence gracefully.

---

## Behavioral-parity findings (incremental)

*Concrete divergences from the terminal CLI found while using CLIde, logged as they come up.*

### Permission-mode changes are frozen per-turn (2026-07-21)

**Terminal CLI:** cycling the permission mode (Shift+Tab: Auto/Plan/acceptEdits/…)
**takes effect on the currently running turn.** The next tool permission check within
the same turn uses the new mode — e.g. flipping to acceptEdits mid-task auto-accepts
the *remaining* edits of that turn. Mechanism: the interactive CLI runs in streaming
input mode with a long-lived `Query`, and Shift+Tab calls `query.setPermissionMode()`,
sending an `SDKControlSetPermissionModeRequest` down the control channel.

**CLIde today:** the mode is a **snapshot taken at send time**, frozen for the whole turn.
- Client: `cyclePermissionMode` only mutates local React state — no WS/SDK message is
  emitted on the switch (`useChatComposerState.ts`). The value is serialized into the
  outgoing payload *only* when a message is sent (`useChatComposerState.ts:637`).
- Server: baked into `sdkOptions.permissionMode` at query construction and read
  synchronously by `query()` (`claude-sdk.js:177-178`, `:618`). Single-shot string
  prompt per turn ⇒ the live setters are unavailable (SDK gates `setPermissionMode` /
  `setModel` to "streaming input mode only" — verified in `sdk.d.ts`).
- Net: a mid-task mode flip lands on the user's *next* message, not the running turn.
  (Same shape blocks live model-switch mid-turn.)

**To reach parity:** the persistent streaming-input-query migration (architectural note
above). Then wire a dedicated WS control frame (`set-permission-mode`) from
`cyclePermissionMode` straight to `queryInstance.setPermissionMode(mode)` — decoupled
from send. Claude-adapter-only capability; other adapters no-op (multi-provider caveat).
Bundles naturally with live `setModel()` and native `interrupt()`.
