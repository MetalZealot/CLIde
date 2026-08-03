# CLIde provider capability map

**Status:** Living foundation baseline

**Started:** 2026-07-30

**Last source audit:** CLIde `main` at `935c629`

**Architecture contract:** [Current provider architecture contract](../specs/CLIde_Provider_Architecture_Current_Contract.md)

This is the canonical map of provider-normalized behavior in CLIde. It records
what CLIde means, who owns it, how each active provider/runtime binds to it, and
whether the behavior reaches the application today.

It is not an exhaustive copy of every native SDK method, CLI flag, App Server
endpoint, event, or setting. Those remain in provider-native maps. Every
material native surface should instead receive a disposition here or in its
provider map.

## 1. Reading the map

### 1.1 Binding fidelity

| Mark | Meaning |
|---|---|
| **E** | Exact native mapping is implemented |
| **A** | Approximate mapping is implemented with documented semantic loss |
| **C** | CLIde-owned behavior independent of the provider |
| **R** | Runtime/transport/version dependent |
| **G** | Declared or partly wired, but a known conformance gap remains |
| **S** | Available only through the provider's separate Shell client |
| **—** | Unsupported or not integrated |

Binding fidelity is separate from upstream availability. A provider can expose
a native feature while CLIde has no binding, and CLIde can own a feature such as
starring without a native provider equivalent.

### 1.2 Implementation chain

A mature row should identify:

```text
canonical behavior
  -> provider/runtime binding
  -> adapter
  -> gateway or route
  -> UI/headless consumer
  -> persistence/history
  -> automated evidence
  -> live-smoke evidence
```

The initial baseline maps shipped contracts and known gaps. It does not yet
claim complete end-to-end conformance evidence for every row.

## 2. Identity and ownership

```text
CLIde session_id
  |
  +-- provider
  +-- resolved runtime installation/profile
  +-- provider_session_id
  +-- provider aliases or native lineage
  +-- normalized live/history messages
  +-- requested session settings
  `-- provider/transcript-confirmed effective settings
```

| Canonical concept | Owner | Invariant |
|---|---|---|
| `session_id` | CLIde | Stable identity for database, frontend, gateway, and public API |
| `provider_session_id` | Provider, mapped by CLIde | Native identifier; never the primary app identity |
| Run ID and event sequence | CLIde gateway | Exactly-once live replay and completion boundary |
| Native turn/item/request IDs | Provider adapter | Retained only where required for correlation or history identity |
| Rewind lineage | CLIde session + provider adapter | May replace native state without replacing the app session |
| Fork lineage | CLIde service + provider adapter | Always creates a new CLIde session |
| Star/archive/display metadata | Usually CLIde | App-owned unless an explicit synchronization policy selects a native equivalent |

CLIde consolidates sessions from every provider into one application model. It
does not claim that provider-native conversations are interchangeable.

## 3. Current runtime profiles

This snapshot is time-specific. Runtime diagnostics must eventually replace
manual assumptions.

| Provider | Interactive profile | Other relevant profiles | Current availability note |
|---|---|---|---|
| Claude | Agent SDK spawns a standalone Claude Code per turn | Separate Claude Shell; SDK control surface | Pinned SDK 0.3.165 bundles runtime 2.1.165; the runtime actually spawned is whatever `PATH` resolves (2.1.220 observed) |
| Codex | Long-lived bundled App Server by default; bundled SDK fallback | SDK jobs, disposable usage App Server, separate standalone Shell | Bundled and standalone 0.146.0 were observed |
| Cursor | External `cursor-agent` process | Native model/config/session stores | No installation detected in the audited service environment |
| OpenCode | External `opencode run` process | Native model command and shared SQLite history | No installation detected in the audited service environment |

Provider identity alone does not select a capability set. Codex's effective
profile changes when App Server falls back to the SDK.

## 4. Normalized capability baseline

### 4.1 Sessions and turns

| Capability ID | Canonical CLIde behavior | Claude | Codex | Cursor | OpenCode |
|---|---|---:|---:|---:|---:|
| `session.identity` | Stable CLIde ID mapped to native ID | C | C | C | C |
| `session.discovery` | Index native sessions into CLIde | E | E | E | E |
| `session.history` | Load normalized persisted messages | E | E | E | E |
| `session.resume` | Continue native context from a CLIde session | E | E | E | E |
| `session.star` | App-owned starring and starred-first ordering | C | C | C | C |
| `session.rewind` | Resume/edit from an earlier point without losing app identity | E | R | — | — |
| `session.fork` | Create a sibling CLIde session/native lineage | — | R | — | — |
| `turn.start` | Start a text turn through the selected provider | E | E | E | E |
| `turn.abort` | Signal-first cancellation with native graceful interruption where possible | E | E | E | E |
| `turn.queue-followup` | Queue a later CLIde turn rather than native active-turn steering | C | C | C | C |

Notes:

- Codex rewind/fork require the effective App Server transport and disappear on
  SDK fallback.
- Claude's upstream SDK exposes native fork helpers, but CLIde's current
  capability contract does not advertise a provider fork binding.
- Claude's rewind is conversation-only. File checkpoints are written on every
  persistent run, but the native file-restore call is never made.
- Live/history equivalence is an invariant; full per-message-kind conformance
  coverage remains incomplete.

### 4.2 Inputs, models, and usage

| Capability ID | Canonical CLIde behavior | Claude | Codex | Cursor | OpenCode |
|---|---|---:|---:|---:|---:|
| `input.text` | Send normalized user text | E | E | E | E |
| `input.image` | Send normalized image attachments | E | E | E | E |
| `model.catalog` | Return normalized selectable models | E | E | E | E |
| `model.request` | Request a model for a new/resumed turn | E | E | E | E |
| `model.effective` | Report transcript/provider-confirmed model truth | E | E | E | E |
| `reasoning.effort` | Request provider-native effort level | E | E | — | E |
| `usage.context` | Report turn/session token context where available | E | E | — | E |
| `usage.plan-limits` | Report plan windows/credits without inventing unsupported concepts | E | E | — | — |

Catalog fidelity differs. Claude and Codex retain fallbacks, Cursor and OpenCode
have native model commands, and model-source/runtime-version diagnostics are not
yet uniform.

### 4.3 Access policy and interaction

| Capability ID | Canonical CLIde behavior | Claude | Codex | Cursor | OpenCode |
|---|---|---:|---:|---:|---:|
| `access.presets` | Map shared user intent onto native access controls | E | R | G | A |
| `collaboration.plan` | Plan without treating Plan as a filesystem permission | E | R | G | A |
| `interaction.tool-approval` | Surface a pending tool decision in CLIde | E | R | — | — |
| `interaction.command-approval` | Surface a command approval request | — | R | — | — |
| `interaction.file-approval` | Surface a file-change approval request | — | R | — | — |
| `interaction.permission-approval` | Surface a scoped permission amendment | — | R | — | — |
| `interaction.user-input` | Structured questions with reconnect-safe pending state | E | R | — | — |

The canonical access model is not a single `permissionMode` string. Filesystem
boundary, network, approval behavior, reviewer, collaboration intent, and
prompting are separate dimensions.

Known gap: Cursor currently advertises permission modes in the capability
service, but its runtime adapter does not consume the composer's
`permissionMode` consistently.

Claude qualifications behind its exact marks: two native access modes
(`dontAsk`, and the CLI-only `manual`) are unmapped; Plan mode relies on a
CLIde-owned tool allow-list rather than native plan instructions; and in the
`auto` and `bypassPermissions` modes the runtime resolves approval before the
tool-permission callback, so interactive tools never reach the UI. Access-policy
changes also apply only from the next turn, because CLIde constructs a new query
per turn instead of holding a streaming-input session.

### 4.4 Provider resources

| Capability ID | Canonical CLIde behavior | Claude | Codex | Cursor | OpenCode |
|---|---|---:|---:|---:|---:|
| `auth.status` | Normalized installed/authenticated state | E | E | E | E |
| `mcp.config.read` | List normalized MCP configuration by supported scope | E | E | E | E |
| `mcp.config.write` | Add/update/remove MCP configuration | E | E | E | E |
| `skills.discovery` | Discover normalized provider-visible skills | E | E | E | E |
| `skills.install` | Install/remove user-scoped skills through provider conventions | E | E | E | E |
| `runtime.diagnostics` | Report configured/effective executable, version, health, and compatibility | G | G | G | G |

Configuration support does not imply runtime MCP health, OAuth state, active
tools/resources, or reload controls. Those are separate future capabilities.

## 5. Normalized state baseline

| State family | Current source | Current limitation | Target |
|---|---|---|---|
| Provider default model/effort/access | Browser/app preferences plus provider catalogs | State is fragmented and partly browser-local | Backend-owned provider defaults |
| Session requested model | Session-scoped database/cache state | Does not prove active runtime acceptance | Preserve as requested state |
| Session effective model | Transcript/provider lookup | Provider-specific freshness and fallback semantics | Source-labelled effective state |
| Access policy | Composer state and per-turn runtime options | One string hides independent dimensions | Structured `AgentAccessPolicy` |
| Runtime/transport | Provider-specific resolution and Codex diagnostics | Not uniformly represented | Provider-native runtime summary |
| Provider settings | Native files plus CLIde overrides | Effective provenance is not normalized | Provider-specific settings facet with shared scope/provenance vocabulary |

Settings normalization should standardize scope, provenance, desired/effective
state, and mutability. It should not force unrelated provider keys into one
universal configuration object.

## 6. Current implementation destinations

| Concern | Current source/destination |
|---|---|
| Provider registry and facets | `server/modules/providers/provider.registry.ts`, `server/shared/interfaces.ts` |
| Static/dynamic capability declaration | `server/modules/providers/services/provider-capabilities.service.ts` |
| Provider-native adapters | `server/modules/providers/list/<provider>/` |
| Live runtime entrypoints (registry migration completed by upstream v1.37) | `server/modules/providers/list/<provider>/<provider>-runtime.provider.js` for `claude`, `codex`, `cursor`, `opencode` |
| Stable run ownership and normalized writing | WebSocket gateway, `chatRunRegistry`, `ChatSessionWriter` |
| Interactive request normalization | `interactive-request-registry.service.ts`, shared request types, Chat request UI |
| Stable session/native-ID persistence | Sessions repository/database plus provider synchronizers |
| Model requested/effective resolution | Provider model services and per-session model state |
| MCP/skills/auth/usage | Optional provider facets and shared routes/services |
| Generic UI capability consumption | Composer, Chat controls, provider settings/status surfaces |

## 7. Provider-native maps and ledgers

| Provider | Native map | Upgrade ledger | Current action |
|---|---|---|---|
| Claude | [Claude Code and Agent SDK](claude-agent-sdk.md) | [Claude ledger](claude-upgrade-ledger.md) | Maintain on each SDK bump or material runtime change |
| Codex | [CLI, SDK, and App Server](codex-cli-sdk-app-server.md) | [Codex ledger](codex-upgrade-ledger.md) | Maintain on each stable candidate |
| Cursor | Not created | Not created | Audit official docs plus installed CLI artifacts when available |
| OpenCode | Not created | Not created | Audit source, config schema, OpenAPI server, CLI, and installed artifacts |
| Antigravity | Not a registered provider | Not created | Begin with provider-fit and integration-surface assessment |

## 8. Known conformance work

1. Add typed stable capability IDs and binding fidelity instead of expanding a
   flat boolean bag indefinitely.
2. Make provider/runtime bindings transport-aware for every dynamic capability.
3. Add declaration-to-adapter-to-gateway-to-UI conformance tests.
4. Make generic UI consistently consume image, abort, interactive-request, and
   usage capabilities.
5. Fix or stop advertising Cursor permission-mode mappings.
6. Implement native-runtime resolution and sanitized compatibility diagnostics.
7. Represent provider defaults, session requested state, and effective state
   separately.
8. Generate or validate mechanical tables in this document from typed code.
9. Add provider-native unknown-event/method diagnostics without retaining
   sensitive payloads.

## 9. Update rules

When a provider release changes:

1. Update its provider-native map and compact ledger.
2. Classify each material native surface as:
   - existing canonical binding;
   - selected new canonical behavior;
   - provider-specific surface;
   - Shell-only escape hatch;
   - compatibility watch;
   - intentional no-action.
3. Update this map only when current CLIde behavior, fidelity, runtime
   availability, implementation state, or disposition changes.
4. Add TODO work only for selected integrations.
5. Add or supersede an ADR only when ownership, identity, persistence,
   fallback, or security boundaries change.

Old release inventories belong in Git history and provider ledgers, not in this
living map.
