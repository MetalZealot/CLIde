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

- [ ] **Push `main` to `origin`.** 27 commits ahead, fast-forward, plain
  `git push` — no `--force-with-lease`, since the release was a merge, not a
  rebase. **S**
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

## Live-verification debt

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
- [ ] **Still unverified: Stop on Cursor and OpenCode.** They have no
  AbortController tier, so before `9a9d47b` the button did nothing — the case
  Claude masks and Codex can't speak for. Neither CLI is installed and
  `cursor-agent` needs a paid account, so live testing is the expensive path.
  Cheaper close: `opencode-runtime.provider.test.js` already stubs the CLI as a
  shell script on `PATH` and drives the real `spawnOpenCode`; extend it with a
  stub that hangs, then assert `abortOpenCodeSession(appSessionId)` kills it.
  That pins the runtime-side keying `chat-session-addressing.test.ts` stubs out
  (it fakes only the runtime boundary). Same shape for Cursor. **S/M**

## ADR reassessment — two decisions left

The third item, the ADR 0003 model-picker divergence, is done. These two are
not, and both are a yes/no rather than a build.

- [ ] **Does the Codex App Server transport earn its maintenance?** (ADR
  0011/0012.) The case against: it is opt-in, upstream does not know it exists,
  and it broke during the v1.37 merge because upstream changed a runtime
  contract it could not see (`3e84bd7`). The case for is in
  [the transport architecture spec](2026-07-25-codex-chat-transport-architecture.md);
  note that spec's own outstanding work is verification, not code. Decide keep
  or drop before doing any more work on it. **M**
- [ ] **ADR 0016 is written but entirely unimplemented** — no `git-common-dir`
  anywhere in `server/` or `src/` — and it is what blocks adopting upstream's
  worktrees module. Two honest exits: build its Phase 0, or downgrade it to
  Proposed and harvest upstream's `listWorktrees` descriptor and test harness.
  Blocks the next item. **M–L**

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
