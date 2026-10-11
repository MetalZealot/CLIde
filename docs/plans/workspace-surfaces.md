# The workspace tabs offer what the desktop agent apps' side panels offer

- Status: 3/3
- Next: check the Done-when list on the phone, then delete this plan
- Context: [subagent visibility](subagent-visibility.md) owns how agents show
  in the chat; [provider capabilities](../providers.md)

Measured against T3 Code's "Open a surface" launcher (Browser, Terminal,
Files, Diff, Pull request, Agents; read from its installed v0.0.42 client),
Codex and Claude desktop. CLIde's Shell tab is not a terminal: it reopens the
open chat in the provider's own CLI (`claude --resume`, `opencode --session`,
…). No app compared exposes that as a tab, and CLIde has no plain terminal.

Target bar, phone: **Chat · Terminal · Files · Git · [swappable ▾]**, where the
swappable slot lists Browser. Desktop's header tabs get the same
set.

## Phases

- [x] 1. **Terminal replaces Shell in the bar.** A new `terminal` tab runs a
  plain shell in the selected checkout, reusing the Shell view's plain-shell
  mode; the server starts an interactive shell when given no command, under
  its own PTY key. Shell view leaves the bar and becomes "Open in CLI" in the
  chat's kebab menu, opening the same view it does today. One phase, because
  the phone bar has exactly five places.
- [x] 2. **A running subagent updates without a reload.** Built as
  [subagent visibility](subagent-visibility.md) phase 3.
- [x] 3. **Terminal is rebuilt on upstream's terminal plugin** (MIT,
  `cloudcli-ai/cloudcli-plugin-terminal`), whose plugin host CLIde removed. Its
  framework-free `session.ts` (reconnect with exact replay) and `shell.ts`
  (shell and working-directory resolution) come across nearly verbatim; the
  screen is rewritten in CLIde's React components. Layout B (actions in the
  header menu, a tab row only with two or more terminals) with the pinned key
  bar, picked from the probe. First cut verified live: the `/terminal` socket,
  reconnect with exact replay, the key bar, light/dark, Clear and Restart.
  Second cut seen live: terminal tabs with an 8-second undo on close, output search,
  and a per-device settings sheet (font size, cursor, copy on select).

## Done when

- The phone bar reads Chat, Terminal, Files, Git and the swappable slot; the
  Terminal tab opens a prompt in the checkout's directory, not a provider CLI.
- "Open in CLI" from the chat kebab opens the chat in the provider's CLI,
  exactly as the Shell tab does today, for all four providers.
- Locking the phone and coming back resumes the same Terminal with the missed
  output, with no tap.

## Not doing

- A Diff tab. The Git tab already shows the working tree's diff and each
  commit's; the file viewer does not show diffs, and T3's per-thread diff is a
  narrower version of the same view.
- A Pull request surface. Pull requests live in the Git tab
  ([Source Control design](../designs/source-control.md)).
- An Agents tab, and the "agents working" strip that opened it. Running agents
  show on the Working line instead ([ADR 0076](../decisions/0076-plan-pins-under-header-agents-ride-working-line.md)).
- A Tasks tab. The plan pins under the chat header instead
  ([ADR 0076](../decisions/0076-plan-pins-under-header-agents-ride-working-line.md)).
