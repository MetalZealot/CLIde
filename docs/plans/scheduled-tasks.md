# Scheduled tasks: saved prompts that run on a repeat with nobody watching

- Status: not started
- Next: Phase 0 — Grayson agrees or changes the positions below
- Context: [message edit model](message-edit-model.md) (the scheduled bubble),
  [runtime rebuild](agent-runtime-rebuild.md) phases 4 and 6,
  [background-session notifications](background-session-notifications.md),
  [`ARCHITECTURE.md`](../../ARCHITECTURE.md) invariants 3 and 18. Product sources:
  [Claude Code Desktop](https://code.claude.com/docs/en/desktop-scheduled-tasks),
  [Codex](https://learn.chatgpt.com/docs/automations?surface=app)

A scheduled task is a saved prompt that CLIde sends on a repeat, either back into
one chat or into a new chat each time, and that tells the phone when a run finishes
or needs an answer. It builds on the one-off scheduled messages CLIde already
sends. The new parts are repetition, a chat started by the server, approvals that
wait for someone who isn't there, and a Scheduled section.

## What exists today

Read from source 2026-10-06 unless marked.

- `scheduled-messages` sends one message into an existing chat at a set time or
  when a usage limit resets. The row is durable and timers re-arm from the table on
  start. The send runs on the server with no browser open and goes out to whoever
  is listening. A busy chat, or one open in the Shell, fails the send with a reason.
- Only an existing chat can be targeted, because the sender refuses a missing
  `session_id`. Fork already mints a chat on the server (`createAppSession`), so a
  chat started by the server has a precedent.
- An unanswered Claude approval is **denied after 55 s**
  (`CLAUDE_TOOL_APPROVAL_TIMEOUT_MS`). A scheduled run that asks for permission
  while nobody is watching carries on without the tool. Codex's path is not checked.
- Web push is wired end to end, with `action_required`, `stop` and `error` kinds.
- Scheduled sends start with `userId: null`.
- What the desktop apps do (from their docs, read 2026-10-01):
  - Schedule presets: Manual, Hourly, Daily, Weekdays and Weekly.
  - Run now, Pause, Edit, and a history that includes skipped runs and why.
  - Claude starts a new chat per run. Codex lets each task choose a new chat or
    the same chat.
  - Claude makes one catch-up run after sleep, looking back 7 days.
  - Each task has its own permission mode. In Claude, a run that needs approval
    waits in the sidebar.
  - Both offer an optional worktree per run.
  - Codex has a triage inbox that archives runs with nothing to report.
  - Both skip runs while the computer sleeps. CLIde's host does not sleep.

## Positions (proposed; agreed in phase 0)

- **A task is a definition, and each run is a chat turn sent through today's
  scheduled-message sender.** The task row owns the schedule and the next run
  time. Sending, the busy rule and the Shell rule stay one path. This rejects a
  second sender. It also rejects putting repetition on the message row, because
  the edit model treats a scheduled message as one send.
- **Each task picks a target: "this chat" or "a new chat each run".** Codex's test
  decides it: does the next run need the last one's context? "This chat" is made
  from the existing schedule picker, and "a new chat" from the Scheduled section.
  This rejects Claude's new-chat-only model, which can't babysit a PR.
- **Presets only: Manual, Hourly, Daily, Weekdays, Weekly.** Times use the
  timezone the task was made in, stored with the task, so a clock change moves
  nothing. This rejects cron text and minute intervals. Hourly is the floor
  because every run spends usage.
- **A missed run gets one catch-up, and the rest are recorded as skipped.**
  CLIde misses runs only while it is down (restart, update or crash). On start,
  the most recent missed time runs once and older ones go into history as
  skipped. The run's message says when it was due, so the prompt can judge
  staleness. This copies Claude.
- **A run that can't start is skipped, not queued forever.** That covers the
  previous run still going, a busy chat, or a chat open in the Shell
  (invariant 3), each recorded as skipped with the reason. Only one scheduled run
  happens at a time across all tasks. The others wait, and a wait that reaches
  the task's next time becomes a skip.
- **Approvals wait for you.** A scheduled run's approval has no timeout. It sends
  a push ("<task> needs approval") and is answered from the phone like any other.
  Each task stores a permission mode chosen from the provider's own modes, and
  never a bypass mode by default. The agent API's bypass is a known Trust gap, not
  a pattern to copy. This rejects auto-deny, which today turns an unattended run
  into silent half-work.
- **A run due while usage is spent waits for the reset**, through the same
  usage-reset trigger a hand-scheduled message uses, and is skipped only if the
  reset lands after the task's next run. Spent usage is not a failure.
- **Three failures in a row pause the task** and send a push saying why. A missing
  folder and a provider error each count. This stops an hourly task on a broken
  prompt from burning usage for a week.
- **Run chats live under their task.** A new-chat run is a real session, but it is
  listed under its task in the Scheduled section, not in the project's chat list.
  That way an hourly task doesn't bury real chats. The runs table maps each
  session to its task, and nothing is copied onto the session row.
- **Each provider declares whether it can run tasks.** "Can start a chat from the
  server" is a provider capability. Claude and Codex come first. Cursor and
  OpenCode report no until verified.
- **A copied database fires nothing.** A test server started from a copy of the
  production database would otherwise send every task, and every pending
  scheduled message, a second time into the same folders. An environment switch
  turns scheduling off, and test servers set it.
- **Check memory before starting a run.** If available memory is under a floor,
  the run waits. When runtime rebuild phase 4 lands, its session-host floor
  replaces this check.

## Phases

- [ ] 0. **Positions agreed.** You: read the positions and say which ones change.
- [ ] 1. **Tasks run on the server, with no new UI — est. 1–2.**
  - Work:
    - Task and run tables (a migration, with the database backed up first).
    - Next-run maths, with clock-change cases.
    - The dispatcher arms tasks beside messages.
    - Catch-up, skip rules, auto-pause and the memory check.
    - The copied-database switch. Adding it to the test-server units is a host
      change, so it needs your yes.
    - Runs carry the creating user's id.
  - Tests: cases go into the existing scheduled-messages test file.
  - Agent check, live on a test server: a task created through the API fires into
    an existing chat, and a restart across its time gives exactly one catch-up.
- [ ] 2. **Approvals wait, and the phone hears about runs — est. 1.**
  - Work:
    - Scheduled runs' approvals have no timeout.
    - Push when a run needs approval, finishes, or is paused.
    - A permission mode per task.
    - Codex's approval path checked and matched.
  - You: a task that runs `ls` in ask-first mode buzzes the phone, and approving
    from the notification finishes it.
- [ ] 3. **"Repeat" in the schedule picker — est. 1.**
  - Needs message-edit-model phase 3 first, because it changes the same bubble.
  - Work:
    - The picker gains the repeat presets.
    - The bubble says "Repeats weekdays 9:00".
    - The bubble's menu adds Run now, Pause and Stop repeating.
  - Probe on the S20 first.
  - You: set a repeat on a chat, and after it fires the next one appears.
- [ ] 4. **A new chat each run — est. 1–2.**
  - Work:
    - Chats started by the server, behind the capability flag.
    - Run chats are left out of the project list and linked from their task.
  - Agent check, live: Claude and Codex tasks each produce a run chat, and the
    project list is unchanged.
- [ ] 5. **The Scheduled section — est. 2.**
  - Placement is settled: Scheduled is a rail view in
    [the sidebar design](../designs/sidebar-rail.md), which fixes its rows,
    scope and round button. Probe the task sheet on the S20 before building.
  - Work:
    - A task list showing the next run and the last outcome.
    - A task sheet with Run now, Pause, Edit and Delete, a history with skip
      reasons, and its run chats.
    - A new-task form: name, prompt, project, provider, model, permission mode,
      target and schedule.
  - You: make a daily task on the phone, close the app, and get the push at its
    time.

## Done when

- A daily task made on the phone fires at its time with every browser closed,
  and the phone gets a push.
- A run that needs approval waits and sends a push, and approving from the phone
  finishes it.
- A restart across a run time produces exactly one catch-up run.
- A test server started from a copy of the database fires nothing.
- An hourly task left running for a week leaves the project's chat list as it was.
- Three failures in a row pause the task and say why.

## Pre-mortem

It failed in six months. The likeliest reasons, each already a work item above:

- Runs asked for permission, were denied after 55 s, and did half the job for
  weeks without anyone noticing: phase 2.
- An hourly task with a broken prompt spent the week's usage: auto-pause,
  phase 1.
- A run started while three chats were open, and the host killed one mid-reply:
  the memory check, phase 1.
- Every task ran twice because a test server copied the database: the switch,
  phase 1.
- A 9:00 task fired at 8:00 after the clocks changed: the stored timezone and the
  clock-change cases, phase 1.
- Results went unread because nobody opened the Scheduled section: every run
  sends a push that opens its chat, phase 2.
- The runtime rebuild changed how turns start and broke scheduled runs: both use
  the one sender, and runtime phase 4's live check already fires a scheduled
  message.

## Not doing

- A worktree per run. Tasks run in the project folder as it is. Add this if a task
  needs to edit while you're working there.
- Cloud runs. The host is always on.
- Triggers other than time, such as GitHub events or webhooks.
- Making or editing tasks by asking the agent in chat, and tasks that reschedule
  themselves.
- A triage inbox that hides runs with nothing to report.
- A per-task "always allow" list. The allow rules a chat already uses apply.
