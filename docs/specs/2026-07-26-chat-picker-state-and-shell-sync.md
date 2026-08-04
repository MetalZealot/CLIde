# Chat picker state and Shell synchronization

*Recorded 2026-07-26 against CLIde `main` after Codex App Server became the
default interactive Chat transport. This is a future implementation brief, not
a completed design decision.*

## Purpose

CLIde's Chat composer exposes Model, Effort, and Permission controls beside a
conversation that can also be opened in the provider-native Shell. The two
surfaces look like views of one session, but they do not currently share one
source of truth for those controls.

This note records:

- what Chat actually sends to Claude and Codex;
- why Chat and Shell can display different settings for the same conversation;
- which inconsistencies are expected consequences of separate runtimes;
- which inconsistencies are genuine CLIde state bugs; and
- the recommended shape of a later fix.

Read this alongside:

- [Provider permission and mode surface map](2026-07-25-provider-permission-mode-map.md);
- [Codex Chat transport architecture](../maps/2026-07-25-codex-chat-transport-architecture.md);
- [Codex CLI, SDK, and App Server surface map](../maps/codex-cli-sdk-app-server.md);
- [ADR 0011 — Codex App Server Chat transport](../decisions/0011-codex-app-server-chat-transport.md); and
- [ADR 0003 — Per-session model tracking](../decisions/0003-per-session-model-tracking.md).

## Executive summary

1. **The structured Chat send envelope is sound.** CLIde does not need to
   append natural-language permission or effort instructions to a prompt.
   `chat.send` already carries structured turn options that each provider
   adapter translates into its native SDK, CLI, or App Server controls.

2. **Chat and Shell are separate clients.** Chat uses CLIde's provider adapter.
   Shell starts or reconnects to a separate provider-native terminal process.
   For Codex it currently runs only `codex resume <provider-session-id>`; it
   does not pass the Chat picker's effort, sandbox, approval policy, reviewer,
   or collaboration mode.

3. **The current composer shows requested state, not verified effective
   state.** It does not receive a turn-start acknowledgement containing the
   settings the backend and provider actually accepted.

4. **Effort is not session-scoped.** It is stored once per provider in browser
   `localStorage`, so every conversation for that provider shares the last
   browser choice. It is not hydrated from the provider transcript or last
   effective turn.

5. **Permission state is only partly session-scoped.** Existing sessions can
   get a browser-local session key, but a new-chat selection is initially saved
   only as the provider's last choice. That session can later drift when a
   different conversation changes the provider-level fallback.

6. **The Codex permission setting in Settings is disconnected.** Settings
   saves `codex-settings.permissionMode`, but the composer maintains separate
   `permissionMode-last-*` and `permissionMode-*` keys. The saved Settings
   value neither initializes Chat nor configures Shell.

7. **The later fix is state ownership and feedback, not prompt rewriting.**
   CLIde should resolve provider-neutral turn intent on the backend, persist
   session-scoped desired/effective state, and report the resolved result back
   to every client.

## 1. Current execution paths

### 1.1 Browser Chat

`useChatComposerState.buildSendOptions` snapshots the composer state into the
next `chat.send`:

```ts
{
  model,
  effort,
  permissionMode,
  toolsSettings,
  ...
}
```

The WebSocket gateway resolves the stable CLIde session row, provider,
project path, and provider-native session id. It then forwards the structured
options to the selected provider runtime.

This is the correct boundary: user text remains user text, while execution
policy remains typed control data.

Queued messages intentionally preserve the options captured when they were
queued. Changing a picker after queueing a message does not change that queued
turn. The UI currently does not make this timing especially visible.

### 1.2 Claude Chat

The Claude adapter translates the Chat selection into Agent SDK options for
the next query:

- `permissionMode`;
- validated `effort`;
- allowed and disallowed tools;
- interactive `canUseTool` handling; and
- Plan-specific tools.

The global Claude `skipPermissions` setting can override the displayed
composer permission mode with `bypassPermissions`, except in Plan. This is
another case where requested UI state and effective runtime state can differ.

### 1.3 Codex Chat

Codex interactive Chat uses App Server unless the explicit SDK escape hatch is
configured or startup initialization falls back.

CLIde maps the legacy composer mode into Codex controls:

| Composer mode | Sandbox | Approval policy | Reviewer | Collaboration |
|---|---|---|---|---|
| `default` | `workspace-write` | `untrusted` | `user` | default |
| `acceptEdits` | `workspace-write` | `never` | `user` | default |
| `bypassPermissions` | `danger-full-access` | `never` | `user` | default |
| `plan` | `workspace-write` | `untrusted` | `user` | Plan |

The App Server transport passes these values through `thread/start` or
`thread/resume` and `turn/start`, along with model and effort. Codex persists
the actual turn context in its rollout JSONL.

Therefore a different setting shown in Shell is not evidence that the Chat
turn ignored the picker. The provider turn context, or a future backend
acknowledgement derived from it, is the authoritative evidence.

### 1.4 Provider-native Shell

The Shell WebSocket owns a separate, reusable PTY. For a Codex session it
starts:

```text
codex resume "<provider-session-id>" || codex
```

It does not include Chat composer overrides such as:

```text
--model
--sandbox
--ask-for-approval
-c model_reasoning_effort=...
```

The Codex TUI consequently resolves configuration from its own session state
and normal config layers. If a PTY already exists, CLIde reconnects to that
same process and replays its buffered output instead of starting a fresh
resume. Shell can therefore show both provider-native state and state from an
older Shell launch.

Changes made through Shell slash commands are likewise not pushed into the
open Chat composer.

## 2. State ownership defects

### 2.1 Effort is provider-global

`useChatProviderState` stores effort as:

```text
<provider>-effort
```

There is no session id in the key. The displayed value means "the last effort
selected in this browser for this provider," not "the effort of this
conversation" or "the effort used by its previous turn."

Consequences:

- changing effort in one Codex session changes the composer value shown in all
  Codex sessions;
- another browser or device can show a different value;
- a Shell `/model` or `/reasoning` change is not reflected in Chat; and
- the next Chat send can overwrite a provider-native effort choice without
  explaining that it is doing so.

### 2.2 Permission state can drift

The composer stores:

```text
permissionMode-last-<provider>
permissionMode-<app-session-id>
```

A mode selected before the first send has no session id yet, so only the
provider-level key is written. When the backend allocates the session id,
CLIde reads the provider fallback but does not promote it into a durable
session key.

If another conversation later changes the provider fallback, returning to the
first conversation can display that newer value even though the first
conversation never selected it.

Like effort, these values are browser-local and are not shared across devices
or verified against the provider's effective turn context.

### 2.3 Settings and composer permission modes are disconnected

The Settings page writes:

```text
codex-settings.permissionMode
```

The composer does not use that value to initialize its permission state.
During send it reads `codex-settings` as a generic tools-settings object, but
the actual `permissionMode` field comes from the separate composer state.

The Settings copy currently says the value can be overridden per session.
In practice, the Settings value is not the base value being overridden.

### 2.4 No requested-versus-effective distinction

The UI currently has only one visible value for each picker. It does not
distinguish:

- configured default;
- last effective session value;
- pending override for the next turn;
- options captured by a queued turn;
- settings accepted by the backend;
- settings enforced or altered by provider/admin policy; or
- independent settings active in Shell.

That ambiguity makes correct turn execution look broken and can also conceal a
real mismatch.

## 3. Recommended state model

### 3.1 Keep separate concepts separate

The later implementation should model at least:

```ts
type TurnExecutionIntent = {
  model?: string;
  effort?: string;
  collaborationMode: 'default' | 'plan';
  accessPreset: string;
};

type EffectiveAccessPolicy = {
  filesystem: 'read-only' | 'workspace-write' | 'full';
  network: 'off' | 'ask' | 'allowed';
  approvalPolicy: 'untrusted' | 'on-request' | 'never' | 'granular';
  reviewer: 'user' | 'auto-review' | 'none';
};
```

These are illustrative shapes, not a final serialized contract. The important
constraint is that effort, collaboration behavior, sandbox boundary, approval
policy, and reviewer are not collapsed into one Claude-derived mode string.

### 3.2 Establish explicit precedence

For each new turn, resolve values in this order:

1. an explicit unsent composer override;
2. the session's last effective or explicitly selected value;
3. the provider/repository/user default configured in CLIde Settings;
4. the provider's native config default; and
5. managed requirements or policy constraints, which may narrow the result.

The backend should own this resolution because browser `localStorage` cannot
provide cross-device consistency or prove what the provider accepted.

### 3.3 Store desired and effective values

CLIde should retain two related records:

- **desired session state**: what the user wants future Chat turns to request;
- **effective turn state**: what the provider actually used for a particular
  turn.

Provider rollout files remain useful evidence, but the normal UI should not
need to parse them client-side. The backend can record the resolved
turn-start configuration when it starts a provider turn and reconcile it with
provider events or persisted context where available.

Use provenance and timestamps, similar to the per-session model work in ADR
0003, so a newer provider-native change is not silently overwritten by an
older browser choice.

### 3.4 Acknowledge the running configuration

Add a normalized turn-start event such as:

```ts
{
  kind: 'turn_started',
  sessionId,
  turnId,
  requested: { ... },
  effective: {
    model,
    effort,
    collaborationMode,
    accessPolicy,
    provider,
    transport,
  },
}
```

The composer can then show:

- **Next turn:** a pending unsent override;
- **Queued turn:** the immutable options already captured;
- **Running as:** the backend-confirmed effective values; and
- **Last turn:** the persisted effective values after completion.

Do not claim exact provider enforcement where the adapter cannot observe it.
Mark values as requested or inferred when necessary.

## 4. Chat and Shell product behavior

### 4.1 Minimum coherent behavior

The minimum fix should be honest rather than pretending that two clients are
live-synchronized:

- label Shell as a separate provider-native client;
- show the last known Chat effective settings near the Shell entry point;
- show that an existing PTY may retain older Shell-local settings;
- offer **Restart Shell using Chat settings** when the provider supports
  command-line overrides; and
- refetch or reconcile provider-native state after returning from Shell where
  reliable evidence exists.

### 4.2 Stronger future integration

For Codex, a deeper integration could attach the TUI to a controlled App
Server endpoint or add an explicit config/session synchronization protocol.
That is materially larger than the picker fix and should not be required for
the first coherent release.

Starting `codex resume` with explicit flags can align Shell at launch, but it
does not by itself create two-way synchronization. Shell slash-command changes
would still need to be observed and reconciled.

### 4.3 Provider-neutral boundary

The shared UI should expose:

- requested intent;
- effective settings;
- persistence scope;
- source/provenance; and
- whether Shell synchronization is supported.

Each adapter should decide how to:

- translate a preset;
- start Chat;
- start Shell;
- read effective state;
- observe provider-native changes; or
- declare a clean no-op when the provider cannot support a feature.

## 5. Suggested implementation sequence

1. Add tests that reproduce effort cross-session leakage, new-session
   permission fallback drift, the disconnected Codex Settings value, queued
   option capture, and cross-device/browser-local behavior.
2. Define normalized desired/effective turn-setting types.
3. Make Settings the explicit default for **new sessions**, not a parallel
   unused control.
4. Persist session-scoped desired effort and access intent on the backend.
5. Add backend turn-start resolution and a normalized effective-settings
   acknowledgement.
6. Hydrate the composer from session state and display pending versus effective
   values.
7. Split Plan/collaboration mode from access policy.
8. Replace legacy cross-provider mode names with the provider-aware presets in
   the permission-mode surface map.
9. Add Shell disclosure and **Restart Shell using Chat settings**.
10. Add provider-specific reconciliation for trustworthy Shell-originated
    changes.
11. Verify new/resumed/queued turns, browser refresh, multiple devices,
    reconnects, App Server startup fallback, and installed-PWA behavior.

## 6. Acceptance criteria

- Changing Effort in session A does not silently change session B.
- A new session's permission choice remains attached to that session after
  other sessions change their choices.
- Settings defines the default used by a newly created session.
- A browser refresh or second client obtains the same server-backed session
  state.
- A queued message visibly retains its captured options.
- Every started turn reports requested and effective settings.
- Codex Chat reports sandbox, approval policy, reviewer, collaboration mode,
  and effort independently.
- Claude Chat reports the effective SDK permission mode, including any global
  `skipPermissions` override.
- Plan does not silently redefine filesystem or network authority.
- Shell is never presented as synchronized when it is not.
- Restarting Shell with Chat settings uses the last backend-confirmed session
  state and clearly states the persistence scope.
- SDK fallback and App Server disclose their different interactive
  capabilities.

## 7. Dated deployment note: SDK 0.145.0

Commit `cd3b710` updated CLIde's exact `@openai/codex-sdk` dependency and its
bundled `@openai/codex` CLI from 0.144.6 to 0.145.0. The update, regenerated
protocol subset, focused tests, builds, and live App Server/SDK smoke tests were
verified in the isolated branch-test service on port 3002. The tracked TODO
record explicitly says production port 3001 was untouched.

At the time this note was written:

- `package.json` and `package-lock.json` require 0.145.0;
- the main checkout's existing `node_modules` still contains SDK and bundled
  CLI 0.144.6;
- the production service was built and started before the update commit;
- Codex Chat's live App Server therefore runs the bundled 0.144.6 CLI; and
- Shell resolves the standalone CLI from `~/.local/bin`, which is 0.145.0.

This is deployment drift, not a failed source update. A later deployment needs
to install the locked dependencies, rebuild the server, and restart CLIde
through the user's normal SSH workflow. Until then, Chat and Shell differ in
both settings ownership and Codex runtime version.

Do not treat these exact versions as a permanent product constraint. Recheck
the manifest, installed dependency tree, live transport diagnostics, and Shell
executable whenever implementing this spec.

## 8. Code navigation

- Composer state and send snapshot:
  `src/components/chat/hooks/useChatComposerState.ts`
  (`buildSendOptions`, `handleSubmit`)
- Provider picker state:
  `src/components/chat/hooks/useChatProviderState.ts`
  (`providerEfforts`, permission persistence effects,
  `cyclePermissionMode`)
- Background queued sends:
  `src/hooks/useQueuedMessageAutoSend.ts`
- Chat WebSocket gateway:
  `server/modules/websocket/services/chat-websocket.service.ts`
  (`handleChatSend`)
- Shell process construction and reuse:
  `server/modules/websocket/services/shell-websocket.service.ts`
  (`buildShellCommand`, `ptySessionsMap`)
- Claude option translation:
  `server/claude-sdk.js` (`mapCliOptionsToSDK`)
- Codex SDK mapping:
  `server/openai-codex.js` (`mapPermissionModeToCodexOptions`,
  `queryCodexSdk`)
- Codex App Server mapping:
  `server/modules/providers/list/codex/codex-app-server-chat.transport.ts`
  (`mapCodexAppServerPermissionMode`, `query`)
- Codex transport/runtime diagnostics:
  `server/modules/providers/list/codex/codex-chat-transport-state.ts`
- Settings persistence:
  `src/components/settings/hooks/useSettingsController.ts`
  (`loadSettings`, `saveSettings`)
