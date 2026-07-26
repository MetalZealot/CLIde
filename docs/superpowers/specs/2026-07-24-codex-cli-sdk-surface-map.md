# Codex CLI, SDK, and App Server surface map

*Surveyed 2026-07-24 against the official Codex documentation, installed Codex CLI
0.145.0, installed `@openai/codex-sdk` 0.144.6, generated 0.145.0 App Server
TypeScript bindings, and CLIde's `my-edits` branch.*

This is both a Codex reference and an implementation inventory for CLIde. It separates
the surfaces deliberately: the interactive CLI, `codex exec`, the TypeScript SDK, and
the App Server do **not** expose the same capabilities.

> **Implementation update (2026-07-25):** The opt-in App Server Chat transport
> described as future work below has now shipped. Read
> [Codex Chat transport architecture](2026-07-25-codex-chat-transport-architecture.md)
> for the implemented slice, current rollout behavior, default-migration checklist,
> and rules for future Codex features. Keep this document as the broader dated
> capability inventory.

> **Maintenance update (2026-07-26):** App Server is now CLIde's default
> interactive Chat transport, with the TypeScript SDK retained as an explicit
> escape hatch and startup fallback. CLIde now pins SDK and bundled CLI 0.145.0
> together. The schema bump adds `thread/fork.beforeTurnId` for direct
> edit-before-turn rewinds and the `cacheWriteInputTokens` usage field. The
> status tables below remain the original dated survey rather than a live
> implementation checklist.

Status legend:

- **Implemented** — CLIde exposes the underlying Codex behavior in chat or a close UI
  equivalent.
- **Partial** — some behavior or data is present, but important fidelity/control is
  missing.
- **Shell only** — available by opening CLIde's Codex shell, not as a first-class web
  feature.
- **Missing** — Codex provides it, but CLIde does not currently expose it.
- **TUI-only / low priority** — presentation or terminal ergonomics that need not map
  directly to a web client.

## Executive summary

1. **CLIde currently uses Codex's narrowest programmable surface.**
   `server/openai-codex.js` uses the TypeScript SDK, which is a typed wrapper around a
   `codex exec --json` subprocess. It is good for one-shot and resumed turns, but it is
   not the full interactive Codex control protocol.

2. **The Codex App Server is the proper rich-client integration point.** OpenAI describes
   it as the interface for products that need authentication, conversation history,
   approvals, and streamed agent events; the Codex IDE extension uses it. It exposes
   threads, turns, live deltas, approvals, steering, rollback/fork/archive, models,
   account/rate-limit data, configuration, MCP, skills, plugins, apps, hooks, filesystem
   operations, review, and more.

3. **The largest CLIde gap is architectural, not a collection of missing flags.**
   Extending the current per-turn TypeScript SDK adapter can improve its eight supported
   item types, but it cannot provide full CLI parity. A long-lived backend-owned
   `codex app-server` stdio connection is the clean route to that parity.

4. **CLIde already covers the basic agent loop well:** create/resume a session, send text
   and images, choose a model and reasoning effort, select one of three permission
   presets, stream completed tool/message items, abort, read history, and open the real
   terminal UI as an escape hatch.

5. **The highest-value missing frontend features are:** approval round-trips; live text,
   reasoning, command, and patch deltas; active-turn steering; rich plan/diff/status and
   compaction events; native session fork/rollback/archive/name controls; authoritative
   model/account/rate-limit/config data; and native MCP/skills/plugin state.

## 1. The Codex surfaces and when each is appropriate

| Surface | What it is | Best use | Rich-client suitability | CLIde today |
|---|---|---|---|---|
| Interactive `codex` CLI | Full-screen terminal application | Human terminal use | Useful as a parity reference, not a web protocol | Embedded in the Shell tab |
| `codex exec` | Non-interactive JSONL/text runner | CI, scripts, one-shot automation | Limited: event stream but no general bidirectional client control | Indirectly used through the TS SDK |
| TypeScript SDK | Node wrapper that spawns `codex exec --json` | Server-side jobs and simple agent turns | Limited to the exec event model | Primary Codex chat adapter |
| Python SDK | Python client that controls App Server | Python applications needing richer control | Broad; currently a more direct App Server client | Not used |
| `codex app-server` | Bidirectional JSON-RPC-like local protocol | IDEs and rich clients | **Intended surface for CLIde-class clients** | Not used |
| `codex mcp-server` | Exposes Codex itself as an MCP server | Let another MCP host call Codex tools | Complementary, not a chat/session frontend protocol | Not used |
| Codex Cloud commands | Start/read/apply remote tasks | Remote execution workflows | Optional frontend surface | Not used |

### Critical comparison with Claude Code

The installed Claude Agent SDK is already a remote-control layer over the full Claude
Code process. The Codex **TypeScript SDK is not equivalent to that surface**; it wraps
the narrower `exec --json` mode. The closest Codex equivalent to the Claude SDK's
interactive control plane is App Server.

The practical mapping is:

| Claude Code concept | Closest Codex concept |
|---|---|
| `query()` plus control methods | App Server thread/turn requests |
| SDK stream messages | App Server notifications and server-to-client requests |
| `canUseTool` / permission callbacks | Approval requests sent from App Server to client |
| `resume`, `forkSession`, `resumeSessionAt` | `thread/resume`, `thread/fork`, `thread/rollback` |
| `setModel`, `setPermissionMode`, `interrupt` | per-turn overrides, `turn/steer`, `turn/interrupt` |
| `supportedModels`, account/context controls | `model/list`, `account/*`, `thread/tokenUsage/updated` |
| Claude settings/skills/MCP control methods | App Server `config/*`, `skills/*`, `mcpServer/*`, `plugin/*`, `app/*` |

Codex terminology:

| Codex term | Meaning in a frontend |
|---|---|
| Thread | A persisted conversation; closest to a Claude session/provider session |
| Turn | One user instruction plus the agent work it triggers |
| Item | A typed event/result within a turn: message, reasoning, command, patch, tool call, plan, and so on |
| Notification | Server-pushed state or delta; the client does not reply |
| Server request | Server-initiated approval, elicitation, token-refresh, or delegated tool request that the client must answer |
| Approval policy | When Codex should request approval |
| Sandbox policy / permission profile | What filesystem, process, and network access is technically permitted |
| Skill | Instruction/workflow package discovered from configured roots |
| Plugin | Installable bundle that can contribute skills and other Codex capabilities |
| App | Connector/integration exposed to Codex, with its own tool and approval policy |

Two differences are easy to miss:

- Interactive slash commands are TUI actions, not a promise that sending the literal
  string through `codex exec` or the SDK will execute the same control. A frontend must
  call the matching protocol operation or implement its own UI.
- Approval policy and sandbox policy are independent. A client can choose when to ask
  while separately constraining what an approved process may access.

## 2. Sources, versions, and drift policy

Primary references:

- [Codex CLI reference](https://developers.openai.com/codex/cli/reference)
- [Codex CLI features and interactive commands](https://developers.openai.com/codex/cli/features)
- [Codex SDK](https://developers.openai.com/codex/sdk)
- [Codex App Server](https://developers.openai.com/codex/app-server)
- [Codex non-interactive mode](https://developers.openai.com/codex/noninteractive)
- [Codex configuration reference](https://developers.openai.com/codex/config-reference)
- [OpenAI Codex TypeScript SDK source](https://github.com/openai/codex/tree/main/sdk/typescript)
- [OpenAI Codex Python SDK source](https://github.com/openai/codex/tree/main/sdk/python)

Local evidence:

- Global CLI: `codex-cli 0.145.0`.
- Installed Node SDK: `@openai/codex-sdk` 0.144.6.
- Repository dependency: `^0.144.0`; the current lockfile resolves 0.144.1. The
  inspected `node_modules` is therefore newer than the reproducible lockfile install,
  and implementation should be checked against the locked version before shipping.
- App Server bindings generated with:
  `codex app-server generate-ts --out <temporary-directory>`, both default and
  `--experimental`.
- CLIde implementation: `server/openai-codex.js`,
  `server/modules/providers/list/codex/`, provider capability declarations, settings
  routes/components, command routes, and chat composer behavior.

Codex evolves quickly. For implementation work, regenerate bindings from the CLI version
CLIde will ship and diff them. Treat this document as a dated map, not an eternal API
contract. Some methods included in default generated bindings still have fields or docs
marked experimental.

## 3. Interactive CLI: complete user-action inventory

### 3.1 Top-level commands

The locally installed 0.145.0 CLI exposes:

| Command | User action | CLIde status |
|---|---|---|
| `codex` | Start an interactive conversation | **Shell only**; web chat uses the SDK |
| `exec` | Run non-interactively; resume; JSONL; schema output | **Implemented internally** through SDK, not exposed as a job builder |
| `review` | Review uncommitted changes, a base branch, or a commit | **Missing** as Codex-native review; CLIde has a generic Git panel |
| `login`, `logout` | OAuth/device/API-key/access-token auth and status | **Partial**; login runs a shell command, auth state is hand-read |
| `mcp` | Add/get/list/remove servers; OAuth login/logout | **Partial** config editor; no live status/OAuth/tool/resource UI |
| `plugin` | Add/list/remove plugins and marketplaces | **Missing** |
| `mcp-server` | Run Codex as an MCP server | **Missing**, likely an advanced integration |
| `app-server` | Run the protocol server; generate TypeScript/JSON Schema bindings | **Missing; recommended foundation** |
| `remote-control` | Pair/control Codex remotely | **Missing; experimental** |
| `completion` | Generate shell completion scripts | **TUI-only / low priority** |
| `update` | Update Codex | **Missing**; deployment concern rather than chat feature |
| `doctor` | Produce diagnostics, including redacted JSON | **Missing**; valuable support feature |
| `sandbox` | Run a command under a named permission profile | **Partial** through turn sandbox presets; no generic sandbox runner |
| `debug` | Inspect models, App Server, and prompt input | **Missing**; developer/support feature |
| `apply` | Apply a Codex Cloud task diff locally | **Missing** |
| `resume` | Select and resume a session | **Implemented** through CLIde sessions and Shell |
| `archive`, `unarchive`, `delete` | Manage stored sessions | **Partial**; CLIde owns corresponding session records but does not call native APIs |
| `fork` | Branch a stored session | **Missing** |
| `cloud` | Exec/list/status/diff/apply remote tasks | **Missing; experimental** |
| `exec-server` | Experimental exec service | **Missing; experimental** |
| `features` | List feature flags | **Missing** as a UI/config inspector |

The official reference additionally documents commands such as `codex app` and
`codex execpolicy`; they were not present in the local 0.145.0 top-level help, so a
frontend must account for version/platform/feature differences instead of hardcoding a
single permanent list.

Notable nested actions in the installed CLI:

- `review`: review uncommitted work, changes from a base branch, or one commit, with an
  optional prompt/title;
- `login`: browser login, device auth, API-key stdin, access-token stdin, and status;
- `mcp`: list/get/add/remove plus OAuth login/logout;
- `plugin`: add/list/remove plugins and add/list/upgrade/remove marketplaces;
- `app-server`: choose transport/listen/auth settings, run the server, or generate
  TypeScript/JSON Schema protocol bindings;
- `doctor`: human diagnostics or a redacted JSON report;
- `sandbox`: run a command under a selected permission profile;
- `debug`: model, App Server, and prompt-input diagnostics;
- `cloud`: submit, list, inspect status/diff, and apply a remote task.

### 3.2 Common run controls

Across interactive, resume, fork, and exec flows, Codex can accept:

- `--config`, repeatable `--enable`/`--disable`, and `--strict-config`;
- `--image`;
- `--model`, `--oss`, and `--local-provider` (`lmstudio` or `ollama`);
- `--profile`;
- `--sandbox`, `--ask-for-approval`,
  `--dangerously-bypass-approvals-and-sandbox`, and
  `--dangerously-bypass-hook-trust`;
- `--cd` and repeatable `--add-dir`;
- `--search`;
- `--remote` and `--remote-auth-token-env` on interactive/resume/fork;
- `--no-alt-screen` for terminal presentation.

Resume adds `--last`, `--all`, and `--include-non-interactive`; fork adds `--last` and
`--all`. The current CLI does not expose reasoning effort as a dedicated top-level flag;
it is configurable through config/profile and interactive controls. App Server and the
SDK expose it directly.

`codex exec` additionally supports:

- `--json` JSONL event output;
- `--output-schema`;
- `--output-last-message`;
- `--ephemeral`;
- `--skip-git-repo-check`;
- `--ignore-user-config` and `--ignore-rules`;
- `--color`;
- `codex exec resume` and `codex exec review`.

CLIde exposes model, effort, three permission presets, working directory, images,
resume, abort, and JSONL-derived events. It does not expose structured output, ephemeral
runs, additional directories, web-search mode, provider/profile selection, or most
config overrides.

### 3.3 Interactive input and keyboard actions

| Interaction | Codex behavior | CLIde status |
|---|---|---|
| Plain prompt | Start/continue a turn | **Implemented** |
| Paste/attach image | Add image input | **Implemented** for supported image paths/data |
| `@` | Fuzzy-search and mention workspace files | **Missing** in chat; CLIde has a separate file browser |
| `!command` | Run a local shell command inside the conversation | **Missing**; tracked in `TODO.md` |
| Enter while agent works | Inject/steer the active turn | **Missing**; CLIde queues a later turn |
| Tab while agent works | Queue a follow-up | **Partial**; CLIde has a queued-draft flow |
| Double Escape | Edit a previous message and fork | **Missing** for Codex; CLIde rewind is Claude-only |
| Ctrl-R / history navigation | Search/reuse prompt history | **Missing** |
| Ctrl-O | Copy last output | **Partial** through per-message copy |
| Ctrl-C / stop | Interrupt or exit | **Implemented** for the active SDK turn |

### 3.4 Interactive slash commands

CLIde's web composer does **not** forward Codex's native slash-command protocol.
`server/routes/commands.js` supplies CLIde-owned commands (`/help`, `/models`, `/cost`,
`/memory`, `/config`, `/status`) and scans Claude command directories. An unrecognized
Codex command is generally just prompt text. Some Codex commands have separate UI
equivalents:

| Codex commands | Purpose | CLIde equivalent/status |
|---|---|---|
| `/permissions`, `/setup-default-sandbox`, `/sandbox-add-read-dir` | Permission and sandbox management | **Partial:** three turn presets; no profile/read-dir editor |
| `/model`, `/fast`, `/personality` | Model, service tier, personality | **Partial:** model and effort picker; no fast tier/personality |
| `/plan`, `/goal` | Planning and persistent goal controls | **Missing** |
| `/agent`, `/subagents`, `/ps`, `/stop` | Inspect/control agents and background work | **Missing** except stop current parent turn |
| `/apps`, `/plugins`, `/hooks`, `/skills`, `/mcp` | Extension/integration discovery and control | **Partial:** filesystem skills and MCP config only |
| `/mention` | Add a file mention | **Missing** |
| `/compact` | Compact context | **Missing** |
| `/fork` | Fork current thread | **Missing** |
| `/rename`, `/archive`, `/delete`, `/resume`, `/new` | Session lifecycle | **Mostly equivalent** through CLIde sidebar controls |
| `/review`, `/diff` | Review work and show changes | **Partial:** generic Git panel, not native Codex review/diff events |
| `/copy`, `/raw` | Copy/render raw output | **Partial:** message copy formats; no raw transcript view |
| `/status`, `/usage`, `/debug-config` | Runtime, usage, and effective-config inspection | **Partial:** app/provider status and context usage; no native config origins |
| `/approve` | Approve a pending action | **Missing:** no Codex approval request channel |
| `/memories` | Inspect/manage memories | **Missing** |
| `/import` | Import external-agent configuration | **Missing** |
| `/ide`, `/keymap`, `/vim` | Terminal/editor integration and keymaps | **TUI-only / low priority** |
| `/clear`, `/exit`, `/quit`, `/logout` | Clear/exit/auth lifecycle | **Partial:** new chat and shell exit; no native logout UI |
| `/feedback`, `/init` | Submit feedback / create project instructions | **Missing** |
| `/app`, `/side`, `/btw` | App and side-conversation flows | **Missing** |
| `/experimental` | Feature flag UI | **Missing** |
| `/title`, `/theme`, `/statusline`, `/pets`, `/pet` | Terminal presentation | **TUI-only / low priority** |

The installed command catalog also includes `/keymap`, `/vim`, `/clear`, `/logout`,
`/feedback`, `/raw`, and the aliases noted above. The exact list should be discovered
from the running version rather than copied permanently into CLIde.

### 3.5 Feature-flag snapshot

`codex features list` is also an important capability-discovery source. On local 0.145.0,
stable features currently enabled include:

- apps, plugins, remote plugins, and plugin sharing;
- hooks;
- goals and personality;
- multi-agent support;
- browser use, external browser use/full CDP access, computer use, and an in-app browser;
- image generation;
- auth elicitation, MCP tool elicitation, skill MCP dependency installation, and skill
  search;
- fast mode;
- mentions v2;
- shell/unified execution and shell snapshots;
- tool suggestions, workspace dependencies, request compression, remote compaction,
  and code-mode host support.

Stable flags present but disabled locally include memories, multi-agent v2, and secret
auth storage. Experimental flags include network proxying and idle-sleep prevention;
numerous development flags also exist (for example artifacts, chronicle, code mode,
deferred execution, current-time reminders, and request-user-input defaults).

Feature flags are not all user-facing promises. A client should use the effective
feature list plus method/capability availability to hide unsupported UI and should not
enable development flags merely because they appear in the catalog.

## 4. TypeScript SDK: exact surface CLIde uses

The TypeScript SDK starts `codex exec --json` and communicates over stdio. It provides:

### 4.1 Client and thread operations

- `new Codex(options)`
- `startThread(options)`
- `resumeThread(threadId, options)`
- `thread.run(input, turnOptions)`
- `thread.runStreamed(input, turnOptions)`
- `thread.id`

It does **not** provide general thread listing, archive/delete/fork/rollback, account
management, model enumeration, approvals, MCP administration, or arbitrary App Server
calls.

### 4.2 Client/thread/turn options

Client:

- CLI binary override;
- base URL and API key;
- flattened configuration overrides;
- child-process environment.

Thread:

- model;
- sandbox mode: `read-only`, `workspace-write`, `danger-full-access`;
- approval policy: `never`, `on-request`, `on-failure`, `untrusted`;
- working directory and additional directories;
- skip-git-repository check;
- reasoning effort: `minimal`, `low`, `medium`, `high`, `xhigh`;
- network access;
- web search mode: `disabled`, `cached`, `live` and legacy boolean enablement.

Turn:

- input as a string or text/local-image items;
- JSON Schema structured output;
- `AbortSignal`.

### 4.3 Exec event and item model

Events:

- `thread.started`
- `turn.started`
- `item.started`
- `item.updated`
- `item.completed`
- `turn.completed`
- `turn.failed`
- `error`

Item types:

- `agent_message`
- `reasoning`
- `command_execution`
- `file_change`
- `mcp_tool_call`
- `web_search`
- `todo_list`
- `error`

Completed-turn usage contains input tokens, cached input tokens, output tokens, and
reasoning output tokens.

### 4.4 Current CLIde use

`server/openai-codex.js`:

- creates a new `Codex` wrapper for each web turn;
- starts or resumes a provider thread;
- uses `runStreamed`;
- forwards text and local images;
- sets model, reasoning effort, cwd, sandbox, and approval policy;
- aborts through an `AbortController`;
- reads the completion usage.

It deliberately ignores `item.started` and `item.updated`, so command, patch, MCP, and
text progress usually appears only when each item completes. It maps the eight item
types into CLIde's shared message model, but some rich per-item information is flattened.

Permission mapping:

| CLIde mode | Codex sandbox | Codex approval |
|---|---|---|
| Default | `workspace-write` | `untrusted` |
| Accept edits | `workspace-write` | `never` |
| Bypass permissions | `danger-full-access` | `never` |

`supportsPermissionRequests` is false for Codex because the exec/TS SDK path does not
give CLIde an App Server approval round-trip. The presets therefore decide behavior
before a turn; CLIde cannot display and answer an individual Codex approval prompt.

## 5. App Server: the rich-client capability inventory

### 5.1 Transport and lifecycle

App Server uses JSON-RPC-like messages without the normal `"jsonrpc"` field. The stable
local transport is JSONL over stdio. WebSocket/Unix-socket transports exist but are
experimental; CLIde should prefer a backend-owned stdio child process and normalize
messages onto its existing authenticated browser WebSocket.

A client must:

1. send `initialize` with client metadata and capability preferences;
2. receive the result and send `initialized`;
3. correlate request IDs;
4. handle notifications;
5. answer server-to-client requests such as approvals and user input;
6. explicitly opt into experimental APIs before using them.

The generated default 0.145.0 protocol contains 92 client request methods, 10
server-to-client request methods, and 72 notification methods.

### 5.2 Default generated client requests

#### Threads, turns, and review

- `thread/start`, `thread/resume`, `thread/fork`
- `thread/list`, `thread/loaded/list`, `thread/read`
- `thread/archive`, `thread/unarchive`, `thread/delete`, `thread/unsubscribe`
- `thread/name/set`, `thread/metadata/update`
- `thread/goal/set`, `thread/goal/get`, `thread/goal/clear`
- `thread/compact/start`, `thread/rollback`, `thread/shellCommand`
- `thread/inject_items`, `thread/approveGuardianDeniedAction`
- `turn/start`, `turn/steer`, `turn/interrupt`
- `review/start`
- legacy/support helpers: `getConversationSummary`, `gitDiffToRemote`

This is the core feature set missing from the current TS SDK adapter: persistent client
threads, active-turn steering, explicit compaction, native fork/rollback, and native
review.

#### Models, permissions, and features

- `model/list`
- `modelProvider/capabilities/read`
- `permissionProfile/list`
- `experimentalFeature/list`
- `experimentalFeature/enablement/set`
- `windowsSandbox/setupStart`, `windowsSandbox/readiness`

#### Configuration and external-agent import

- `config/read`
- `config/value/write`
- `config/batchWrite`
- `configRequirements/read`
- `externalAgentConfig/detect`
- `externalAgentConfig/import`
- `externalAgentConfig/import/readHistories`

The external import surface can detect/import compatible material from other agents.
Generated types include categories such as project instructions, config, skills,
plugins, MCP server config, subagents, hooks, commands, and session histories. That is
particularly useful for a Claude Code → Codex migration assistant.

#### Account, authentication, limits, and feedback

- `account/read`
- `account/login/start`, `account/login/cancel`, `account/logout`
- `account/rateLimits/read`
- `account/rateLimitResetCredit/consume`
- `account/usage/read`
- `account/workspaceMessages/read`
- `account/sendAddCreditsNudgeEmail`
- compatibility helpers: `getAuthStatus`
- `feedback/upload`

The account surface supports ChatGPT account metadata, API-key auth, and other
provider-specific account forms represented by the running version. Login can use
browser/device flows while the frontend owns the UX rather than embedding a terminal.

#### MCP

- `mcpServer/oauth/login`
- `config/mcpServer/reload`
- `mcpServerStatus/list`
- `mcpServer/resource/read`
- `mcpServer/tool/call`

#### Skills, hooks, apps, plugins, and marketplaces

- `skills/list`, `skills/extraRoots/set`, `skills/config/write`
- `hooks/list`
- `app/read`, `app/list`, `app/installed`
- `plugin/list`, `plugin/installed`, `plugin/read`, `plugin/skill/read`
- `plugin/install`, `plugin/uninstall`
- `plugin/share/save`, `plugin/share/updateTargets`, `plugin/share/list`,
  `plugin/share/checkout`, `plugin/share/delete`
- `marketplace/add`, `marketplace/remove`, `marketplace/upgrade`

#### Files, search, command execution, and diagnostics

- `fs/readFile`, `fs/writeFile`, `fs/createDirectory`, `fs/getMetadata`
- `fs/readDirectory`, `fs/remove`, `fs/copy`, `fs/watch`, `fs/unwatch`
- `fuzzyFileSearch`
- `command/exec`, `command/exec/write`, `command/exec/terminate`,
  `command/exec/resize`

These can support a native `@` file picker, watched editor/file tree, and controlled
terminal process without scraping shell output. Destructive file operations still need
CLIde-side authorization and path boundaries.

### 5.3 Server-to-client requests the frontend must answer

- `item/commandExecution/requestApproval` — command execution approval;
- `item/fileChange/requestApproval` — file-change approval;
- `item/permissions/requestApproval` — general permission approval;
- `item/tool/requestUserInput` — tool-requested structured user input;
- `mcpServer/elicitation/request` — MCP elicitation;
- `item/tool/call` — dynamic tool calls delegated to the client;
- `account/chatgptAuthTokens/refresh` — ChatGPT token refresh;
- `attestation/generate` — device/client attestation;
- `execCommandApproval` and `applyPatchApproval` — legacy approval requests.

An experimental `currentTime/read` request is also present in the full generated
protocol.

This bidirectional request channel is why App Server can implement a proper permission
and elicitation UI while the current `exec --json` adapter cannot.

### 5.4 Notifications available to a frontend

The 72 default generated notifications are:

- **Global/thread:** `error`, `thread/started`, `thread/status/changed`,
  `thread/archived`, `thread/deleted`, `thread/unarchived`, `thread/closed`,
  `thread/name/updated`, `thread/goal/updated`, `thread/goal/cleared`,
  `thread/environment/connected`, `thread/environment/disconnected`,
  `thread/settings/updated`, `thread/tokenUsage/updated`, `thread/compacted`.
- **Turn:** `turn/started`, `turn/completed`, `turn/diff/updated`,
  `turn/plan/updated`, `turn/moderationMetadata`.
- **Items and deltas:** `item/started`, `item/completed`,
  `item/autoApprovalReview/started`, `item/autoApprovalReview/completed`,
  `item/agentMessage/delta`, `item/plan/delta`,
  `item/reasoning/summaryTextDelta`, `item/reasoning/summaryPartAdded`,
  `item/reasoning/textDelta`, `item/commandExecution/outputDelta`,
  `item/commandExecution/terminalInteraction`, `item/fileChange/outputDelta`,
  `item/fileChange/patchUpdated`, `item/mcpToolCall/progress`,
  `rawResponseItem/completed`, `rawResponse/completed`.
- **Hooks and request resolution:** `hook/started`, `hook/completed`,
  `serverRequest/resolved`.
- **Account and integrations:** `account/updated`, `account/rateLimits/updated`,
  `account/login/completed`, `mcpServer/oauthLogin/completed`,
  `mcpServer/startupStatus/updated`, `skills/changed`, `app/list/updated`,
  `externalAgentConfig/import/progress`, `externalAgentConfig/import/completed`.
- **Filesystem/search/process:** `fs/changed`, `fuzzyFileSearch/sessionUpdated`,
  `fuzzyFileSearch/sessionCompleted`, `command/exec/outputDelta`,
  `process/outputDelta`, `process/exited`.
- **Model, safety, and config:** `model/rerouted`, `model/verification`,
  `model/safetyBuffering/updated`, `warning`, `guardianWarning`,
  `deprecationNotice`, `configWarning`.
- **Remote/platform:** `remoteControl/status/changed`,
  `windows/worldWritableWarning`, `windowsSandbox/setupCompleted`.
- **Realtime:** `thread/realtime/started`, `thread/realtime/itemAdded`,
  `thread/realtime/transcript/delta`, `thread/realtime/transcript/done`,
  `thread/realtime/outputAudio/delta`, `thread/realtime/sdp`,
  `thread/realtime/error`, `thread/realtime/closed`.

A production client should render unknown notifications safely and log them in a
redacted diagnostic channel; protocol additions should not crash the conversation.

### 5.5 Input types

A turn can contain:

- text, including structured text elements;
- remote image or local image, with image detail;
- remote audio or local audio;
- a skill reference;
- a mention reference.

Turn-level overrides can include cwd, model, reasoning effort/summary, personality,
service tier, approval policy/reviewer, sandbox policy, output schema, and related
version-dependent settings.

### 5.6 Thread and turn data a client can retrieve

Thread records can include:

- stable thread ID and session/tree relationships;
- fork origin and parent thread;
- preview, name, created/updated/recency timestamps;
- status, persistence/ephemeral state, rollout path, cwd, CLI version;
- source (CLI, IDE, exec, App Server, or subagent variants);
- agent nickname/role;
- provider and Git metadata;
- turns.

Thread listing can filter/paginate by archived state, cwd, search text, and source.

Turns contain:

- ID, status, error, start/end/duration;
- full items and a presentation-oriented item view;
- plan and diff updates during execution.

### 5.7 Rich item data

App Server's item union is materially richer than the TypeScript SDK's eight exec item
types:

- user and hook-prompt messages;
- agent messages, including phase and memory citations;
- plans;
- reasoning summaries/content;
- command execution with cwd, parsed actions, process/source, status, aggregated output,
  exit code, and duration;
- file changes and patches;
- MCP calls with server/tool, app/plugin attribution, result/error, and duration;
- dynamic client tool calls;
- collaboration/subagent calls with sender, receivers, prompt, model, effort, and agent
  states;
- subagent activity;
- web search;
- viewed images;
- sleeps/waits;
- generated images;
- entered/exited review mode;
- context compaction markers.

This data model can support a substantially more truthful transcript than CLIde's
current generic `Bash`/`Edit` reconstruction.

### 5.8 Other retrievable data

#### Models and provider capabilities

Model entries can carry ID/slug, display name/description, visibility, supported effort
levels and default effort, input modalities, personality/service tiers, default status,
and other version-dependent capability metadata. Provider capabilities include native
web search, image generation, and namespaced tools.

#### Account, rate limits, and usage

The protocol can return:

- account type, email/plan metadata where applicable;
- primary/secondary rate-limit windows, used percentage, window duration, reset time;
- credits and spend-control state;
- per-limit identifiers and reset-credit state;
- aggregate usage such as lifetime tokens, peak daily usage, longest turn, streaks, and
  daily buckets, where the account/provider supports them;
- workspace messages and account notifications.

#### Effective configuration and policy

`config/read` returns effective values with origin/layer metadata rather than forcing a
client to guess from one TOML file. `configRequirements/read` can expose centrally
managed constraints: allowed approval and sandbox modes, permission profiles, web
search, hooks, apps, remote control, computer use, enabled features, data residency,
and models.

#### MCP, skills, plugins, apps, and hooks

- MCP startup/auth status, tools, resources, and resource templates;
- skill identity/path/scope, enablement, interface, dependencies, and errors;
- installed/available plugins and their skills;
- available/installed apps and app metadata;
- registered hooks.

### 5.9 Experimental-only methods in 0.145.0

The full generated protocol adds 37 client methods beyond the default bindings:

- **Thread state:** `thread/increment_elicitation`,
  `thread/decrement_elicitation`, `thread/settings/update`,
  `thread/memoryMode/set`, `memory/reset`.
- **Background terminals:** `thread/backgroundTerminals/clean`,
  `thread/backgroundTerminals/list`, `thread/backgroundTerminals/terminate`.
- **Search/pagination:** `thread/search`, `thread/searchOccurrences`,
  `thread/turns/list`, `thread/items/list`.
- **Realtime:** `thread/realtime/start`, `thread/realtime/appendAudio`,
  `thread/realtime/appendText`, `thread/realtime/appendSpeech`,
  `thread/realtime/stop`, `thread/realtime/listVoices`.
- **Remote control:** `remoteControl/enable`, `remoteControl/disable`,
  `remoteControl/status/read`, `remoteControl/pairing/start`,
  `remoteControl/pairing/status`, `remoteControl/client/list`,
  `remoteControl/client/revoke`.
- **Collaboration/test:** `collaborationMode/list`, `mock/experimentalMethod`.
- **Environments:** `environment/add`, `environment/info`, `environment/status`.
- **Processes:** `process/spawn`, `process/writeStdin`, `process/kill`,
  `process/resizePty`.
- **Incremental fuzzy search:** `fuzzyFileSearch/sessionStart`,
  `fuzzyFileSearch/sessionUpdate`, `fuzzyFileSearch/sessionStop`.

These are promising, but CLIde should isolate them behind capability/version checks.
Realtime and remote control should not be prerequisites for the initial App Server
migration.

## 6. Configuration and extensibility inventory

Codex configuration spans more than model choice. A complete settings inspector/editor
may need to represent:

- model/provider, reasoning effort and summary, verbosity, personality, and service tier;
- approval, sandbox, permission profiles, network access, and writable roots;
- tools: shell, web search, image generation, browser/computer use;
- agents/subagents, roles, concurrency, and depth;
- apps/connectors and destructive/open-world/tool approval rules;
- MCP servers, auth, enablement, tool allow/deny lists, and per-tool approval;
- skills and extra roots;
- hooks;
- plugins and marketplaces;
- project/user instructions and discovery limits;
- history persistence, memory, and compaction;
- TUI keymap/status line/theme/presentation;
- authentication storage and forced login methods;
- telemetry, notifications, shell environment policy;
- feature flags;
- centrally managed configuration requirements.

Configuration may come from user config, trusted project `.codex/config.toml`, profiles,
command-line overrides, and managed policy. A proper client should show the effective
value **and its origin**, and should not overwrite a higher-priority or protected layer
silently.

## 7. Codex local data observed by CLIde

CLIde currently couples to these implementation files:

- `~/.codex/sessions/**/rollout-*.jsonl` — transcripts/session metadata;
- `~/.codex/session_index.jsonl` — names/index metadata;
- `~/.codex/models_cache.json` — model catalog cache;
- `~/.codex/auth.json` — sensitive auth material read to infer status/email;
- `~/.codex/config.toml` and project `.codex/config.toml` — model and MCP config;
- known skill directories under workspace/project/user/system roots.

This works for the current CLI but creates version and security coupling. The App Server
provides first-class alternatives for threads, models, account/auth, effective config,
MCP, skills, plugins, and notifications. CLIde's own stable `session_id` should remain
the app-facing identity; the App Server thread ID belongs in `provider_session_id`, in
line with existing project invariants.

## 8. CLIde implementation inventory

Current code map:

| Concern | Primary implementation |
|---|---|
| Live agent turn and exec-event normalization | `server/openai-codex.js` |
| Image conversion for SDK input | `server/shared/image-attachments.ts` |
| Provider registration | `server/modules/providers/list/codex/codex.provider.ts` |
| Transcript discovery/watcher ingestion | `server/modules/providers/list/codex/codex-session-synchronizer.provider.ts` |
| History parsing and token extraction | `server/modules/providers/list/codex/codex-sessions.provider.ts` |
| Model cache/config resolution | `server/modules/providers/list/codex/codex-models.provider.ts` |
| Auth-file inspection | `server/modules/providers/list/codex/codex-auth.provider.ts` |
| MCP TOML reads/writes | `server/modules/providers/list/codex/codex-mcp.provider.ts` |
| Filesystem skill discovery/mutation | `server/modules/providers/list/codex/codex-skills.provider.ts` |
| Shared capability declaration | `server/modules/providers/services/provider-capabilities.service.ts` |
| CLIde-owned slash commands | `server/routes/commands.js`, `src/components/chat/hooks/useSlashCommands.ts` |
| Provider login terminal flow | `src/components/provider-auth/view/ProviderLoginModal.tsx` |
| Codex resume in the embedded terminal | `server/modules/websocket/services/shell-websocket.service.ts` |
| Follow-up queue behavior | `src/components/chat/hooks/useChatComposerState.ts`, `src/hooks/useQueuedMessageAutoSend.ts` |

### 8.1 Implemented or substantially present

- app-owned stable sessions mapped to Codex provider thread IDs;
- create and resume text conversations;
- local image input;
- model selection and reasoning effort;
- Default, Accept edits, and Bypass permissions presets;
- working-directory selection;
- stop/abort active turn;
- agent messages, reasoning, completed commands, file changes, MCP calls, web searches,
  todo lists, and errors from exec events;
- turn token usage/context-ring data;
- transcript discovery and reload from Codex rollout JSONL;
- model catalog from the local cache with fallbacks;
- filesystem-based skill discovery and user-skill install/remove;
- direct TOML editing for basic MCP configuration;
- basic auth detection and terminal-driven login;
- full interactive Codex CLI as a Shell-tab escape hatch.

### 8.2 Partial implementations and fidelity problems

#### Streaming

CLIde discards `item.started` and `item.updated`. Users see many actions only when they
finish, and the generic normalizer loses App Server's text/reasoning/plan/patch/terminal
deltas and status transitions.

#### History

The Codex history adapter hand-parses rollout JSONL. It reconstructs user text/images,
assistant responses, reasoning, shell commands/results, and apply-patch edits, but does
not preserve the complete live item model: plans/todos, native web/MCP attribution,
rich statuses/durations, compaction, review state, or subagent relationships can be
lost or rendered differently after refresh.

Subagent rollout sessions are intentionally skipped, matching the open provider-neutral
subagent-tracking item in `TODO.md`.

#### Permissions

Permission modes are pre-turn presets, not individual approval requests. The web UI
cannot explain a requested command/file/network permission, receive a user's decision,
or grant a scoped amendment.

#### Models

The model picker reads a cache file and has a fallback catalog. It does not consume
authoritative live model/provider capability metadata, supported modalities, tiers,
personality, or model-list change events.

#### Authentication

Settings infer auth by reading `auth.json` and decoding token metadata; login launches
`codex login` in a PTY. There is no native account/read, browser/device flow owned by the
frontend, cancel/logout, account-update notification, or managed-auth-policy display.

#### MCP

The settings UI edits a subset of user/project TOML. It lacks effective origin/layer,
live startup state, tools/resources, OAuth login/logout, reconnect/reload, enablement,
tool allow/deny lists, and per-tool approval settings.

#### Skills and extensibility

Skills are found by scanning known filesystem roots. There is no live `skills/changed`
invalidation or structured dependency/interface/error/scope data. Plugins,
marketplaces, apps/connectors, hooks, and their approval policies are not exposed.

#### Commands

The web slash menu is CLIde/Claude-oriented, not provider-discovered. Its built-in help
and some command text are Claude-specific. Codex's native slash commands are available
only inside the Shell tab.

#### Usage

CLIde has per-turn/per-session context usage but not the App Server account rate-limit,
credit, workspace-message, or aggregate usage surfaces. A separate in-flight worktree
(`feat/codex-plan-usage`) may change this snapshot; re-audit when it merges.

### 8.3 Missing capability groups

- App Server initialization, subscriptions, and version negotiation;
- live approvals, elicitation, and dynamic client tools;
- active-turn steering and item injection;
- thread fork, rollback, native compact, and native review;
- plan/diff/status/compaction/safety/model-reroute events;
- thread search/source filters and rich thread metadata;
- goals;
- subagent/collaboration activity;
- background terminals;
- structured output UI/API;
- audio/realtime inputs;
- native `@` mention and fuzzy file search;
- file watching through Codex;
- authoritative account, auth, rate limit, credit, and usage data;
- effective config with origins and managed requirements;
- native MCP status/auth/resource/tool controls;
- plugins, marketplaces, apps, hooks;
- external Claude/agent config and history import;
- Codex Cloud tasks;
- diagnostics/doctor and feedback submission;
- remote control.

## 9. Capability matrix for frontend planning

| Capability | Codex source | CLIde | Priority |
|---|---|---|---|
| Text turns and resume | TS SDK / App Server | Implemented | Keep |
| Images | TS SDK / App Server | Implemented | Keep |
| Audio | App Server | Missing | Later |
| Model + effort | Both | Partial metadata | P1 |
| Personality/service tier | App Server/config | Missing | P2 |
| Structured output | TS SDK/App Server | Missing UI/API | P2 |
| Completed tool items | TS SDK | Implemented | Keep |
| Live text/reasoning/tool/patch deltas | App Server | Missing | **P0/P1** |
| Abort | Both | Implemented | Keep |
| Steer active turn | App Server | Missing | **P1** |
| Queue follow-up | Interactive behavior/app-owned | Partial | P1 |
| Individual approvals | App Server | Missing | **P0** |
| User-input/MCP elicitation | App Server | Missing | **P0/P1** |
| Plans, diffs, status, compaction | App Server | Missing | **P1** |
| Thread list/read | App Server | Hand-parsed | P0 migration |
| Rename/archive/delete | App Server | App-owned partial | P1 |
| Fork/rollback | App Server | Missing | P1/P2 |
| Review | CLI/App Server | Missing native flow | P2 |
| Goals | App Server | Missing | P2 |
| Subagents/collaboration | App Server | Missing | P2 |
| Background terminals | Experimental App Server | Missing | Later |
| Account/auth | App Server | File/PTY workaround | **P0/P1** |
| Rate limits/credits/usage | App Server | Mostly missing | P1 |
| Model catalog/capabilities | App Server | Cache workaround | **P0/P1** |
| Effective config/origins/policy | App Server | Partial files | P2 |
| MCP status/OAuth/resources/tools | App Server | Config-only partial | P2 |
| Skills | App Server | Filesystem partial | P2 |
| Plugins/apps/hooks | App Server | Missing | P2/P3 |
| File mentions/fuzzy search/watch | App Server | Separate browser only | P2 |
| External-agent import | App Server | Missing | P3 |
| Cloud tasks | CLI | Missing | P3 |
| Realtime/remote control | Experimental App Server | Missing | Optional |
| Full TUI | CLI | Shell only | Intentional escape hatch |

## 10. Recommended CLIde architecture

### 10.1 Backend transport

Add a Codex App Server client under the provider adapter:

```text
React UI
   │ CLIde normalized WebSocket frames + control requests
   ▼
Express/WS provider orchestration
   │ provider-neutral session/turn/capability interfaces
   ▼
Codex adapter ── JSONL over stdio ── codex app-server
```

The backend should own one supervised App Server process per server/user security
boundary, initialize it once, route requests by CLIde stable session ID, and translate
provider thread IDs at the adapter boundary.

Do not expose the experimental App Server WebSocket directly to browsers. That would
bypass CLIde authentication/path controls and make the UI depend on an unstable
transport.

### 10.2 Provider-neutral contracts

Normalize capability groups rather than Codex method names in shared UI:

- lifecycle: list/read/start/resume/fork/archive/delete/rollback;
- turn controls: start/steer/queue/interrupt/compact;
- approvals and structured user input;
- item/delta/status/plan/diff/usage events;
- model/account/rate-limit descriptors;
- config with origin and write constraints;
- extension inventory/status/actions;
- subagent and background-task activity.

Claude, Cursor, and OpenCode adapters can implement, degrade, or no-op each capability
without leaking Codex-only concepts into shared components.

### 10.3 Migration sequence

1. **Foundation (P0):** App Server stdio client, initialize/version handling, typed
   generated bindings, request correlation, notification router, process recovery, and
   unknown-message diagnostics.
2. **Core chat parity (P0/P1):** thread start/resume/read/list, turn start/interrupt,
   live item deltas, approval/user-input requests, status/errors, authoritative models,
   and account/auth state.
3. **Interactive parity (P1):** steering/queue semantics, plan/diff/token/compaction
   events, rate limits, native rename/archive/delete/fork/rollback.
4. **Integrations (P2):** effective config/requirements, MCP status/OAuth/tools/resources,
   skills, plugins, apps, hooks, and native file mentions/search/watch.
5. **Advanced (P2/P3):** review, goals, subagents, background terminals, external-agent
   import, Cloud tasks, realtime, and remote control.

Keep the current TypeScript SDK adapter behind a feature flag during migration. It is a
useful fallback for simple turns and a clear behavioral baseline.

## 11. Verification checklist for future updates

When Codex or the SDK is upgraded:

1. record CLI and SDK versions;
2. capture top-level `codex --help`, `codex exec --help`, and relevant subcommand help;
3. capture `codex features list`;
4. regenerate default and `--experimental` App Server TypeScript bindings;
5. diff client requests, server requests, notifications, item types, input types, model,
   account, config, and MCP types;
6. inspect the installed TypeScript SDK declarations and confirm whether it still wraps
   `exec --json`;
7. update CLIde's capability declaration and event exhaustiveness tests;
8. replay a representative saved transcript and compare live vs reloaded rendering;
9. exercise text, image, command, patch, MCP, web search, todo/plan, error, abort,
   approval, resume, and compaction paths;
10. verify the Shell escape hatch still resumes the same provider thread;
11. re-check official docs for stability labels and migration notes;
12. update this file's date/version header and the capability matrix.

## Bottom line

Codex already exposes nearly everything needed for a first-class CLIde frontend, but
the majority is exposed through **App Server**, not through the TypeScript SDK CLIde
currently uses. The TypeScript SDK is not defective; it is optimized for a smaller
automation use case. Treating App Server as Codex's provider protocol—and preserving
the existing CLIde session/provider boundary—is the central implementation decision
that unlocks the rest of this inventory.
