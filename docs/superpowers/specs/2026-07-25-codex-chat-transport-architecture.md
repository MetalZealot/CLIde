# Codex Chat transport architecture

*Recorded 2026-07-25 against CLIde `main`, `@openai/codex-sdk` 0.144.6,
the CLI bundled with that SDK, and the accepted App Server rollout in ADR 0011.*

## Purpose

This document is the durable mental model for implementing Codex features in
CLIde. It explains:

- how the interactive CLI, TypeScript SDK, and App Server differ;
- what OpenAI supplies versus what CLIde owns;
- which App Server capabilities CLIde Chat currently implements;
- what changes if App Server becomes the default Chat transport; and
- which integration surface future Codex work should target.

It complements the current, curated
[Codex CLI, SDK, and App Server surface map](2026-07-24-codex-cli-sdk-surface-map.md).
ADR 0011 remains the canonical decision for the opt-in first rollout.

## Executive summary

The Codex TypeScript SDK and App Server can both run coding-agent threads, but
they are not interchangeable layers with merely different option counts:

- The **TypeScript SDK** is a high-level Node wrapper around
  `codex exec --json`. It suits CI, one-shot automation, and simple
  start/resume/run workflows.
- **App Server** is Codex's long-lived, bidirectional rich-client protocol. It
  suits IDEs and applications such as CLIde that must answer approvals and
  structured questions while a turn is running.
- The **interactive CLI** is the terminal user interface. CLIde embeds it in
  the Shell tab, but its slash commands and keyboard actions are not a web
  protocol and do not automatically work when sent as Chat prompt text.

Claude Code's Agent SDK already resembles a rich remote-control layer. The
closest Codex equivalent to that part of Claude's SDK is App Server, not the
Codex TypeScript SDK. This difference should guide provider-neutral feature
design.

CLIde did **not** implement Codex App Server. OpenAI ships it in the Codex CLI
runtime bundled with `@openai/codex-sdk`. CLIde implemented the client,
translation, lifecycle, safety, persistence, and UI layers needed to use that
existing server.

## 1. Surface model

| Surface | Shape | Best use in CLIde | Important limitation |
|---|---|---|---|
| Interactive `codex` CLI | Human terminal application | Shell tab and terminal-only escape hatch | Its UI actions are not callable Chat operations |
| `codex exec --json` | Non-interactive process and JSONL event stream | Scripts and simple jobs | No general server-to-client request channel |
| TypeScript SDK | Typed wrapper around `exec --json` | Simple Node automation and fallback turns | Cannot round-trip approvals or structured questions |
| Python SDK | Client over local App Server | Python applications | Not used by CLIde |
| `codex app-server` | Long-lived JSON-RPC-like protocol over stdio, WebSocket, or Unix socket | Rich interactive Codex Chat | Larger, lower-level, version-sensitive protocol |
| `codex mcp-server` | Codex exposed as MCP tools | Let another orchestrator call Codex | Not a Chat/session frontend protocol |

The TypeScript SDK is not defective or obsolete. It intentionally provides a
smaller abstraction. App Server exposes a different communication model:

```text
TypeScript SDK

CLIde -> start/resume and run turn -> codex exec --json
CLIde <- streamed exec events ------ codex exec --json


App Server

CLIde -> thread/turn requests ------> codex app-server
CLIde <- events and requests -------- codex app-server
CLIde -> approval/question answers -> codex app-server
```

That reverse request path is the critical difference. It lets Codex pause an
active turn, ask the client for a decision or answer, then continue the same
turn.

## 2. Ownership: OpenAI versus CLIde

### OpenAI supplies

- the Codex runtime and agent loop;
- `codex exec --json`;
- the TypeScript SDK wrapper;
- the `codex app-server` executable and protocol;
- generated TypeScript/JSON Schema protocol bindings;
- Codex authentication, configuration, native threads, transcripts, tools,
  sandboxing, approvals, models, MCP, skills, plugins, and related runtime
  behavior.

### CLIde supplies

- the authenticated browser-to-backend WebSocket;
- app-facing stable session IDs and database rows;
- mapping `session_id` to Codex's native `provider_session_id`/thread ID;
- a JSONL RPC client over App Server stdin/stdout;
- App Server process startup, initialization, supervision, and failure handling;
- a curated, checked-in protocol subset;
- translation from Codex items and events into `NormalizedMessage`;
- provider-neutral capability declarations;
- approval and structured-question lifecycle and UI;
- history reload, redaction, notifications, reconnect behavior, and display;
- protocol drift tests against the pinned bundled CLI.

The runtime path is:

```text
Browser Chat
    |
    | CLIde authenticated WebSocket
    v
CLIde Chat/provider adapter
    |
    | JSONL requests, responses, notifications, and server requests
    v
OpenAI codex app-server subprocess
    |
    v
Codex account, config, tools, native threads, and rollout files
```

CLIde resolves `@openai/codex/bin/codex.js` from the dependency tree and runs
it with `app-server --stdio`. It deliberately does not use an unrelated global
`codex` executable. App Server is launched lazily; it is not a separately
installed system daemon.

## 3. Current CLIde implementation

### Transport selection

Interactive Codex requests enter through `queryCodex()` in
`server/openai-codex.js`.

```text
CLIDE_CODEX_CHAT_TRANSPORT=app-server -> App Server path
variable absent or any other value    -> TypeScript SDK path
```

The running production `cloudcli.service` did not have this variable set when
this document was written. Therefore the installed production Chat still used
the SDK even though the App Server implementation was merged.

“Opt-in” currently means a server startup flag. It is not a discoverable Chat
or Settings control, and it is not selectable per user, conversation, or turn.

### Process topology

Chat owns one lazy, supervised, long-lived App Server process per CLIde backend
process. Active turns for multiple Codex threads share it.

Codex account usage is intentionally separate: the usage provider launches a
short-lived App Server, reads `account/rateLimits/read` and
`account/usage/read`, then closes it. The Chat feature flag does not control
that reader.

### Core implementation files

| Responsibility | Location |
|---|---|
| SDK adapter and Chat transport gate | `server/openai-codex.js` |
| Bundled CLI resolution and short-lived usage client | `server/modules/providers/list/codex/codex-app-server.client.ts` |
| Long-lived Chat transport | `server/modules/providers/list/codex/codex-app-server-chat.transport.ts` |
| Curated generated protocol subset | `server/modules/providers/list/codex/codex-app-server.protocol.ts` |
| Shared JSONL request/response transport | `server/modules/providers/shared/jsonl-rpc.client.ts` |
| Runtime capability exposure | `server/modules/providers/services/provider-capabilities.service.ts` |
| Pending approval/question lifecycle | `server/modules/providers/services/interactive-request-registry.service.ts` |
| Approval banner | `src/components/chat/view/subcomponents/PermissionRequestsBanner.tsx` |
| Structured-question UI | `src/components/chat/tools/components/InteractiveRenderers/UserInputRequestPanel.tsx` |
| Protocol and behavior coverage | `server/modules/providers/tests/codex-app-server-*.test.ts` |

## 4. App Server capabilities currently exposed in Chat

Enabling the App Server transport retains the basic SDK-era Chat loop:

- create and resume Codex conversations;
- send text and local image inputs;
- select working directory, model, and reasoning effort;
- use Default, Accept Edits, and Bypass Permissions modes;
- render assistant messages, reasoning, completed commands, file changes, MCP
  tool calls, and web searches;
- update the per-turn context/token ring;
- interrupt the active turn; and
- reload persisted history through the existing Codex transcript adapter.

It additionally exposes:

- Codex Plan collaboration mode;
- command-execution approvals;
- file-change approvals;
- requests for additional filesystem or network permission;
- Allow once, Allow for session, Deny, and Cancel decisions;
- structured single-select or free-text questions;
- secret question inputs without writing the answer into Chat history;
- question timeouts and skip/empty-answer behavior;
- pending approval/question replay after the browser reconnects;
- stable CLIde-session-to-Codex-thread mapping; and
- startup-only SDK fallback.

The curated live item union currently handles:

- `agentMessage`;
- `plan`;
- `reasoning`;
- `commandExecution`;
- `fileChange`;
- `mcpToolCall`; and
- `webSearch`.

The transport consumes completed items rather than the full set of App Server
deltas. App Server has many more methods and events than CLIde currently uses.
Enabling the transport does not automatically expose them in the interface.

## 5. Capabilities available upstream but not yet integrated

Important future App Server-backed work includes:

- live agent-message, reasoning, command-output, plan, and patch deltas;
- active-turn steering and item injection;
- native thread list/read/name/archive/delete/fork/rollback;
- explicit compaction and native review;
- turn plan, diff, status, moderation, warning, and model-reroute events;
- goals and subagent/collaboration activity;
- authoritative model and provider-capability discovery;
- native account/login/logout and managed-auth state;
- effective config with origins and managed requirements;
- MCP status, OAuth, resources, and tool calls;
- native skills, plugins, marketplaces, apps, and hooks;
- file mentions, fuzzy search, watching, and controlled processes;
- external-agent configuration/history import;
- realtime/audio and remote-control features.

Each feature still requires:

1. adding the necessary protocol types and drift coverage;
2. implementing the request/event lifecycle in the backend adapter;
3. representing support through provider-neutral capabilities;
4. designing the corresponding CLIde interface;
5. preserving security and redaction boundaries; and
6. testing live behavior and transcript reload consistency.

## 6. Failure and fallback rules

App Server may fall back to the SDK only if its process cannot complete
initialization.

Once CLIde attempts `thread/start`, `thread/resume`, or `turn/start`, the
instruction stays on the App Server path. Retrying it through the SDK could run
the same user instruction twice, including duplicate commands or file edits.

If the long-lived process exits:

- all active App Server turns fail;
- pending interactions are cancelled;
- a later query may start a fresh process; and
- the accepted failed turn is never silently retried through the SDK.

This is a product safety invariant, not merely an implementation detail.

## 7. What changes if App Server becomes the default

### Expected user-visible changes

- Plan becomes a normal Codex permission-mode choice.
- Default mode can ask for real approvals instead of relying on the
  non-interactive exec path's inability to round-trip them.
- Structured Codex questions become part of ordinary Chat.
- Command, file, and additional-permission requests become visible and
  actionable.
- Normal text, image, model, effort, history, usage, and abort behavior should
  remain compatible.
- Existing native Codex threads should resume without data migration because
  both transports use the same Codex state and thread IDs.

### Expected operational changes

- A Codex subprocess remains alive after its first Chat use, increasing idle
  memory relative to per-turn SDK subprocesses. This matters on the Raspberry
  Pi and should be measured.
- A single App Server process becomes a shared failure domain for concurrent
  Codex turns.
- Protocol compatibility becomes part of every Codex SDK/CLI upgrade.
- Diagnostics need to report the configured transport, actual transport,
  bundled CLI version, connection health, and whether a startup fallback
  occurred.

### Required engineering changes before a default rollout

1. Invert the rollout switch so App Server is normal and an explicit
   `CLIDE_CODEX_CHAT_TRANSPORT=sdk` remains as an emergency escape hatch.
2. Show the configured and actual transport in Settings/status diagnostics.
3. Split interactive Chat from simple automation entry points. The current
   shared `queryCodex()` is also used by `server/routes/agent.js`, so the
   supposedly Chat-only flag presently changes that API path too.
4. Make capability reporting reflect the actual runtime transport. If App
   Server startup falls back, the UI must not continue advertising Plan and
   interactive approvals as though they remain available.
5. Verify background completion/failure notification parity. The SDK adapter
   currently invokes the notification orchestrator directly; the App Server
   adapter needs an equivalent audited path.
6. Measure steady-state memory, process recovery, and multiple concurrent
   threads on the Pi.
7. Live-test new/resumed turns, images, every permission mode, every approval
   decision, structured questions, secret answers, reconnect replay, abort,
   process failure, history refresh, and account usage in the installed PWA.
8. Keep the SDK fallback until App Server has completed an extended production
   soak and rollback is no longer needed.

## 8. What becomes of the TypeScript SDK

Making App Server the default for interactive Chat does not imply removing the
SDK.

The recommended near-term roles are:

- startup fallback before App Server accepts work;
- explicit emergency rollback transport;
- simple non-interactive automation where a bidirectional rich-client protocol
  adds no value; and
- compatibility/reference path during App Server upgrades.

There is also a packaging dependency: CLIde currently obtains the pinned Codex
CLI and App Server executable through the runtime bundled with
`@openai/codex-sdk`. Even if no production code called the SDK API, removing
the package would require adding and pinning the Codex CLI package directly,
then changing executable resolution and upgrade tests.

The intended steady state is:

```text
Interactive Codex Chat -> App Server
Simple automation/jobs  -> TypeScript SDK where appropriate
Terminal experience     -> interactive Codex CLI in Shell
Emergency rollback      -> TypeScript SDK
Account usage snapshot  -> independent short-lived App Server
```

Do not delete the SDK adapter as part of merely changing the Chat default.
Removal, if ever justified, is a separate decision after deciding how CLIde
will package the Codex runtime and service non-interactive jobs.

## 9. Rules for future Codex features

1. **Choose the surface by interaction shape, not by familiarity.**
   Bidirectional Chat controls belong on App Server. Simple run-and-collect
   jobs may remain on the SDK. Terminal presentation belongs in Shell.

2. **Do not assume the Codex TypeScript SDK matches Claude's Agent SDK.**
   Shared provider contracts must use capability flags and clean no-op behavior
   rather than assuming identical control methods.

3. **Do not implement native slash commands by sending slash text.**
   Use the corresponding App Server method or build an explicit CLIde-owned
   interface. The interactive CLI's parser is not part of `exec` or SDK Chat.

4. **Prefer first-class App Server state over file scraping when migrating a
   feature.** Transcript/config/cache parsing remains a compatibility path, but
   live model, account, config, thread, MCP, and extension features should use
   authoritative protocol methods when available.

5. **Keep CLIde identity separate from provider identity.**
   `session_id` is stable and app-facing; the Codex thread ID belongs in
   `provider_session_id`.

6. **Never retry accepted work through another transport.**
   Startup fallback is safe; post-acceptance fallback is not.

7. **Keep App Server behind the backend trust boundary.**
   Do not expose its experimental WebSocket directly to browsers. Continue to
   use local stdio and CLIde's authenticated, user-scoped WebSocket.

8. **Treat approval policy and sandbox policy as separate controls.**
   “When should Codex ask?” and “what can an approved action access?” are
   independent security decisions.

9. **Expose runtime capability, not provider mythology.**
   Plan and interactive approvals depend on the active transport, not merely
   on `provider === "codex"`.

10. **Pin and verify the whole compatibility unit.**
    Upgrade the TypeScript SDK and its bundled CLI together, regenerate the
    App Server protocol, run drift tests, and smoke-test live behavior before
    rollout.

11. **Preserve reload parity.**
    A feature is incomplete if it looks correct live but disappears, changes
    meaning, or exposes sensitive data after transcript refresh.

12. **Record non-obvious new decisions.**
    If a feature changes transport ownership, identity, fallback, persistence,
    or security boundaries, add a new append-only ADR rather than silently
    changing ADR 0011.

## 10. References

- [OpenAI Codex SDK](https://developers.openai.com/codex/sdk)
- [OpenAI Codex App Server](https://developers.openai.com/codex/app-server)
- [OpenAI Codex non-interactive mode](https://developers.openai.com/codex/noninteractive)
- [OpenAI Codex CLI reference](https://developers.openai.com/codex/cli/reference)
- [Codex CLI, SDK, and App Server surface map](2026-07-24-codex-cli-sdk-surface-map.md)
- [ADR 0011 — Codex App Server is the opt-in interactive Chat transport](../../decisions/0011-codex-app-server-chat-transport.md)
