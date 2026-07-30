# CLIde provider architecture — current contract

**Status:** Current implementation contract and reading guide

**Last reconciled:** 2026-07-30 against CLIde `main` at `935c629`

**Detailed history:** [Provider Architecture Consolidation Spec](CLIde_Provider_Architecture_Consolidation_Spec.md)

**Living conformance inventory:** [CLIde provider capability map](../maps/clide-provider-capability-map.md)

This document is the compact default context for provider architecture work.
It extracts the current invariants and implementation direction from the much
larger historical proposal, repository-local re-audit, and native-runtime
addendum. It does not replace source inspection, ADRs, or provider-native maps.

## 1. Correct abstraction boundary

CLIde integrates **agent runtime providers**, not merely model APIs:

- Claude Code;
- Codex;
- Cursor CLI;
- OpenCode;
- a future runtime such as Antigravity only after an explicit provider-fit
  decision.

A model inference API does not necessarily provide an agent loop, filesystem
tools, shell execution, permissions, session persistence, transcripts, MCP, or
resume semantics. Those behaviors belong to the runtime adapter boundary.

## 2. Non-negotiable invariants

### 2.1 CLIde owns application identity

- `session_id` is the stable CLIde identity used by the database, frontend,
  gateway, and public API.
- `provider_session_id` is the provider-native thread/session identifier.
- Native IDs may remain compatibility aliases at selected transport boundaries,
  but must never become the primary CLIde identity.
- Rewind may replace the native thread behind one stable CLIde session.
- Fork creates a new CLIde session and a new native lineage.
- Cross-provider continuation is an explicit import/copy/new-session operation,
  not an invisible native-session substitution.

CLIde sessions are consolidated in one application model; provider-native
sessions are not assumed interchangeable.

### 2.2 The gateway owns run safety

`chatRunRegistry`, the gateway-owned `AbortSignal`, `ChatSessionWriter`, replay
sequence/run identity, and exactly-once completion remain shared ownership.
Provider adapters receive those facilities; they do not replace them with
parallel run registries or completion writers.

Abort is signal-first. A provider-native interrupt is an optional graceful
secondary action, including before a native session ID exists.

### 2.3 Providers own native behavior

Provider-specific SDKs, CLI flags, protocols, transcript formats, configuration,
and normalization live under `server/modules/providers/list/<provider>/` or in
the existing thin runtime entrypoint awaiting migration.

Shared code consumes:

- CLIde session IDs;
- normalized run input;
- normalized events and interactive requests;
- normalized model, auth, usage, MCP, and skill records;
- capability bindings;
- requested and effective settings.

Provider-native names must not leak into generic React behavior merely because
one runtime exposes them first.

### 2.4 Interactive Chat and small jobs are different facets

Interactive Chat, ephemeral text generation, account usage, model discovery,
authentication, and Shell may use the same resolved installation but have
different lifecycle, persistence, permission, and transport requirements.

Do not force them through one oversized runtime interface. A provider may
eventually expose separate `runtime`, `jobs`, and `nativeRuntime` facets.

### 2.5 Capability is runtime-effective

Capability data has four layers:

1. static provider descriptor;
2. installed/configured/authenticated state;
3. dynamic runtime and transport health;
4. effective capabilities for the selected transport and version.

Codex App Server and SDK fallback are the current concrete example: Plan,
interactive requests, rewind, and fork disappear when the active Chat transport
falls back to the SDK.

### 2.6 Requested and effective state remain separate

For model, effort, access policy, transport, runtime source, and other
provider-controlled settings, distinguish:

- provider/app default for a new session;
- value requested for this CLIde session or turn;
- provider- or transcript-confirmed effective value.

The transcript is effective truth for what ran. A picker selection or database
preference is not confirmation that a running provider accepted it.

## 3. Current provider composition

The current `IProvider` registry owns:

| Facet | Current contract |
|---|---|
| Models | catalog, current/effective model lookup, next-resume override |
| Authentication | installed/authenticated status |
| Usage | optional plan/rate-limit reporting |
| MCP | normalized configuration list/upsert/remove |
| Skills | normalized discovery/install/remove |
| Sessions | native event normalization, history, optional fork |
| Synchronization | full and incremental native-session indexing |

Live Chat start/resume/abort dispatch remains outside `IProvider` through
application-level runtime functions. Native runtime resolution is specified but
not yet implemented. The provider catalogue and capability-driven frontend are
also incomplete.

## 4. Normalized contract rules

### 4.1 Messages

- Every provider event is normalized before reaching React.
- Every event has a stable `kind`, stable message identity, provider, CLIde
  session ID, and timestamp.
- Live and reloaded history must render materially equivalent content.
- Unknown native event/item types should produce redacted diagnostics rather
  than transcript payload logging.
- Provider-native request IDs stay inside the interactive-request registry.

### 4.2 Interactive requests

The shared contract covers tool approval, command approval, file-change
approval, additional permission approval, and structured user input.
Provider adapters translate native requests and decisions at their boundary.

### 4.3 Access policy

A single `permissionMode` string is not the canonical policy model.
Collaboration mode, filesystem sandbox, network access, approval behavior,
reviewer behavior, and user prompting are distinct controls.

Shared presets must record:

- provider-neutral intent;
- exact or approximate native mapping;
- risk level;
- runtime limitations;
- interactive request types;
- session/turn/persistent scope.

Plan is collaboration intent, not a filesystem permission level. Unsupported
intent must not silently widen access.

### 4.4 Optional behavior

Unsupported behavior is explicit. Generic UI must hide it, disable it with an
explanation, or provide a clean no-op only where a no-op is truthful. Providers
must not implement fake methods solely to satisfy an interface.

## 5. Native runtime contract direction

Every provider needs deterministic installation detection, resolution, and
compatibility diagnostics for these purposes:

- interactive Chat;
- background/ephemeral jobs;
- model discovery;
- account usage;
- authentication;
- Shell.

Resolution order is:

1. trusted server-configured path;
2. executable visible to the production service `PATH`;
3. documented platform installer location;
4. explicitly enabled bundled fallback.

The resolved record must identify invoked path, real path, version, source,
configuration root, supported surfaces, and compatibility state. Client input
must never supply arbitrary executable paths.

All facets should use one installation by default. Any exception must be
deliberate and visible in diagnostics. Never infer the service runtime from an
interactive SSH shell alone.

## 6. Capability conformance

An advertised capability is valid only when the map can identify:

1. its canonical CLIde behavior;
2. native provider/runtime binding;
3. adapter implementation;
4. gateway or route integration;
5. UI consumer or intentional headless consumer;
6. false/unavailable degradation behavior;
7. live/history persistence implications;
8. focused automated evidence;
9. required live-smoke evidence.

Provider identity alone is not proof. A transport/version probe may alter the
effective binding at runtime.

## 7. Current high-priority gaps

- Live runtime dispatch is not registry-owned.
- Native runtime resolution and one-installation diagnostics are not
  implemented.
- The frontend provider catalogue still contains hardcoded provider knowledge.
- Some declared capability flags are not consistently consumed by generic UI.
- Cursor advertises permission modes its runtime adapter does not fully map.
- Desired/effective provider state is only partially represented.
- Capability declarations do not yet have end-to-end conformance tests.
- Claude, Cursor, and OpenCode do not yet have refreshed living
  provider-maintenance maps and ledgers.

These are tracked in the
[living capability map](../maps/clide-provider-capability-map.md) and `TODO.md`.

## 8. Reading router

Read only the material needed for the task:

| Task | Default documents |
|---|---|
| Generic provider implementation | This contract + canonical capability map |
| One provider update | Provider-native map + its ledger + relevant adapter |
| Session identity, rewind, or fork | ADRs 0003, 0007, 0008, 0012 + map identity section |
| Abort, replay, or completion | ADR 0013 + Section 30.3–30.6 of the historical spec |
| Permissions or Plan | Provider permission-mode map + canonical access binding |
| Native executable/runtime source | Section 31 of the historical spec until extracted into code |
| Why an alternative was rejected | Routed section of the historical spec or relevant ADR |
| New provider | This contract + map schema + provider module guide |

Load the full historical spec only when reviewing the consolidation proposal as
a whole.

## 9. Documentation ownership

- `docs/superpowers/maps/` contains living current-state inventories.
- `docs/superpowers/specs/` contains dated assessments, designs, and the
  preserved architecture history.
- `docs/superpowers/plans/` contains implementation sequences.
- `docs/decisions/` contains lasting architectural decisions.
- Git history and compact upgrade ledgers preserve change history; living maps
  do not accumulate obsolete release-by-release detail.

When code becomes the typed source of truth, generate or validate mechanical map
tables from it. Keep semantic fidelity, degradation, security, and deliberate
non-mappings human-reviewed.
