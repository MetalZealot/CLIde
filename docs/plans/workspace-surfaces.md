# The workspace tabs offer what the desktop agent apps' side panels offer

- Status: 1/2
- Next: Phase 1 — a plain Terminal tab takes Shell's place, and Shell view moves to the chat kebab
- Context: [subagent visibility](subagent-visibility.md) owns how agents show
  in the chat; [provider capability map](../maps/clide-provider-capability-map.md)

Measured against T3 Code's "Open a surface" launcher (Browser, Terminal,
Files, Diff, Pull request, Agents; read from its installed v0.0.42 client),
Codex and Claude desktop. CLIde's Shell tab is not a terminal: it reopens the
open chat in the provider's own CLI (`claude --resume`, `opencode --session`,
…). No app compared exposes that as a tab, and CLIde has no plain terminal.

Target bar, phone: **Chat · Terminal · Files · Git · [swappable ▾]**, where the
swappable slot lists Browser. Desktop's header tabs get the same
set.

## Phases

- [ ] 1. **Terminal replaces Shell in the bar.** A new `terminal` tab runs a
  plain shell in the selected checkout — the plain-shell mode already exists
  and needs no server work. Shell view leaves the bar and becomes "Open in
  CLI" in the chat's kebab menu, opening the same view it does today. One
  phase, because the phone bar has exactly five places.
- [x] 2. **A running subagent updates without a reload.** Built as
  [subagent visibility](subagent-visibility.md) phase 3.

## Done when

- The phone bar reads Chat, Terminal, Files, Git and the swappable slot; the
  Terminal tab opens a prompt in the checkout's directory, not a provider CLI.
- "Open in CLI" from the chat kebab opens the chat in the provider's CLI,
  exactly as the Shell tab does today, for all four providers.

## Not doing

- A Diff tab. The Git tab already shows the working tree's diff and each
  commit's; the file viewer does not show diffs, and T3's per-thread diff is a
  narrower version of the same view.
- A Pull request surface. How PRs belong in CLIde's Git control is not yet
  assessed.
- An Agents tab, and the "agents working" strip that opened it. Each agent's
  run already folds into its one row in the chat, which holds the activity a
  tab was meant to contain.
- A Tasks tab. At most 2 of 100 Codex chats called `update_plan`, and Claude
  5.5 made one in 1 of 70 chats (counted 2026-10-01), so it would sit empty.
