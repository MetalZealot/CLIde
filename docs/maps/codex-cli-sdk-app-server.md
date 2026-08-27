# Codex CLI, SDK, and App Server living surface map

*Originated 2026-07-24. Surface last audited 2026-08-12 against CLIde's
managed-runtime branch and two 0.147.0 installations; the pin, protocol counts
and model rows below were re-measured 2026-08-26 against 0.150.0.*

This map records current Codex behavior and CLIde destinations. The
[upgrade ledger](codex-upgrade-ledger.md) keeps release history; generated
bindings and exhaustive diffs remain temporary audit artifacts. Cross-provider
semantics belong in the
[provider capability map](clide-provider-capability-map.md).

## Current compatibility snapshot

| Evidence | Current value |
|---|---|
| Dispositions compiled at | 0.150.0, spanning the 0.148.0–0.150.0 notes |
| Native thread store | `~/.codex/state_*.sqlite`, table `threads`; `session_index.jsonl` is a legacy mirror and absent on a current install |
| Repository pin | `@openai/codex-sdk` 0.150.0, with `@openai/codex` 0.150.0 transitively |
| Host installations | Bundled 0.150.0 and standalone 0.149.1, distinct by path |
| Default generated protocol | 98 client requests, 10 server requests, 81 notifications |
| Experimental generated protocol | 156 client requests, 11 server requests, 81 notifications |
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

## 4. Delta at 0.150.0, and current dispositions

### Compatibility result

- SDK and bundled CLI pins moved together to 0.150.0.
- The curated protocol subset regenerates and verifies unchanged: every method
  and field CLIde consumes survives.
- Generated experimental client requests grew 136 → 156 and notifications
  72 → 81 in both modes; default client requests (98) and server requests
  (10/11) held. None of the additions is consumed yet.
- `ModelReasoningEffort` gained `max` and `ultra`; `ThreadOptions` gained
  `threadSource` and `CodexOptions` raw `configOverrides`. Only the effort
  levels reach a CLIde surface, and the live model list already carried them.
- App Server MCP event streaming explains the notification-count rise.

### Material upstream surfaces, compiled at 0.150.0

Spans 0.148.0 through 0.150.0. Rows still open from the 0.147.0 pass are
carried forward rather than restated.

| Upstream change | CLIde impact | Disposition |
|---|---|---|
| `session_index.jsonl` is no longer the thread-name store; `~/.codex/state_*.sqlite` holds a `threads` table with `title`, `archived`, `updated_at`, `cwd`, `model`, `reasoning_effort` and `first_user_message` | CLIde's name lookup reads that JSONL path, which is absent on a current install, so it silently returns nothing and disk-discovered sessions fall back to their last agent message | **Candidate.** The filename carries a schema counter, so a reader must resolve the newest `state_*.sqlite`, never hardcode one |
| Resumed and forked threads restore their active permission profile instead of falling back to current defaults (0.149); resumed sessions restore their persisted cwd and approval policy (0.148) | Invisible here, verified: `resumeThread` is always passed a `sandboxMode`/`approvalPolicy` derived from the composer's mode, and CLIde keeps its own per-session mode. Coherent, except that CLIde's store is `localStorage` — resuming the same session from another device falls back to the provider-wide last mode, where the runtime's own profile would have been right | **No action** on the runtime change. The cross-device fallback is a CLIde question of the same shape as the non-durable model default in [`TODO.md`](../TODO.md) |
| Thread credits or cost in `/status`, status lines and terminal titles (0.148) | CLIde has an account-usage surface for Claude and none for Codex spend | **Candidate** |
| `Interrupt` hooks fire when a top-level turn is interrupted (0.150); hooks can also run asynchronously and call MCP tools (0.148) | A hook is the runtime's own extension point, configured in the user's `config.toml`. CLIde issues the abort itself, so it already knows the turn ended | **No action.** Listed as a candidate at 0.150.0; inspection says otherwise |
| `codex doctor` diagnoses endpoint protection, network and proxy failures, desktop state and update connectivity (0.149) | Overlaps CLIde's planned System → Diagnostics screen | **Defer** to [the flight recorder plan](../plans/diagnostics-flight-recorder.md) |
| `/export` conversation to Markdown (0.148); `/copy` picker for responses, code blocks and quotes (0.150) | Chat-surface actions CLIde would re-implement natively, not consume | **Defer** |
| `codex exec fork`, plus archive and restore in the resume picker (0.148) | CLIde already reads `forked_from_id` and owns archive | **Integrated** |
| SDK `configOverrides` raw CLI overrides (0.149) | No CLIde surface passes raw config | **No action** |
| `@` mentions of other Codex tasks and `codex queue` (0.149, 0.150) | CLIde addresses sessions over its own protocol | **No action** |
| `codex agents` dashboard, `/cd`/`/pwd`/`/cwd`, Vim motions, markdown link rendering, permission-mode shortcuts | Terminal UI; CLIde owns checkout identity (ADRs 0033, 0041) | **No action** |
| Amazon Bedrock as a built-in provider, with compaction and multi-agent fixes (0.148, 0.150) | No CLIde surface selects a Codex model provider | **Compatibility watch** |
| Untrusted projects no longer supply project-level `AGENTS.md`; managed deny-read rules stay enforced after a permission change (0.150) | Changes what a CLIde-hosted session actually reads, without any CLIde change | **Compatibility watch** |

Carried from 0.147.0 and still open: `isBlocking` structured questions
(**integrated**); persistent thread sections and incremental transcript
browsing (**defer** — not equivalent to CLIde stars or sidebar sections);
portable plugins and plugin search (**defer** — needs a provider-slotted
extensions IA); `--approve-for-me`, Cursor skill import and Claude/Cursor sync,
and the removal of `codex exec --full-auto` (**no action**); MCP protocol
2026-07-28 and cached web search (**compatibility watch**).

These releases also fix model switches leaving stale instructions or mutating an
active turn, turns reconnecting through provider outages, MCP recovery after
OAuth reauthentication, duplicate sub-agent activity, Unix shutdown hangs from
detached processes holding a terminal, bounded replay buffers for inactive
threads, credential redaction in app-server diagnostics, and sandbox paths
failing closed. CLIde inherits all of them by pinning; they inform live smoke
coverage without creating frontend work.

## 5. Upgrade evidence and source policy

Each stable upgrade audits official release/docs/tagged source, installed
packages and binaries, SDK declarations, CLI help, default and experimental
generated protocol, the curated compatibility guard, focused/full tests, and an
isolated live gate. Production process/version and installed-app evidence remain
separate deployment facts.

Dispositions above were compiled against the three release notes plus tagged
source and the installed state store; `session_index.jsonl`'s demotion is
established by upstream's own test, which removes the file and asserts that
naming still resolves from SQLite.

Primary current sources:

- [Codex 0.150.0 release](https://github.com/openai/codex/releases/tag/rust-v0.150.0),
  [0.149.0](https://github.com/openai/codex/releases/tag/rust-v0.149.0),
  [0.148.0](https://github.com/openai/codex/releases/tag/rust-v0.148.0)
- [OpenAI tag comparison: 0.147.0 to 0.150.0](https://github.com/openai/codex/compare/rust-v0.147.0...rust-v0.150.0)
- [Tagged TypeScript SDK](https://github.com/openai/codex/tree/rust-v0.150.0/sdk/typescript)
- [Tagged App Server protocol](https://github.com/openai/codex/tree/rust-v0.150.0/codex-rs/app-server-protocol)
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
