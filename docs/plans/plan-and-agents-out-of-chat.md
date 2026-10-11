# The plan and running agents leave the chat transcript

- Status: 13/13
- Next: none; Grayson checked phases 11–13 live (2026-10-11) and the branch merged
- Context: [ADR 0076](../decisions/0076-plan-pins-under-header-agents-ride-working-line.md),
  [ADR 0078](../decisions/0078-background-work-sits-behind-a-header-button.md),
  [ADR 0079](../decisions/0079-header-menus-are-a-sheet-from-behind-the-header.md),
  [ADR 0080](../decisions/0080-background-work-rides-the-activity-line.md);
  [subagent visibility](subagent-visibility.md) owns the agent row and its
  transcript; [provider capabilities](../providers.md); the id rules in
  [code anchors](../code-anchors.md). The chosen layout is variant K of the
  agent-activity probe.

## Phases

- [x] 0. Each provider's plan and agent sources are named in the provider
  reference: Claude's `TaskCreate`/`TaskUpdate` calls and its
  `~/.claude/tasks/<provider_session_id>/` store, Codex's `update_plan` and
  `spawn_agent`, and whether Cursor and OpenCode have either. A provider without
  one advertises it and draws nothing.
- [x] 1. Task calls stop drawing their own rows. `TaskCreate`, `TaskUpdate`,
  `TaskList` and `TaskGet` leave the standalone set and fold into the activity
  row they sit in, which notes "step N done". Client only.
- [x] 2. The plan is a banner under the header: label, `done/total`, the
  current step, a progress bar, and a checklist that drops down over the chat.
  It reads the provider's own plan state from the server, so a plan created on
  a page not yet loaded is whole after a reload, and it is absent when the
  session has no plan.
- [x] 3. Running agents ride the Working line: a robot and count at its right
  end, tapping lists them in place, each with Stop through the SDK's
  `stopTask`. The count comes from the run's state, not loaded rows, so it
  survives a reload, and it stays while the turn is held open for background
  work.
- [x] 4. A background command's row shows running or done, and its completion
  notice stops rendering as a status line plus an assistant message.
- [x] 5. An agent opens full screen with its prompt, calls, text and report —
  [subagent visibility](subagent-visibility.md) phase 5, retargeted from in
  place.
- [x] 6. Sidebar session rows show plan progress and running agents, carried
  on the session activity summary the sidebar already reads.
- [x] 7. A finished plan keeps its banner, muted, until a new plan replaces it.
- [x] 8. Agents and background commands move off the Working line into one
  list behind a header button (ADR 0078): Running with Stop, Done until
  cleared, each full screen. A command shows its output tail, live from the
  run, then from the provider's saved file.
- [x] 9. A background agent's report comes from its hand-back, and a notice
  loaded before its call still hides once the call arrives, as does each repeat
  notice an agent sends by task id alone when it stops again.
- [x] 10. The header's kebab gives way to the title, which opens the same menu
  headed by the full title; tapping that line renames the session in place,
  replacing the Rename item.
- [x] 11. On phones the title menu and the usage ring open one sheet from
  behind the header (ADR 0079); wide screens keep popovers.
- [x] 12. The background-work list moves from the header to a mark at the right
  end of the last activity line, shown only while it holds work, robot for
  agents alone and layers otherwise, in a white pill with the running count;
  it opens in the bottom sheet (ADR 0080). The jump-to-bottom button shows the
  same icon and count while scrolled up.
- [x] 13. While the run is open, what runs comes from the provider's live
  task list (Claude's `background_tasks_changed`): a task an agent launched
  joins the list named "from" its agent, with Stop, so the mark's count matches
  the Working line's. Providers without the list keep the derived one.

## Done when

- A Claude run with a task list shows the banner and no task rows, and the
  banner is complete after a reload mid-run.
- Two background agents show a robot and "2" on the activity line; Stop on one ends only
  that agent; after the turn both are under Done and open full screen.
- A background command finishing adds no message to the chat.
- An agent opens full screen on the phone and shows its report.
- With no plan and no agents running, the chat view shows nothing new.
- Codex's `update_plan` drives the same banner; providers without a plan show
  nothing.

## Not doing

- An Activity tab, or a running-work strip above the composer (probe round 1).
- Messaging a running agent. Claude Code's terminal can; CLIde has no path yet.

## Traps

- **Pagination hides the plan's start.** Deriving the plan from loaded rows
  shows a partial list after a reload; phase 2 reads stored state. The store
  folder is named by `provider_session_id`, never `session_id`.
- **A dead run leaves agents "running".** Work still reading running once the
  run closes is listed as Ended, never as running.
- **A command's saved output is Claude Code's temp file.** Its path is not a
  public contract and `/tmp` is wiped on reboot; the view then says the output
  is gone.
- **The task tools exist on Opus 5.x only because `TodoWrite` is
  pre-approved** ([Claude settings surface](claude-settings-surface.md) phase
  6). If that changes, the banner goes quiet; that is not a banner bug.
- **New state crosses the typed wire** (ADR 0067). Add plan and agent-count
  kinds there, provider-neutral, rather than reading Claude tool names in
  shared UI.
