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

- [ ] **Exercise `9a9d47b`, `a4af8bf`, and `658d536` on a real session.** All
  three shipped with static coverage only and are now running on 3001
  unverified. Two concrete checks: **Stop on Cursor and OpenCode** (they have no
  AbortController tier, so before `9a9d47b` the button did nothing), and a
  **duplicate `AskUserQuestion` panel** (one pending request answered once per
  runtime). **S**

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
