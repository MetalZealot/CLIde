# Subagents are visible while they run and readable after they die

- Status: 4/5
- Next: Phase 5 — the row opens the agent's whole transcript; waits on [the agent runtime rebuild](agent-runtime-rebuild.md)'s phase 7
- Context: transcript shape and the id rules in
  [code anchors](../maps/code-anchors.md); detail-surface rule in
  [ADR 0060](../decisions/0060-a-calls-detail-opens-flat-in-place.md); this
  supersedes TODO items "Subagent tracking in the UI" and "A running subagent's
  tool calls render as the session's own".

Claude only. No other provider forks agents to disk today; the row and the
viewer take a provider-neutral shape so one can, but nothing is built for them.

Subagent transcripts are **never** indexed as sessions. Every row in an
`agent-*.jsonl` carries the *parent's* `sessionId`, so indexing them collides
with the parent row — that is why they were pulled from the sidebar, and the
constraint holds for every phase below.

## Phases

- [x] 1. **A finished agent call keeps its children across a reload.** History
  reads `<transcript>/subagents/`, where Claude has written agent files since
  2.1.233, instead of the flat project slug dir where the glob matched nothing.
  The client also matched only `Task`, the tool's former name, so no transcript
  on disk opened a container; one predicate now owns `Agent` and `Task`.
- [x] 2. **An agent with no `Agent` row still appears.** Discovery reads the
  `subagents/` directory rather than only collecting `toolUseResult.agentId`
  off completed calls, so background tasks and forked skills surface as a
  synthesized call carrying their type, prompt, and tools. An `Agent` call
  still awaiting its result absorbs the transcript instead of duplicating it.
  A forked skill also leaves the session row unindexed for its whole run —
  only the agent file changes, and the watcher ignores it — so history derives
  the transcript path rather than returning empty.
- [x] 3. **A running agent updates without a reload.** Live rows stamped
  `parentToolUseId` fold into their agent call instead of rendering as the
  session's, and the SDK's `task_*` events become `agent_status` rows, so a
  background agent — whose call returns at launch — reads running until its
  task ends. Codex's App Server does the same through `subAgentActivity`
  items and the agent threads it streams on the parent's connection. No
  `subagents/**` watch: runs CLIde starts already stream every agent call, and
  it would only serve sessions run outside CLIde.
- [x] 4. **One row per agent at its launch point.** Agent type and task, tool
  count and elapsed time, a shimmer while running and red when it failed — the
  activity row's shape, no dot. Identical for inline `Task`, background, and
  forked-skill agents, and for Codex's `spawn_agent`. It updates live once
  phase 3 lands.
- [ ] 5. **The row opens the agent's whole transcript.** It opens in place to the
  prompt, the calls and the report
  ([ADR 0060](../decisions/0060-a-calls-detail-opens-flat-in-place.md)); the
  agent's own text between calls is still missing, because history attaches
  only its tools.

## Done when

- A `/code-review high` run shows a live row while it works, and that row is
  still there, complete, after a reload.
- Killing the server mid-agent leaves the row readable as failed, with the
  tools it completed.
- Opening an agent on a phone shows its calls and report in place, wrapped.
- The sidebar session list is byte-identical before and after an agent runs.

## Not doing

- Resuming or re-attaching to a killed agent. The transcript persists; the
  process does not.
- Subagent token accounting. The context ring skips `isSidechain` rows by
  design — separate TODO item.
- A sidebar entry, session row, or Agents tab. The row in the chat is the
  only surface.
