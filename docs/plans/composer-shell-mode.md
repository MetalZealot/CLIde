# `!` shell mode in the chat composer

- Status: 2/5
- Next: Phase 2's rest — Codex `user_shell_command` cards and a fixture from a real CLI `!` run
- Context: [providers](../providers.md); [code anchors](../code-anchors.md);
  [runtime rebuild plan](agent-runtime-rebuild.md) owns delivery, which this rides
  rather than changes

A leading `!` turns the composer into shell mode. On send, CLIde's server runs the
command in the session's project folder and the command and output join the
conversation. By default the agent then replies, as Claude Code does
(`respondToBashCommands`, default true, read from CLI 2.1.293). A setting makes it
context-only instead. The SDK has no `!` input, so CLIde runs the command itself, the
same way for every provider. Agreed with Grayson on 2026-10-13.

Claude Code's shape, matched so a session reads the same in the CLI:
`<bash-input>cmd</bash-input>`, then `<bash-stdout>…</bash-stdout><bash-stderr>…</bash-stderr>`.
In context-only mode an `isMeta` caveat row goes in first. Output past 30,000
characters (`bashOutputMaxChars` default) spills to a file, and the agent gets the
preview and the file's path.

## Phases

- [x] 0. Look agreed on the S20 (`shell-mode` probe):
  - Composer D: a pink `!` mark, the command in monospace, and a pink border.
  - Card C: a bordered card on the left, with a pink `!`, the command, status, Stop
    while it runs, and output that folds under the header.
- [x] 1. Claude reply mode on 3001 ([ADR 0082](../decisions/0082-cloudcli-runs-bang-commands-itself.md)). The server owns the command, so a locked phone
  loses nothing:
  - `chat.shell` on the chat socket; Stop is the run's own `chat.abort`.
  - cwd from the session row only, never the client.
  - Refused while the Shell tab holds the session, a turn runs, or another command runs.
  - The user's login shell, with the shell helpers shared with the Terminal tab, not copied.
  - No stdin, its own process group, a 10-minute ceiling.
  - Streamed, ANSI-stripped output, capped as above.
  - The result is held until it's delivered.
  - The reply turn starts from the server, inside the command's own run.
- [~] 2. History: one parser turns both Claude shapes (the CLI's two rows, CLIde's one
  prompt) into one shell card, in the string and array branches (done, verified on the
  S20). Left: Codex's own `user_shell_command` records render as cards too, and a
  fixture from one real CLI `!` run.
- [ ] 3. Every provider: one contract test in `chat-session.test.ts` sends `!` through
  each. Cursor and OpenCode flatten prompt newlines. If their output arrives
  unreadable, a capability flag hides shell mode there, with a reason.
- [ ] 4. Context-only setting, on reply by default. The block is held on the server
  and goes in with the caveat on the next send, shown as a "not sent yet" chip.
  A restart loses an unsent block.

## Done when

- On the S20 against 3001, `!git status` streams in a shell card and Claude replies
  about it.
- The card survives a reload.
- With the setting off, `!ls` gets no reply and the next message carries its output.
- A Codex session does the same.
- Cursor and OpenCode either work or hide the mode with a reason.

## Not doing

- Codex's native `thread/shellCommand`. It's a later swap behind the same socket
  message.
- Interactive commands: there's no stdin, by design.
- Approval or sandboxing. Grayson typed the command himself, as in Claude Code, with
  the trust level the Terminal tab already has.
