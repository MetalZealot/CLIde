# Rebuild the agent runtime: long-lived Claude sessions, one typed wire, a home for every message

- Status: 1/11
- Next: Grayson's checks on 3001 once Pi-Ops' Deploy has run: phase 1 (a mode
  switch mid-reply) and phase 1b (copy a recorder block); then phase 2
- Design: [agent runtime design](../designs/agent-runtime-rebuild.md). Read it whole
  before any phase: it binds every phase and changes only with Grayson.
- Context: the design's list, plus `scripts/verify-claude-session-sdk.ts` and
  `scripts/runtime-scorecard.mjs`

The phases that build [the design](../designs/agent-runtime-rebuild.md), the daily
pains each one ends, and Grayson's open calls. It is over the 16 KB plan cap by
Grayson's decision (2026-10-05): it is the plan that decides whether CLIde stays
his daily driver, so detail wins over size.

## What each daily pain waits for

| Pain | Phase |
|---|---|
| A mode or model change waits for the next message | 1 |
| The slash menu has 11 commands; the CLI reports about 56 (measured, in the command map) | 1 |
| Aborting a new chat's first message leaves two sidebar rows | 1 |
| Search counts and diffs show only after a reload | 1 |
| Thinking comes back empty | 1 |
| Replies don't stream word by word | 2 |
| A background job keeps the chat busy, blocking sends, Shell and scheduled messages | 4 |
| Phone and laptop disagree about a live chat; a message queued on a closed phone never sends | 5 |
| Background-task notices appear only after a reload (inferred: frames after `complete` are dropped) | 5–6 |
| "Starting" before every message (3.3 s median); a background job can't wake the chat after the reply ended | 6 |
| Stop kills background jobs | 6 (ADR 0066) |
| Claude tool rows look different after a reload | 7 |
| Codex tool rows look different after a reload | follow-on plan (Grayson's call 2) |

## Grayson's calls (the recommended default applies until he answers)

1. **Priority.** Recommended: start phases 0–2 now. Finish
   [message-edit-model](message-edit-model.md) phase 3 before this plan's
   phase 5, because phase 5 moves the queue that plan's rows sit on.
2. **Codex's before/after-reload tool rows.** Recommended: a follow-on plan.
   The likely fix is reading Codex history through its App Server
   (`thread/read`, `thread/turns/list`, `thread/items/list`: found in the 0.153.4
   binary's strings, never tried live), which is a different job from Claude's.
3. **What Stop means.** Settled by ADR 0066: Stop ends the reply only;
   background jobs keep running, each with its own stop button.

## Inherited workarounds

Each exists only because of the old design (the design's first position) and
goes in the phase shown.

- The transcript wait for aborted new chats; the idle `claude` per project for
  the command list: phase 6.
- The hidden `/model`, `/effort`, `/fast`, `/clear`, `/rename`: phase 7.

## Phases

Sizes are estimates in focused agent sessions, not measurements. Each phase
ships on its own, keeps all four providers working, and updates `docs/TODO.md`
and this plan in the same commit as its code. "You" is Grayson's under-a-minute
check; "Agent, live" is what a session on the Pi verifies before calling the
phase done.

- [x] 0. **Ground rules and probes — est. 2.** Done 2026-10-05; ADRs accepted 2026-10-06.
  - ADRs: 0065, the runtime layer is
    rebuilt in place and stops tracking upstream (with the upstream sync map's
    matching line); 0066, one long-lived Claude process per chat, Stop ends only
    the turn, delivery read from `command_lifecycle`, superseding ADR 0013 for
    Claude; 0067, one typed message shape shared by server and client; 0068, a
    live session's settings and queue on the server, superseding ARCHITECTURE.md invariant 11
    for open sessions.
  - Probes: `scripts/verify-claude-session-sdk.ts`, the 13 checks plus a
    background-subagent interrupt, run on the Pi; results in the
    [SDK map](../maps/claude-agent-sdk.md)'s §2 table and the script's FINDINGS,
    sanitized frame streams in `server/modules/providers/tests/fixtures/claude-session-sdk/`.
    The SDK map's §4 counts are fixed (14 of 39 handled).
  - What the probes changed here: no `PreToolUse` hook (phase 1);
    `allowDangerouslySkipPermissions` on every chat (phase 1); delivery from
    `command_lifecycle`, not an input echo (the design's positions, phase 6); "Sent"
    from `message_start`, not `rate_limit_event` (phase 2); `perTaskStopAffordance`
    needed for subagents only, the session's idle state is not the pinned signal,
    and an error-then-close exits 1 (phase 6).
  - Runtime scorecard, the one runtime change in this phase (logging only): every
    `[turn]` line of a turn carries the app session id (a new chat's `start` said
    `session=new`), and `end`/`failed` carry `dropped=`, the SDK frame kinds
    nothing handled. `scripts/runtime-scorecard.mjs` reports per turn run start →
    first frame and → result, the live `claude` processes with their memory, and
    available memory. Baseline from the logs before any phase-1 change (246 turns,
    2026-09-28 → 10-05): run start → first frame p50 3.3 s resumed, 3.1 s new,
    p90 4.4 s; run start → result p50 61 s, p90 500 s; 20 failed runs, 8 error
    results, 12 aborts. Probe split of "Starting": spawn 2.7–2.9 s, transcript
    load ≤ 0.4 s, warm turn to `init` 50–80 ms. Memory: an idle `claude` ~122 MB
    private; three open took available memory down 203 MB.
  - Overlapping plans' Next lines edited: TypeScript conversion phase 5 is
    superseded by phase 6; subagent visibility phase 5 and rewind Phase B wait on
    phase 7; chat history performance phase 13 lands with phase 2 and its phase 11
    is coordinated with phase 3; Claude permission default and Claude settings
    phase 6 read session state from phase 5; the flight recorder's chat-path core
    is phase 1b.

- [ ] 1. **Quick wins on today's runtime — est. 2–3.**
  - Done: the id-space slips (context refresh, abort record, forked resume),
    with fake-`Query` turn tests in `provider-runtime.test.ts` that phase 6 extends.
  - Built, not yet live-checked: `chat.control`. A composer change during a
    running turn calls `setPermissionMode`, `setModel` or `applyFlagSettings` on
    the live query, gated by the capability matrix's new `controlModes` (`live`
    for Claude, `next-turn` elsewhere). The sessions row is still written by the
    composer's own requests; "Default" effort resolves to the model's own level,
    and `max` waits for the next send (the flag layer cannot carry it).
  - Done, no code: AskUserQuestion in bypass does not reproduce. All 12 calls in
    CLIde transcripts from 2026-09-16 to 10-06 were shown and answered, 4 of
    them in bypass; `canUseTool` never short-circuits interactive tools.
  - Built, with `chat.control`: `allowDangerouslySkipPermissions: true` on every
    Claude chat query, so a live switch to bypass works (probe 5).
  - Built: `CLAUDE_CODE_EMIT_STARTUP_TIMING=1` on chat queries. `[turn]
    first-frame` carries `ready_ms` (spawn to input ready), `[turn] result` carries
    `request_ms` and `ttft_ms`, and the scorecard summarises all three.
  - Built, not yet seen in the app: the slash menu adds `supportedCommands()` from
    an idle query per project (49 rows here, 2.1 s), cached 30 minutes, minus the
    last `init`'s terminal list and the commands whose state CLIde does not yet
    read back. CLIde's own 11 stay and win name clashes.
  - Built and checked against the real CLI (aborts at 0.6–4.2 s, all mapped,
    including one with no frames): `Options.sessionId` for new sessions. The
    mapping is recorded at the first frame as before, or once a frame-less run's
    transcript appears (the CLI writes it as it exits); recording it before spawn
    would map a chat whose spawn failed to a transcript that never existed.
  - Built: the live `tool_use_result` reaches tool rows, and chat queries ask for
    `thinking.display: 'summarized'` (measured: Opus's thinking text is empty
    without it, 141 characters with it; Haiku accepts it).
  - You: during a running Claude reply, switch the mode in the composer; the
    next tool call follows it without a new message. Agent, live (done
    2026-10-06): aborted new chats map their transcript, against the real CLI;
    the slash menu on a test server lists 69 commands, 41 from the CLI.

- [ ] 1b. **Chat-path flight recorder — est. 1–2.** The chat-path core of the
  [diagnostics flight recorder](diagnostics-flight-recorder.md), built before
  phases 2–3 change what the client receives, so a "nothing appeared" report from
  the phone says which of its five causes it was.
  - Built, not yet seen on the phone: `src/utils/flightRecorder.ts`. Per frame
    reaching the WebSocket listener: kind, short session and run ids, `seq`,
    listener count, and handler notes (`stored`, `buffered`, `subagent`,
    `no-session`, `dup`, `threw` with a redacted message and top stack frames);
    the store adds `no-id`, `cap`, `detached` or `hidden` when a live row does
    not reach the merged view. Also sends (type, session, sent or not), socket
    connect/open/close/watchdog/wake and page visibility. Never contents.
  - `?clideRecord=1` turns it on per origin before React starts (`=0` turns it
    off and deletes what it kept). Each page load keeps its own storage key, 300
    events, newest three loads; identical consecutive frames fold into one line.
    A Copy / Clear / Off bar, built outside React, sits top right below the
    header. No Settings screen: that stays in the flight-recorder plan's phase 3,
    with its boot, service-worker and auth probes.
  - Off costs one null check per call site; 12 recorder tests plus a store case.
  - Agent, live (done 2026-10-06, main's client on Vite against the 3002 test
    server): a Haiku turn recorded subscribe → send → status, thinking and text
    `stored` → complete, with no message text; Copy, and Off clearing storage.
  - You: open a chat on the phone with the parameter, send a message, copy the
    block; it lists the turn's frames by kind and nothing you wrote.

- [ ] 2. **Word-by-word replies — est. 1–2.**
  - `includePartialMessages`; the normalizer reads the wrapped `stream_event`;
    the server coalesces deltas into `text_delta` frames that take no replay
    slot; subagent `stream_event`s are dropped.
  - The client reuses the existing `stream_delta`/`stream_end` path and its
    100 ms buffer, never a parallel one. The final row reconciles by API message
    id plus block index, replacing the store's text matching, and keeps its real
    row id.
  - A session not on screen updates one buffered row, not one row per chunk.
    Today each delta appends its own row and counts against the 500-row live
    cap, so background sessions would show duplicated text.
  - The "Sent" stage moves from the first `rate_limit_event`, which can arrive
    after the reply or not at all on a warm turn (probe 1), to the `message_start`
    stream event.
  - [Chat history performance](chat-history-performance.md) phase 13 (cost per
    chunk) lands here.
  - You: ask something with a long answer; it appears word by word; reload, and
    the same reply shows once. Agent, live: the scroll benchmark and history
    budgets hold.

- [ ] 3. **Typed wire in place, no behaviour change — est. 2–3.**
  - `NormalizedMessage` moves to `shared/chat-protocol/` as the row and event
    unions. The client's copy is deleted, `WebSocketContext` frames are typed,
    and `ChatMessage` is typed. Type errors drive the fixes; no index signature
    remains.
  - Every normalizer sets `ToolKind`; the client renders tools by kind with
    per-name overrides. The tool-name branches in `MessageComponent`,
    `ToolRenderer`, `toolActivity.ts`, `operationDetail.ts` and `toolConfigs.ts`
    go.
  - `MessageComponent` switches exhaustively on row kind.
  - The history bench patches exact source text in `MessageComponent.tsx` and
    `useChatMessages.ts` and fails with "Counter seam changed" if it moves; move
    those markers in the same commit.
  - You: Claude and Codex tool rows look unchanged on phone and laptop, before
    and after a reload. Agent: full `npm test` (a protocol change).

- [ ] 3b. **Failure pass and product bar: research, no code — est. 1.** Gaps
  the [pillar check](../../ARCHITECTURE.md#quality-goals-pillars) found.
  - Failure pass: for every call out of CLIde (provider processes, the APIs
    behind them, WebSocket, Git, MCP, scheduled sends), what you see when it
    fails, hangs or half-succeeds. Each silent case becomes an item in phases
    4–6, or a TODO line if it is outside the runtime.
  - Product bar: what Claude Code's CLI and desktop app, T3 Code and Happy do
    that CLIde lacks. Each gap is mapped to a phase here, to the `/next` mobile
    plan, or declined with a reason. It runs before phase 5 so anything that
    needs the protocol lands in it.
  - You: read both lists and say which gaps matter.

- [ ] 4. **Session host, part 1: busy states, writers, lifecycle — est. 1–2.**
  - The three busy predicates, each caller moved to the right one. A send to a
    pinned session (background tasks running, no turn) becomes a new turn on the
    held input instead of RUN_IN_PROGRESS.
  - The one-writer rule for idle processes and for the agent API.
  - The update lease per turn; updates drain idle processes.
  - SIGTERM closes every handle; start-up sweeps orphans.
  - The memory floor and idle timeout, counting every `claude` spawn. Measured
    sizes to set them by: an idle `claude` ~122 MB private, ~150 MB shared-fair
    (PSS), one mid-turn with tool children ~170 MB; three open took available
    memory from 637 to 434 MB with the host's usual load.
  - No wire change. You: start a dev server in a chat, then send another
    message; it goes through. Agent, live: Claude and Codex send, stop, resume
    and approve; a scheduled message fires; a CLI update with an idle session.

- [ ] 5. **Session host, part 2: protocol v2 — est. 2–3.** Needs
  [message-edit-model](message-edit-model.md) phase 3 first.
  - The envelope's `v`, with `client_outdated` on a mismatch.
  - Session-scoped `seq` and `runId`, turns inside the session handle, replay of
    the current turn, and the per-turn after-`complete` drop.
  - Fan-out to every socket; subscribe replaces the set.
  - The server-side queue (`input_queued`, delivered at idle); the browser's
    `localStorage` queue migrates to it.
  - Server-held session state with requested and effective values, pushed as
    `session_state` on change and on subscribe. It extends the store's existing
    per-session model, effort and fast-mode fields rather than adding a parallel
    path.
  - Notifications keyed by turn.
  - Tests: extend `chat-run-registry.test.ts` and the conformance cases in
    `chat-session.test.ts`. Each provider, with app and provider ids unequal:
    send, stream and request round trip; abort before and after the provider id
    exists; exactly one turn completion; replay after reconnect; two sockets on
    one session; a send while busy is queued, not rejected.
  - You: open one Claude chat on phone and laptop, send from the laptop; the
    phone shows the reply live, and a mode change on one shows on the other.
    Queue a message on the phone and close it; it still sends.

- [ ] 6. **Claude long-lived session, behind `CLIDE_CLAUDE_SESSIONS=persistent` — est. 3–4.**
  - Everything under "Claude session" above.
  - The idle signal is `session_state_changed` (its env var works, probe 8). It
    reports idle while background shells still run (probe 11), so `pinned` comes
    from `background_tasks_changed`, not from it.
  - `perTaskStopAffordance` matters for background subagents: a bare interrupt
    already spares background shells and kills subagents (probe 3).
  - Error results never end the session (probe 7), but closing the input after
    one makes the CLI exit 1 and the iterator throw; the host treats that as a
    normal close. A process that exits on its own (crash, OOM kill) marks the
    session closed and fails its running turn; the next send reopens it.
  - Delivery is the `command_lifecycle` `queued`/`started` frame for the sent
    uuid; a send whose uuid is `cancelled` is reported undelivered.
  - Eviction and reopen as under "Session host"; reopening is a cold resume.
  - Phase 1's workarounds for the per-message process go: an aborted new chat's
    mapping waits on the process exit, not a 5-second file check; the command
    list comes from the open session, and the idle `claude` per project stays
    only if a project with no open chat still needs it — decided by measuring.
  - Tests on an injected fake `Query`: user- and provider-initiated turns;
    interrupt and stopping; live controls and the reconcile table; idle close
    and reopen, stale reopen, rewind reopen, `/clear` remap, replaying
    the phase-0 fixtures. Re-run the probe through the adapter, and on every SDK or
    CLI bump after: `command_lifecycle` and both env switches are undocumented.
  - You: send two messages in a row; the second shows no "Starting". Start a
    background job, press Stop on the reply; the job keeps running and has its
    own stop. Leave a chat idle past the timeout, then send; it resumes normally.
  - Agent, live: no `[turn] start` respawn between messages; a background job
    wakes the chat after an hour; resident memory with three open sessions,
    against the floor. The flag defaults on after Grayson accepts.

- [ ] 7. **Every Claude message and control has a home — est. 3–4.**
  - The disposition record, filled from the table above; one per-row mapper for
    live frames and JSONL rows; the cross-row folds (tool-result attachment,
    subagent files, token crediting, compact references, echo removal) move to
    `shared/`; a golden test holds live-then-folded equal to `fetchHistory` for
    the same recorded session. History-only row types get their own list from
    real transcripts.
  - Commands: `supportedCommands()` and `commands_changed` feed the menu; slash
    text is sent natively; `local_command_output` becomes a command-output row;
    terminal-only commands are hidden. `/model`, `/effort`, `/fast`, `/clear` and
    `/rename` leave the hide list once their state is read back
    (`conversation_reset`, the session title, the composer controls).
  - A task strip from `task_*`, `background_tasks_changed` and
    `backgroundTasks()`.
  - Requests: `onElicitation`; `onUserDialog` with `supportedDialogKinds`.
  - Notices: `informational`, `notification`, `model_refusal_*`,
    `permission_denied`, `auth_status`, `memory_recall`.
  - A one-line turn summary from `result` (the mockup's "read 6 files · edited
    3, +42 −7 · tests passed").
  - `rewindFiles` (rewind Phase B), `forwardSubagentText`, `promptSuggestions`,
    `includeHookEvents`, MCP status and controls, `accountInfo` (replacing
    credential-file inference), plugin and skill reloads, session titles.
  - The SDK map's coverage table is generated from the record by a test; `tsc`
    fails when an SDK bump adds a message type.
  - Drift reaches past message types: every `Options` field, `Query` method and
    hook event in `sdk.d.ts` gets an entry (the phase that uses it, or why it is
    not surfaced), and a test fails by name on one the record lacks, the way the
    settings catalog test does for settings keys.
  - You: run `/usage` in the composer; its output appears as a row. A finished
    turn shows its one-line summary. Agent: the golden test passes.

- [ ] 8. **Controls from capabilities, requests across sessions, the provider kit — est. 2–3.**
  - The composer applies `live` controls immediately and `next-turn` ones at
    send, from the capability modes, and shows requested against effective.
  - One client store of pending approvals and questions for every session, not
    only the one on screen. This is what lets the mockup's Home answer a
    request from a card.
  - Permission unification stays with [the Claude settings plan](claude-settings-surface.md)
    phase 6; this phase gives it the session state it needs.
  - The provider kit: one provider id list in `shared/`; a server descriptor
    endpoint (label, logo key, capability defaults) that drives the client's
    provider lists; `docs/maps/adding-a-provider.md` replaces the README
    section; phase 5's conformance suite is the gate a new provider passes.
  - Provider-name checks a capability can replace go; per-provider settings,
    login, MCP and logo screens keep theirs. Capability flags nothing reads are
    consumed or deleted.
  - Provider updates name what has no home: the Codex protocol test also lists
    App Server notifications CLIde does not handle (from the bindings
    `check:providers --protocol` already generates); `check:providers` ends
    with each provider's surfaces that have no home; the capability map's
    tables are generated from the descriptors.
  - You: in a Codex chat the composer offers only controls Codex can change; in
    a Claude chat a mode change applies to the running reply.

- [ ] 9. **Cleanup — est. 1.**
  - The from-scratch review: every inherited workaround is
    gone, or has a written reason a client built today would keep it.
  - Remove the phase-6 flag and Claude's per-message chat path. `run()` stays
    for one-shot jobs (commit messages, the agent API).
  - Update the SDK map (snapshot and bottom line), the capability map, code
    anchors, the websocket and providers READMEs, and the `AGENTS.md` routing
    table. Narrow the TypeScript conversion plan to Codex, Cursor, OpenCode and
    notifications. Archive this plan and its design.

## Done when

- Two messages in a row in one Claude chat start no new process, and a
  background job can wake the chat by itself.
- A mode or model change applies to the running reply, and the composer shows
  the mode the session is actually in.
- Replies stream word by word, and a reload shows the same rows.
- `npm test` fails, naming the type, when an SDK bump adds a message type
  nothing handles.
- Phone and laptop on one chat see the same live turn, the same queue and the
  same mode.
- Three open Claude chats stay above the memory floor, and a chat with a
  running background job is never closed to make room.
- Adding a provider is one adapter folder plus passing the conformance suite.
- After any provider update, one command lists what is new and has no home yet.

## Pre-mortem

It failed in six months. The likeliest reasons, each already a work item:

- A CLI update dropped an undocumented frame or switch the session relies on
  (`command_lifecycle`, the session-state env var): the probe re-runs on every
  bump (phase 6), and `dropped=` in the scorecard shows new kinds (phase 0).
- Memory ran out with a few chats and a language server open: the floor reads
  available memory, so other processes count (phase 4); the scorecard shows who
  holds it (phase 0).
- A crashed process left a chat stuck "running": phase 6's unexpected-exit rule.
- A phone showed nothing after a wire change and nobody could say why: phase 1b
  before phases 2–3.
