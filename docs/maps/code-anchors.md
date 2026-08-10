# CLIde code anchors

Symbol-anchored map of the files worth *not* blind-reading. **Grep the symbol, don't
trust line numbers** — even a stale entry still points at the right symbol, and grep
finishes the job.

Moved here from the local `CLAUDE.md` on 2026-08-04 so both agents get the same
anchors. Read it when you are about to touch one of the areas below; it is not
required for unrelated work.

## Token-usage extraction has THREE parallel paths that must stay in sync

Claude Code fabricates local all-zero "synthetic" assistant rows (session-limit
notices, API errors, `"No response requested."`, model `<synthetic>`). Every path must
skip `isSidechain` + `inputTokens <= 0` rows and walk back to the last genuine turn, or
a limit-ended session reports used=0 and blanks the context ring. The three:

- `extractTokenBudget` (`claude-runtime.provider.js`, live stream) — note it checks only
  `inputTokens <= 0`, never `isSidechain`; pre-existing, verify before "fixing";
- the `/token-usage` endpoint scan (`provider-token-usage.service.ts` since v1.37, moved
  out of the old `server/index.js`; re-fetched on every session switch);
- `extractHistoryTokenUsage` (`claude-sessions.provider.ts`).

Codex has its own shared helper, `extractCodexContextTokenUsage`
(`server/shared/codex-token-usage.js`).

The **denominator** has two sources, in this order: the SDK's own `getContextUsage()`
reading, cached per session by `claude-context-usage.ts` (authoritative — also carries
`autoCompactThreshold`; only answerable *mid-turn*, so `claude-runtime.provider.js` fires it once per
turn without awaiting), then `resolveClaudeContextCeiling`
(`claude-context-window.ts`) as the fallback for history reads and post-restart
sessions. `CONTEXT_WINDOW` outranks both. The fallback's `CLAUDE_MODEL_CONTEXT_SPECS`
table mirrors the SDK's embedded model registry (no runtime accessor exists), so
**refresh it on every SDK bump** — and note its arithmetic is calibrated against
measurements in `scripts/verify-context-usage-sdk.ts`, not decoded. See ADR 0014.

`TokenUsageSummary` owns the composer summary and its provider-specific drill-ins:
Claude opens the saved per-category reading in-place, while Codex exposes account
activity only when `account/usage/read` returned it. `/context`, `/usage`, and the
near-compaction warning route into that popover through `UsagePopoverRequest`;
`CommandResultModal` no longer owns Context or Usage views.

## Session identity and addressing

Runtimes are addressed by the **app** session id, never the provider-native one.
`chat.send` / `chat.abort` / `chat.subscribe` all pass `sessions.session_id`; each
runtime resolves the provider id itself via `context.resolveProviderSessionId` when its
CLI/SDK needs one for resume. Runtimes key their process maps and interaction
registrations by the id they were handed, i.e. the app one.

This flipped in v1.37 and was the source of three separate merge defects. If you are
touching abort, approval replay, or resume, confirm which id space you are in:
`fd5d724`, `3e84bd7`, `9a9d47b`; tests in
`server/modules/websocket/tests/chat-session-addressing.test.ts`. See ADRs 0008, 0012,
0013.

**Known open defect — aborting a new session's *first* message orphans it into two
sidebar rows.** A fourth, distinct id-mapping bug: not one of ADR 0013's three, not
ADR 0008's rotation case. `capturedSessionId` is assigned only *inside* the stream loop
(`claude-runtime.provider.js`, `for await (const message of queryInstance)`), so an
abort that trips the AbortController before the SDK yields its first message runs zero
iterations — no `session_created`, `ws.setSessionId` never fires, and
**`assignProviderSessionId` is never called**. The CLI subprocess has already written
the jsonl, so the synchronizer correctly indexes it as a second session.

The reconciliation already exists and simply never runs: `assignProviderSessionId`
(`sessions.db.ts`) merges a watcher-created duplicate into the app row in one
transaction, covered by `sessions-provider-mapping.test.ts`. **This is a missing-trigger
bug, not a missing-mechanism one.** Pre-allocating the id is not available — `query()`
takes `resume` for existing sessions only and `forkSession` *returns* a new UUID — so
the fix must be reconciliation on teardown: where `capturedSessionId` is still null,
find a jsonl in the run's project transcript dir created within the run's lifetime that
no session row claims and no alias tombstones, disambiguate by matching its first `user`
row against the aborted prompt, and call `assignProviderSessionId`. **If more than one
candidate matches, do nothing** — that leaves today's behaviour, so an ambiguous case is
no worse than the status quo.

## Model picker: catalog and active-model are two systems

The **catalog** (the static list of selectable models) is server-side and hardcoded:
`server/modules/providers/list/claude/claude-models.provider.ts`
(`CLAUDE_FALLBACK_MODELS`). The frontend renders whatever `GET /:provider/models`
returns.

`ComposerModelMenu` is the only model/effort presentation. The `/models` command
increments its `openRequest` instead of opening `CommandResultModal`. The menu heads
with the provider name and opens a provider list **only while the chat is brand new**
(`canSelectProvider` in `ChatInterface`) — a session belongs to the runtime that
started it. There is no catalog-refresh action: Claude and Codex are in
`UNCACHED_PROVIDERS` (`provider-models.service.ts`), so it refetched nothing. The
server still accepts `?bypassCache=`; no client sends it.

**Per-session active-model tracking** — which model a given session is actually running,
as opposed to the catalog — is its own subsystem: client `SessionSlot`, server
`GET /api/providers/:provider/sessions/:sessionId/active-model`, `resolveResumeModel` /
`pickSupersedesTranscript` (`server/modules/providers/`). It is actively evolving with
several known-open bugs; read the "Model picker follow-ups" section of `docs/TODO.md`
and ADRs 0003 and 0025 before touching it.

`resolveClaudeModelAlias` (`claude-models.provider.ts`) maps a transcript's model id back
onto a catalog card by **substring match over alias values**, which works only because
every current alias (`opus`, `sonnet`, `haiku`, `fable`) is a family name. Two
consequences to know before adding any non-alias entry: a dated id like
`claude-opus-4-1-20250805` falls through to the `opus` card — so a session pinned to
4.1 both displays and can *resume* as Opus 5 — and the first `includes` hit wins, making
array order load-bearing. Fixing it means exact match, then a `startsWith` test against
each option's wire ids, then family fallback last, preserving the `[1m]` symmetry check.
The Shell `/model` prose bug ("Sonnet 4.5 (1M context)" instead of a `[1m]` token) is in
the same function — fix both in one pass.

## Frontend

- **`MessageComponent.tsx`** — single memo'd component. Copy-control gating is
  `shouldShowUserCopyControl` / `shouldShowAssistantCopyControl`; AskUserQuestion option
  parsing is the `/[❯\s]*(\d+)\./` block mid-file.
- **Sidebar long-press** — `useLongPress` (`src/hooks`) returns
  `{ handlers, isPressing }`; rows recess off `isPressing`, **not** CSS `:active`, which
  is unreliable on touch (ADR 0009). Context menu is `SidebarContextMenu`. Starred-first
  ordering is `compareSessionsStarredFirst` (`src/components/sidebar/utils/utils.ts`),
  reached through `getAllSessions`, so every project session list inherits it — sort
  there, not at a call site. The two lists that map sessions directly
  (`SidebarContent`: conversation search, archived groups) are server-ordered
  `isStarred DESC` and deliberately excluded.
- **Sidebar status is symbols, not row tint** (ADR 0031). `ActivityState` is
  `'blocked' | 'unread' | 'running'`; `SidebarStatusIndicator` is the single renderer,
  and the only three semantic colours are `status-attention` / `status-unread` /
  `status-running` in `tailwind.config.js`. It takes `t` as a **prop** rather than
  calling `useTranslation`, so grepping for that hook wrongly suggests it is
  un-translated. Selection stays `primary` — theme-relative, a separate visual channel.
- **The two signals have different lifecycles** — `reduceSidebarSessionSignals`
  (`src/hooks/sidebarSessionSignals.ts`). Attention follows the *request* lifecycle,
  unread follows the *viewing* one, so opening a session clears unread but never
  clears an unresolved attention signal. `collectActivitySessions` copies these above
  Pinned without removing the rows from their repositories (ADR 0030).
- **Every composer popover shares one anchor and one surface.** `useComposerMenuAnchor`
  owns above-trigger placement, outside-pointer and Escape dismissal, and reflow;
  `ComposerMenuPrimitives` owns the surface, heading, separator, and item. The three
  consumers are `ComposerModelMenu`, `ComposerPermissionMenu`, and `TokenUsageSummary`.
  Add a fourth popover by reusing both, not by re-deriving `getBoundingClientRect`
  maths. (`MessageCopyControl` positions itself independently — different placement
  semantics, deliberately not a consumer.)
- **Biggest state hooks — reach for these by name** rather than grepping cold:
  `useChatComposerState`, `useProjectsState`, `useSidebarController`,
  `useChatSessionState`, `useSessionStore`, `useGitPanelController`.
- **Composer picker state is browser-global, not per session** — surveyed 2026-07-26,
  unchanged since. `useChatProviderState` keys effort as `<provider>-effort` with **no
  session id**, so it means "the last effort picked in this browser for this provider":
  changing it in one Codex session changes what every other Codex session displays.
  Permission mode has two keys, `permissionMode-last-<provider>` and
  `permissionMode-<app-session-id>`; a mode chosen before the first send has no session
  id yet, writes only the provider key, and is never promoted when the id arrives — so a
  later conversation's choice can surface in an earlier one. Settings writes a third,
  `codex-settings.permissionMode`, which the composer never reads to initialize, despite
  Settings copy describing it as the value sessions override. None of the three is
  reconciled against what the provider actually enforced for the turn, so there is no
  requested-versus-effective distinction anywhere in the UI. Treat all of this as current
  behaviour to work around, not as a bug already being fixed.

## Build and layout

- Backend entry is `server/index.ts`; frontend is a React 18 + Vite + Tailwind SPA under
  `src/`; shared types/utils in `shared/`, imported via the `@/` alias on both sides
  (note the alias resolves differently per tsconfig — see `AGENTS.md`).
- Build outputs: `dist/` (client, from Vite) and `dist-server/` (server, from tsc).
  `dist-server/**` paths stay `.js` even though the sources are `.ts`.
- One `<provider>-runtime.provider.js` per provider under
  `server/modules/providers/list/<claude|cursor|codex|opencode>/`, wired into one WS
  server. Claude uses `@anthropic-ai/claude-agent-sdk`.
- User data (login/sessions) is a SQLite DB outside the repo, so working-tree changes
  cannot destroy it. Schema/migrations live in `server/modules/database/`
  (`schema.ts`, `migrations.ts`, `repositories/`).
