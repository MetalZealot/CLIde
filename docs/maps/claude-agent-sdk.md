# Claude Code and Agent SDK living surface map

*Originated 2026-07-19. Snapshot re-measured 2026-10-01 against the pinned
`@anthropic-ai/claude-agent-sdk` 0.3.286, its bundled native runtime
(`@anthropic-ai/claude-agent-sdk-linux-arm64` 0.3.286, reporting Claude Code
2.1.286), the standalone Claude Code 2.1.286 on this host, and CLIde's Claude
adapter under `server/modules/providers/list/claude/`. The prose below the
snapshot was last audited 2026-07-30 at 0.3.165 / 2.1.220.*

This is the current human-maintained map of how Claude surfaces relate to CLIde.
It is intentionally not a copy of the SDK type declarations or a changelog:

- the **map** says what is true now, what CLIde exposes, and where a candidate
  integration belongs;
- the [upgrade ledger](claude-upgrade-ledger.md) records what changed in each
  audited release and what CLIde decided;
- generated type dumps, `strings` output from the native binary, and settings
  schema extracts are audit artifacts, not committed documentation;
- Git history preserves prior versions of this map.

Cross-provider semantics and normalized CLIde bindings belong in the
[CLIde provider capability map](clide-provider-capability-map.md). The focused
[Claude Code settings audit](2026-07-28-claude-code-settings-surface-audit.md)
remains the companion inventory for the settings cascade.

## Current compatibility snapshot

| Evidence | Current value |
|---|---|
| Repository pin | `@anthropic-ai/claude-agent-sdk` `^0.3.286`, lockfile 0.3.286 |
| SDK's own bundled runtime | `@anthropic-ai/claude-agent-sdk-linux-arm64` 0.3.286 → `claude` 2.1.286 — **fallback only**, never spawned while CLIde sets `pathToClaudeCodeExecutable` |
| Runtime CLIde actually spawns | Standalone Claude Code on `PATH` — 2.1.286 on this host |
| Runtime pairing policy | **Unpinned by design**: `CLAUDE_CLI_PATH` or bare `claude` |
| SDK `Options` surface | 69 top-level options (`projectConfigRoot`, `verbatimPrompts`, `permissionPrompts`, `pluginDelivery` new at 0.3.286); CLIde sets 20 |
| SDK `Query` control methods | 30 typed (`reloadOutputStyles`, `readMcpResource` new at 0.3.286); CLIde calls 3 (`interrupt`, `getContextUsage`, `supportedModels`) plus the untyped `askSideQuestion` |
| SDK stream message types | 39 in the `SDKMessage` union; CLIde handles 14 and drops 25. The CLI also sends `command_lifecycle`, which is outside the union (§4) |
| SDK top-level exports | 18 functions (`prewarm` new at 0.3.286), 2 classes, 7 constants; CLIde imports `query` only |
| Hook events | 33, unchanged at 0.3.286; CLIde registers 1 (`Notification`) |
| Settings cascade | In force via `settingSources: ['project','user','local']`; no CLIde UI |
| Chat transport | One fresh `query()` subprocess per user turn, `resume` to continue |

Unlike Codex, CLIde does **not** treat the SDK and its bundled CLI as one pinned
compatibility unit. The SDK is a remote control; the runtime it drives is
whichever Claude Code the host has installed. That is deliberate — CLIde
sessions and terminal Shell sessions must be the same engine writing the same
JSONL files — but it means the shipped pair is untested by construction. As of
the 0.3.286 bump the bundled and spawned runtimes are both 2.1.286; the host's
`claude` self-updates, so the gap reopens on its own.

The bundled binary is a **fallback, not the engine**. CLIde always passes
`pathToClaudeCodeExecutable`, and the SDK resolves its own binary only when that
option is absent, so bumping the pin never moves Chat's runtime — evidence in the
[ledger](claude-upgrade-ledger.md).

## Status and disposition language

The two concepts are separate, matching the Codex map:

- **CLIde state:** Implemented, Partial, Shell only, or Not exposed.
- **Disposition:** Keep, Integrate, Candidate, Defer, Compatibility watch, or
  No action.

"Not exposed" does not mean "must be implemented." A capability can be a poor
fit for a web UI, terminal presentation, enterprise-policy-only, or already
covered by an app-owned equivalent.

## 1. Surface model

The single most important correction to "the SDK makes API calls": it does not.
`query()` spawns the full Claude Code CLI as a subprocess
(`pathToClaudeCodeExecutable`) and speaks a JSON control protocol with it over
stdio. Skills, hooks, settings files, MCP, plugins, session JSONLs in
`~/.claude/projects`, checkpointing, and slash commands all live inside that
subprocess. The raw API client is a different package (`@anthropic-ai/sdk`).

| Surface | Shape | Current CLIde role | Boundary |
|---|---|---|---|
| Interactive `claude` CLI | Human terminal application | Shell-tab escape hatch | Slash commands and key actions are TUI behavior, not protocol calls |
| `claude -p --output-format=stream-json` | Non-interactive process and JSONL events | Reached only indirectly, through the SDK | Same engine, no control channel of its own |
| Agent SDK `query()` | Node wrapper that spawns and drives the CLI | The entire interactive Chat path | One subprocess per turn today |
| `Query` control channel | Bidirectional control requests on the live handle | `interrupt()` and `getContextUsage()` only | Most methods are gated to streaming-input mode |
| SDK top-level session functions | `listSessions`, `getSessionMessages`, `forkSession`, `resolveSettings`, … | Not used; CLIde hand-parses JSONL | Would bypass CLIde's multi-provider normalization |
| Settings cascade | `settings.json` tiers plus managed/policy | Inherited, never authored or displayed | Shared mutable state with every terminal session |
| `claude mcp` / `plugin` / `agents` / `auth` / `project` subcommands | Process-level management verbs | Not used; CLIde edits config files directly | Config CRUD without the runtime's own validation |
| Remote control, gateway, Cloud review (`ultrareview`) | Hosted or peer surfaces | Not used | Separate products, not session frontends |

```text
Browser
   |
   | CLIde authenticated WebSocket and stable session_id
   v
CLIde provider orchestration
   |
   | provider_session_id (Claude's own session UUID)
   v
Claude adapter (server/modules/providers/list/claude/claude-runtime.provider.js)
   |-- one query() per turn ---> spawns standalone Claude Code (PATH)
   |                               |-- ~/.claude/projects/<slug>/<id>.jsonl
   |                               |-- settings cascade, skills, MCP, hooks
   |                               `-- control channel (interrupt, context usage)
   |-- history/discovery -------> filesystem JSONL parsing (no SDK calls)
   |-- plan usage -------------> https://api.anthropic.com/api/oauth/usage
   `-- terminal UI ------------> interactive claude CLI in Shell
```

CLIde owns the stable app-facing `session_id`. Claude owns the session UUID,
stored as `provider_session_id`. Rewind may replace the provider-announced id
behind one stable CLIde session; the writer remaps it so the client never sees
the change.

## 2. The architectural constraint everything else hangs off

CLIde runs **one `query()` per user turn**. Its prompt is an input stream CLIde
owns (`createClaudeInputChannel`), open for the whole turn and closed at the
turn's `result`, or held while background tasks run. "Streaming input mode"
means exactly that: an async-iterable prompt, however long the query lives. So
`setPermissionMode`, `setModel` and `applyFlagSettings` are reachable mid-turn
today; CLIde simply never calls them. What it lacks is a handle **between**
turns: once the input closes the process exits, and nothing can be changed or
asked until the next message spawns a new one.

`supportedCommands`, `supportedModels`, `supportedAgents` and `accountInfo` read
the cached `initialize` answer, so an idle query that never sends a message
answers them, as the model list already does. A persistent query per session,
feeding later turns through the same input, is what removes the per-turn spawn
and transcript reload and lets the provider start a turn itself (a background
task waking the chat). [The runtime rebuild plan](../plans/agent-runtime-rebuild.md)
sequences both.

Two consequences are already user-visible:

- **Permission-mode changes are frozen per turn.** In the terminal CLI, Shift+Tab
  calls `query.setPermissionMode()` and takes effect on the *running* turn. In
  CLIde, `cyclePermissionMode` (`useChatComposerState.ts`) only mutates local
  React state; the value is serialized into the outgoing payload at send time and
  baked into `sdkOptions.permissionMode` at query construction
  (`claude-runtime.provider.js`). A mid-task flip lands on the *next* message. The same
  shape blocks live model switching.
- **Context usage is a mid-turn-only reading.** `getContextUsage()` answers only
  while a turn is streaming — at the terminal `result` the transport is already
  closing — and costs 780–1200ms, so it is fired without `await` on an interval
  and cached to memory and disk (`claude-context-usage.ts`). Everything outside a
  live turn falls back to the mirrored model registry in
  `claude-context-window.ts`.

### A long-lived query, measured

`scripts/verify-claude-session-sdk.ts` drove one `query()` per session across
turns, on 2026-10-05 at SDK 0.3.286 / CLI 2.1.286, mostly on haiku. Its
FINDINGS block has the detail and the fixtures directory beside the Claude
provider tests holds the sanitized frame streams.

| # | Question | Result |
|---|---|---|
| 1 | Several turns on one query | One process and one session id. `init` repeats every turn. Warm turns reach `init` in 50–80 ms against 3.8 s cold. `total_cost_usd`, `modelUsage` and `duration_api_ms` are running totals; `usage` and `duration_ms` are per turn |
| 1 | Delivery receipt | No `isReplay` echo of sent input. `command_lifecycle` (queued → started → completed / cancelled, keyed by the sent uuid) and `user_message_uuid` on the turn's first assistant frame |
| 2 | Mid-turn `setModel` / `setPermissionMode` | Both apply inside the running turn: the next API call used the new model, the next Write skipped `canUseTool` under `acceptEdits` |
| 3 | `interrupt()` mid-turn | 6–8 ms; `still_queued` lists a message pushed meanwhile, which then runs as the next turn; `canUseTool`'s signal aborts; the turn ends `error_during_execution` and the process lives |
| 3 | Background work on interrupt | A background shell survives with or without `perTaskStopAffordance`. A background subagent is killed without it and survives with it; `stopTask` then ends it in 13 ms |
| 4 | `AskUserQuestion` in `auto` / `bypassPermissions` | Reaches `canUseTool` in both, with no hook. A `PreToolUse` hook answering `ask` adds no second prompt. `auto` falls back to `default` on haiku |
| 5 | Switching to bypass mid-session | Rejected unless the query set `allowDangerouslySkipPermissions`; with it, `default` still asks until the switch. A `system/status` frame reports the new mode |
| 6 | `applyFlagSettings` with `null` | `effortLevel: null` runs at the model's own default (medium on sonnet 5.5), not `settings.json`'s nor the session's starting value. `model: null` goes to "Default (recommended)", Fable 5.1 on this account, which fails without usage credits. `init` carries no effort at 2.1.286; a hook's `input.effort.level` does. A set `effortLevel: 'high'` overrides a spawn `effort: 'low'` from the next request (2026-10-06) |
| 7 | Error results | Never end the iterator: `error_max_turns`, an out-of-credits result and `error_during_execution` were each followed by a working turn. When the last result was an error, closing the input exits the CLI with code 1 and the iterator throws |
| 8 | Opt-in frames | `session_state_changed` needs `CLAUDE_CODE_EMIT_SESSION_STATE_EVENTS=1` (otherwise the SDK swallows it); `idle` lands ~8 ms after `result`. `tool_use_summary` needs `CLAUDE_CODE_EMIT_TOOL_USE_SUMMARIES=1`. `session_title_changed` never arrived |
| 9 | `Options.sessionId` | Names every frame and the transcript file. Refused with `resume` unless `forkSession` is set |
| 10 | Idle query, no message sent | `initializationResult()` in 4.5 s; `supportedCommands()` then returns 58 rows (this repo) in ≤1 ms, likewise models, agents and account. No frames while idle |
| 11 | Background task after `result`, input open | Its completion starts a new turn by itself, 15.5 s after the result for a 15 s sleep |
| 12 | Input closed at `result`, background shell running | The CLI exits ~5 s later and kills the shell. The SDK's 600 s ceiling never arms, because the session already reports `idle` |
| 13 | Memory per process | Idle: RSS ~234, PSS ~150, USS ~122 MB. Three open took available memory from 637 to 434 MB. Loading a 16.9 MB transcript adds ~30 MB; mid-turn with tool children ~170 MB USS |

**Where "Starting" goes.** From the probe's `init.startup_timing` and
`result.time_to_request_phases_ms` (set with `CLAUDE_CODE_EMIT_STARTUP_TIMING=1`):
the spawn is 2.7–2.9 s to `input_ready` (node boot 0.4–0.7 s, skills 0.8 s),
loading the transcript 2 ms for a new session and 0.25–0.41 s for 2.7–16.9 MB, and
the first turn's request build 0.7–0.8 s against 0.1–0.15 s warm. Production's
`[turn]` logs agree: 240 turns from 2026-09-28 to 2026-10-05 put send → first
frame at 3.27 s median resumed and 3.06 s new (p90 4.4 s), with no difference
between contexts under 60K and over 150K tokens. A long-lived query removes about
3.5 s per message whatever the session's size. The ~10 s median from first frame
to the first `rate_limit_event` on resumed turns is API time, not loading: that
event can arrive at the end of a response.

## 3. Current CLIde mapping

### 3.1 Interactive Chat and turn control

| Capability | Upstream surface | CLIde today | Integration destination | Disposition |
|---|---|---|---|---|
| Start/resume text turns | `query()` + `resume` | Implemented | `server/modules/providers/list/claude/claude-runtime.provider.js` | Keep |
| Local image input | Streaming-input `SDKUserMessage` | Implemented (`buildPromptPayload`) | Shared attachment normalization | Keep |
| Model and effort per turn | `model`, `effort` options | Implemented; catalog is a hand-maintained fallback list | Claude models provider + composer | Keep; catalog authority is a separate candidate |
| Access presets | `permissionMode` | Implemented for 5 of 6 SDK values; `dontAsk` unmapped, CLI-only `manual` unmapped | Capability service + composer | Candidate: map or stop advertising |
| Plan mode | `permissionMode: 'plan'` plus a hardcoded allow-list | Approximate: CLIde injects `Read`/`Task`/`exit_plan_mode`/`Todo*`/`WebFetch`/`WebSearch` itself | `mapCliOptionsToSDK` | Compatibility watch; `planModeInstructions` is unused |
| Tool approval | `canUseTool` callback | Implemented through the interactive-request registry | Approval UI + registry | Keep |
| Structured questions and plan exit | `AskUserQuestion`, `ExitPlanMode` via `canUseTool` | Implemented, no auto-resolution timeout | Question UI | Keep |
| Approval in `auto`/`bypassPermissions` | Permission-mode step precedes `canUseTool` | `AskUserQuestion` reaches `canUseTool` in both modes with no hook (probe, 2026-10-05); other tools skip it, as designed | Request tray | Keep. A question lost in CLIde is lost after `canUseTool`, not before |
| Abort active turn | `interrupt()` plus `abortController` | Implemented, signal-first (ADR 0013) | Chat transport | Keep |
| Token-level streaming | `includePartialMessages` | Not exposed; the normalizer's `content_block_delta`/`content_block_stop` branches are dead code | Live normalizer + composer | Integrate — the client-side path partly exists |
| Active-turn steering | Streaming input | Not exposed; CLIde queues a later turn | Composer queue | Defer pending provider-neutral steering semantics |
| Structured output | `outputFormat` (JSON schema) | Not exposed | Non-interactive job API | Defer until a consumer exists |
| Spend and turn guardrails | `maxTurns`, `maxBudgetUsd`, `taskBudget` | Not exposed; `result` carries the matching error subtypes | Provider settings + run guard | Candidate |
| Model failover | `fallbackModel` | Not exposed | Models provider | Candidate — pairs with the 529 synthetic-notice handling |
| Thinking control | `thinking`, `maxThinkingTokens` | Not exposed; only `effort` is wired | Composer | Defer |
| Prompt suggestions | `promptSuggestions` + `prompt_suggestion` message | Not exposed | Composer | Defer |
| MCP elicitation and trust dialogs | `onElicitation`, `onUserDialog` | Not exposed; those interactions are invisible in CLIde | Interactive-request registry | Candidate |

### 3.2 Sessions, history, and context

| Capability | Upstream surface | CLIde today | Integration destination | Disposition |
|---|---|---|---|---|
| Stable session identity | Claude session UUID plus CLIde database | Implemented with `session_id` / `provider_session_id` separation | Sessions repository + aliases | Keep |
| Discovery and history | `~/.claude/projects/**/*.jsonl` | Implemented by filesystem watching and hand-parsed JSONL | `claude-session-synchronizer.provider.ts`, `claude-sessions.provider.ts` | Compatibility watch |
| Native session functions | `listSessions`, `getSessionInfo`, `getSessionMessages`, `renameSession`, `deleteSession`, `tagSession`, `importSessionToStore`, `foldSessionSummary` | Not used | Claude sessions provider (internal delegation only) | Defer; wholesale replacement would fight the multi-provider model |
| Subagent transcripts | `listSubagents`, `getSubagentMessages`, nested `subagents/agent-*.jsonl` | Partial: `subagentTools` and `parent_tool_use_id` grouping exist; no agent view, orphaned files on force-delete | Provider-neutral agent activity model | Defer; tracked in `TODO.md` |
| Conversation rewind | `resumeSessionAt` + transcript anchor resolution | Implemented; transcript becomes a tree and readers follow the active parent chain | `claude-rewind.util.ts` + `claude-runtime.provider.js` | Keep (ADR 0007) |
| File checkpoints | `enableFileCheckpointing` | **Half-wired:** snapshots are written every run, `rewindFiles()` is never called | Rewind UI + control channel | Integrate — the expensive half is already paid for |
| Explicit fork | `forkSession` option and top-level `forkSession()` | Not exposed; capability service reports `supportsFork: false` | Sessions service + provider fork binding | Candidate |
| Compaction | Auto-compact plus `/compact` | Partial: summaries are re-labelled as assistant text and referenced files are surfaced (ADR 0023); `compact_boundary` and `PreCompact`/`PostCompact` are unused | History parser + transcript divider | Candidate |
| Context ceiling and auto-compact threshold | `getContextUsage()` | Implemented mid-turn, cached to disk, with a mirrored-registry fallback | `claude-context-usage.ts`, `claude-context-window.ts` | Keep |
| Per-category context breakdown | `getContextUsage()` payload | Implemented from the saved last-turn reading; the composer usage popover drills into the itemized categories in place, and `/context` routes there | Composer usage popover | Keep |
| Transcript retention | `cleanupPeriodDays` | Not exposed; directly affects CLIde's own session list | Provider settings | Candidate |
| Session naming | `title` option, `-n/--name`, `renameSession` | App-owned summaries only | Sidebar/session routes | Keep current ownership |
| App-owned starring | CLIde metadata | Implemented, starred-first ordering | Sessions repository | Keep |
| Ephemeral runs | `persistSession: false` | Implemented for the commit-message generator | `claude-runtime.provider.js` | Keep |

Live and reloaded history must remain equivalent. Any new message kind is
incomplete until the JSONL parser preserves the same meaning, identity, and
redaction behavior as the live stream.

### 3.3 Models, account, authentication, and settings

| Capability | Upstream surface | CLIde today | Integration destination | Disposition |
|---|---|---|---|---|
| Model catalog | `supportedModels()`, the SDK's embedded registry | Live `supportedModels()` plus a pinned legacy list; hand-maintained fallback if the CLI fails | `claude-models.provider.ts` | Implemented |
| Context-window facts | SDK model registry (`context.window`, output caps) | Mirrored by hand in `claude-context-window.ts` | Same | Compatibility watch — see §6 |
| Per-session effective model | Transcript inspection plus `settings.json` `model` | Implemented (ADR 0003) | Active-model service | Keep |
| Mid-session model switch | `setModel()` | Reachable mid-turn and never called; the next API call of the running turn uses the new model (probe, 2026-10-05) | Chat transport | Integrate (rebuild plan phase 1) |
| Account identity | `accountInfo()` (email, org, subscription) | Inferred from credentials files and `settings.json` | `claude-auth.provider.ts` + Settings | Candidate |
| Installed/authenticated state | `claude --version`, credentials files | Implemented | `claude-auth.provider.ts` | Keep |
| Login/logout | `claude auth`, `setup-token` | Terminal flow only | Settings | Defer pending a complete native design |
| Plan rate limits and credits | `https://api.anthropic.com/api/oauth/usage` | Implemented as a truthful cached read shared by the composer, Settings, and `/usage`; stale fallback retains the last successful timestamp | `claude-usage.provider.ts` + shared usage surfaces | Keep |
| Live rate-limit pushes | `rate_limit_event` stream message | Implemented: normalized into the provider usage cache and emitted as `provider_usage` to live UI consumers | Claude runtime → usage service/hook | Keep |
| Settings cascade (read) | `resolveSettings()` — effective, provenance, per-tier sources | Not exposed; the cascade is in force but invisible | `GET /api/providers/claude/settings` + provider settings screen | Integrate — cheapest high-value item |
| Settings cascade (write) | `Options.settings` flag tier, JSONC edits | Not exposed | Provider settings screen | Defer to the settings spec |
| Silently overridden keys | `model`, `effortLevel`, `permissions.defaultMode`, `env`, `systemPrompt` | Overridden on every query without telling the user | Read-only rows with a "CLIde controls this" note | Integrate with the viewer |
| Two parallel permission systems | `permissions.allow/deny/ask` versus CLIde's `localStorage` tool lists | Both in force, neither aware of the other | Permissions reconciliation | Integrate — needs an ADR |
| Escalating-mode guard | `filterEscalatingDefaultMode()` | Not used (nothing reads `permissions.defaultMode` yet) | Settings read path | Keep in scope with the viewer |

The settings audit remains the detailed inventory: roughly 140 public keys, of
which about 25 are worth adapting, 15 are read-only, 45 are terminal-only, and 35
are enterprise plumbing. `~/.claude.json` (`globalConfig`) is a **different
store** that never reaches an SDK session; anything CLIde surfaced from it would
be decorative.

### 3.4 MCP, skills, plugins, agents, and hooks

| Capability | Upstream surface | CLIde today | Integration destination | Disposition |
|---|---|---|---|---|
| MCP configuration | `~/.claude.json`, `.mcp.json`, `claude mcp` | Implemented: user/local/project scopes, stdio/http/sse | `claude-mcp.provider.ts` + shared MCP services | Keep |
| MCP servers passed to a turn | `mcpServers` option | Implemented by hand-reading `~/.claude.json` and merging project entries | `loadMcpConfig` in `claude-runtime.provider.js` | Compatibility watch — duplicates the CLI's own resolution |
| MCP runtime state | `mcpServerStatus()`, `reconnectMcpServer()`, `toggleMcpServer()`, `setMcpServers()` | Not exposed | Shared MCP runtime/status contract | Candidate |
| MCP gating keys | `enabledMcpjsonServers`, `disabledMcpjsonServers`, `enableAllProjectMcpServers` | Not exposed | MCP settings | Candidate with the settings viewer |
| In-process MCP servers | `createSdkMcpServer()`, `tool()` | Not used | Exposing CLIde's own actions as tools | Defer |
| Skills | Filesystem roots plus `settings.json` overrides | Implemented: discovery plus managed user-skill add/remove | `claude-skills.provider.ts` | Keep |
| Skill reload | `reloadSkills()`, `skillOverrides`, `disableBundledSkills`, `disableSkillShellExecution` | Not exposed | Skills settings | Candidate |
| Slash commands | `supportedCommands()`, `commands_changed`, `system:init`'s `slash_commands` / `terminal_slash_commands` | Approximate: CLIde scans `.claude/commands/` and hardcodes 9 commands (`server/modules/commands/commands.routes.ts`, `useSlashCommands.ts`) — misses plugin, skill, and real built-in commands; `local_command_output` is unhandled | Commands route + slash menu; full routing in [the command surface map](claude-command-surface.md) | Integrate |
| Plugins | `plugins` option, `reloadPlugins()`, `claude plugin`, `enabledPlugins` | Not exposed. CLIde's own Settings → Plugins is a *different* system — name collision to avoid | Provider-slotted extensions settings | Defer |
| Subagents | `agents` option, `supportedAgents()`, `claude agents` | Not exposed as a library; subagent output is grouped in the transcript | Agents settings + activity model | Defer |
| Hooks | 33 hook events | 1 registered (`Notification` → CLIde notifications) | Hook registration + provider settings | Integrate selectively; `PreToolUse` is not needed for questions (§3.1) |
| Sandbox | `sandbox` option and settings object | Not exposed; needs `bubblewrap` on Linux | Its own spec | Defer |
| File reads for a remote UI | `readFile(path, {maxBytes, encoding})` | Not used; CLIde owns Files/editor APIs | Files architecture | No action — preserve CLIde's authorization boundary |

### 3.5 CLI and advanced surfaces

| Capability | Upstream surface | CLIde today | Integration destination | Disposition |
|---|---|---|---|---|
| Interactive slash commands and key actions | TUI | Shell only unless CLIde has an explicit equivalent | Shell or capability-gated web action | Do not forward slash text as protocol |
| Background agents | `--bg`, `claude agents`, `stopTask()`, `backgroundTasks()` | Partial: `task_*` and `background_tasks_changed` are normalized; no per-task stop, and `stopTask()` is never called | Background-task tray | Integrate (rebuild plan phases 6–7) |
| Worktrees | `-w/--worktree`, `worktree.*` settings, `WorktreeCreate/Remove` hooks | Not exposed; CLIde has its own Git panel and worktree script | Source Control workspace | Defer |
| Cloud multi-agent review | `claude ultrareview` | Not exposed — user-triggered and billed | None | No action |
| Remote control and gateway | `--remote-control`, `claude gateway` | Not exposed | None | No action |
| IDE integration | `--ide`, `~/.claude.json` IDE keys | Not exposed; irrelevant to a web client | None | No action |
| Doctor and diagnostics | `claude doctor`, `--debug`, `debugFile` | Partial CLIde diagnostics only | Provider diagnostics/support | Candidate |
| Safe/bare modes | `--safe-mode`, `--bare` | Not exposed | Troubleshooting affordance | Defer |
| Session import/export | `importSessionToStore`, `InMemorySessionStore`, `sessionStore` | Not used | Migration flows | No action until migration is a goal |

## 4. Stream message coverage

The `SDKMessage` union has 39 members at 0.3.286. CLIde handles 14: `assistant`,
`user`, `result`, `system/init` (session id only), `compact_boundary`, `status`,
`api_retry`, `thinking_tokens`, `background_tasks_changed`, the four `task_*`
types, and `rate_limit_event`. `normalizeMessage` (`claude-sessions.provider.ts`)
turns the assistant and user shapes into rows: text, `thinking`, `tool_use`,
`tool_result`, base64 images, compact summaries, local-command rows and
`<synthetic>` notices. The other 25 fall through and are dropped in silence;
[the runtime rebuild plan](../plans/agent-runtime-rebuild.md) gives each a home.

| Message type | What it carries | Disposition |
|---|---|---|
| `rate_limit_event` | `status`, `rateLimitType` (`five_hour` / `seven_day` / `seven_day_opus` / `seven_day_sonnet` / `overage`), `utilization`, `resetsAt`, `surpassedThreshold`, `unifiedWindows`, overage status | Implemented for normalized windows and live `provider_usage`. `utilization` and `surpassedThreshold` appear only at `allowed_warning` (0.9 observed); plain `allowed` frames omit them. Its timing within a turn varies: before the first token, after the last, or absent on a warm turn (measured 2026-10-05), so it is a poor "sent" marker |
| `status` (`compacting` / `requesting`, or a new `permissionMode`) | Why the session is silent; a mode change | `compacting` implemented as the activity label. `requesting` is only emitted with `includePartialMessages` (0 of 4 turns without, 1 of 1 with, at 2.1.270). A `status` frame carrying `permissionMode` follows a live mode switch (measured 2026-10-05) |
| `api_retry` | Attempt, max retries, delay, HTTP status, error class | Implemented as the `retrying` activity stage. Arrives without `includePartialMessages`, one frame per attempt (measured against a local 529 stub at 2.1.270) |
| `thinking_tokens` | Running thinking-token estimate while thinking text is redacted; not billed `output_tokens` | Implemented: the live part of the activity row's token count. A finished step keeps its estimate, because mid-turn `assistant` rows report a placeholder `output_tokens` of 1–2. 46 frames over a 55 s Opus think, average gap 1.2 s (measured at 2.1.270) |
| `compact_boundary` | Where context was compacted | Implemented as a transcript row |
| `task_started`, `task_updated`, `task_progress`, `task_notification`, `background_tasks_changed` | Background-task lifecycle: shells (`local_bash`) and subagents (`local_agent`), `is_backgrounded`, final status | Implemented as rows and the background-hold count; no per-task stop |
| `stream_event` | Raw API stream events, wrapped (`message_start`, `content_block_delta`, …) | Needs `includePartialMessages`; the normalizer's unwrapped `content_block_delta` branch never matches |
| `session_state_changed` | `idle` / `running` / `requires_action` | Reaches the consumer only with `CLAUDE_CODE_EMIT_SESSION_STATE_EVENTS=1`; without it the CLI marks it `sdk_host_only` and the SDK consumes it to time its own stdin close |
| `tool_use_summary` | One-line summary of the preceding tool calls | Only with `CLAUDE_CODE_EMIT_TOOL_USE_SUMMARIES=1` |
| `user` with `isReplay` | An echo, but not of sent input: `setModel` produces one carrying `<local-command-stdout>Set model to …` | Dropped |
| `commands_changed`, `local_command_output`, `conversation_reset`, `model_refusal_*`, `tool_progress`, `hook_*`, `control_request_progress`, `auth_status`, `notification`, `informational`, `prompt_suggestion`, `permission_denied`, `memory_recall`, `elicitation_complete`, `files_persisted`, `plugin_install`, `worker_shutting_down`, `mirror_error` | Assorted | Dropped; homes in the rebuild plan |

Outside the union, the CLI sends `command_lifecycle` on every turn: `queued`,
`started`, then `completed` or `cancelled`, keyed by the uuid of the user message
CLIde pushed (measured 2026-10-05). It is the delivery receipt a long-lived
session needs, and the type checker cannot see it. The first assistant frame of
a turn also carries `user_message_uuid`. `result` gains `ttft_ms`,
`time_to_request_ms` and per-phase timings with `CLAUDE_CODE_EMIT_STARTUP_TIMING=1`,
and the first turn's `init` carries `startup_timing` regardless.

Unknown message types are silently ignored. See §6.

## 5. Current implementation destinations

New Claude work should land at the narrowest owning boundary:

| Concern | Current owner |
|---|---|
| Live query construction, streaming, approvals, abort | `server/modules/providers/list/claude/claude-runtime.provider.js` |
| Executable resolution | `server/shared/claude-cli-path.ts` |
| History and transcript normalization | `server/modules/providers/list/claude/claude-sessions.provider.ts` |
| Session discovery and watcher ingestion | `claude-session-synchronizer.provider.ts` |
| Rewind anchor resolution | `claude-rewind.util.ts` |
| Authoritative context readings and cache | `claude-context-usage.ts` |
| Derived context ceiling fallback | `claude-context-window.ts` |
| Models and effective session model | `claude-models.provider.ts` plus shared active-model services |
| Authentication and credentials | `claude-auth.provider.ts`, `claude-credentials.ts` |
| Plan usage | `claude-usage.provider.ts` |
| MCP | `claude-mcp.provider.ts` plus shared MCP services |
| Skills | `claude-skills.provider.ts` plus shared skills services |
| Slash-command discovery | `server/modules/commands/commands.routes.ts` |
| Capability flags | `server/modules/providers/services/provider-capabilities.service.ts` |
| Interactive request normalization | `interactive-request-registry.service.ts` |
| Embedded terminal | `server/modules/websocket/services/shell-websocket.service.ts` |

Shared UI and protocol work must stay provider-neutral: other adapters have no
`rate_limit_event`, no settings cascade, and no checkpoints, so shared surfaces
must render absence gracefully.

## 6. Drift detection and diagnostics

There is no Claude equivalent of the Codex generated-protocol drift test, and
none is obviously warranted: the contract is a TypeScript declaration file
CLIde consumes at build time, so a breaking type change fails `npm run
typecheck`. What that does **not** catch is exactly what the Codex map calls
out — behavior the static types cannot express:

- unknown stream message `type` values (currently dropped in silence);
- unknown transcript row shapes in history parsing;
- a spawned runtime whose control protocol has moved ahead of the pinned SDK;
- control requests that fail or time out (`getContextUsage()` already has a
  documented "Query closed before response received" failure mode).

A future diagnostics change should record, without payloads: unknown message
type, unknown transcript row type, count and last-seen timestamp, spawned
runtime version, and pinned SDK version. This belongs in provider diagnostics,
not the user transcript.

## 7. Sources and evidence policy

Claude Code has no public tagged source repository, so the evidence hierarchy
differs from Codex's:

1. **Installed artifacts are primary.**
   - `node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts` and `sdk.mjs`
     (types, model registry, exported runtime functions);
   - the native binary under `~/.local/share/claude/versions/<version>` —
     `strings` over it carries the full settings JSON-Schema and the `/config`
     row table (method of record for the settings audit);
   - `claude --help` and per-subcommand help;
   - the SDK's own bundled runtime, for the pairing gap.
2. **Live behavior settles ambiguity.** Verification scripts such as
   `scripts/verify-rewind-sdk.ts` and `scripts/verify-context-usage-sdk.ts`
   established the rewind tree shape and the real context ceilings; both
   contradicted plausible readings of the docs.
3. **Official documentation is supporting, not authoritative**, for surface
   inventory — it lags the shipped binary.

Primary current sources:

- [Claude Code documentation](https://docs.claude.com/en/docs/claude-code)
- [Agent SDK documentation](https://docs.claude.com/en/api/agent-sdk/overview)
- [Claude Code settings reference](https://docs.claude.com/en/docs/claude-code/settings)
- [`@anthropic-ai/claude-agent-sdk` on npm](https://www.npmjs.com/package/@anthropic-ai/claude-agent-sdk)
- [Claude Code release notes](https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md)

Do **not** load the bundled `claude-api` skill to answer questions about this
surface; it is a different subject (the raw API) and its context cost is
prohibitive on this host.

## 8. Recurring update procedure

For each candidate SDK bump or material runtime change:

1. Claim the recurring provider-maintenance item in `TODO.md` and work in an
   isolated topic worktree.
2. Record four versions separately: repository pin, installed SDK, SDK-bundled
   runtime, and the runtime actually on `PATH`.
3. Diff `sdk.d.ts` against the previous version: `Options` members, `Query`
   methods, the `SDKMessage` union, `HookEvent`, `PermissionMode`, and top-level
   exports. The counts in this map's snapshot table are the regression check.
4. Diff `claude --help` and subcommand help; re-extract the settings schema from
   the native binary when the settings audit is in scope.
5. Re-derive the mirrored model registry from `sdk.mjs` — never from memory.
6. Classify each material change as: consumed contract change, current-map
   opportunity, behavioral compatibility watch, or no action with a reason.
7. Update this map's delta section and append one compact ledger entry.
8. Create a `TODO.md` item only for a deliberately selected integration.
9. Add or supersede an ADR only when ownership, identity, persistence, fallback,
   or a security boundary changes.
10. Run focused Claude tests, typecheck, lint, and the relevant build.
11. Smoke-test new and resumed Chat, images, abort, approvals, `AskUserQuestion`,
    Plan mode, rewind, context ring and `/context`, usage, and live-versus-reloaded
    history equivalence.
12. After deployment, verify the spawned runtime version and installed-app Chat.

## Bottom line

CLIde drives Claude through a narrow slice of a very wide surface: 20 of 69
options, 3 of 30 typed control methods, 14 of 39 message types, 1 of 33 hooks,
and 1 of 18 exported functions (`query` itself). That slice is deliberate for
history and identity — hand-parsed JSONL serves the multi-provider model. The
live controls it lacks already work on today's per-message query (§2), and a
long-lived query per session is measured to remove about 3.5 s of start-up from
every message and to let background work start a turn by itself.
