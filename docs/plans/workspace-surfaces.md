# The workspace tabs offer what the desktop agent apps' side panels offer

- Status: not started
- Next: Phase 1 — a plain Terminal tab takes Shell's place, and Shell view moves to the chat kebab
- Context: [subagent visibility](subagent-visibility.md) (phases 3 and 5 feed
  this); detail-surface rule in
  [ADR 0060](../decisions/0060-a-calls-detail-opens-flat-in-place.md);
  [provider capability map](../maps/clide-provider-capability-map.md)

Measured against T3 Code's "Open a surface" launcher (Browser, Terminal,
Files, Diff, Pull request, Agents; read from its installed v0.0.42 client),
Codex and Claude desktop. CLIde's Shell tab is not a terminal: it reopens the
open chat in the provider's own CLI (`claude --resume`, `opencode --session`,
…). No app compared exposes that as a tab, and CLIde has no plain terminal.

Target bar, phone: **Chat · Terminal · Files · Git · [swappable ▾]**, where the
swappable slot lists Browser, Tasks, Agents and plugins. Desktop's header
tabs get the same set.

## Phases

- [ ] 1. **Terminal replaces Shell in the bar.** A new `terminal` tab runs a
  plain shell in the selected checkout — the plain-shell mode already exists
  and needs no server work. Shell view leaves the bar and becomes "Open in
  CLI" in the chat's kebab menu, opening the same view it does today. One
  phase, because the phone bar has exactly five places.
- [ ] 2. **A Tasks surface shows the open chat's task list.** Claude keeps
  one per session through `TaskCreate`/`TaskUpdate`/`TaskList` (`TodoWrite` in
  older transcripts); Codex through `update_plan`, which CLIde currently hides
  from history. Today each call is its own row in the chat and nothing shows
  the list as it stands now. The surface shows the latest state: each item
  pending, in progress, or done. It reads from the chat's own messages, so it
  needs no subagent work; Cursor and OpenCode show the empty state.
- [ ] 3. **A running subagent updates without a reload.** This is
  [subagent visibility](subagent-visibility.md) phase 3; build it there. An
  Agents tab without it shows a snapshot that goes stale.
- [ ] 4. **An Agents surface lists the open chat's agents.** This chat only,
  like T3. One card per agent: a status dot (working, completed, failed,
  stopped), type and task, a running timer, the latest tool or progress line,
  and tool count · tokens. Tapping a card jumps to that agent's row in the
  chat. An empty chat says what will appear, not a blank. It sits in the
  swappable slot on the phone and as a tab on desktop. Claude and Codex
  (`spawn_agent`) feed it; Cursor and OpenCode show the empty state.
- [ ] 5. **The chat shows that agents are running.** A strip above the
  composer, shaped like the Browser preview, reading e.g. "2 agents working";
  tapping it opens Agents. When Browser and agents are both active, the two
  collapse into one strip. Agree that combined state with Grayson as a mockup
  before building it.

## Done when

- The phone bar reads Chat, Terminal, Files, Git and the swappable slot; the
  Terminal tab opens a prompt in the checkout's directory, not a provider CLI.
- "Open in CLI" from the chat kebab opens the chat in the provider's CLI,
  exactly as the Shell tab does today, for all four providers.
- During a `/code-review high` run, the Agents surface shows each agent
  working with a ticking timer, then completed, with no reload.
- The same run shows the strip above the composer while any agent works, and
  it disappears when the last one finishes.
- In a Claude chat that has made a task list, Tasks shows every item with
  its current state, and ticks one off live as the agent completes it.
- A chat with no agents shows the empty state, on Claude and Codex.

## Not doing

- A Diff tab. The Git tab already shows the working tree's diff and each
  commit's; the file viewer does not show diffs, and T3's per-thread diff is a
  narrower version of the same view.
- One Agents list across every session. The sidebar already carries each
  session's status.
- A Pull request surface. How PRs belong in CLIde's Git control is not yet
  assessed.
- TaskMaster. CLIde no longer ships it, so the Tasks surface owns the `tasks`
  id outright.
