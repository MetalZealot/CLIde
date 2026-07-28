# Context-usage staleness: live re-capture during long turns

**Date:** 2026-07-28
**Status:** Planned — Phase 1 approved, Phase 2 gated on user approval
**Scope:** Claude only (exempt from the multi-provider rule — see CLAUDE.md "Multi-provider
compatibility goal"; `claude-sdk.js` internals and `claude-context-usage.ts` are
Claude-specific by design). Do **not** wire Codex/Cursor/OpenCode into this.

---

## Problem

On a long turn, the `/context` modal ("SESSION TELEMETRY → Context Window") shows a
headline that disagrees wildly with the composer's context ring — e.g. ring at **103K**
while the modal says **28,269 / 967,000 … Measured 4 min ago**.

This is not one stale number. The two surfaces read **two different sources**:

| Surface | Source | Liveness |
|---|---|---|
| Composer ring (`TokenUsageSummary.tsx`) | `token_budget` WS frames | **Live** — one per assistant step |
| `/context` modal headline + breakdown | SDK `getContextUsage()` control request, cached | **Once per turn**, ~1s in |

- Ring path: `server/claude-sdk.js` emits `kind: 'status', text: 'token_budget'` for every
  non-`result` SDK message (grep `extractTokenBudget`); the client consumes it in
  `src/components/chat/hooks/useChatRealtimeHandlers.ts` (grep `token_budget`, in the
  `case 'status'` block) and feeds the wheel.
- Modal path: `captureClaudeContextUsage(capturedSessionId, queryInstance)` in
  `server/claude-sdk.js` is fired **exactly once per turn**, guarded by a
  `contextUsageRequested` boolean, roughly 1 second into the turn. The reading is cached
  (memory + one JSON file per session) by
  `server/modules/providers/list/claude/claude-context-usage.ts`. The `/context` handler in
  `server/routes/commands.js` (grep `"/context":`) then renders `ceiling.totalTokens`.

So three minutes into a turn, the modal is faithfully reporting what was true at second
one. The `Measured N min ago` line is honest — the number behind it is just very old.

### Why the modal doesn't just use the live ring number

Deliberate. `commands.js` has a comment above the `usedTokens` fallback explaining it: the
transcript scan and the SDK reading disagree by a few hundred tokens (different extractions
of the same turn), and a modal showing one number in the headline with a breakdown of the
other "adds up to nothing." The headline is `ceiling.totalTokens` precisely so it equals the
sum of the non-deferred, non-reserved categories listed below it. **Do not break this
invariant** (see Non-goals).

---

## The hard constraint

`getContextUsage()` **only answers mid-turn.** Documented at the top of
`claude-context-usage.ts`:

- At the terminal `result` message the transport is already closing
  ("Query closed before response received"); once the generator returns, the query is gone.
- Each call costs **780–1200ms**, far too slow to `await` inline in the message loop.

Consequences that shape the whole design:

1. A refresh **can only genuinely re-measure while a turn is streaming.** On an idle session
   there is no live query to ask, and re-asking is impossible — not slow, impossible.
2. Conversely, on an idle session the last-turn reading is already *correct*: context does
   not change between turns. Staleness only matters mid-turn.
3. Therefore the highest-value fix is **not** a button. It is re-firing the capture
   periodically during a turn, which needs no UI at all.

---

## Phase 1 — Throttled re-capture during a turn (required)

**File:** `server/claude-sdk.js` only. ~10 lines.

### Current code

Near the top of the streaming loop (grep `contextUsageRequested`):

```js
let contextUsageRequested = false;
for await (const message of queryInstance) {
  ...
  if (!contextUsageRequested && capturedSessionId) {
    contextUsageRequested = true;
    void captureClaudeContextUsage(capturedSessionId, queryInstance);
  }
```

### Change

1. Add a module-level constant alongside `TOOL_APPROVAL_TIMEOUT_MS` (near the top of the
   file, ~line 50), following that constant's env-override style:

   ```js
   const CLAUDE_CONTEXT_USAGE_REFRESH_MS =
     parseInt(process.env.CLAUDE_CONTEXT_USAGE_REFRESH_MS, 10) || 60000;
   ```

2. Replace the per-turn boolean with a timestamp:

   ```js
   let lastContextUsageAt = 0;
   ```

3. Replace the guard:

   ```js
   if (capturedSessionId && Date.now() - lastContextUsageAt >= CLAUDE_CONTEXT_USAGE_REFRESH_MS) {
     lastContextUsageAt = Date.now();   // set BEFORE firing — prevents stacking
     void captureClaudeContextUsage(capturedSessionId, queryInstance);
   }
   ```

   Setting the timestamp before the `void` call is what keeps a ~1s in-flight request from
   stacking when frames stream fast. No extra in-flight flag is needed.

4. **Rewrite the block comment above that guard.** It currently states "fire it once per
   turn" — load-bearing prose in this repo, and it would now be a lie. It must explain: the
   control request only answers mid-turn, it costs ~1s so it is never awaited, and it is now
   re-fired on an interval so a long turn's reading (and the `/context` breakdown built from
   it) tracks the run instead of freezing at second one.

### Why this is enough

- The ring's **denominator** already reads the cache live — `extractTokenBudget` is called
  with `getClaudeContextCeiling(capturedSessionId || sessionId)` on every frame — so a
  fresher ceiling flows into subsequent frames automatically. No new WS frame needed.
- The `/context` modal reads the cache when it opens, so any modal opened after the first
  minute of a long turn now shows a reading at most ~60s old instead of turn-length old.
- The **persisted** reading (the one that survives a restart and a resume) currently freezes
  at each turn's start. After this, the last capture of a turn lands within ~60s of the
  turn's end, so post-run and post-restart readings are far closer to reality too.

### Known limits of Phase 1 (state these, don't try to fix them here)

- A modal **already open** does not update — its payload is a snapshot taken by
  `executeCommand('/context')`. Phase 2 addresses this.
- `captureClaudeContextUsage` returns `null` harmlessly if the turn ends between the guard
  passing and the request landing. Cost of that: at most one wasted control request per
  minute per active session.
- Each successful capture rewrites the session's JSON file (atomic write + a `pruneStore`
  `readdir`/`stat` over ≤200 files). Once per minute per streaming session — negligible,
  but worth knowing on a microSD-rooted Pi.

---

## Phase 2 — Refresh button in the modal (do NOT start without the user's go-ahead)

Ask the user before building this. Phase 1 may be sufficient on its own.

If approved:

### Server

1. Export a helper from `server/claude-sdk.js`:

   ```js
   export const refreshClaudeContextUsage = async (providerSessionId) => { ... }
   ```

   It looks the session up in the existing `activeSessions` map (there is already a private
   `getSession(sessionId)` helper — check whether it is exported and export what you need
   rather than duplicating the map), and calls
   `captureClaudeContextUsage(providerSessionId, session.instance)`. Returns the fresh
   ceiling, or `null` when there is no live query.

2. Add `POST /api/projects/:projectId/sessions/:sessionId/context-usage/refresh`. Put it
   next to the existing `/token-usage` endpoint in `server/index.js` (grep
   `loadClaudeContextCeiling` — it is in that handler).

   **Critical:** the client sends the *app* session id; the reading is keyed by the
   *provider* session id. Map it exactly the way `commands.js` does in its `/context`
   handler — `sessionsDb.getSessionById(...)` then `provider_session_id`, falling back to
   the given id. Getting this wrong silently refreshes nothing.

   Respond with something the client can distinguish: refreshed vs. no-live-turn.

### Client

3. In `src/components/chat/view/subcomponents/CommandResultModal.tsx`, add a refresh control
   to the `ContextContent` headline card. **Copy the existing pattern in the same file** —
   the PLAN USAGE LIMITS section already has one (grep `planUsage.refresh`): ghost icon
   `Button`, `RefreshCw` with `animate-spin` while loading, `aria-label`.

4. Wiring: button → `POST` the refresh endpoint → on success re-run
   `executeCommand('/context', ..., { preserveInput: true })`. `showContextModal` in
   `src/components/chat/hooks/useChatComposerState.ts` already does exactly that call and is
   the model to follow; the re-run replaces `commandModalPayload` wholesale, so the modal
   re-renders with the fresh reading. No new state plumbing for the data itself.

5. **Disable the button when the session is not streaming**, with a tooltip/hint saying the
   reading is from the last turn. An idle refresh cannot produce a new number (see the hard
   constraint) — an enabled button that changes nothing is worse than a disabled one. This
   needs the "is this session currently processing" flag threaded into the modal; check what
   `ChatInterface.tsx` already has at the `CommandResultModal` render site before adding a
   new prop.

---

## Non-goals — do not do these

- **Do not** swap the modal headline to the live `tokenBudget.used`. It kills the visible
  discrepancy for free but breaks the headline-equals-breakdown invariant that
  `commands.js` documents on purpose. The result is a headline that no longer matches the
  itemised column beneath it.
- **Do not** poll `getContextUsage()` from a timer outside the streaming loop. Outside a
  live turn it cannot answer.
- **Do not** await `captureClaudeContextUsage` in the message loop. ~1s × every frame behind
  it.
- **Do not** touch the `token_budget` frame shape, `extractTokenBudget`, or the synthetic
  zero-usage guards. Unrelated, and that guard has three parallel implementations that must
  stay in sync (see CLAUDE.md "Navigation anchors").

---

## Verification

1. **Typecheck + lint:** `npm run typecheck` and `npm run lint` (both must pass before
   committing; husky/lint-staged runs eslint on staged files anyway).
2. **Unit tests:** `server/modules/providers/tests/claude-context-usage.test.ts` exists —
   run the suite and keep it green:
   ```bash
   npx tsx --tsconfig server/tsconfig.json --test server/modules/providers/tests/*.test.ts
   ```
   (Bare `--test` fails on the `@/` alias; a directory arg fails too.)
   Phase 1's change is in `claude-sdk.js`, which has no test harness — the throttle logic is
   a timestamp comparison, so a unit test is optional. Do not build a new harness for it.
3. **Live check (the real verification):** this is a **server** change, so
   `npm run build:server`, then restart **from SSH only** —
   `systemctl --user restart cloudcli`. **Never restart from inside a CloudCLI session**;
   it kills the session doing the restarting. If you are running inside CloudCLI, build and
   then ask the user to restart.
   Then: start a turn that runs >2 minutes, open the context modal partway through, and
   confirm the headline tracks the ring within roughly a minute instead of sitting at the
   turn's opening value.
4. Check `free -h` before building — 4 GB RAM Pi.

---

## Repo conventions to follow

- **Conventional commits**, ending with the `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`
  trailer (swap in whichever model actually does the work).
  Suggested: `fix(claude): re-capture context usage during long turns`.
- **TODO.md** is tracked. Add/check off the item alongside the work, or as a small `docs:`
  commit.
- **ADR:** if implementation ends somewhere non-obvious — you try a different interval
  strategy and back it out, or Phase 2's idle-disabled button turns out to need a different
  shape — prompt the user "worth an ADR?" and draft it for `docs/decisions/`. The
  mid-turn-only constraint is arguably ADR-worthy on its own if it is not already recorded.
- Work happens on `main` in `~/Projects/cloudcli` unless another session is already active
  (`git worktree list` / `git branch -v` to check).

---

## Reference: file/symbol map

Grep the symbol, don't trust line numbers.

| What | Where | Symbol to grep |
|---|---|---|
| Per-turn capture (Phase 1 edit site) | `server/claude-sdk.js` | `contextUsageRequested` |
| Live ring frames | `server/claude-sdk.js` | `extractTokenBudget`, `token_budget` |
| Reading cache + persistence + constraints | `server/modules/providers/list/claude/claude-context-usage.ts` | `captureClaudeContextUsage`, `loadClaudeContextCeiling`, `getClaudeContextCeiling` |
| `/context` payload builder | `server/routes/commands.js` | `"/context":` |
| `/token-usage` endpoint | `server/index.js` | `loadClaudeContextCeiling` |
| Modal render | `src/components/chat/view/subcomponents/CommandResultModal.tsx` | `ContextContent`, `formatReadingAge`, `planUsage.refresh` |
| Modal data fetch | `src/components/chat/hooks/useChatComposerState.ts` | `showContextModal`, `executeCommand` |
| Ring component | `src/components/chat/view/subcomponents/TokenUsageSummary.tsx` | `UsageWheel` |
| Ring's live frame handler | `src/components/chat/hooks/useChatRealtimeHandlers.ts` | `token_budget` |
