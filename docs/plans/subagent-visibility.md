# Subagents are visible while they run and readable after they die

- Status: 1/5
- Next: Phase 2 — discover agents by listing `subagents/`, not via `toolUseResult.agentId`
- Context: transcript shape and the id rules in
  [code anchors](../maps/code-anchors.md); detail-surface rule in
  [ADR 0046](../decisions/0046-tool-detail-leaves-the-chat-column.md); this
  supersedes TODO items "Subagent tracking in the UI" and "A running subagent's
  tool calls render as the session's own".

Claude only. No other provider forks agents to disk today; the row and the
viewer take a provider-neutral shape so one can, but nothing is built for them.

Subagent transcripts are **never** indexed as sessions. Every row in an
`agent-*.jsonl` carries the *parent's* `sessionId`, so indexing them collides
with the parent row — that is why they were pulled from the sidebar, and the
constraint holds for every phase below.

## Phases

- [x] 1. **A finished `Task` keeps its children across a reload** — this commit.
  `getSessionMessages` lists `agent-*.jsonl` in `dirname(jsonl_path)`, the flat
  project slug dir; since Claude 2.1.233 they live in
  `<slug>/<provider_session_id>/subagents/`, so the glob matches nothing and
  `parseAgentTools` never runs on history. Repoint it; `SubagentContainer`
  already renders what it returns.
- [ ] 2. **An agent with no `Task` row still appears.** Discovery reads the
  `subagents/` directory instead of collecting `toolUseResult.agentId` off
  completed Task results. Background tasks and forked skills (`/code-review
  high`) write no such row, which is why they are invisible today. `agentType`
  comes from the sibling `agent-<id>.meta.json`.
- [ ] 3. **A running agent updates without a reload.** A watch on
  `subagents/**` — currently in `WATCHER_IGNORED_PATTERNS` — emits an agent
  event keyed to the parent `session_id`, on its own channel, never through
  `session_upserted`. The client drops the server's `parentToolUseId` stamp
  today, so live child tools only reach the container on refresh; that lands
  here too.
- [ ] 4. **One row per agent at its launch point.** Agent type, a
  running/done/failed dot, elapsed time, tool count, updating live. Identical
  shape for inline `Task`, background, and forked-skill agents — which kind it
  was is not something the reader should have to know.
- [ ] 5. **The row opens the agent's transcript.** Full-screen on mobile,
  rendered by the same `MessageComponent` as chat, read-only, no composer; back
  returns to the chat at that row. Desktop expands an operation list inline in
  the chat column and offers the same full transcript in an overlay.

## Done when

- A `/code-review high` run shows a live row while it works, and that row is
  still there, complete, after a reload.
- Killing the server mid-agent leaves the row readable as failed, with the
  tools it completed.
- Opening an agent transcript on a phone fills the screen; back lands on the
  chat row, not the top of the chat.
- The sidebar session list is byte-identical before and after an agent runs.

## Not doing

- Resuming or re-attaching to a killed agent. The transcript persists; the
  process does not.
- Subagent token accounting. The context ring skips `isSidechain` rows by
  design — separate TODO item.
- Any surface outside chat: no sidebar entry, no session row, no tab.
