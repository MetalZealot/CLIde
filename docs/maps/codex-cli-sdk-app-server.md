# Codex CLI, SDK, and App Server living surface map

*Originated 2026-07-24. Last audited 2026-07-30 against CLIde `main`,
`@openai/codex-sdk` 0.146.0, the bundled Codex CLI/App Server 0.146.0, the
official Codex documentation, and the OpenAI `rust-v0.146.0` release and tagged
source.*

This is the current human-maintained map of how Codex surfaces relate to
CLIde. It is intentionally not a complete copy of Codex's generated protocol
or a chronological changelog:

- the **map** says what is true now, what CLIde exposes, and where a candidate
  integration belongs;
- the [upgrade ledger](codex-upgrade-ledger.md) records what changed in
  each audited release and what CLIde decided;
- generated bindings and command/feature diffs are audit artifacts, not
  committed documentation;
- Git history preserves prior versions of this map.

Cross-provider semantics and normalized CLIde bindings belong in the
[CLIde provider capability map](clide-provider-capability-map.md).

## Current compatibility snapshot

| Evidence | Current value |
|---|---|
| Previous audited compatibility pair | SDK and bundled CLI 0.145.0 |
| Current repository pin | `@openai/codex-sdk` 0.146.0 |
| Bundled CLI/App Server | `@openai/codex` 0.146.0 |
| Standalone CLI on this host | `codex-cli 0.146.0` |
| Default generated App Server surface | 93 client requests, 10 server requests, 72 notifications |
| Experimental generated App Server surface | 130 client requests, 11 server requests, 72 notifications |
| Interactive Chat transport | App Server by default; SDK by explicit escape hatch or startup fallback |
| Production evidence | Running App Server reports 0.146.0; CLIde on port 3001 returns HTTP 200 |
| Remaining 0.146 rollout evidence | Post-restart new-chat and resumed-chat smoke in the installed app |

CLIde pins the TypeScript SDK and its bundled CLI exactly as one compatibility
unit. Chat and account usage resolve the bundled executable from the repository
dependency tree; the unrelated standalone `codex` on `PATH` is not the
production App Server.

## Status and disposition language

The two concepts are separate:

- **CLIde state:** Implemented, Partial, Shell only, or Not exposed.
- **Disposition:** Keep, Integrate, Defer, Compatibility watch, or No action.

“Not exposed” does not mean “must be implemented.” A capability can be a poor
fit for CLIde, terminal presentation, experimental, provider-specific without a
shared product need, or already covered by an app-owned equivalent.

## 1. Surface model

Codex has several related but non-equivalent integration surfaces:

| Surface | Shape | Current CLIde role | Boundary |
|---|---|---|---|
| Interactive `codex` CLI | Human terminal application | Shell-tab escape hatch | Slash commands and keyboard actions are TUI behavior, not Chat protocol calls |
| `codex exec --json` | Non-interactive process and JSONL events | Indirectly used by the TypeScript SDK | No general server-to-client request channel |
| TypeScript SDK | Node wrapper around `codex exec --json` | Non-interactive jobs, explicit Chat escape hatch, startup fallback | Narrow start/resume/run abstraction |
| `codex app-server` | Long-lived bidirectional JSONL protocol | Default interactive Codex Chat and short-lived account-usage reads | Larger version-sensitive rich-client contract |
| `codex mcp-server` | Codex exposed as MCP tools | Not used | Orchestrator integration, not a session frontend |
| Codex Cloud | Hosted task lifecycle | Not used | Separate remote-work product surface |

The TypeScript SDK is not a smaller version of App Server with fewer options.
It is a different interaction model. App Server can send approvals, structured
questions, and other requests back to CLIde while a turn is active.

```text
Browser
   |
   | CLIde authenticated WebSocket and stable session_id
   v
CLIde provider orchestration
   |
   | provider_session_id / Codex thread id
   v
Codex adapter
   |-- interactive Chat ------> long-lived app-server
   |-- account usage ---------> disposable app-server
   |-- simple jobs/fallback --> TypeScript SDK -> codex exec --json
   `-- terminal UI -----------> interactive codex CLI
```

CLIde owns the stable app-facing `session_id`. Codex owns its native thread ID,
stored by CLIde as `provider_session_id`. Rewind may replace the provider
thread behind one stable CLIde session; an explicit fork creates another CLIde
session. See ADRs
[0011](../decisions/0011-codex-app-server-chat-transport.md) and
[0012](../decisions/0012-codex-rewind-and-fork-session-identity.md).

## 2. Current CLIde mapping

### 2.1 Interactive Chat and turn control

| Capability | Upstream surface | CLIde today | Integration destination | Disposition |
|---|---|---|---|---|
| Start/resume text turns | SDK and App Server | Implemented | Chat transport | Keep |
| Local image input | SDK and App Server | Implemented | Shared attachment normalization | Keep |
| Model and reasoning effort | SDK and App Server | Implemented; catalog metadata remains partial | Models provider + composer | Keep; improve catalog authority separately |
| Plan collaboration mode | App Server | Implemented when App Server is actual transport | Capability service + composer | Keep |
| Command approval | App Server server request | Implemented | Interactive-request registry + approval UI | Keep |
| File-change approval | App Server server request | Implemented | Interactive-request registry + approval UI | Keep |
| Additional permission approval | App Server server request | Implemented | Interactive-request registry + approval UI | Keep |
| Structured user questions, including secret answers | App Server server request | Implemented with history redaction | Interactive-request registry + question UI + history | Keep |
| Abort active turn | SDK and App Server | Implemented | Chat transport | Keep |
| Completed agent, reasoning, command, file, MCP, and web-search items | SDK and App Server | Implemented with provider-neutral normalization | Live normalizer + history parser | Keep |
| Text/reasoning/command/patch deltas | App Server notifications | Not exposed; CLIde renders completed items | Chat stream normalizer | Integrate when progressive rendering is prioritized |
| Active-turn steering/item injection | App Server | Not exposed; CLIde queues a later turn | Composer queue + Chat transport | Defer pending provider-neutral steering semantics |
| Plan/diff/status updates | App Server notifications | Partial: Plan mode exists, rich plan/diff events do not | Transcript event model + Chat UI | Defer |
| Structured output schema | SDK and App Server | No CLIde UI/job contract | Non-interactive job API | Defer until a concrete consumer exists |
| Audio/realtime | Experimental App Server | Not exposed | Future multimodal transport | No action |

The App Server capability flags are runtime-derived. If startup falls back to
the SDK, CLIde hides Plan, approvals, rewind, and fork instead of advertising
features the active transport cannot provide. Accepted work is never retried
through another transport.

### 2.2 Sessions, history, and context

| Capability | Upstream surface | CLIde today | Integration destination | Disposition |
|---|---|---|---|---|
| Stable session identity | Native Codex thread plus CLIde database | Implemented with `session_id` / `provider_session_id` separation | Session repository + provider aliases | Keep |
| Thread discovery and history | App Server methods and rollout JSONL | Implemented by filesystem discovery and hand-parsed rollout history | Codex session synchronizer/provider | Compatibility watch |
| Live/history item identity | App Server item IDs and rollout item IDs | Implemented for deduplication | Live normalizer + history parser | Keep |
| Memory citations | App Server/rollout agent-message metadata | Implemented as compact sources | History parser + message renderer | Keep |
| Context token usage | App Server token notifications and rollout usage | Implemented | Chat transport + token-usage parser | Keep |
| Rename/archive/delete | Native methods plus app-owned records | Mostly app-owned equivalents | Sidebar/session routes | Keep current ownership until native lifecycle has a clear benefit |
| App-owned starring | CLIde session metadata | Implemented and sorted starred-first | Session repository + sidebar | Keep |
| Native thread pinning | `Thread.isPinned`, `thread/list.isPinned`, `thread/metadata/update.isPinned` | Not connected to CLIde stars | Session/sidebar metadata bridge | Candidate; define conflict and synchronization rules first |
| Conversation rewind | `thread/fork.beforeTurnId` | Implemented by replacing the provider thread behind one stable CLIde session | App Server transport + provider aliases | Keep |
| Explicit fork | `thread/fork.lastTurnId` | Implemented as a separate CLIde session | App Server transport + session repository | Keep |
| Native rollback | Deprecated App Server method | Intentionally not used | None | No action |
| Native compact | App Server | Not exposed | Provider-capability-gated composer command + history | Defer |
| Native thread list/read/search | App Server | Not used for the main sidebar/history path | Session synchronizer/provider | Defer; migration must preserve watcher and app identity behavior |
| Subagent/collaboration activity | App Server items and child rollouts | Child sessions are deliberately skipped; no agent view | Provider-neutral agent activity model | Defer; tracked in `TODO.md` |

Live and reloaded history must remain equivalent. Any new item type or metadata
is incomplete until the rollout parser preserves the same meaning, identity,
and redaction behavior as the live stream.

### 2.3 Models, account, authentication, and policy

| Capability | Upstream surface | CLIde today | Integration destination | Disposition |
|---|---|---|---|---|
| Model catalog | `model/list`, provider capabilities, local cache | Reads `models_cache.json` with fallbacks | Codex models provider | Candidate: consume authoritative live catalog without losing fallback behavior |
| Per-session effective model | Turn/transcript metadata | Implemented separately from global config defaults | Active-model service | Keep |
| Account authentication state | `account/read` and auth notifications | Inferred from `auth.json`; login uses terminal flow | Codex auth provider + Settings | Candidate only with a complete native login/logout design |
| Plan rate-limit windows | `account/rateLimits/read` | Implemented through a short-lived bundled App Server | Codex usage provider + composer usage popover | Keep |
| Credits/reset balance and account activity | `account/usage/read` | Implemented where account/auth mode supports it; account activity is an in-place drill-in beneath Weekly | Codex usage provider + composer usage popover | Keep |
| API-key plan usage | Not available from the current account surface | Reports unsupported honestly | Usage provider | Keep |
| Effective configuration and origins | `config/read` | Direct TOML/file interpretation only | Provider Settings | Candidate for a read-only cascade/policy view |
| Managed requirements | `configRequirements/read` | Not exposed | Provider Settings/policy UI | Defer until effective-config viewing exists |
| Runtime diagnostics | CLIde plus package manifests | Configured/actual transport, health, SDK version, bundled CLI version, startup fallback, and last error | Provider capability diagnostics | Keep; add protocol-drift counters |

### 2.4 MCP, skills, plugins, apps, and hooks

| Capability | Upstream surface | CLIde today | Integration destination | Disposition |
|---|---|---|---|---|
| MCP configuration | TOML and App Server MCP methods | User/project TOML list/add/edit/remove | Shared MCP Settings + Codex MCP provider | Keep |
| MCP startup state, OAuth, tools, and resources | App Server | Not exposed | Shared MCP runtime/status contract | Candidate |
| Skills | App Server and filesystem roots | Filesystem discovery plus managed user-skill add/remove | Shared skills service and slash menu | Keep; authoritative live invalidation is a future improvement |
| Plugins and marketplaces | CLI and App Server | Not exposed outside Shell | Provider-slotted extensions Settings | Defer pending shared plugin IA |
| Apps/connectors | App Server | Not exposed | Provider-slotted extensions Settings + composer mentions | Defer |
| Hooks | App Server/config | Not exposed | Provider Settings and diagnostics | Defer |
| Plugin/app attribution on tool items | App Server item metadata | MCP attribution is partial; trusted command-plugin attribution is not preserved | Live normalizer + history parser + tool renderer | Integrate with plugin support |
| External-agent import | App Server | Not exposed | Dedicated migration flow, not ordinary Settings | No action until migration is a product goal |

### 2.5 CLI and advanced surfaces

| Capability | Upstream surface | CLIde today | Integration destination | Disposition |
|---|---|---|---|---|
| Interactive slash commands and key actions | TUI | Shell only unless CLIde has an explicit equivalent | Shell or provider-capability-gated web action | Do not forward slash text as protocol |
| Native review | CLI and App Server | Generic Git panel only | Source Control/review workflow | Defer |
| Fuzzy file mentions | App Server | Separate CLIde file browser; no native `@` picker | Composer + Files | Candidate |
| Background terminals/processes | Experimental App Server | CLIde has its own Shell/PTY system | Shell architecture | No action without a concrete missing capability |
| Filesystem read/write/watch | App Server | CLIde owns Files/editor APIs | Files architecture | No action; preserve CLIde authorization boundary |
| Remote Code Mode host | App Server `--code-mode-host` | Not used; CLIde launches a local bundled runtime | Native-runtime boundary | No action |
| Remote control | Experimental CLI/App Server | Not exposed | None | No action |
| Codex Cloud tasks | CLI | Not exposed | Future remote-jobs product | Defer |
| Doctor/debug/feedback | CLI/App Server | Partial CLIde diagnostics only | Provider diagnostics/support | Candidate for support tooling |

## 3. Current implementation destinations

New Codex work should land at the narrowest owning boundary:

| Concern | Current owner |
|---|---|
| Interactive App Server Chat | `server/modules/providers/list/codex/codex-app-server-chat.transport.ts` |
| App Server process/RPC helper for bounded reads | `server/modules/providers/list/codex/codex-app-server.client.ts` |
| SDK fallback and non-interactive turn normalization | `server/modules/providers/list/codex/codex-runtime.provider.js` |
| Transport selection, versions, and health | `server/modules/providers/list/codex/codex-chat-transport-state.ts` |
| Curated consumed protocol | `server/modules/providers/list/codex/codex-app-server.protocol.ts` |
| Generated contract guard | `server/modules/providers/tests/codex-app-server-protocol-drift.test.ts` |
| Capability flags | `server/modules/providers/services/provider-capabilities.service.ts` |
| Session discovery and watcher ingestion | `server/modules/providers/list/codex/codex-session-synchronizer.provider.ts` |
| History and transcript normalization | `server/modules/providers/list/codex/codex-sessions.provider.ts` |
| Models and effective session-model state | `codex-models.provider.ts` plus shared active-model services |
| Account authentication | `server/modules/providers/list/codex/codex-auth.provider.ts` |
| Plan/account usage | `server/modules/providers/list/codex/codex-usage.provider.ts` |
| MCP | `server/modules/providers/list/codex/codex-mcp.provider.ts` plus shared MCP services |
| Skills | `server/modules/providers/list/codex/codex-skills.provider.ts` plus shared skills services |
| Embedded terminal | `server/modules/websocket/services/shell-websocket.service.ts` |

Shared UI and protocol work must remain provider-neutral. Codex-specific
methods stay inside the adapter; shared contracts expose capabilities and
provider-neutral behavior.

## 4. Delta from 0.145.0 to 0.146.0

This section describes only the newest audited transition. On the next
upgrade, condense this delta into the ledger and replace it with the new one.

### 4.1 Compatibility result

- The TypeScript SDK declarations are unchanged; only package and bundled CLI
  versions changed.
- Top-level CLI and `codex exec` help are unchanged.
- `codex app-server` adds `--code-mode-host <WS_URL>`.
- All changes to CLIde's consumed App Server contract are additive.
- The generated contract test passes against 0.146.0; no adapter change was
  required for Chat, approvals, questions, usage, rewind/fork, abort, or
  history.

### 4.2 New or enriched surfaces

| Upstream change | Surface | CLIde impact and destination | Disposition |
|---|---|---|---|
| Persisted thread pinning | Thread record/list/metadata update | Could bridge native pins with app-owned session stars | Candidate |
| External import provider attribution, detection limits, and `import/recordHistory` | App Server | Relevant only to a future migration flow | No action |
| Browser Use and feedback requirements; managed SQLite/log/catalog/update/login-shell/private-desktop paths | `configRequirements/read` | Belongs in a future read-only policy/cascade view | Defer |
| App tools report enabled/read-only state | `app/read` types | Needed by future app/connector UI | Defer |
| Plugin catalog force refresh and workspace-publishing entitlement | Plugin methods/types | Needed by future plugin Settings | Defer |
| Remote skill icon URLs | Skill interface | Needed if CLIde adopts App Server skill inventory | Defer |
| Trusted plugin ID/script path on command items | Thread item | Preserve live and in history when plugin UX is integrated | Compatibility watch |
| Enterprise `ent26` plan type | Account type | Current usage normalization must remain tolerant of unknown plan labels | Compatibility watch |
| Remote Code Mode host | App Server CLI | Does not fit the current local bundled-runtime boundary | No action |
| New feature flags (`in_app_updates` plus development flags) | CLI feature inventory | Do not enable development flags merely because they exist | No action |

The release also includes proxy, MCP refresh, interrupted-turn, imported
timestamp, fork, and terminal fixes. These are behavioral smoke-test inputs,
not necessarily new frontend features.

## 5. Upgrade evidence and source policy

Every stable upgrade must examine all of these layers:

1. **What OpenAI says changed**
   - official Codex documentation;
   - the OpenAI GitHub release;
   - the tag-to-tag comparison;
   - tagged SDK, App Server protocol, and App Server implementation;
   - linked upstream PRs when a behavior is ambiguous or high impact.
2. **What CLIde will actually ship**
   - npm dist tag and package manifests;
   - exact SDK and bundled CLI versions in the lockfile and installed tree;
   - SDK declaration diff;
   - CLI/subcommand help and feature-flag diff;
   - default and `--experimental` generated App Server bindings.
3. **What CLIde consumes and users observe**
   - curated protocol and drift tests;
   - adapter and history-parser exhaustiveness;
   - focused tests/builds;
   - isolated live smoke before rollout;
   - production process/version, HTTP health, and installed-app smoke after
     deployment.

GitHub issues are diagnostic evidence for a suspected regression, not the
authoritative capability inventory. The release, tagged source, official docs,
installed artifacts, and live behavior take precedence.

Primary current sources:

- [Codex 0.146.0 release](https://github.com/openai/codex/releases/tag/rust-v0.146.0)
- [OpenAI tag comparison: 0.145.0 to 0.146.0](https://github.com/openai/codex/compare/rust-v0.145.0...rust-v0.146.0)
- [Tagged TypeScript SDK source](https://github.com/openai/codex/tree/rust-v0.146.0/sdk/typescript)
- [Tagged App Server protocol source](https://github.com/openai/codex/tree/rust-v0.146.0/codex-rs/app-server-protocol)
- [Tagged App Server implementation](https://github.com/openai/codex/tree/rust-v0.146.0/codex-rs/app-server)
- [Codex CLI reference](https://developers.openai.com/codex/cli/reference)
- [Codex SDK](https://developers.openai.com/codex/sdk)
- [Codex App Server](https://developers.openai.com/codex/app-server)
- [Codex non-interactive mode](https://developers.openai.com/codex/noninteractive)
- [Codex configuration reference](https://developers.openai.com/codex/config-reference)

## 6. Recurring update procedure

For each candidate stable release:

1. Claim the recurring provider-maintenance item and work in an isolated
   topic worktree.
2. Record the current source, installed dependency, built artifact, and live
   runtime versions separately.
3. Audit the GitHub release, compare, tagged source, and official docs.
4. Compare SDK declarations, CLI help, feature flags under a clean temporary
   `CODEX_HOME`, and generated default/experimental bindings.
5. Classify each material change as:
   - consumed contract change;
   - current-map opportunity;
   - behavioral compatibility watch;
   - no action, with a reason.
6. Update the exact SDK/bundled-CLI pair and every platform lockfile package.
7. Expand the curated protocol and focused tests only for surfaces CLIde
   consumes.
8. Replace this map's current delta and append one compact ledger entry.
9. Create a `TODO.md` item only for a deliberately selected integration.
10. Add or supersede an ADR only when transport ownership, identity,
    persistence, fallback, or a security boundary changes.
11. Run focused Codex tests, typecheck, lint, relevant builds, SDK import,
    bundled binary version, and a read-only App Server handshake.
12. Smoke-test model discovery, new/resumed Chat, SDK fallback, Plan,
    approvals/questions, command/file/MCP items, images, abort, usage,
    rewind/fork, and live-versus-reloaded history.
13. After deployment, verify the running child version, service/HTTP health,
    and new/resumed Chat in the installed app.

The exhaustive audit output should be generated into a temporary or ignored
artifact directory. Do not commit hundreds of generated bindings merely to
retain a diff that GitHub and the audit tool can reproduce.

## 7. Drift detection and diagnostics

The generated drift test protects the contract CLIde already consumes. It
does not discover useful additions, and schema compatibility cannot prove
runtime behavior.

CLIde currently responds to unknown App Server server requests with a proper
unsupported-method error, but unknown notification methods and unknown
completed item types are ignored. A future diagnostics change should record,
without payloads:

- unknown notification method;
- unknown server-request method;
- unknown item type;
- count and last-seen timestamp;
- bundled CLI version.

This belongs in provider diagnostics, not the user transcript. Method/type
names are sufficient to reveal protocol drift without retaining sensitive
content.

## Bottom line

The committed map stays curated and current. The ledger preserves compact
release decisions. Generated audits discover the full upstream delta.
Contract tests catch known breakage, and runtime diagnostics should catch
unknown behavior that static comparison misses.
