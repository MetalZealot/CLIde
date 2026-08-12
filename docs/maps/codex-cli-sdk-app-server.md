# Codex CLI, SDK, and App Server living surface map

*Originated 2026-07-24. Last audited 2026-08-12 against CLIde's managed-runtime
branch, `@openai/codex-sdk` 0.147.0, two Codex CLI/App Server 0.147.0
installations, generated protocol, the official release, and tagged source.*

This map records current Codex behavior and CLIde destinations. The
[upgrade ledger](codex-upgrade-ledger.md) keeps release history; generated
bindings and exhaustive diffs remain temporary audit artifacts. Cross-provider
semantics belong in the
[provider capability map](clide-provider-capability-map.md).

## Current compatibility snapshot

| Evidence | Current value |
|---|---|
| Previous audited pair | SDK and bundled CLI 0.146.0 |
| Repository pin | `@openai/codex-sdk` and `@openai/codex` 0.147.0 |
| Host installations | Bundled and standalone 0.147.0, distinct by path |
| Default generated protocol | 98 client requests, 10 server requests, 72 notifications |
| Experimental generated protocol | 136 client requests, 11 server requests, 72 notifications |
| Interactive Chat | App Server by default; SDK by explicit escape hatch or initialization-only fallback |
| Runtime selection | Bundled seed, explicit compatible promotion, no silent fallback |
| Isolated live evidence | New/resumed Chat; every facet resolving one executable; Check, Use, idle promotion, and Roll back on 3002 |
| Production state | Port 3001 intentionally untouched by this branch |

The SDK and bundled CLI stay pinned as one compatibility pair, but version is
not installation identity. A provider-generic resolver persists one approved
Codex installation for Chat, Shell, SDK jobs, models, authentication, and usage.
Discovery never promotes an installation.

## 1. Surface model

| Surface | Current CLIde role | Boundary |
|---|---|---|
| Interactive `codex` CLI | Shell-tab escape hatch | TUI actions are not Chat protocol calls |
| `codex exec --json` | Indirect SDK runtime | No general server-to-client request channel |
| TypeScript SDK | Jobs, explicit Chat escape hatch, startup fallback | Narrow start/resume/run wrapper around `exec` |
| `codex app-server` | Default Chat plus bounded models/usage reads | Rich, version-sensitive bidirectional protocol |
| `codex mcp-server` | Not used | Orchestrator surface, not a session frontend |
| Codex Cloud | Not used | Separate hosted-task lifecycle |

```text
Browser -> CLIde session_id -> Codex adapter -> approved installation
                                      |-- long-lived Chat App Server
                                      |-- bounded App Server reads
                                      |-- SDK jobs / startup fallback
                                      `-- interactive Shell
```

CLIde owns `session_id`; Codex owns the thread id persisted as
`provider_session_id`. See ADRs
[0012](../decisions/0012-codex-rewind-and-fork-session-identity.md) and
[0034](../decisions/0034-codex-managed-native-runtime.md).

## 2. Current CLIde mapping

### 2.1 Chat, turns, and interaction

| Capability | Upstream surface | CLIde today | Disposition |
|---|---|---|---|
| Start/resume, text, image, model, effort | SDK and App Server | Implemented | Keep |
| Plan collaboration mode | App Server | Implemented when App Server is effective | Keep |
| Command/file/permission approvals | App Server server requests | Reconnect-safe shared request registry and UI | Keep |
| Structured questions | App Server `request_user_input` | Implemented with secret redaction and 0.147 blocking/timeout semantics | Keep |
| Abort, rewind, fork | App Server; SDK abort | Implemented and capability-gated | Keep |
| Completed agent/tool/reasoning items | SDK and App Server | Normalized live and from history | Keep |
| Text/tool deltas | App Server notifications | Completed items only | Integrate when progressive rendering is prioritized |
| Active-turn steering | App Server | CLIde queues a later turn | Defer pending provider-neutral semantics |
| Structured output, audio, realtime | SDK/experimental App Server | No current consumer | Defer or no action |

App Server capabilities are runtime-derived. SDK fallback hides Plan,
approvals, rewind, and fork; accepted work is never retried through another
transport. CLIde keeps `approvalsReviewer: 'user'` and does not expose
0.147's `--approve-for-me` mode.

### 2.2 Sessions, history, and context

| Capability | CLIde today | Disposition |
|---|---|---|
| Stable session and native thread mapping | Implemented with separate app/native ids | Keep |
| Filesystem discovery and rollout history | Implemented by synchronizer and parser | Compatibility watch |
| Context usage and message identity | Preserved live and on reload | Keep |
| App-owned star/archive/name | Implemented | Keep app ownership |
| Persistent native sections (0.147) | Not mapped to stars or sidebar grouping | Defer until section semantics are chosen |
| Rewind and explicit fork | Implemented with stable-session rules | Keep |
| Native compact/list/read/search | Not the main history path | Defer |
| Subagent activity | Child rollouts skipped; no agent view | Defer |

### 2.3 Models, account, configuration, and runtime

| Capability | CLIde today | Disposition |
|---|---|---|
| Model catalog | Read from selected runtime, with labelled cache/static fallbacks | Keep |
| Effective per-session model | Transcript/provider truth, separate from stored request | Keep |
| Authentication | File status and terminal login flow from selected runtime context | Keep current ownership |
| Rate limits and account activity | Bounded selected App Server; unsupported modes report honestly | Keep |
| Effective config and requirements | Direct TOML editing; native read-only cascade not exposed | Defer |
| Runtime diagnostics and selection | Active, live, pending, previous, per-facet ids; row-level Check and Use | Keep |

The runtime selector displays sanitized paths and sends opaque ids. Check reuses
the generated App Server compatibility gate and enables Use only for the row
that passed. Promotions wait for an active Chat turn to finish; unavailable or
changed selections do not fall back to bundled.

### 2.4 MCP, skills, plugins, and advanced surfaces

| Capability | CLIde today | Disposition |
|---|---|---|
| MCP configuration | Native TOML list/add/edit/remove; edits preserve unmodelled keys | Keep |
| MCP runtime/OAuth/tool state | Not exposed | Candidate |
| Skills | Filesystem discovery and managed user install/remove | Keep |
| Plugins, marketplaces, apps | Not exposed outside Shell | Defer pending shared IA |
| Hooks and effective policy | Not exposed | Defer |
| External-agent import | No product migration flow | No action |
| Filesystem and terminal APIs | CLIde owns Files and Shell | No action |
| Remote Code Mode/control | Local approved-runtime boundary only | No action |
| Native review and cloud tasks | Not exposed | Defer until a concrete workflow exists |

## 3. Current implementation destinations

| Concern | Current owner |
|---|---|
| Interactive App Server Chat | `server/modules/providers/list/codex/codex-app-server-chat.transport.ts` |
| Bounded App Server calls | `server/modules/providers/list/codex/codex-app-server.client.ts` |
| SDK jobs and fallback | `server/modules/providers/list/codex/codex-runtime.provider.js` |
| Transport state and capabilities | `codex-chat-transport-state.ts`, shared capability service |
| Curated protocol and generated guard | `codex-app-server.protocol.ts`, `codex-app-server-compatibility.ts` |
| Runtime persistence and discovery | `server/modules/providers/services/provider-native-runtime.service.ts` |
| Codex runtime descriptor/management | `codex-native-runtime.provider.ts`, `codex-native-runtime-management.provider.ts` |
| Authenticated runtime routes | `server/modules/providers/codex-native-runtime.routes.ts` |
| Runtime row | `src/components/settings/view/sections/agent/CodexNativeRuntimeRow.tsx` |
| Session discovery/history | Codex synchronizer and sessions provider |
| Models, auth, usage, MCP, skills | Their Codex provider facets |
| Shell | `server/modules/websocket/services/shell-websocket.service.ts` |

## 4. Delta from 0.146.0 to 0.147.0

### Compatibility result

- SDK and bundled CLI pins moved together to 0.147.0.
- Generated requests increased from 93 to 98 by default and 130 to 136 with
  experimental types; server requests and notifications stayed 10/11 and 72.
- `ToolRequestUserInputParams.isBlocking` is now consumed and guarded by the
  compatibility check.
- The same structural checker validates every promotion; no second definition
  of compatibility exists.

### Material upstream surfaces

| Upstream change | CLIde impact | Disposition |
|---|---|---|
| `isBlocking` structured-question field | Blocking waits; non-blocking uses explicit/default timeout | Integrated |
| Persistent, manually ordered thread sections and incremental transcript browsing | Not equivalent to CLIde stars or sidebar sections | Defer |
| `--approve-for-me` reviewer mode | Conflicts with explicit user review policy | No action |
| Portable plugins and plugin search | Needs provider-slotted extensions IA | Defer |
| Cursor skill import and Claude/Cursor sync | Migration workflow, not ordinary Settings | No action |
| MCP protocol 2026-07-28 | Consumed contract unchanged | Compatibility watch |
| Cached web search and Bedrock remote compaction | No current normalized product surface | Compatibility watch |
| Removal of `codex exec --full-auto` | CLIde uses explicit sandbox/approval settings | No action |

The release also contains secret-redaction, terminal-input, rendering, Windows,
project-trust, authentication, plugin-isolation, and network fixes. These inform
live smoke coverage without creating frontend work by themselves.

## 5. Upgrade evidence and source policy

Each stable upgrade audits official release/docs/tagged source, installed
packages and binaries, SDK declarations, CLI help, default and experimental
generated protocol, the curated compatibility guard, focused/full tests, and an
isolated live gate. Production process/version and installed-app evidence remain
separate deployment facts.

Primary current sources:

- [Codex 0.147.0 release](https://github.com/openai/codex/releases/tag/rust-v0.147.0)
- [OpenAI tag comparison: 0.146.0 to 0.147.0](https://github.com/openai/codex/compare/rust-v0.146.0...rust-v0.147.0)
- [Tagged TypeScript SDK](https://github.com/openai/codex/tree/rust-v0.147.0/sdk/typescript)
- [Tagged App Server protocol](https://github.com/openai/codex/tree/rust-v0.147.0/codex-rs/app-server-protocol)
- [Codex App Server docs](https://developers.openai.com/codex/app-server)
- [Codex CLI reference](https://developers.openai.com/codex/cli/reference)

## 6. Recurring update procedure

1. Record source, installed dependency, built artifact, selected runtime, and
   live-process versions separately.
2. Audit release, compare, tagged source, official docs, declarations, CLI help,
   feature flags, and generated default/experimental protocol.
3. Classify every material change as consumed, candidate, watch, or no action.
4. Pin SDK, bundled CLI, and platform lockfile packages together.
5. Expand curated protocol only for consumed fields and run the shared
   compatibility check against every promotable candidate.
6. Run focused/full checks and isolated live Chat, interactions, models, usage,
   Shell, promotion, idle recycle, and rollback gates.
7. Record production state only after deployment; never infer it from source or
   a branch server.

Unknown App Server methods or item types should eventually be counted without
payloads in diagnostics. Generated schemas find additions; compatibility tests
protect known contracts; only live behavior proves interaction and lifecycle.
