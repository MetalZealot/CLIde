# Codex Chat transport and managed runtime architecture

*Originated 2026-07-25. Rewritten 2026-08-12 for the default App Server
transport and managed native runtime. ADR 0034 is the current decision; ADR
0011 records the superseded opt-in rollout.*

## 1. Current topology

CLIde owns the authenticated browser connection and stable `session_id`.
Codex owns the native thread id, which CLIde stores as `provider_session_id`.
Every Codex facet resolves the same explicitly approved installation.

```text
Browser
  |
  | authenticated CLIde HTTP/WebSocket
  v
Provider orchestration
  |
  | approved Codex installation id
  v
Managed native runtime
  |-- Chat ------------> long-lived app-server
  |-- models/usage ----> bounded app-server calls
  |-- jobs/fallback ---> TypeScript SDK -> codex exec --json
  `-- Shell -----------> interactive codex CLI
```

App Server is the default interactive Chat transport because it can send
approvals and structured questions back to CLIde during a turn. The SDK is an
explicit escape hatch and an initialization-only fallback. Once App Server has
accepted thread or turn work, CLIde never retries it through the SDK because
that could execute the instruction twice.

## 2. Identity and process ownership

The browser addresses a session only by CLIde `session_id`; native thread ids
never replace app identity. Rewind can replace the Codex thread behind one
stable CLIde session, while fork creates a distinct CLIde session. One backend
transport owns each accepted turn, interactive request, abort signal, and final
completion boundary.

Chat's App Server is long-lived so approvals, questions, abort, resume, and
thread operations remain correlated. Models, usage, authentication, jobs, and
Shell may use bounded processes, but their executable resolution is not
independent of Chat.

## 3. Managed native-runtime contract

Discovery and selection are separate:

- discovery inspects the bundled package, the production service `PATH`, and
  known standalone locations;
- a new selection store is seeded to the bundled installation so existing
  behavior does not change;
- discovered installations remain inert until Check and Use explicitly promote
  one;
- browser mutations carry opaque installation ids, never executable paths;
- installation identity includes path and executable fingerprint, so two
  installations with the same version remain distinct.

Check reuses the generated App Server compatibility guard for the methods and
fields CLIde consumes. Use is locked until that exact installation passes. A
missing, changed, or incompatible approved executable makes Codex unavailable;
CLIde does not silently run the bundled copy. Roll back explicitly selects the
recorded previous installation.

A selection change applies to short-lived facets on their next launch. If Chat
has a live App Server, the new selection is pending: an active turn continues
on its original process, then the server recycles when idle. Diagnostics expose
the approved, live-process, pending, previous, and per-facet ids so divergence
cannot hide behind matching version strings.

## 4. Interactive transport behavior

The App Server adapter owns:

- start and resume;
- text, image, and file input;
- model, effort, sandbox, approval policy, and collaboration mode;
- command, file-change, and permission approvals;
- structured `request_user_input` questions;
- abort, rewind, and fork;
- normalized live messages, token usage, and completion.

Runtime-derived capability flags hide App Server-only features if startup falls
back to the SDK. Codex 0.147 adds `isBlocking` to structured questions:
blocking requests wait indefinitely; non-blocking requests auto-resolve after
`autoResolutionMs`, or 120 seconds when it is null. Zero is answered immediately
inside the Codex transport and never changes Claude's shared zero-timeout
meaning of “no timer.”

`CLIDE_CODEX_CHAT_TRANSPORT=sdk` remains the explicit Chat escape hatch.
Fallback is allowed only when App Server initialization fails before accepting
work. `approvalsReviewer: 'user'` stays explicit; Codex 0.147's
`--approve-for-me` surface is not mapped.

## 5. Persistence and reload

The database stores CLIde session identity and the native thread mapping; Codex
rollout files remain the transcript authority. Live normalization and reload
parsing must preserve equivalent message identity, redaction, token usage, and
tool meaning. Native persistent sections introduced in 0.147 are not treated as
CLIde stars or sidebar groups; they remain unmapped until CLIde chooses explicit
section semantics.

## 6. Implementation anchors

| Concern | Owner |
|---|---|
| Default App Server Chat | `server/modules/providers/list/codex/codex-app-server-chat.transport.ts` |
| SDK jobs and explicit/startup fallback | `server/modules/providers/list/codex/codex-runtime.provider.js` |
| Curated protocol | `server/modules/providers/list/codex/codex-app-server.protocol.ts` |
| Compatibility check | `server/modules/providers/list/codex/codex-app-server-compatibility.ts` |
| Runtime discovery and persistence | `server/modules/providers/services/provider-native-runtime.service.ts` |
| Codex runtime descriptor | `server/modules/providers/list/codex/codex-native-runtime.provider.ts` |
| Runtime management and routes | `codex-native-runtime-management.provider.ts`, `codex-native-runtime.routes.ts` |
| Selection UI | `src/components/settings/view/sections/agent/CodexNativeRuntimeRow.tsx` |
| Stable session/native id mapping | Sessions repository and Codex synchronizer |
| Live and reloaded message normalization | Codex transport and sessions provider |

## 7. Rules for future changes

1. Preserve CLIde `session_id` as the only runtime address exposed by the app.
2. Keep all Codex facets on one approved installation unless a documented
   exception is visible in diagnostics.
3. Treat `PATH` as discovery input, never selection authority.
4. Never accept a browser-supplied executable path or silently fall back from a
   broken selection.
5. Never interrupt an active turn merely to apply a runtime promotion.
6. Add curated protocol fields only when CLIde consumes them, and keep the
   generated compatibility check as the single structural gate.
7. Verify transport behavior live; schema and automated evidence cannot prove
   approvals, resume, or process-recycle timing.

## References

- [ADR 0034](../decisions/0034-codex-managed-native-runtime.md)
- [Codex native surface map](codex-cli-sdk-app-server.md)
- [Provider contract](CLIde_Provider_Architecture_Current_Contract.md)
- [Codex upgrade ledger](codex-upgrade-ledger.md)
