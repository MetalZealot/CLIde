# Post-v1.37 remaining work

- Date: 2026-08-04
- Status: Open. This is the live continuation list for everything the v1.37
  release left behind.
- Replaces: the follow-up queue in
  [the merge handoff](archive/2026-08-01-post-v1-37-main-divergence-and-merge-handoff.md),
  which is archived. Nothing here requires reading that document first.

The v1.37 integration is merged, built, deployed to 3001, and closed out. So is
the model-picker storage divergence ([ADR 0025](../decisions/0025-session-model-picks-live-in-the-database.md)).
What follows is what was deliberately not done.

Each item states what the decision or action actually is. Detail that already
exists elsewhere is linked, not restated.

## Ready now, mechanical

- [x] **Push `main` to `origin`** — **done 2026-08-04.** Fast-forward, plain
  `git push`; no `--force-with-lease` was needed, since the release was a merge,
  not a rebase. `origin/main` and local `main` have been level ever since.
- [x] **Retire the `chore/upstream-1.37` branch and its worktree**
  (`~/Projects/cloudcli-wt-upstream-1.37`) — **done 2026-08-04.** Verified first
  that the branch held nothing unique (`git log main..chore/upstream-1.37` empty,
  tip `658d536` an ancestor of `main`, worktree clean, no stashes or checkpoint
  refs, gitignored files identical to main's apart from the generated
  `.env.local` ports). Ports 3003/5175 are free. The revert path is unaffected:
  `bd61d08` is an ancestor of `main`, so it stays reachable without the branch.
  Four other fully-merged branches were retired in the same pass —
  `fix/chat-scroll-pagination` (`8537fb2`), `fix/codex-plan-mode-reset`
  (`3cdeec9`), `fix/samsung-picker-lifecycle` (`8aee41e`), and
  `fix/pwa-attachment-picker` (`449b944`) — leaving `feature/tts-and-stt` and
  `fix/synthetic-model-guard` as the only live branches.

## Live-verification debt — closed 2026-08-04

- [x] **Exercise `9a9d47b`, `a4af8bf`, and `658d536` on a real session** —
  **done 2026-08-04 on 3001**, where all three were already deployed (the two
  server fixes in the Aug-4 09:20 build, the client fix in the Aug-3 21:13 one).
  Grayson got a tool approval in Default mode, left CLIde, and returned: the
  prompt replayed (`9a9d47b`'s subscribe half — pre-fix it replayed nothing and
  the run sat until its 55s timeout) and rendered as **one** panel (`a4af8bf` +
  `658d536`). Stop mid-turn on Codex also worked, covering `9a9d47b`'s abort
  half against the runtime that commit actually rewrote.
  - Correction worth keeping: the duplicate-panel bug is **not**
    AskUserQuestion-specific. `claude-runtime.provider.js:102` files every
    interactive request in the one `interactiveRequestRegistry` and only labels
    it `user_input` vs `tool_approval`, and the broken lookup filtered on
    `sessionId` alone — so any tool approval reproduces it. No need to coax an
    AskUserQuestion out of the model to test this path.
- [x] **Stop on Cursor and OpenCode** — **closed 2026-08-04 by test, not live
  run.** They have no AbortController tier, so before `9a9d47b` the button did
  nothing — the case Claude masks and Codex can't speak for. Neither CLI is
  installed and `cursor-agent` needs a paid account, so the stub-CLI route was
  taken instead: a hanging fake on `PATH` drives the real `spawnOpenCode` /
  `spawnCursor`, and the test asserts `abort*Session(appSessionId)` kills it
  while `abort*Session(providerSessionId)` returns false. That pins the
  runtime-side keying `chat-session-addressing.test.ts` stubs out (it fakes only
  the runtime boundary). New: `cursor-runtime.provider.test.js`; extended:
  `opencode-runtime.provider.test.js`. Server suite 404 → 406.
  - Both guards were mutation-checked: re-keying `processKey` to
    `providerSessionId || sessionId` — the pre-`9a9d47b` shape — fails each one
    on "Timed out waiting for the run to register under the app session id". A
    guard that has never been seen to fail is not a guard.
  - The stub self-exits after 30s. Without it the first mutation run wedged the
    test runner: the orphaned child held stdio open, so `node --test` never
    exited even though the test itself had already failed.

## ADR reassessment — two decisions left

The third item, the ADR 0003 model-picker divergence, is done. These two are
not, and both are a yes/no rather than a build.

- [ ] **Does the Codex App Server transport earn its maintenance?** (ADR
  0011/0012.) **Reframed 2026-08-04 — the original "it is opt-in" premise was
  stale.** Since `cbf2960` it is the *default* interactive Chat transport:
  `getConfiguredCodexChatTransport` (`codex-chat-transport-state.ts:69`) returns
  `app-server` unless `CLIDE_CODEX_CHAT_TRANSPORT=sdk`, and the SDK path is
  described in its own comment as "an explicit emergency escape hatch". It is
  1,840 lines of implementation behind 1,005 lines of tests, with a startup
  fallback to the SDK already built in. So this is no longer "drop a side
  experiment" — it is "revert the default path to the escape hatch". What stands
  from the original case against: upstream does not know it exists, and it broke
  during the v1.37 merge because upstream changed a runtime contract it could not
  see (`3e84bd7`). The case for is in
  [the transport architecture map](../maps/2026-07-25-codex-chat-transport-architecture.md);
  its own outstanding work is verification, not code. **M**
- [ ] **ADR 0016 is written but entirely unimplemented** — status `Accepted`, yet
  no `git-common-dir` or `commonDir` anywhere in `server/`, `src/` or `shared/`
  (re-verified 2026-08-04) — and it is what blocks adopting upstream's worktrees
  module. Note the exit originally listed here, "downgrade it to Proposed", is
  not available: [the decision log's README](../decisions/README.md) is
  append-only and recognises only `Accepted` or `Superseded by NNNN`, with no
  `Proposed` state. The two exits that fit the convention are to build Phase 0 so
  the Accepted status becomes true, or to write a superseding ADR recording the
  deferral and harvest upstream's `listWorktrees` descriptor and test harness
  under it. Blocks the next item. **M–L**

## Queued specs, not started

In the order Grayson set on 2026-08-03. Each has its own document; none needs a
new one.

1. [ ] **Source Control and repository-grouped worktrees** —
   [review](2026-07-30-post-v1-37-source-control-worktree-review.md). Rejects
   upstream's Worktrees feature as shipped. Start from the merged Git module,
   and settle ADR 0016 first. **L**
2. [ ] **WebSocket liveness** —
   [review](2026-07-30-post-v1-37-websocket-liveness-review.md). Compare the
   merged gateway against ADR 0006. The open question is whether the client
   watchdog accepts any inbound activity or requires a matched application echo.
   **M**
3. [ ] **Source Control commit-message model selection** —
   [spec](2026-07-29-source-control-commit-message-model-selection.md). Ready
   for a fresh worktree, but rebaseline on the post-v1.37 Git module and panel.
   Must stay provider-neutral and ephemeral, and keep commit/hook errors
   visible. **M**
4. [ ] **MCP scope-storage collision guard** —
   [spec](2026-07-30-mcp-scope-storage-collisions.md). Re-map its source paths
   after the module migration, then prevent same-file/same-table user/project
   scope aliases without de-duplicating legitimate entries. **M**
5. [ ] **Provider architecture consolidation** — baseline is
   [the current contract](../maps/CLIde_Provider_Architecture_Current_Contract.md) and
   the living maps. Kept separate from release work on purpose. **L**

## The lesson worth keeping from v1.37

Only 5 files conflicted textually in the final merge, and 39 in the first — but
**every genuine defect was in a file that merged cleanly**. Conflict markers
were an anti-signal. When both sides refactor toward the same shape, diff the
*contract* surfaces — runtime options, gateway addressing, provider context —
rather than trusting Git's conflict set.
`server/modules/websocket/tests/chat-session-addressing.test.ts` is the right
shape of artifact: one per contract, driving every provider with the ids
deliberately unequal.
