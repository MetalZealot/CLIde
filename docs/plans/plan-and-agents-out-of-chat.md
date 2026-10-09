# The plan and running agents leave the chat transcript

- Status: not started
- Next: Phase 0 — confirm each provider's plan and agent sources
- Context: [ADR 0076](../decisions/0076-plan-pins-under-header-agents-ride-working-line.md);
  [subagent visibility](subagent-visibility.md) owns the agent row and its
  transcript; [provider capabilities](../providers.md); the id rules in
  [code anchors](../code-anchors.md). The chosen layout is variant K of the
  agent-activity probe.

## Phases

- [ ] 0. Each provider's plan and agent sources are named in the provider
  reference: Claude's `TaskCreate`/`TaskUpdate` calls and its
  `~/.claude/tasks/<provider_session_id>/` store, Codex's `update_plan` and
  `spawn_agent`, and whether Cursor and OpenCode have either. A provider without
  one advertises it and draws nothing.
- [ ] 1. Task calls stop drawing their own rows. `TaskCreate`, `TaskUpdate`,
  `TaskList` and `TaskGet` leave the standalone set and fold into the activity
  row they sit in, which notes "step N done". Client only.
- [ ] 2. The plan is a banner under the header: label, `done/total`, the
  current step, a progress bar, and a checklist that drops down over the chat.
  It reads the provider's own plan state from the server, so a plan created on
  a page not yet loaded is whole after a reload, and it is absent when the
  session has no plan.
- [ ] 3. Running agents ride the Working line: a robot and count at its right
  end, tapping lists them in place, each with Stop through the SDK's
  `stopTask`. The count comes from the run's state, not loaded rows, so it
  survives a reload, and it stays while the turn is held open for background
  work.
- [ ] 4. A background command's row shows running or done, and its completion
  notice stops rendering as a status line plus an assistant message.
- [ ] 5. An agent opens full screen with its prompt, calls, text and report —
  [subagent visibility](subagent-visibility.md) phase 5, retargeted from in
  place.
- [ ] 6. Sidebar session rows show plan progress and running agents, carried
  on the session activity summary the sidebar already reads.

## Done when

- A Claude run with a task list shows the banner and no task rows, and the
  banner is complete after a reload mid-run.
- Two background agents show the robot and "2" on the Working line; Stop on
  one ends only that agent; the count is right after a reload.
- A background command finishing adds no message to the chat.
- An agent opens full screen on the phone and shows its report.
- With no plan and no agents running, the chat view shows nothing new.
- Codex's `update_plan` drives the same banner; providers without a plan show
  nothing.

## Not doing

- An Activity tab, or a running-work strip above the composer (probe round 1).
- A surface for background commands beyond their row.
- Messaging a running agent. Claude Code's terminal can; CLIde has no path yet.

## Traps

- **Pagination hides the plan's start.** Deriving the plan from loaded rows
  shows a partial list after a reload; phase 2 reads stored state. The store
  folder is named by `provider_session_id`, never `session_id`.
- **A dead run leaves agents "running".** If the server or the CLI process
  dies, the count must clear or show unknown, not spin forever.
- **The Working line scrolls away** when reading back up. Accepted in ADR 0076;
  the sidebar row covers other sessions.
- **The task tools exist on Opus 5.x only because `TodoWrite` is
  pre-approved** ([Claude settings surface](claude-settings-surface.md) phase
  6). If that changes, the banner goes quiet; that is not a banner bug.
- **The Working line is narrow on a phone.** The agent count is an icon and a
  number, never a label.
- **New state crosses the typed wire** (ADR 0067). Add plan and agent-count
  kinds there, provider-neutral, rather than reading Claude tool names in
  shared UI.
