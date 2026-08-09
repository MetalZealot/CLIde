# Claude Code and Agent SDK living surface map

*Originated 2026-07-19. Last audited 2026-07-30 against CLIde `docs/clide-provider-map`,
the pinned `@anthropic-ai/claude-agent-sdk` 0.3.165 (`sdk.d.ts`, 6,128 lines),
the SDK's bundled native runtime (`@anthropic-ai/claude-agent-sdk-linux-arm64`,
reporting Claude Code 2.1.165), the standalone Claude Code 2.1.220 on this host,
and CLIde's Claude adapter under `server/modules/providers/list/claude/claude-runtime.provider.js` plus
`server/modules/providers/list/claude/`.*

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
| Repository pin | `@anthropic-ai/claude-agent-sdk` `^0.3.165`, lockfile 0.3.165 |
| SDK's own bundled runtime | `@anthropic-ai/claude-agent-sdk-linux-arm64` 0.3.165 → `claude` 2.1.165 |
| Runtime CLIde actually spawns | Standalone Claude Code on `PATH` — 2.1.220 on this host |
| Runtime pairing policy | **Unpinned by design**: `CLAUDE_CLI_PATH` or bare `claude` |
| SDK `Options` surface | 62 top-level options; CLIde sets 19 |
| SDK `Query` control methods | 23; CLIde calls 2 (`interrupt`, `getContextUsage`) |
| SDK stream message types | 32; CLIde's live normalizer acts on 2 shapes (assistant/user) |
| SDK top-level exports | 17 functions, 2 classes, 3 constants; CLIde imports `query` only |
| Hook events | 30; CLIde registers 1 (`Notification`) |
| Settings cascade | In force via `settingSources: ['project','user','local']`; no CLIde UI |
| Chat transport | One fresh `query()` subprocess per user turn, `resume` to continue |

Unlike Codex, CLIde does **not** treat the SDK and its bundled CLI as one pinned
compatibility unit. The SDK is a remote control; the runtime it drives is
whichever Claude Code the host has installed. That is deliberate — CLIde
sessions and terminal Shell sessions must be the same engine writing the same
JSONL files — but it means the shipped pair is untested by construction. Today
the gap is 55 patch releases (2.1.165 bundled versus 2.1.220 spawned).

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

CLIde runs **one `query()` per user turn** with a plain string prompt (an async
generator only for image turns), then lets the generator wind down. Most `Query`
control methods are documented as available **only in streaming input mode**, so
today they are structurally out of reach even though the handle exposes them.

Moving to a persistent streaming-input query per session — feeding later turns
through the generator instead of constructing a new `query()` — is the
prerequisite for `setModel`, `setPermissionMode`, `supportedCommands`,
`supportedModels`, `accountInfo`, MCP management, and background-task control.
It would also drop the per-turn subprocess spawn cost, which on this host is not
free.

Two consequences are already user-visible:

- **Permission-mode changes are frozen per turn.** In the terminal CLI, Shift+Tab
  calls `query.setPermissionMode()` and takes effect on the *running* turn. In
  CLIde, `cyclePermissionMode` (`useChatComposerState.ts`) only mutates local
  React state; the value is serialized into the outgoing payload at send time and
  baked into `sdkOptions.permissionMode` at query construction
  (`claude-sdk.js:183-195`). A mid-task flip lands on the *next* message. The same
  shape blocks live model switching.
- **Context usage is a mid-turn-only reading.** `getContextUsage()` answers only
  while a turn is streaming — at the terminal `result` the transport is already
  closing — and costs 780–1200ms, so it is fired without `await` on an interval
  and cached to memory and disk (`claude-context-usage.ts`). Everything outside a
  live turn falls back to the mirrored model registry in
  `claude-context-window.ts`.

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
| Approval in `auto`/`bypassPermissions` | Permission-mode step precedes `canUseTool` | **Known gap:** interactive tools never reach the UI in those modes; the classifier answers for the user | `PreToolUse` hook (runs before the mode check) | Integrate |
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
| Conversation rewind | `resumeSessionAt` + transcript anchor resolution | Implemented; transcript becomes a tree and readers follow the active parent chain | `claude-rewind.util.ts` + `claude-sdk.js` | Keep (ADR 0007) |
| File checkpoints | `enableFileCheckpointing` | **Half-wired:** snapshots are written every run, `rewindFiles()` is never called | Rewind UI + control channel | Integrate — the expensive half is already paid for |
| Explicit fork | `forkSession` option and top-level `forkSession()` | Not exposed; capability service reports `supportsFork: false` | Sessions service + provider fork binding | Candidate |
| Compaction | Auto-compact plus `/compact` | Partial: summaries are re-labelled as assistant text and referenced files are surfaced (ADR 0023); `compact_boundary` and `PreCompact`/`PostCompact` are unused | History parser + transcript divider | Candidate |
| Context ceiling and auto-compact threshold | `getContextUsage()` | Implemented mid-turn, cached to disk, with a mirrored-registry fallback | `claude-context-usage.ts`, `claude-context-window.ts` | Keep |
| Per-category context breakdown | `getContextUsage()` payload | Implemented from the saved last-turn reading; the composer usage popover drills into the itemized categories in place, and `/context` routes there | Composer usage popover | Keep |
| Transcript retention | `cleanupPeriodDays` | Not exposed; directly affects CLIde's own session list | Provider settings | Candidate |
| Session naming | `title` option, `-n/--name`, `renameSession` | App-owned summaries only | Sidebar/session routes | Keep current ownership |
| App-owned starring | CLIde metadata | Implemented, starred-first ordering | Sessions repository | Keep |
| Ephemeral runs | `persistSession: false` | Implemented for the commit-message generator | `claude-sdk.js` | Keep |

Live and reloaded history must remain equivalent. Any new message kind is
incomplete until the JSONL parser preserves the same meaning, identity, and
redaction behavior as the live stream.

### 3.3 Models, account, authentication, and settings

| Capability | Upstream surface | CLIde today | Integration destination | Disposition |
|---|---|---|---|---|
| Model catalog | `supportedModels()`, the SDK's embedded registry | Hand-maintained `CLAUDE_FALLBACK_MODELS` plus a pinned legacy list | `claude-models.provider.ts` | Candidate: consume the live list without losing fallbacks |
| Context-window facts | SDK model registry (`context.window`, output caps) | Mirrored by hand in `claude-context-window.ts` | Same | Compatibility watch — see §6 |
| Per-session effective model | Transcript inspection plus `settings.json` `model` | Implemented (ADR 0003) | Active-model service | Keep |
| Mid-session model switch | `setModel()` | Not reachable — needs streaming input | Chat transport | Defer to the persistent-query migration |
| Account identity | `accountInfo()` (email, org, subscription) | Inferred from credentials files and `settings.json` | `claude-auth.provider.ts` + Settings | Candidate |
| Installed/authenticated state | `claude --version`, credentials files | Implemented | `claude-auth.provider.ts` | Keep |
| Login/logout | `claude auth`, `setup-token` | Terminal flow only | Settings | Defer pending a complete native design |
| Plan rate limits and credits | `https://api.anthropic.com/api/oauth/usage` | Implemented as a cached read for the composer summary; the external action opens Claude's plan usage settings | `claude-usage.provider.ts` + composer usage popover | Keep |
| Live rate-limit pushes | `rate_limit_event` stream message | **Not exposed** although it arrives unprompted mid-session | Live normalizer → usage UI | Integrate — free live updates, no extra requests |
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
| MCP servers passed to a turn | `mcpServers` option | Implemented by hand-reading `~/.claude.json` and merging project entries | `loadMcpConfig` in `claude-sdk.js` | Compatibility watch — duplicates the CLI's own resolution |
| MCP runtime state | `mcpServerStatus()`, `reconnectMcpServer()`, `toggleMcpServer()`, `setMcpServers()` | Not exposed | Shared MCP runtime/status contract | Candidate |
| MCP gating keys | `enabledMcpjsonServers`, `disabledMcpjsonServers`, `enableAllProjectMcpServers` | Not exposed | MCP settings | Candidate with the settings viewer |
| In-process MCP servers | `createSdkMcpServer()`, `tool()` | Not used | Exposing CLIde's own actions as tools | Defer |
| Skills | Filesystem roots plus `settings.json` overrides | Implemented: discovery plus managed user-skill add/remove | `claude-skills.provider.ts` | Keep |
| Skill reload | `reloadSkills()`, `skillOverrides`, `disableBundledSkills`, `disableSkillShellExecution` | Not exposed | Skills settings | Candidate |
| Slash commands | `supportedCommands()`, `commands_changed` | Approximate: CLIde scans `.claude/commands/` and hardcodes a built-in list (`server/modules/commands/commands.routes.ts`) — misses plugin, skill, and real built-in commands | Commands route + slash menu | Integrate |
| Plugins | `plugins` option, `reloadPlugins()`, `claude plugin`, `enabledPlugins` | Not exposed. CLIde's own Settings → Plugins is a *different* system — name collision to avoid | Provider-slotted extensions settings | Defer |
| Subagents | `agents` option, `supportedAgents()`, `claude agents` | Not exposed as a library; subagent output is grouped in the transcript | Agents settings + activity model | Defer |
| Hooks | 30 hook events | 1 registered (`Notification` → CLIde notifications) | Hook registration + provider settings | Integrate selectively (`PreToolUse` first — see §3.1) |
| Sandbox | `sandbox` option and settings object | Not exposed; needs `bubblewrap` on Linux | Its own spec | Defer |
| File reads for a remote UI | `readFile(path, {maxBytes, encoding})` | Not used; CLIde owns Files/editor APIs | Files architecture | No action — preserve CLIde's authorization boundary |

### 3.5 CLI and advanced surfaces

| Capability | Upstream surface | CLIde today | Integration destination | Disposition |
|---|---|---|---|---|
| Interactive slash commands and key actions | TUI | Shell only unless CLIde has an explicit equivalent | Shell or capability-gated web action | Do not forward slash text as protocol |
| Background agents | `--bg`, `claude agents`, `stopTask()`, `backgroundTasks()` | Not exposed; `task_notification` exists in shared types but nothing emits it for Claude | Background-task tray | Candidate |
| Worktrees | `-w/--worktree`, `worktree.*` settings, `WorktreeCreate/Remove` hooks | Not exposed; CLIde has its own Git panel and worktree script | Source Control workspace | Defer |
| Cloud multi-agent review | `claude ultrareview` | Not exposed — user-triggered and billed | None | No action |
| Remote control and gateway | `--remote-control`, `claude gateway` | Not exposed | None | No action |
| IDE integration | `--ide`, `~/.claude.json` IDE keys | Not exposed; irrelevant to a web client | None | No action |
| Doctor and diagnostics | `claude doctor`, `--debug`, `debugFile` | Partial CLIde diagnostics only | Provider diagnostics/support | Candidate |
| Safe/bare modes | `--safe-mode`, `--bare` | Not exposed | Troubleshooting affordance | Defer |
| Session import/export | `importSessionToStore`, `InMemorySessionStore`, `sessionStore` | Not used | Migration flows | No action until migration is a goal |

## 4. Stream message coverage

`normalizeMessage` (`claude-sessions.provider.ts:493`) acts on the assistant and
user message shapes — text, `thinking`, `tool_use`, `tool_result`, base64 image
blocks — plus transcript-only concerns: compact summaries, local-command rows and
their stdout, and `<synthetic>` notices. `claude-sdk.js` reads `session_id` off
any frame and per-step usage off assistant frames, and uses `result` only as an
exclusion so the cumulative turn total never drives the ring.

Everything else in the 32-type union falls through and is dropped:

| Message type | What it carries | Disposition |
|---|---|---|
| `rate_limit_event` | `rateLimitType` (`five_hour` / `seven_day` / `seven_day_opus` / `seven_day_sonnet` / `overage`), `utilization`, `resetsAt`, overage status | Integrate — live usage for free |
| `status` (`compacting` / `requesting`) | Why the session is silent | Integrate |
| `api_retry` | Retry attempt during 529 storms | Integrate |
| `compact_boundary` | Where context was compacted | Candidate |
| `task_notification`, `task_started`, `task_updated`, `task_progress` | Background-task lifecycle | Candidate |
| `thinking_tokens` | Live thinking-token counter | Defer |
| `tool_progress`, `tool_use_summary` | Per-tool progress and summaries | Candidate |
| `commands_changed` | Live slash-menu invalidation | Integrate with `supportedCommands()` |
| `stream_event` partials | Token-level deltas | Blocked on `includePartialMessages` |
| `auth_status`, `session_state_changed`, `permission_denied`, `elicitation_complete`, `memory_recall`, `files_persisted`, `plugin_install`, `hook_started/progress/response`, `prompt_suggestion`, `local_command_output`, `mirror_error` | Assorted | Defer / No action |

Unknown message types are silently ignored. See §7.

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

CLIde drives Claude through the narrowest possible slice of a very wide surface:
19 of 62 options, 2 of 23 control methods, 2 of 32 message shapes, 1 of 30 hooks,
and 1 of 17 exported functions (`query` itself). That slice is deliberate for
history and identity — hand-parsed JSONL serves the multi-provider model — but
three gaps are pure loss: the live `rate_limit_event` stream, the settings
cascade that is already in force but invisible, and file checkpoints that are
written on every run and never restored. The persistent streaming-input query is
the single unlock behind most of the rest.
