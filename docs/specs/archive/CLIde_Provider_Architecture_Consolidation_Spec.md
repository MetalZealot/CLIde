# CLIde Provider Architecture Consolidation Spec

**Status:** Historical design and audit record; current contract extracted July 30, 2026; archived August 1, 2026
**Audience:** CLIde maintainers and coding agents  
**Repository:** `MetalZealot/CLIde`  
**Basis:** Current `main` branch inspected July 29, 2026  
**Primary objective:** Make adding a new coding-agent provider require implementing a provider adapter rather than modifying provider-specific branches throughout the application.

> **Default reading path:** Do not load this entire document for ordinary
> provider work. Read the concise
> [current provider architecture contract](../../maps/CLIde_Provider_Architecture_Current_Contract.md)
> and the living
> [CLIde provider capability map](../../maps/clide-provider-capability-map.md).
> Return here only for the routed historical evidence identified by those
> documents.

> **Historical record:** Sections 1–29 preserve the original architectural
> investigation and proposal. Section 30 records a second audit performed from
> inside the CLIde checkout against current `main` at
> `e09e9ed028cadb9d326fd1bb9b7f1a8237082e9e`. Where Section 30 identifies a
> conflict, omission, or narrower boundary, its repository-backed finding should
> guide interpretation of the original proposal. Section 31 adds native-runtime
> resolution. Section 32 defines the relationship to the extracted current
> contract and living maps. The original text is intentionally retained to show
> how the proposal evolved.

---

## 1. Executive Summary

CLIde already has a meaningful provider abstraction. Claude, Codex, Cursor, and OpenCode are represented through a shared provider registry and provider-specific implementations for models, authentication, MCP, skills, session normalization, and session synchronization.

The remaining architectural weakness is that **live agent execution is still wired outside the provider contract**, while the frontend still contains a hardcoded provider catalogue and provider-specific model state.

This spec proposes an incremental consolidation rather than a rewrite:

1. Add a live runtime facet to the provider contract.
2. Route start, resume, abort, permission response, rewind, and fork operations through the provider registry.
3. Expose provider descriptors and capabilities through a backend catalogue endpoint.
4. Replace hardcoded frontend provider arrays and provider-specific model state with registry-driven records.
5. Move optional provider startup and shutdown behaviour behind provider lifecycle hooks.
6. Defer separately installable provider packages until the in-repository contract is stable.

The intended end state is:

> CLIde owns the common workspace, file, Git, terminal, session, transport, and UI infrastructure. Each provider owns only the logic required to connect its native CLI, SDK, app server, configuration, transcript storage, and feature set to that infrastructure.

---

## 2. Context

CloudCLI began as a Claude Code UI and later expanded to support additional coding-agent runtimes. The current architecture is no longer simply a Claude-specific application with unrelated integrations bolted on.

The repository now includes:

- A central provider registry.
- A shared `IProvider` contract.
- Provider-specific implementations for:
  - models
  - authentication
  - MCP
  - skills
  - session event normalization
  - session history
  - session synchronization
  - optional usage reporting
- A normalized session and message model.
- A backend-owned provider capability matrix.
- Stable application session IDs separate from provider-native IDs.
- A unified WebSocket protocol.

These are strong foundations.

However, live execution still depends on application-level imports and manually maintained dispatch maps. The frontend also needs explicit source changes whenever a provider is added.

---

## 3. Terminology

### 3.1 Model Provider

A service that performs inference, such as Anthropic, OpenAI, Google, OpenRouter, or a local model server.

A model provider alone does not necessarily provide:

- file tools
- shell execution
- an agent loop
- session persistence
- permissions
- transcript storage
- MCP integration
- resume or abort semantics

### 3.2 Agent Runtime Provider

A coding-agent runtime integrated into CLIde, such as:

- Claude Code
- Codex
- Cursor CLI
- OpenCode
- a future Gemini CLI integration

This is the correct unit of abstraction for CLIde.

### 3.3 Provider-Native Session ID

The ID assigned by the underlying agent runtime.

### 3.4 CLIde Session ID

The stable application-owned session ID used by the database, frontend, gateway, and public API.

### 3.5 Provider Descriptor

Backend-owned metadata describing how a provider should appear and behave in the application.

---

## 4. Current Architecture Assessment

### 4.1 Existing Strengths

The following areas are already suitably modular or close to it:

- Provider model discovery.
- Provider authentication status.
- Provider-native MCP configuration.
- Provider-native skill discovery and installation.
- Session history normalization.
- Transcript and database session indexing.
- Stable CLIde session identity.
- Normalized message/event types.
- Capability-driven UI behaviour.
- Provider-neutral project and session listing.

These areas should be preserved and extended rather than replaced.

### 4.2 Remaining Provider Leakage

The main remaining leaks are:

#### Live runtime dispatch

The main server imports provider-specific execution functions and manually maps providers to start and abort functions.

Conceptually, the application root still knows:

```ts
claude -> queryClaudeSDK
cursor -> spawnCursor
codex -> queryCodexChat
opencode -> spawnOpenCode
```

This prevents registration alone from making a provider runnable.

#### Frontend provider catalogue

The frontend contains a hardcoded provider list and provider-specific state such as:

- `claudeModel`
- `codexModel`
- `cursorModel`
- `opencodeModel`

Adding a provider therefore requires editing selection, state, persistence, fallback, and authentication UI code.

#### Duplicate provider unions

Provider IDs are represented in both backend and frontend type unions. This is useful for type safety but creates duplicated registration work.

#### Application-level provider lifecycle

Provider-specific startup, shutdown, process management, and optional app-server behaviour are not consistently owned by provider objects.

#### Application-level Claude imports

Some Claude-specific context and runtime helpers are imported directly into broader server code rather than reached through a provider-owned interface.

---

## 5. Problem Statement

Adding a new live provider currently requires changes across multiple unrelated layers:

- backend provider union
- frontend provider union
- provider registry
- provider routes
- main server imports
- WebSocket dispatch maps
- external agent API
- provider selector
- model state
- model fallback state
- permission fallback state
- authentication modal
- icons and labels
- documentation

Some of this is inherently necessary. A provider must implement its native behaviour.

The architectural problem is that **core application files must also be edited merely to acknowledge the provider's existence**.

This increases:

- integration cost
- regression risk
- provider-specific branching
- review surface
- duplicated state
- difficulty testing the provider contract
- long-term maintenance burden

---

## 6. Goals

### 6.1 Primary Goals

1. Make live runtime execution a provider-owned concern.
2. Make the backend registry the canonical catalogue of available providers.
3. Make the frontend render providers from descriptors rather than a hardcoded list.
4. Keep provider-specific formats and behaviour inside provider modules.
5. Preserve the normalized session, message, and gateway contracts.
6. Allow providers to expose capabilities without forcing every provider to implement every feature.
7. Keep the migration incremental and continuously testable.
8. Avoid rewriting working provider implementations.

### 6.2 Secondary Goals

1. Reduce the number of files required to register a provider.
2. Improve provider contract test coverage.
3. Make provider startup and cleanup deterministic.
4. Prepare the architecture for future separately packaged providers.
5. Make Gemini CLI or another future provider a useful validation target.

---

## 7. Non-Goals

This project does **not** initially aim to:

- Turn CLIde into a general-purpose raw-model agent framework.
- Replace Claude Code, Codex, Cursor, or OpenCode agent loops.
- Create a universal abstraction that hides all provider differences.
- Force identical feature parity across providers.
- Immediately support third-party provider installation from npm.
- Rewrite the existing session database.
- Replace the unified WebSocket gateway.
- Replace all provider-specific files with one generic implementation.
- Remove provider-specific capability logic.
- Introduce dynamic code loading before the static contract is stable.
- Add a new provider as part of the core refactor unless used as a validation spike.

Provider-specific code is expected. The goal is containment, not elimination.

---

## 8. Architectural Principles

### 8.1 Capability-Based Behaviour

The UI and gateway should ask:

- Does this provider support abort?
- Does it support images?
- Does it support interactive permission requests?
- Does it support effort?
- Does it support rewind?
- Does it support session forking?

They should not infer these behaviours from provider IDs.

### 8.2 Stable Application Contracts

Provider-native differences should be normalized at the boundary.

Core application code should operate on:

- CLIde session IDs
- normalized run input
- normalized events
- normalized capabilities
- normalized models
- normalized authentication status
- normalized usage status

### 8.3 Optional Facets

Not every provider supports:

- MCP writes
- skill installation
- usage reporting
- interactive approvals
- rewind
- forking
- app-server lifecycle

The contract should model unsupported features explicitly rather than requiring fake implementations.

### 8.4 Provider Ownership

Provider-specific logic should live under:

```text
server/modules/providers/list/<provider>/
```

The application root should not import provider-native SDKs or helpers.

### 8.5 Incremental Migration

Existing functions may be wrapped first and moved later.

The first implementation should prefer adapters around proven code over broad file relocation.

---

## 9. Proposed Provider Contract

The provider contract should be expanded to include live runtime execution and an application descriptor.

```ts
export interface IProvider {
  readonly id: LLMProvider;
  readonly descriptor: IProviderDescriptor;

  readonly models: IProviderModels;
  readonly auth: IProviderAuth;
  readonly sessions: IProviderSessions;

  readonly runtime?: IProviderRuntime;
  readonly mcp?: IProviderMcp;
  readonly skills?: IProviderSkills;
  readonly sessionSynchronizer?: IProviderSessionSynchronizer;
  readonly usage?: IProviderUsage;
  readonly lifecycle?: IProviderLifecycle;
}
```

Whether currently required facets become optional should be decided carefully. During the initial migration, existing required facets may remain required to avoid unnecessary churn.

### 9.1 Provider Descriptor

```ts
export interface IProviderDescriptor {
  id: LLMProvider;
  displayName: string;
  description?: string;
  iconKey: string;
  selectable: boolean;
  runtimeAvailable: boolean;
  capabilities: ProviderCapabilities;
}
```

The descriptor should contain presentation metadata but not React components or executable frontend code.

### 9.2 Runtime Contract

```ts
export interface IProviderRuntime {
  startRun(
    input: ProviderRunInput,
    context: ProviderRunContext
  ): Promise<ProviderRunHandle>;

  abortRun(
    input: ProviderAbortInput
  ): Promise<ProviderAbortResult>;

  respondToInteractiveRequest?(
    input: ProviderInteractiveResponseInput
  ): Promise<ProviderInteractiveResponseResult>;

  forkSession?(
    input: ProviderForkSessionInput
  ): Promise<ProviderForkSessionResult>;

  rewindSession?(
    input: ProviderRewindSessionInput
  ): Promise<ProviderRewindSessionResult>;
}
```

### 9.3 Run Input

```ts
export interface ProviderRunInput {
  appSessionId: string;
  providerSessionId?: string | null;
  projectId: string;
  cwd: string;
  prompt: string;
  model?: string;
  effort?: string;
  permissionMode?: string;
  images?: ProviderImageAttachment[];
  resume: boolean;
  rewindToMessageId?: string;
  metadata?: Record<string, unknown>;
}
```

The contract must distinguish CLIde IDs from provider-native IDs.

### 9.4 Run Context

```ts
export interface ProviderRunContext {
  signal: AbortSignal;
  emit(event: NormalizedMessage): void;
  createProviderSessionMapping(
    providerSessionId: string,
    metadata?: ProviderSessionMappingMetadata
  ): Promise<void>;
  notify(event: ProviderNotificationEvent): Promise<void>;
}
```

The runtime may emit through a callback or return an async iterable. Either approach is acceptable, but CLIde should choose one consistent pattern.

An async iterable is conceptually clean:

```ts
startRun(input: ProviderRunInput): AsyncIterable<NormalizedMessage>;
```

However, existing implementations already use callbacks, WebSocket writers, registries, and completion handling. A callback-based context may therefore be the safer first migration.

### 9.5 Lifecycle Contract

```ts
export interface IProviderLifecycle {
  initialize?(): Promise<void>;
  shutdown?(): Promise<void>;
  healthCheck?(): Promise<ProviderHealthStatus>;
}
```

This should own provider-specific:

- app-server startup
- process cleanup
- file watchers not covered by shared synchronization
- runtime health
- provider boot diagnostics

---

## 10. Provider Registry Changes

The provider registry should become the sole source for provider resolution and listing.

Required operations:

```ts
providerRegistry.listProviders()
providerRegistry.listDescriptors()
providerRegistry.resolveProvider(providerId)
providerRegistry.resolveRuntime(providerId)
providerRegistry.initializeAll()
providerRegistry.shutdownAll()
```

### 10.1 Registry Requirements

- Reject unsupported provider IDs with a structured application error.
- Preserve deterministic provider ordering.
- Allow a provider to be registered but unavailable.
- Distinguish:
  - supported by this CLIde build
  - installed on the host
  - authenticated
  - runtime currently healthy
- Do not infer installation or authentication from registration.

### 10.2 Static Registration First

The initial implementation should retain static imports:

```ts
const providers = [
  new ClaudeProvider(),
  new CodexProvider(),
  new CursorProvider(),
  new OpenCodeProvider(),
];
```

Dynamic npm loading is explicitly deferred.

---

## 11. Runtime Migration

### 11.1 Current Behaviour to Preserve

The migration must preserve:

- active session tracking
- abort semantics
- terminal completion events
- notification behaviour
- provider session ID mapping
- permission request routing
- image attachment support
- model and effort options
- resume behaviour
- fallback transports
- error normalization
- token and context usage reporting
- background session operation
- WebSocket replay and reconnect behaviour

### 11.2 Adapter-First Migration

Do not immediately move all runtime implementation code.

Create provider runtime adapters that call the current functions:

```ts
export class ClaudeRuntimeProvider implements IProviderRuntime {
  async startRun(input, context) {
    return queryClaudeSDK(/* mapped arguments */);
  }

  async abortRun(input) {
    return abortClaudeSDKSession(input.providerSessionId);
  }
}
```

Repeat for:

- Codex
- Cursor
- OpenCode

Once the runtime contract is proven, implementation files may be moved into provider folders in later cleanup commits.

### 11.3 WebSocket Gateway Changes

Replace manually supplied provider maps:

```ts
spawnFns: {
  claude: queryClaudeSDK,
  cursor: spawnCursor,
  codex: queryCodexChat,
  opencode: spawnOpenCode,
}
```

with registry-backed dispatch:

```ts
startRun: (providerId, input, context) =>
  providerRegistry.resolveRuntime(providerId).startRun(input, context),

abortRun: (providerId, input) =>
  providerRegistry.resolveRuntime(providerId).abortRun(input),
```

The WebSocket gateway must remain provider-neutral.

### 11.4 External Agent API

`server/routes/agent.js` should also use the runtime registry rather than its own provider dispatch.

There must be one authoritative live execution path shared by:

- interactive WebSocket chat
- external agent API
- scheduled or automated runs
- future task queue integrations

Different transports may construct different contexts, but provider execution must resolve through the same runtime adapter.

---

## 12. Provider Catalogue API

Add or expand a provider catalogue endpoint.

Suggested endpoint:

```text
GET /api/providers
```

Suggested response:

```json
{
  "success": true,
  "data": {
    "providers": [
      {
        "id": "claude",
        "displayName": "Claude Code",
        "description": "Anthropic coding agent",
        "iconKey": "claude",
        "selectable": true,
        "runtimeAvailable": true,
        "installed": true,
        "authenticated": true,
        "capabilities": {
          "supportsImages": true,
          "supportsAbort": true,
          "supportsPermissionRequests": true,
          "supportsTokenUsage": true,
          "supportsEffort": true,
          "supportsRewind": true,
          "supportsFork": false,
          "permissionModes": [
            "default",
            "auto",
            "acceptEdits",
            "bypassPermissions",
            "plan"
          ],
          "defaultPermissionMode": "default"
        }
      }
    ]
  }
}
```

### 12.1 Source of Truth

- Descriptor metadata comes from the provider.
- Capability data comes from the provider or provider capability service.
- Installation and authentication come from provider auth.
- Runtime health may come from provider lifecycle or runtime diagnostics.
- The frontend must not maintain a separate authoritative provider list.

### 12.2 Existing Endpoints

Existing provider-specific endpoints for models, capabilities, usage, MCP, and skills may remain.

The catalogue endpoint should act as discovery and initial state, not necessarily replace all detailed endpoints.

---

## 13. Frontend Migration

### 13.1 Replace Hardcoded Provider List

Remove frontend constants such as:

```ts
const PROVIDERS: LLMProvider[] = [
  'claude',
  'cursor',
  'codex',
  'opencode'
];
```

Load providers from `GET /api/providers`.

### 13.2 Generic Provider State

Replace provider-specific model state:

```ts
const [claudeModel, setClaudeModel] = ...
const [codexModel, setCodexModel] = ...
```

with:

```ts
const [providerModels, setProviderModels] =
  useState<Record<string, string>>({});
```

Likewise, store effort and permission selections by provider ID:

```ts
type ProviderSelections = Record<
  string,
  {
    model?: string;
    effort?: string;
    permissionMode?: string;
  }
>;
```

### 13.3 Persistence

Use stable generic keys:

```text
provider:<providerId>:model
provider:<providerId>:effort
provider:<providerId>:permissionMode
```

A migration should read legacy keys once:

- `claude-model`
- `codex-model`
- `cursor-model`
- `opencode-model`

and write the new format.

Do not break existing user selections.

### 13.4 Selection UI

The provider selector should render from descriptors:

- label
- icon key
- availability
- authentication state
- runtime health
- optional disabled reason

The UI should not contain a provider-specific branch merely to display a provider.

### 13.5 Provider-Specific Setup

Authentication and setup workflows may still differ.

The descriptor may declare a setup mode:

```ts
type ProviderSetupMode =
  | 'none'
  | 'external-cli'
  | 'oauth'
  | 'api-key'
  | 'custom';
```

A generic modal may cover common cases. Providers with unusual workflows can retain a provider-specific setup panel, selected through a registry-like map.

The goal is to isolate exceptions, not pretend they do not exist.

---

## 14. Capabilities

The existing capability matrix should be retained and expanded as necessary.

Potential capability shape:

```ts
export interface ProviderCapabilities {
  permissionModes: string[];
  defaultPermissionMode: string;

  supportsImages: boolean;
  supportsAbort: boolean;
  supportsPermissionRequests: boolean;
  supportsTokenUsage: boolean;
  supportsEffort: boolean;
  supportsRewind: boolean;
  supportsFork: boolean;

  supportsMcpRead: boolean;
  supportsMcpWrite: boolean;
  supportsSkillDiscovery: boolean;
  supportsSkillInstall: boolean;
  supportsSessionResume: boolean;
  supportsSessionHistory: boolean;
}
```

Avoid adding capabilities pre-emptively. Add them only when they control real application behaviour.

Capabilities should describe user-visible behaviour, not implementation details.

Bad capability:

```ts
usesJsonl: true
```

Good capability:

```ts
supportsSessionHistory: true
```

---

## 15. Session and Message Contract

The current normalized session and message architecture should remain authoritative.

### 15.1 Requirements

- Core code uses CLIde session IDs.
- Provider-native IDs remain behind database mappings and provider adapters.
- Provider events are normalized before reaching React.
- Every event has a stable `kind`.
- Completion and failure are emitted consistently.
- Message IDs remain unique.
- Pagination behaviour remains consistent.
- Provider transcript formats remain provider-owned.
- A provider may use JSONL, SQLite, app-server RPC, or remote storage.

### 15.2 Runtime and History Consistency

The live runtime and history normalizer should produce compatible normalized messages.

A message rendered live should not materially change shape after reloading session history.

Provider contract tests should detect drift between:

- live event normalization
- persisted history normalization

---

## 16. Provider Lifecycle and Health

Provider availability has several separate states:

```ts
type ProviderAvailability = {
  registered: boolean;
  installed: boolean;
  authenticated: boolean;
  runtimeHealthy: boolean;
  selectable: boolean;
  reason?: string;
};
```

These states must not be collapsed into one boolean.

Examples:

- Registered but CLI not installed.
- Installed but not authenticated.
- Authenticated but app server failed to start.
- Available for history import but not live execution.
- Available through SDK fallback but not app server.
- Visible but intentionally disabled by configuration.

The UI should display useful reasons rather than generic failure.

---

## 17. Proposed File Structure

Target structure:

```text
server/modules/providers/
  provider.registry.ts
  provider.routes.ts
  provider.types.ts

  services/
    provider-auth.service.ts
    provider-capabilities.service.ts
    provider-models.service.ts
    provider-runtime.service.ts
    provider-usage.service.ts
    sessions.service.ts
    session-synchronizer.service.ts

  shared/
    base/
      abstract.provider.ts
    runtime/
      provider-runtime.types.ts
      provider-runtime.errors.ts
    mcp/
    skills/

  list/
    claude/
      claude.provider.ts
      claude-runtime.provider.ts
      claude-models.provider.ts
      claude-auth.provider.ts
      claude-mcp.provider.ts
      claude-skills.provider.ts
      claude-sessions.provider.ts
      claude-session-synchronizer.provider.ts
      claude-usage.provider.ts

    codex/
      codex.provider.ts
      codex-runtime.provider.ts
      ...

    cursor/
      cursor.provider.ts
      cursor-runtime.provider.ts
      ...

    opencode/
      opencode.provider.ts
      opencode-runtime.provider.ts
      ...
```

Existing runtime files may remain at their current paths during the adapter phase.

---

## 18. Migration Plan

Each phase should be independently reviewable and mergeable.

### Phase 0: Baseline and Contract Tests

#### Work

- Document current provider behaviour.
- Add tests around existing provider registry.
- Add shared runtime test fixtures.
- Add gateway tests for start, abort, completion, and unsupported providers.
- Record current frontend provider persistence keys.
- Verify all current providers can:
  - start a session
  - resume a session
  - abort a session
  - reload history
  - report capabilities

#### Acceptance Criteria

- Existing tests pass.
- New tests describe current behaviour without changing it.
- No provider behaviour is intentionally altered.

---

### Phase 1: Introduce Runtime Interfaces

#### Work

- Add `IProviderRuntime`.
- Add shared runtime input and result types.
- Add optional `runtime` property to `IProvider`.
- Create runtime adapters for all current providers.
- Adapters call existing runtime functions.

#### Acceptance Criteria

- All providers compile with the new contract.
- Existing runtime implementation functions remain operational.
- No WebSocket routing has changed yet.
- Runtime adapters have focused unit tests.

---

### Phase 2: Registry-Driven Runtime Dispatch

#### Work

- Add `resolveRuntime()` to provider registry.
- Replace WebSocket spawn and abort maps with registry resolution.
- Route external agent API execution through the same service.
- Normalize unsupported-runtime errors.

#### Acceptance Criteria

- Main server no longer imports provider start and abort functions solely to construct dispatch maps.
- WebSocket chat works for all current providers.
- Abort works for all providers that claim support.
- Unsupported or unavailable runtimes return structured errors.
- Existing reconnect and background-run behaviour is preserved.

---

### Phase 3: Lifecycle Consolidation

#### Work

- Add optional lifecycle interface.
- Move provider-specific initialization and shutdown hooks behind registry methods.
- Add runtime health reporting.
- Preserve shared session watcher orchestration where it remains genuinely shared.

#### Acceptance Criteria

- Application startup invokes `providerRegistry.initializeAll()`.
- Application shutdown invokes `providerRegistry.shutdownAll()`.
- One provider failing initialization does not necessarily crash unrelated providers unless configured as fatal.
- Provider health is observable through backend diagnostics.

---

### Phase 4: Provider Catalogue Endpoint

#### Work

- Add `GET /api/providers`.
- Compose descriptors, capabilities, auth state, and runtime availability.
- Define deterministic ordering.
- Add route tests and response schemas.

#### Acceptance Criteria

- Endpoint lists all registered providers.
- Endpoint accurately distinguishes installed, authenticated, and runtime-healthy states.
- Frontend can discover every selectable provider without a compiled provider array.

---

### Phase 5: Frontend Generic Provider State

#### Work

- Load provider catalogue on application startup.
- Replace hardcoded provider arrays.
- Replace per-provider model state with generic records.
- Migrate legacy local-storage keys.
- Render provider selection from descriptors.
- Keep existing provider-specific login flows where necessary.

#### Acceptance Criteria

- Existing users retain saved model and effort selections.
- All current providers remain selectable.
- Adding a backend descriptor causes the provider to appear without editing the selector component.
- The frontend does not branch by provider ID for generic model, effort, permission, image, abort, rewind, or fork controls.
- Provider-specific branches are documented exceptions.

---

### Phase 6: Remove Application-Level Provider Leakage

#### Work

- Audit imports from provider-specific directories outside the provider module.
- Move or wrap remaining Claude, Codex, Cursor, and OpenCode helpers.
- Consolidate context usage and provider diagnostics behind services.
- Remove obsolete dispatch constants and fallback maps.

#### Acceptance Criteria

- Application root does not import provider-native SDKs.
- Application root does not import provider-specific runtime helpers.
- Provider-specific behaviour outside provider folders is limited to explicitly documented UI setup exceptions or compatibility migrations.

---

### Phase 7: Validate with a New Provider Spike

Use a future provider such as Gemini CLI as an architectural validation exercise.

This phase may stop after a non-production proof of concept.

#### Validation Question

Can a fifth provider be added primarily by:

1. creating its provider directory,
2. implementing the shared facets,
3. registering one provider object,
4. adding static icon assets or generic descriptor metadata,
5. avoiding edits to the WebSocket gateway and generic chat state?

#### Acceptance Criteria

- No new provider branch is added to generic runtime dispatch.
- No new provider-specific model state variable is added to React.
- No new provider branch is added for generic capability-controlled UI.
- Any required core edits reveal a missing provider contract concern and are reviewed as architectural feedback.

---

### Phase 8: Optional Provider Packaging

Only begin this after the in-repository provider contract is stable.

Possible future structure:

```text
@clide/provider-claude
@clide/provider-codex
@clide/provider-cursor
@clide/provider-opencode
@clide/provider-gemini
```

Potential loading mechanisms:

- static package imports at build time
- configuration-driven imports
- plugin manifest discovery
- approved provider package directory

Security, compatibility, versioning, and code-loading policy must be designed before enabling arbitrary third-party provider packages.

This phase is not required to achieve the main architectural benefits.

---

## 19. Acceptance Criteria for the Overall Project

The refactor is complete when all of the following are true:

1. Live runs resolve through `IProviderRuntime`.
2. Abort resolves through `IProviderRuntime`.
3. The WebSocket gateway has no provider-specific run map.
4. The external agent API has no separate provider dispatch implementation.
5. The backend registry is the canonical provider catalogue.
6. The frontend loads selectable providers from the backend.
7. Frontend model, effort, and permission state are keyed by provider ID.
8. Existing user selections survive migration.
9. Provider capabilities control generic UI.
10. Provider-native IDs remain hidden behind provider and database boundaries.
11. Existing Claude, Codex, Cursor, and OpenCode sessions continue working.
12. Session history remains compatible with live events.
13. Startup and shutdown lifecycle behaviour is registry-driven.
14. Provider-specific imports in application root files are removed or justified.
15. Contract tests cover every registered provider.
16. A fifth-provider spike does not require modifying generic gateway dispatch.

---

## 20. Testing Strategy

### 20.1 Contract Tests

Run the same test suite against every provider implementation.

Suggested contract tests:

- descriptor ID matches registry key
- model catalogue has a valid default
- auth status does not throw for normal unauthenticated state
- capabilities match implemented runtime methods
- unsupported features return stable results
- message normalization emits valid kinds
- normalized message IDs are unique
- pagination semantics are consistent
- session synchronization tolerates malformed artifacts
- runtime completion occurs exactly once
- abort does not emit duplicate completion
- provider session mapping is persisted
- live and history message shapes remain compatible

### 20.2 Gateway Tests

Test:

- start run
- subscribe
- replay
- reconnect
- background session completion
- abort
- unsupported provider
- provider unavailable
- provider failure before native session creation
- provider failure after native session creation
- interactive permission response
- session fork
- rewind where supported

### 20.3 Frontend Tests

Test:

- catalogue loading
- unavailable provider rendering
- authentication state rendering
- generic provider selection
- model state keyed by provider
- legacy storage migration
- capability-controlled controls
- provider catalogue refresh
- selected provider disappearing or becoming unavailable

### 20.4 Integration Tests

At minimum, run smoke tests for:

- Claude Code
- Codex
- Cursor
- OpenCode

Where CI cannot authenticate real providers, use adapter fakes and retain a documented manual verification checklist.

---

## 21. Error Handling

Use structured errors with stable codes.

Suggested runtime errors:

```text
UNSUPPORTED_PROVIDER
PROVIDER_RUNTIME_UNAVAILABLE
PROVIDER_NOT_INSTALLED
PROVIDER_NOT_AUTHENTICATED
PROVIDER_INITIALIZATION_FAILED
PROVIDER_RUN_FAILED
PROVIDER_ABORT_UNSUPPORTED
PROVIDER_ABORT_FAILED
PROVIDER_SESSION_NOT_FOUND
PROVIDER_FEATURE_UNSUPPORTED
```

Core transports should not parse provider-native error strings to determine behaviour.

Provider adapters should translate native failures into application errors.

Do not expose credentials, raw environment variables, or sensitive command arguments in client-facing errors.

---

## 22. Compatibility and Migration Risks

### 22.1 Duplicate Completion Events

Existing provider runtimes may already emit completion while the gateway also emits terminal state.

The runtime contract must define exactly which layer owns final completion.

Recommended rule:

> Provider runtime emits normalized terminal events. Gateway records and forwards them but does not synthesize a second terminal event unless the provider fails without emitting one.

### 22.2 Abort Identity

Some providers abort by CLIde session ID, others by provider-native session ID, process ID, thread ID, or run ID.

The runtime input must explicitly include the identifiers available. Do not overload one string with multiple identity meanings.

### 22.3 Dynamic Capabilities

Codex capabilities may differ depending on whether app-server transport is available.

Descriptors and capabilities may need refresh support.

### 22.4 Frontend Offline Fallbacks

Removing all fallback data immediately could make first paint fragile.

A minimal generated fallback may remain, but it must not become a second source of truth.

### 22.5 Provider Registration Type Safety

Moving entirely to arbitrary runtime strings weakens compile-time checks.

Recommended compromise:

- Keep a shared union for built-in providers.
- Treat API-facing provider IDs as validated strings.
- Generate or derive frontend types where practical.
- Do not block eventual plugin IDs on a permanently closed union.

### 22.6 Upstream Divergence

CLIde is a fork of a fast-moving upstream project.

Large file moves increase merge conflicts.

Prefer:

- adapter additions
- narrow interfaces
- small commits
- minimal runtime relocation
- compatibility wrappers

---

## 23. Rollback Strategy

Each migration phase should be reversible.

- Runtime adapters initially wrap existing functions.
- Gateway dispatch can retain a temporary compatibility flag during development.
- Frontend local-storage migration should be additive and preserve old keys for one release if necessary.
- Provider catalogue loading may temporarily fall back to the current built-in list during migration.
- Avoid database schema changes unless required.
- Do not delete old paths until all callers and tests are migrated.

---

## 24. Performance Considerations

The provider catalogue endpoint should not perform expensive session scans.

Recommended behaviour:

- Provider descriptors: static in memory.
- Capability data: static or lightweight runtime diagnostics.
- Installation/auth status: cached briefly where appropriate.
- Model catalogues: continue using provider model cache rules.
- Usage data: keep separate because it may be slow or rate-limited.
- Session indexing: remain asynchronous and outside catalogue requests.

Do not make application startup wait indefinitely for every provider.

---

## 25. Security Considerations

- Provider runtimes execute commands and modify files.
- Registry-driven execution must not bypass existing workspace validation.
- Provider IDs from HTTP or WebSocket input must be validated.
- Runtime adapters must not accept arbitrary executable paths without existing security controls.
- Provider lifecycle hooks must not start untrusted packages.
- Future dynamic provider loading requires an explicit trust model.
- Provider errors must redact tokens and credentials.
- Permission capabilities must reflect actual enforcement, not only UI presentation.

---

## 26. Documentation Requirements

Update:

- provider module guide
- provider contract interfaces
- API documentation
- architecture documentation
- provider addition checklist
- runtime lifecycle documentation
- testing checklist
- frontend provider descriptor documentation

The provider guide must be generated from or manually kept consistent with the actual required facets.

The current discrepancy where documentation describes fewer facets than the interface should be corrected.

---

## 27. Codex Implementation Guidance

When implementing this spec:

1. Inspect current code before editing; upstream may have changed.
2. Treat this document as architectural intent, not a demand to preserve obsolete file names.
3. Do not perform a broad rewrite.
4. Preserve current behaviour before improving organization.
5. Work in small, reviewable phases.
6. Add or update tests in the same change as each contract migration.
7. Prefer wrapping existing runtime functions before moving them.
8. Do not introduce provider-specific branches into generic gateway or frontend state.
9. When a provider requires an exception, document why a capability or interface cannot represent it.
10. Stop and report if current upstream architecture already satisfies a phase.
11. Avoid speculative abstractions for providers that do not exist.
12. Do not begin dynamic package loading during the runtime consolidation.
13. Preserve legacy session compatibility and user settings.
14. Verify Claude, Codex, Cursor, and OpenCode independently.
15. Record any files that still require edits when adding a fifth provider; use that list to identify missing abstraction boundaries.

---

## 28. Suggested First Codex Task

The safest first task is not the whole project.

Use this scoped task:

> Inspect the current CLIde provider and WebSocket runtime architecture. Introduce an `IProviderRuntime` contract and provider runtime adapter classes for Claude, Codex, Cursor, and OpenCode. Each adapter must wrap the existing start and abort functions without moving their implementations or changing gateway dispatch yet. Add focused unit tests and update the provider module guide. Do not modify frontend behaviour, session storage, or public APIs.

Expected output:

- runtime interface
- shared runtime types
- four runtime adapters
- provider wrappers exposing `runtime`
- contract tests
- updated documentation
- no functional behaviour change

After reviewing that change, proceed to registry-driven gateway dispatch as a separate task.

---

## 29. Final Architectural Position

CLIde should not attempt to erase the differences between coding-agent runtimes.

It should establish a stable boundary:

```text
CLIde Core
  - projects
  - files
  - Git
  - terminal
  - database
  - stable session IDs
  - normalized messages
  - WebSocket gateway
  - provider catalogue
  - generic UI

Provider Adapter
  - native SDK, CLI, or app-server connection
  - authentication
  - model catalogue
  - permissions
  - start, resume, abort
  - native session IDs
  - event normalization
  - transcript indexing
  - MCP format
  - skill format
  - usage reporting
  - lifecycle
```

The current codebase already implements much of this boundary.

The highest-value remaining work is:

1. move live runtime execution behind the provider contract;
2. make provider discovery backend-driven in the frontend.

Those two changes should be completed before considering a larger provider plugin ecosystem.

---

## 30. Repository-Local Re-Audit Addendum

**Audit date:** July 29, 2026  
**Audited revision:** `e09e9ed028cadb9d326fd1bb9b7f1a8237082e9e` on `main`  
**Audit location:** `/home/gnuthall/Projects/cloudcli`  
**Purpose:** Verify the substantive claims in this spec from inside the actual
checkout, including ignored/local architectural guidance, current ADRs, tests,
runtime state boundaries, and provider-specific integration surfaces that were
not visible during the original outside-repository investigation.

This addendum does not discard the original direction. The two central findings
remain valid:

1. live provider dispatch is not yet owned by the provider registry; and
2. the frontend still carries a hardcoded provider catalogue and
   provider-specific state branches.

The audit did, however, find that the proposed runtime boundary is too broad in
some places, too narrow in others, and occasionally duplicates abstractions that
already work. The implementation phases and first task should therefore be
revised before work begins.

### 30.1 Audit Method

The re-audit traced the following current paths rather than relying only on
file-name searches:

- `IProvider`, its required and optional facets, and the static provider
  registry;
- WebSocket Chat start, resume, abort, permission-response, replay, and
  completion paths;
- stable application session ID to provider-native session ID mapping;
- session rewind and fork behavior;
- the external `/api/agent` execution path;
- Shell provider launch and resume behavior;
- provider transcript watchers and synchronizers;
- model, capability, usage, and context-usage routes;
- frontend provider selection, model, effort, permission, authentication,
  settings, MCP, skills, icon, and notification surfaces;
- current ADRs and related provider/permission design specs; and
- focused provider and WebSocket tests.

No production service was restarted, no user session or database was modified,
and no implementation code was changed during the audit.

### 30.2 Claims Confirmed

The following original findings are confirmed:

- `IProvider` and `providerRegistry` form a useful backend abstraction for
  models, authentication, MCP, skills, sessions, synchronization, and optional
  account usage.
- Live Chat execution is still selected through application-level
  `spawnFns`/`abortFns` maps in `server/index.js`.
- The external agent route has its own provider validation and dispatch
  branches.
- The frontend has a closed provider union, a hardcoded provider array,
  provider-specific model state, fallback model catalogues, and provider-aware
  selection branches.
- Provider labels, ordering, capabilities, and setup information are repeated
  across backend and frontend surfaces.
- There is no general `GET /api/providers` catalogue. The existing
  `/api/providers/capabilities` route is a natural migration point.
- Provider module documentation is already inconsistent with the interface:
  the guide says there are five facets, while the interface has six required
  facets plus optional usage.
- Baseline contract, gateway, and frontend tests are needed before changing
  dispatch ownership.

### 30.3 Existing Provider-Neutral Runtime Core

The statement that live execution sits outside `IProvider` is correct, but it
must not be read as meaning that CLIde lacks a provider-neutral runtime core.

`chatRunRegistry` and `ChatSessionWriter` already own important cross-provider
invariants:

- stable application-session keyed run state;
- an `AbortController` created before provider execution starts;
- application ID to provider-native ID mapping;
- normalized event writing;
- sequence numbers and run IDs used for reconnect replay;
- exactly one terminal completion event;
- suppression of events after terminal completion; and
- canonical session upsert broadcasting.

The runtime facet should wrap provider-native execution while retaining these
gateway-owned mechanisms. Reimplementing run ownership or completion inside
each adapter would increase the risk of duplicate completions, lost replay
state, and inconsistent session identity.

**Revised boundary:** the gateway owns the run; the adapter owns the native
provider invocation.

### 30.4 Abort Contract Correction

The proposed `abortRun({ providerSessionId })` contract is not sufficient as the
primary cancellation mechanism.

ADR 0013 establishes a signal-first design:

1. the gateway creates an `AbortController` when the run starts;
2. `beginAbort` trips the signal synchronously;
3. the provider-native ID interrupt is attempted as a graceful secondary tier
   when an ID is available; and
4. absence of a provider-native ID must not make abort fail.

This matters most for new sessions because a provider-native ID may not be
announced until after streaming begins. At audit time only Claude fully honors
the shared signal; Cursor, Codex, and OpenCode retain provider-specific or
ID-keyed behavior and should opt in by forwarding the signal into their native
runtimes.

A safer shape is:

```ts
export interface ProviderInteractiveRunContext {
  signal: AbortSignal;
  writer: ProviderRunWriter;
  appSessionId: string;
}

export interface IProviderRuntime {
  startInteractiveRun(
    input: ProviderInteractiveRunInput,
    context: ProviderInteractiveRunContext,
  ): Promise<void>;

  interruptRun?(
    input: ProviderInterruptInput,
  ): Promise<ProviderInterruptResult>;
}
```

`interruptRun` is the graceful provider-native tier. It does not replace the
gateway signal or gateway-owned terminal completion.

### 30.5 Fork, Rewind, and Permission Response Ownership

Three operations listed for migration into `IProviderRuntime` already have, or
need, different ownership:

#### Fork

Fork is already registry-driven through
`providerRegistry.resolveProvider(provider).sessions.forkSession`. It creates
the provider-native child first and then establishes the new stable CLIde
session row. Moving it to the runtime facet would duplicate the existing
session contract.

**Decision for implementation:** keep fork under `IProviderSessions`.

#### Rewind

Rewind is normally a structured option on the next Chat send. Claude and Codex
can replace the provider-native session ID after a rewind while retaining the
same CLIde session ID. Defining both `rewindToMessageId` in the run input and a
separate `rewindSession()` runtime method creates two competing control paths.

**Decision for implementation:** preserve rewind as run input unless a provider
demonstrates a rewind operation that must occur independently of a turn. Any
exception should be documented explicitly.

#### Permission Response

Interactive request responses already resolve through the shared
`interactiveRequestRegistry`. Provider transports register their own resolver
callbacks when they expose a pending request.

**Decision for implementation:** keep response resolution centralized. Add a
runtime-specific response method only if a provider cannot participate in the
shared registry.

### 30.6 Interactive Runs and Background Jobs Are Different Facets

The original requirement for one authoritative live execution path shared by
WebSocket Chat and `/api/agent` is too broad.

The external agent route is intentionally different from interactive Chat:

- it is non-interactive and uses permission-bypass defaults;
- it supports SSE and collected JSON responses;
- it can clone repositories, create branches, commit, push, and open pull
  requests;
- it does not create or resume the same application-session run state;
- Codex uses `queryCodexJob`, not the interactive App Server Chat transport; and
- it exposes provider-native session IDs in its current response protocol.

Commit-message generation is another one-shot provider execution path with a
different persistence and interaction policy.

The registry can still become the source of dispatch, but it should distinguish
interactive runs from ephemeral/background jobs:

```ts
export interface IProvider {
  descriptor: IProviderDescriptor;
  runtime: IProviderRuntime;
  jobs?: IProviderJobs;
  // Existing facets remain.
}
```

`IProviderJobs` should carry explicit invocation policy such as interactive
versus non-interactive, ephemeral versus persistent, permission behavior, and
whether a CLIde session should be created. It must not silently route a
non-interactive job through a stateful Chat transport.

### 30.7 Provider-Native IDs Are Not Fully Hidden

The original desired invariant remains valuable, but it is not an accurate
description of current behavior.

Current canonical session-upsert events include a top-level
`providerSessionId`, and `useProjectsState` uses it as a compatibility alias
when reconciling database rows and selected sessions. The external agent API
also emits a provider-native `session-id`.

Implementation must therefore choose one of two explicit outcomes:

1. retain and document the provider-native compatibility alias at selected
   protocol boundaries; or
2. migrate those consumers to backend-only mapping before claiming that native
   IDs are hidden.

Native IDs must still never become the primary identity of a CLIde session.

### 30.8 Static Descriptor Versus Dynamic Availability

`runtimeAvailable: boolean` conflates static product metadata with live runtime
health.

For example, Codex may be configured for App Server, have its binary and
capabilities discoverable, remain idle before first use, start lazily, degrade
to fallback behavior, or become unavailable after a child-process failure.
A single static boolean cannot represent those states.

The provider catalogue should separate:

- static descriptor data: ID, label, order, setup mode, icon key, and declared
  feature support;
- configuration state: installed, authenticated, or requiring setup;
- dynamic runtime state: `unknown`, `idle`, `starting`, `ready`, `degraded`, or
  `unavailable`; and
- transport-specific effective capabilities when different transports have
  different fidelity.

Dynamic fields should be optional or independently refreshable so listing
providers does not eagerly start every provider.

### 30.9 Lifecycle Must Preserve Lazy Startup

The proposed unconditional `providerRegistry.initializeAll()` call must not
mean eagerly launching all provider runtimes.

Codex currently starts its shared App Server lazily on first use. Eager startup
would consume resources, increase startup latency, and create failures for
providers the user never selected.

Lifecycle should support:

- lightweight registration with no child process;
- optional lazy `prepare()` or initialization on first use;
- idempotent health/configuration probes;
- explicit `shutdown()` for provider-owned processes and resources; and
- cleanup integrated into the real server shutdown path.

The audit also found cleanup worth addressing independently: provider watchers
and the shared Codex App Server do not yet have a complete, consistently invoked
production shutdown path. Lifecycle consolidation should test shutdown, not
only initialization.

### 30.10 Capability-Driven UI Is Only Partial

The backend capability matrix is useful, but the statement that current UI
behavior is capability-driven is only partly true.

At audit time:

- permission-mode choices, effort, rewind, and fork consume capability data;
- `supportsImages`, `supportsAbort`, `supportsPermissionRequests`, and
  `supportsTokenUsage` are not consistently used to gate the corresponding
  generic UI;
- the image button is not generally hidden based on provider capability;
- interrupt visibility is derived primarily from current processing state; and
- Cursor advertises permission modes that its runtime does not actually read.

Phase 0 should add a capability conformance inventory:

1. where each capability is declared;
2. which runtime behavior proves it;
3. which UI behavior consumes it; and
4. what happens when it is false or dynamically unavailable.

Unsupported behavior should be hidden, disabled with an explanation, or handled
as a clean no-op. A declared capability must not be cosmetic.

### 30.11 Frontend State Needs Provider Defaults and Session State

Replacing four provider-specific state variables with
`Record<providerId, value>` is useful for defaults, but it cannot represent all
current state.

ADR 0003 establishes that active model is tracked per session and that the
transcript is ground truth for what actually ran. The client selection is only
a seed for new sessions and a display cache. Permission choices also have both
provider-default and session-specific persistence today.

The generic frontend design should distinguish:

```ts
type ProviderDefaults = Record<string, {
  model?: string;
  effort?: string;
  accessPreset?: string;
}>;

type SessionProviderState = Record<string, {
  requestedModel?: string;
  effectiveModel?: string;
  requestedEffort?: string;
  effectiveEffort?: string;
  requestedAccessPolicy?: AgentAccessPolicy;
  effectiveAccessPolicy?: AgentAccessPolicy;
}>;
```

The exact types may change, but these concepts must remain separate:

- default for a new session;
- requested setting for a particular CLIde session; and
- effective setting confirmed by the provider or transcript.

Generic provider-keyed local-storage entries must not replace per-session truth.

### 30.12 Permission Modes Need a Structured Contract

`permissionMode?: string` and `permissionModes: string[]` are not a sufficient
provider-neutral abstraction.

The repository's permission-mode mapping investigation found that collaboration
intent, filesystem boundary, network access, approval behavior, automated
review, and user prompting are independent controls. Codex in particular can
express sandbox, approval, reviewer, and collaboration settings separately.
Other providers may only approximate the same intent.

The consolidation should build on a structured `AgentAccessPolicy` or
provider-neutral preset descriptor. Each advertised preset needs:

- stable provider-neutral intent;
- native mapping and effective settings;
- risk level;
- exact versus approximate mapping;
- active-transport limitations;
- supported interactive request/decision types; and
- whether it changes one session or persistent provider configuration.

Plan mode must remain separate from access policy. An adapter must not silently
map an unsupported intent to broader access.

### 30.13 Workspace Trust Boundary Needs Explicit Tightening

The security section says runtime migration must not bypass existing workspace
validation. The audit found that this is not strong enough as a statement of
current behavior.

The Chat gateway currently builds runtime options using
`clientOptions.cwd ?? session.project_path`, allowing the client-supplied path
to take precedence over the database-owned session path. Session creation also
does not consistently apply the same workspace validation used by dedicated
filesystem routes.

Runtime consolidation should explicitly require:

- the server resolves the trusted project path from the application session;
- any client-supplied path is ignored or validated against that session;
- provider adapters receive the resolved path rather than raw client input; and
- tests prove a client cannot redirect a run outside its authorized workspace.

This is a migration requirement, not merely a behavior-preservation
requirement.

### 30.14 Additional Provider Catalogues and Integration Surfaces

The original scan did not enumerate every place that must change for a fifth
provider. In addition to runtime dispatch and frontend selection, current
provider knowledge appears in:

- Shell CLI launch, resume syntax, display names, and login/setup commands;
- session watcher roots, file layouts, and file-type branches;
- session synchronizer result initialization;
- transcript token/context extraction for Claude JSONL, Codex JSONL, Cursor
  storage, and OpenCode SQLite;
- the Claude-specific context-refresh route;
- external agent provider validation and dispatch;
- commit-message generation;
- provider route parsers;
- notification label maps;
- command-route provider lists and labels;
- authentication types and endpoints;
- Settings provider lists;
- MCP provider names, scopes, transports, and form fields;
- skill provider names and native paths;
- provider icon resolution;
- translations and provider-ready prompts; and
- public API documentation.

Not every surface must become a required facet. The contract should instead
make optional integration areas explicit and define clean behavior when a
provider does not support one.

At minimum, the fifth-provider spike must record whether it supports:

- interactive Chat;
- background/ephemeral jobs;
- native Shell launch and resume;
- session history and filesystem watching;
- context usage and account-plan usage;
- MCP and skills;
- setup/authentication UI;
- permissions and interactive requests; and
- icons, labels, notifications, and documentation.

If the goal remains literally “adapter plus one registration,” descriptor or
optional facets must cover all required surfaces. Otherwise the promise should
be narrowed to “adapter plus one registration enables interactive Chat,” with
the optional integrations documented separately.

### 30.15 Contract Details Still Required Before Implementation

The original interface sketches are intentionally conceptual and currently
reference undefined types such as `ProviderRunHandle`,
`ProviderAbortInput`, and fork/rewind result types. Before Phase 1, decide:

- whether adapters return an async iterable or write through a normalized
  writer;
- who owns completion and error translation;
- how the adapter announces or replaces a provider-native session ID;
- how `signal`, app session ID, user ID, tool settings, session summary,
  persistence policy, and transport metadata are represented;
- whether background jobs use the same event shape;
- how duplicate provider registration is rejected;
- how deterministic display order is defined; and
- whether dynamic capability changes are pushed or polled.

The current writer model is already integrated with run replay and identity
mapping, so wrapping it is lower risk than inventing an independent event
stream during the first phase.

Avoid using an unrestricted `metadata: Record<string, unknown>` as the permanent
home for all provider differences. It can be a migration bridge, but required
cross-provider inputs should become typed fields and provider-native options
should remain owned by the adapter.

### 30.16 File-Move Scope

Moving the existing interfaces into new files is not necessary to prove the
runtime abstraction and may increase conflicts with upstream changes.

The first phase should add the smallest coherent types alongside the current
interface structure. File reorganization can follow once the contract is
exercised by all four providers and the gateway tests pass.

### 30.17 Test Evidence and Baseline Drift

The audit ran:

```bash
./node_modules/.bin/tsx --tsconfig server/tsconfig.json --test \
  server/modules/providers/tests/*.test.ts \
  server/modules/websocket/tests/*.test.ts
```

Result:

```text
tests: 181
passed: 180
failed: 1
```

The failure was:

```text
supportsRewind capability
  is enabled only for claude
```

The test expects Codex rewind to be false, while current default Codex App
Server capabilities make it true. This is baseline drift rather than a change
introduced by the audit.

Related documentation drift also exists: ADR 0011 describes App Server Chat as
opt-in, while current code and backlog state describe it as the default unless
the SDK transport is selected explicitly. ADRs are append-only, so a future
implementation should consider a superseding ADR rather than rewriting ADR
0011.

Phase 0 must therefore:

1. reconcile the Codex transport/capability test with current intended behavior;
2. document known baseline failures before migration;
3. add registry contract tests;
4. add gateway tests for start, early abort before provider ID assignment,
   graceful interrupt, unavailable runtime, and exactly-once completion;
5. add capability conformance tests; and
6. establish a frontend test strategy, because the current frontend does not
   have equivalent coverage for provider catalogue migration.

### 30.18 Revised Migration Priorities

The original phases remain a useful sequence with these corrections:

#### Revised Phase 0

- Reconcile current test and ADR drift.
- Freeze the existing run-registry and writer invariants in tests.
- Inventory all provider catalogues and optional integration surfaces.
- Add capability declaration-to-runtime-to-UI conformance coverage.

#### Revised Phase 1

- Add only the interactive runtime boundary.
- Pass the gateway-owned signal and writer into adapters.
- Wrap existing provider functions without moving their implementations.
- Keep fork and permission-response ownership where they are.

#### Revised Phase 2

- Replace `spawnFns` and graceful interrupt maps with registry lookup.
- Keep `chatRunRegistry` as the run owner.
- Verify early abort, replay, ID replacement, and exactly-once completion for
  every provider.

#### Revised Phase 3

- Add lazy lifecycle and real shutdown cleanup.
- Separate static catalogue data from dynamic configuration and health.

#### Revised Phase 4

- Expand the existing capabilities route or add `GET /api/providers`.
- Give the catalogue explicit ordering and setup metadata.
- Do not start provider child processes merely to list the catalogue.

#### Revised Phase 5

- Replace frontend provider arrays and provider-specific defaults.
- Preserve per-session requested/effective model and access state.
- Make capability consumption real rather than cosmetic.

#### Revised Phase 6

- Decide which optional surfaces become facets: jobs, Shell, watcher discovery,
  context usage, setup/auth commands, and display metadata.
- Remove application-level provider branches only after ownership is defined.

#### Revised Phase 7

- Run a fifth-provider spike against both the interactive boundary and the
  optional-surface checklist.
- Record every required edit outside the new provider directory and registry.
- Use that evidence to decide whether “one registration everywhere” is
  realistic or should be narrowed.

### 30.19 Revised First Implementation Task

The task in Section 28 should not be used verbatim. In particular, an adapter
must not make provider-session-ID abort the primary cancellation contract, and
it should not absorb fork or shared permission-response behavior.

A safer first task is:

> Inspect the current CLIde provider, WebSocket, run-registry, and writer
> architecture. Reconcile the known Codex rewind capability baseline failure.
> Add focused tests that freeze gateway-owned abort signaling, exactly-once
> completion, event replay, and application/provider session ID mapping. Then
> introduce the smallest `IProviderRuntime` contract needed to wrap interactive
> start/resume execution for Claude, Codex, Cursor, and OpenCode. Pass the
> gateway-owned `AbortSignal` and normalized writer into each adapter. Preserve
> provider-native interrupt as an optional graceful tier. Do not move fork,
> shared interactive-request resolution, frontend behavior, session storage,
> external agent jobs, or public APIs in this task.

Expected output:

- reconciled baseline capability test or a documented reason it remains failing;
- run-registry/gateway invariant tests;
- typed interactive run input and context;
- runtime interface with signal-first cancellation semantics;
- four thin runtime adapters wrapping existing execution functions;
- provider wrappers exposing `runtime`;
- provider registry contract tests;
- updated provider module documentation; and
- no intended functional behavior change.

### 30.20 Revised Architectural Position

The repository-local audit supports a more precise boundary:

```text
CLIde Gateway/Core
  - stable application session identity
  - trusted workspace resolution
  - run registry and AbortController
  - event sequencing and replay
  - normalized writer
  - exactly-once completion
  - shared interactive request registry
  - database and public protocol

Provider Interactive Runtime
  - native SDK, CLI, or app-server invocation
  - native start and resume options
  - native event translation
  - provider-native session ID announcement/replacement
  - signal forwarding
  - optional graceful native interrupt

Existing and Optional Provider Facets
  - models, auth, MCP, skills
  - sessions, fork, synchronization
  - account usage and context usage
  - background/ephemeral jobs
  - Shell launch/resume
  - watcher discovery
  - setup and display metadata
  - lazy lifecycle and health
```

The highest-value first change remains moving interactive execution lookup
behind the registry. The success criterion is not merely removing a dispatch
map: it is doing so without weakening the run-registry invariants, per-session
state, workspace trust boundary, permission semantics, or the deliberate
difference between interactive Chat and background jobs.

---

## 31. Provider-Native Runtime Resolution Addendum

**Recorded:** July 29, 2026  
**Status:** Proposed; implementation deferred to a later session  
**Audited revision:** `e09e9ed028cadb9d326fd1bb9b7f1a8237082e9e` on `main`  
**Purpose:** Extend the consolidation boundary so CLIde consistently uses the
user-selected standalone provider installation for native execution and model
discovery instead of allowing Chat, Shell, jobs, usage, and authentication to
resolve different executable copies.

### 31.1 Motivation

Section 30 establishes the correct ownership boundary between CLIde's gateway
and provider-native execution, but it does not define how a provider-native
runtime is found or selected.

That omission preserves a confusing current split:

- Claude Chat uses CLIde's installed Agent SDK library while explicitly
  launching the standalone `claude` executable from the server environment.
- Claude Shell also launches standalone `claude`.
- Codex Chat and account usage explicitly launch the CLI bundled under
  CLIde's `@openai/codex-sdk` dependency.
- Codex SDK fallback and non-interactive jobs instantiate the TypeScript SDK
  without an executable override, so it also resolves the bundled Codex CLI.
- Codex Shell and installation detection launch standalone `codex` from
  `PATH`.
- Cursor and OpenCode already use their standalone CLI commands for live
  execution and model listing.

The result is that a provider may be reported as installed because one
standalone CLI is available while CLIde Chat actually runs a different bundled
version. Shared home-directory state makes the copies appear related, but it
does not make them the same executable or protocol version.

The desired rule is:

> A provider adapter resolves one native installation and uses it consistently
> for Chat, jobs, model discovery, usage, authentication probes, and Shell
> unless a documented provider limitation requires a visible exception.

### 31.2 Terminology Correction

The terms SDK, CLI, and App Server must remain distinct:

- An **adapter library** is application code imported by CLIde, such as
  `@anthropic-ai/claude-agent-sdk` or `@openai/codex-sdk`.
- A **native runtime executable** is the provider program installed on the host,
  such as `claude`, `codex`, `cursor-agent`, or `opencode`.
- A **native runtime surface** is a mode exposed by that executable, such as
  interactive CLI, non-interactive execution, or `codex app-server`.
- An **App Server** is not a separate Codex installation. It is a server mode
  of the selected Codex executable.

There is no general requirement that an SDK be installed globally or discovered
on `PATH`. TypeScript SDKs are libraries linked into CLIde. The externalization
goal applies first to the provider-native executable that those libraries
control.

Removing an adapter library is a separate later decision:

- Codex could eventually drop its TypeScript SDK dependency because CLIde
  already owns an App Server client and could implement jobs through a
  job-owned App Server or direct non-interactive command.
- Removing the Claude Agent SDK would require replacing a much larger
  remote-control protocol and is not necessary to use standalone Claude Code.

### 31.3 Current Runtime Snapshot

The following snapshot was observed on the audited Raspberry Pi and is
time-specific:

| Provider surface | Resolved runtime |
|---|---|
| Claude Chat | Agent SDK `0.3.165` controlling standalone Claude Code `2.1.220` |
| Claude Shell | Standalone Claude Code `2.1.220` |
| Claude SDK-bundled executable | Claude Code `2.1.165`; installed but not selected by normal Chat |
| Codex Chat/App Server | CLIde-bundled Codex `0.146.0` |
| Codex SDK jobs/fallback | CLIde-bundled Codex `0.146.0` |
| Codex Shell | Standalone Codex `0.146.0` |
| Cursor | No standalone installation detected |
| OpenCode | No standalone installation detected |

The bundled and standalone Codex versions happen to match in this snapshot.
That makes it a useful migration baseline, but implementation must re-read all
paths and versions rather than relying on these values.

### 31.4 New Provider Facet

Add a provider-owned native-runtime facet separate from the interactive-run
facet:

```ts
export interface IProvider {
  readonly id: LLMProvider;
  readonly descriptor: IProviderDescriptor;

  readonly nativeRuntime: IProviderNativeRuntime;
  readonly runtime?: IProviderRuntime;
  readonly jobs?: IProviderJobs;

  readonly models: IProviderModels;
  readonly auth: IProviderAuth;
  readonly sessions: IProviderSessions;
  // Existing optional facets remain.
}
```

Suggested foundational types:

```ts
export type ProviderRuntimePurpose =
  | 'interactive-chat'
  | 'background-job'
  | 'model-discovery'
  | 'account-usage'
  | 'authentication'
  | 'shell';

export type ProviderRuntimeSource =
  | 'configured'
  | 'path'
  | 'known-location'
  | 'bundled';

export type ProviderRuntimeCompatibilityState =
  | 'supported'
  | 'untested'
  | 'degraded'
  | 'incompatible';

export interface ProviderRuntimeInstallation {
  installationId: string;
  provider: string;
  source: ProviderRuntimeSource;
  executablePath: string;
  executableRealPath?: string;
  version?: string;
  configRoot?: string;
  surfaces: {
    interactiveCli: boolean;
    nonInteractive: boolean;
    appServer: boolean;
    modelDiscovery: boolean;
  };
}

export interface ProviderRuntimeCompatibility {
  state: ProviderRuntimeCompatibilityState;
  version?: string;
  testedVersions?: string[];
  missingRequiredCapabilities?: string[];
  unavailableOptionalCapabilities?: string[];
  message?: string;
}

export interface IProviderNativeRuntime {
  detectInstallations(): Promise<ProviderRuntimeInstallation[]>;

  resolveInstallation(
    purpose: ProviderRuntimePurpose,
  ): Promise<ProviderRuntimeInstallation>;

  probeCompatibility(
    installation: ProviderRuntimeInstallation,
    purpose: ProviderRuntimePurpose,
  ): Promise<ProviderRuntimeCompatibility>;
}
```

The exact names may change, but runtime installation resolution must not be
folded into the interactive run input or an unrestricted metadata record.

### 31.5 Resolution Policy

Use a deterministic resolution order:

1. a trusted server-side configured executable path;
2. the executable visible on the CLIde service's effective `PATH`;
3. documented provider installer locations appropriate to the platform;
4. an explicitly enabled bundled fallback, if the CLIde distribution provides
   one.

Rules:

- Standalone/external is the intended default.
- A bundled runtime must never be selected silently after an external runtime
  was detected or configured.
- If fallback occurs, diagnostics and provider availability must report the
  configured and actual source separately.
- Browser or public API requests must not supply arbitrary executable paths.
- Configured paths must be normalized and resolved server-side.
- Resolution must record both the invoked path and real path so symlink-based
  installers can be diagnosed.
- Shell commands must use the same resolved installation as Chat by default.
- An exception may select a different installation only when the provider
  documents why and exposes that mismatch in diagnostics.
- Installation detection must use the production service environment, not
  assume that an interactive SSH shell has the same `PATH`.

The default policy should be external-required once migration is complete.
During the compatibility migration, current bundled behavior may remain
available behind an explicit server setting.

### 31.6 One Installation Across Provider Facets

The resolved installation should feed every provider facet:

```text
Provider native-runtime resolver
          |
          +-- installation/authentication status
          +-- model discovery
          +-- interactive Chat
          +-- background and ephemeral jobs
          +-- account usage
          +-- Shell launch/resume
          +-- version and compatibility diagnostics
```

Provider code must not independently call a bare command name after the resolver
is introduced. A contract test should fail if auth resolves one installation
while Chat, models, jobs, usage, or Shell resolves another without a documented
exception.

The provider catalogue should expose a sanitized runtime summary:

```ts
type ProviderRuntimeSummary = {
  source: ProviderRuntimeSource;
  version?: string;
  displayPath?: string;
  compatibility: ProviderRuntimeCompatibilityState;
  state: 'unknown' | 'idle' | 'starting' | 'ready' | 'degraded' | 'unavailable';
  updatePending?: boolean;
};
```

Do not expose credentials, raw environment values, or unsafe command arguments.

### 31.7 Model Discovery Must Follow the Selected Runtime

The model catalogue must describe what the selected native runtime can actually
run.

#### Codex

Prefer the selected external App Server's `model/list` response over directly
parsing `~/.codex/models_cache.json`. The native response includes picker
visibility, default status, reasoning-effort choices, input modalities, upgrade
metadata, and other capabilities.

The filesystem cache may remain a bounded fallback when App Server is
temporarily unavailable, but the response must label its source and age. It
must not be presented as a confirmed live catalogue.

#### Claude

Re-evaluate the Agent SDK's `supportedModels()` control request using:

- the resolved standalone Claude executable;
- `persistSession: false`;
- a neutral or explicit working directory;
- no CLIde session creation;
- no session-watcher-visible transcript; and
- a timeout and cleanup path.

The earlier native probe was disabled because it created a separate transcript
and polluted project/session discovery. It may only replace the fallback table
after an artifact-level test proves that the current SDK/CLI pair performs the
probe without a phantom session.

#### Cursor and OpenCode

Retain their native model commands but obtain the executable through the
resolver:

- `cursor-agent --list-models`
- `opencode models --verbose`

#### Frontend behavior

Do not eagerly start every provider runtime to render the provider catalogue.
Provider descriptors and installation state should load independently. Fetch
models lazily for the selected or expanded provider, then cache the normalized
result according to provider-owned freshness rules.

Every model response should report:

- catalogue source;
- native runtime version;
- fetch time;
- whether the data is live or fallback;
- compatibility/degraded state; and
- enough model capabilities to drive the relevant UI.

Static fallback catalogues remain safety nets, not authoritative registries.

### 31.8 Compatibility Policy

External runtimes let users update providers independently of CLIde. Exact
version pinning can therefore no longer be the primary compatibility guarantee.

Use two layers:

1. **Known-version evidence**
   - minimum supported version where a meaningful minimum exists;
   - versions exercised by automated and live smoke tests;
   - adapter and protocol provenance recorded in diagnostics.
2. **Runtime capability probes**
   - executable/version probe;
   - App Server initialization where applicable;
   - required method and field availability;
   - optional feature discovery;
   - clean degradation when a capability is absent.

Policy:

- Missing required protocol behavior makes that transport unavailable.
- Missing optional behavior removes or disables the corresponding capability.
- A newer untested version should normally produce an explicit warning rather
  than automatic rejection when required probes pass.
- An older or structurally incompatible version must fail with an actionable
  message.
- CLIde must not silently replace an incompatible external runtime with a
  bundled one.
- Compatibility state must be visible in Settings and provider diagnostics.
- Requested-versus-effective transport and runtime source remain separate.

For Codex, checked-in curated App Server types and generated-schema drift tests
remain useful. They should evolve from "the bundled CLI exactly equals the SDK
version" into contract tests that can run against:

- the oldest supported standalone CLI;
- the CLI version used in normal development;
- the newest candidate CLI during provider maintenance; and
- test fakes for missing optional methods and breaking required changes.

### 31.9 Runtime Updates While CLIde Is Running

Standalone installers commonly update a symlink or versioned target.

Per-process behavior:

- Claude normally starts a new native child for each SDK query, so a later run
  can naturally pick up an updated executable after the resolver refreshes.
- Codex Chat owns a long-lived App Server; changing the executable on disk does
  not change the already-running child.

For long-lived runtimes:

1. snapshot installation ID, real path, and version when the child starts;
2. detect when the selected installation changes;
3. mark `updatePending: true`;
4. never replace the process during an active turn;
5. recycle it when idle through the provider lifecycle; and
6. re-run compatibility and model discovery after restart.

Do not use an executable update as permission to restart the user-owned CLIde
production service automatically.

### 31.10 Provider-Specific Migration

#### Claude

1. Move `CLAUDE_CLI_PATH` and normal `PATH` resolution into
   `ClaudeNativeRuntime`.
2. Make auth, Chat, Shell, model discovery, and diagnostics consume the same
   resolved installation.
3. Display Agent SDK version and external Claude Code version as a tested pair.
4. Probe native model discovery without transcript persistence.
5. After external-required behavior is proven, prevent release packaging from
   carrying unused optional Claude native binaries where packaging permits.

#### Codex

1. Add `CodexNativeRuntime` with configured-path and service-`PATH` resolution.
2. Pass its executable to the TypeScript SDK through `codexPathOverride`.
3. Launch Chat and usage App Servers as
   `<resolved-codex> app-server --stdio`.
4. Route model discovery through `model/list`.
5. Make Shell use the same resolved executable.
6. Replace bundled-version-only diagnostics with adapter, external CLI, App
   Server process, and compatibility diagnostics.
7. Retain the bundled transport only as an explicit migration fallback.
8. Consider removing the Codex SDK and bundled CLI dependency only after
   interactive and job-owned App Server paths cover required behavior.

Because bundled and standalone Codex were both `0.146.0` at audit time, first
switch the path without also changing protocol version. Upgrade testing can
follow as a separate change.

#### Cursor and OpenCode

1. Move their bare command names into provider-native resolvers.
2. Reuse the resolved path for auth, models, Chat, jobs, and Shell.
3. Add configured-path support and normalized version diagnostics.
4. Preserve clean registered-but-unavailable behavior when not installed.

### 31.11 Revised Migration Sequence

Insert these steps before the runtime-dispatch migration in Section 30:

#### Native Runtime Phase A: Contract and diagnostics

- Add the provider-native-runtime types and resolver contract.
- Encode current behavior without changing it.
- Add path precedence, version parsing, missing executable, Windows wrapper,
  symlink, and conflicting-installation tests.
- Expose sanitized configured-versus-effective runtime diagnostics.

#### Native Runtime Phase B: Consumer convergence

- Make provider auth, models, Chat, jobs, usage, and Shell accept or resolve the
  same installation.
- Add an installation-consistency contract test for every provider.
- Keep current transport source during this phase so refactoring and policy
  change remain separate.

#### Native Runtime Phase C: External Codex switch

- Select standalone Codex for App Server, SDK fallback/jobs, usage, models, and
  Shell.
- Verify required App Server contract against the selected executable.
- Run new/resumed Chat, approvals/questions, images, abort, rewind/fork, usage,
  model discovery, history, and SDK/job fallback smoke tests in an isolated
  instance.
- Do not restart production from the agent session.

#### Native Runtime Phase D: Native model catalogues

- Adopt Codex `model/list`.
- Test and, if safe, adopt Claude `supportedModels()`.
- Preserve source-labelled fallbacks.
- Change the frontend to request models lazily per provider.

#### Native Runtime Phase E: Packaging cleanup

- Remove or omit provider-native binaries no longer used by CLIde.
- Keep adapter libraries that still provide meaningful protocol and type
  behavior.
- Measure server bundle, desktop bundle, install time, and Pi disk impact.
- Verify a clean installation gives actionable setup instructions when no
  provider runtime is installed.

After these phases, continue with Section 30's interactive runtime adapters and
registry-driven dispatch. The adapters should receive a resolved installation
instead of hardcoding an executable.

### 31.12 Acceptance Criteria

The standalone-runtime migration is complete when:

1. Every registered provider has a native-runtime resolver.
2. Installation, authentication, Chat, jobs, models, usage, and Shell use the
   same installation by default.
3. Codex Chat runs the selected standalone `codex app-server`.
4. Codex SDK use, while retained, passes `codexPathOverride`.
5. Codex models come from the selected App Server or an explicitly labelled
   fallback.
6. Claude Chat and model discovery use the same external Claude executable.
7. A model probe cannot create a CLIde session or watcher-visible phantom
   transcript.
8. Runtime diagnostics show adapter version, native version, executable source,
   compatibility state, active-process version, and pending updates.
9. An incompatible external runtime produces an actionable visible error.
10. No silent cross-installation or bundled fallback occurs.
11. Provider catalogue loading does not eagerly launch every native runtime.
12. Runtime updates never interrupt an active turn.
13. Executable paths cannot be supplied by untrusted client requests.
14. Current provider sessions and shared native configuration roots remain
   compatible.
15. Focused resolver, compatibility, model-discovery, and installation-
   consistency tests pass for all registered providers.

### 31.13 ADR Requirement

ADR 0011 deliberately selected the Codex CLI bundled with the TypeScript SDK.
Changing the default to the standalone runtime is a lasting architectural
decision with different compatibility and deployment ownership.

Do not rewrite ADR 0011. Before switching the Codex execution source, add a
superseding ADR that records:

- why standalone/external is now the default;
- which adapter libraries remain bundled and why;
- the resolution and fallback policy;
- the runtime compatibility policy;
- how active App Server processes handle updates;
- how diagnostics expose configured and effective installations; and
- how to roll back to an explicitly selected bundled runtime during migration.

### 31.14 Deferred First Task

Use this scoped task in a future implementation session:

> Preserve and commit the provider consolidation spec, claim the corresponding
> TODO item, and create an isolated topic worktree from current `main`. Re-audit
> current provider versions and runtime paths. Add the smallest
> `IProviderNativeRuntime` contract plus Claude, Codex, Cursor, and OpenCode
> resolvers. Encode current behavior without switching execution sources. Add
> focused tests for configured path precedence, service-PATH resolution,
> missing executables, version parsing, symlinks, bundled-versus-external
> reporting, and one-installation consistency. Expose sanitized runtime
> diagnostics through the provider layer. Do not change Chat dispatch, model
> sources, frontend selection, production services, or provider packaging in
> this first task.

Expected output:

- native-runtime interface and shared types;
- four provider-native resolver implementations;
- current behavior represented explicitly rather than through bare commands;
- resolver and installation-consistency tests;
- provider diagnostics containing configured and effective runtime metadata;
- provider module documentation updates;
- a superseding ADR proposed before the later Codex source switch; and
- no intended execution behavior change.

## 32. Extracted Current Contract and Living Maps

This file is intentionally preserved as the complete design and re-audit
record. It is no longer the default context document for routine provider
work.

The current documentation layers are:

1. [Current provider architecture contract](../../maps/CLIde_Provider_Architecture_Current_Contract.md)
   — concise invariants, ownership boundaries, current gaps, and implementation
   order.
2. [CLIde provider capability map](../../maps/clide-provider-capability-map.md)
   — living normalized behavior and provider/runtime bindings.
3. Provider-native maps under [`docs/maps/`](../../maps/README.md)
   — CLI, SDK, App Server, configuration, and protocol inventories.
4. This document — the original proposal, repository-local re-audit, runtime
   resolution addendum, alternatives, and supporting evidence.
5. ADRs — canonical lasting decisions when they apply.

### 32.1 Mapping rule

Provider-native methods, flags, events, settings, and endpoints are not copied
into one universal interface merely because they exist. Each material native
surface receives one explicit disposition:

- bind to an existing normalized CLIde capability;
- add a new normalized capability because CLIde has selected corresponding
  product behavior;
- retain behind a provider-specific facet or UI;
- expose only through the provider's Shell client;
- defer as a compatibility watch; or
- intentionally do not expose it.

Normalization occurs at the user-visible behavior boundary. Native names and
protocol details remain in provider-owned adapters and provider-native maps.

### 32.2 Source-of-truth direction

During consolidation, the living map is the reviewable conformance inventory.
The target state is for typed capability descriptors and provider bindings to
generate or validate its mechanical tables. Human-maintained text remains
responsible for semantics, fidelity, degradation, security, evidence, and
deliberate non-mappings.

Release-specific discovery updates a provider-native map and compact upgrade
ledger first. The canonical CLIde map changes only when a normalized contract,
provider binding, implementation state, or selected disposition changes.
