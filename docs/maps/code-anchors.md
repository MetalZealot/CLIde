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
`autoCompactThreshold`; only answerable *mid-turn*, so `claude-sdk.js` fires it once per
turn without awaiting), then `resolveClaudeContextCeiling`
(`claude-context-window.ts`) as the fallback for history reads and post-restart
sessions. `CONTEXT_WINDOW` outranks both. The fallback's `CLAUDE_MODEL_CONTEXT_SPECS`
table mirrors the SDK's embedded model registry (no runtime accessor exists), so
**refresh it on every SDK bump** — and note its arithmetic is calibrated against
measurements in `scripts/verify-context-usage-sdk.ts`, not decoded. See ADR 0014.

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

## Model picker: catalog and active-model are two systems

The **catalog** (the static list of selectable models) is server-side and hardcoded:
`server/modules/providers/list/claude/claude-models.provider.ts`
(`CLAUDE_FALLBACK_MODELS`). The frontend renders whatever `GET /:provider/models`
returns.

**Per-session active-model tracking** — which model a given session is actually running,
as opposed to the catalog — is its own subsystem: client `SessionSlot`, server
`GET /api/providers/:provider/sessions/:sessionId/active-model`, `resolveResumeModel` /
`pickSupersedesTranscript` (`server/modules/providers/`). It is actively evolving with
several known-open bugs; read the "Model picker follow-ups" section of `docs/TODO.md`
and ADRs 0003 and 0025 before touching it.

## Frontend

- **`MessageComponent.tsx`** — single memo'd component. Copy-control gating is
  `shouldShowUserCopyControl` / `shouldShowAssistantCopyControl`; AskUserQuestion option
  parsing is the `/[❯\s]*(\d+)\./` block mid-file.
- **Sidebar long-press** — `useLongPress` (`src/hooks`) returns
  `{ handlers, isPressing }`; rows recess off `isPressing`, **not** CSS `:active`, which
  is unreliable on touch (ADR 0009). Context menu is `SidebarContextMenu`. Starred-first
  ordering is `compareSessionsStarredFirst` (`src/components/sidebar/utils/utils.ts`),
  applied on every session-list surface.
- **Biggest state hooks — reach for these by name** rather than grepping cold:
  `useChatComposerState`, `useProjectsState`, `useSidebarController`,
  `useChatSessionState`, `useSessionStore`, `useGitPanelController`.

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
