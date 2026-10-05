# Architecture

This document describes CLIde at the level that changes slowly: what the system is,
the qualities it must keep, where the code lives, and the invariants the code relies
on. It holds no implementation detail. Decisions and their reasons are in
[`docs/decisions/`](docs/decisions/README.md), current-state detail in
[`docs/maps/`](docs/maps/README.md), ordered work in [`docs/plans/`](docs/plans/README.md),
and how to work in this repo in [`AGENTS.md`](AGENTS.md).

## Bird's-eye view

CLIde is a self-hosted web app for driving coding agents (Claude Code, Codex, Cursor
and OpenCode) from a phone or a desktop browser. It is a fork of
[`siteboon/claudecodeui`](https://github.com/siteboon/claudecodeui).

- The **browser app** (React 18, Vite, Tailwind; installable as a PWA) talks to one
  Node server over HTTP and a WebSocket.
- The **server** (Express plus WebSocket) runs each provider through an adapter:
  Claude through the Agent SDK, Codex through its App Server, Cursor and OpenCode
  through their CLIs. Adapters turn provider output into CLIde's normalized messages,
  which the chat gateway streams to the browser.
- **Two stores.** CLIde's own SQLite database holds users, sessions and settings,
  outside the checkout (by default `~/.cloudcli/auth.db`). Each provider writes its
  own transcript files in its own home; those are the record of what ran. A watcher
  indexes transcripts written by any process, including ones started outside CLIde.
- **Around chat:** a terminal (the Shell), Files, Source Control, a Playwright-driven
  Browser, voice and scheduled messages.
- **Scope.** English only, run from a git checkout. CLIde has no desktop app,
  container image, npm package or plugin system of its own; the agents' own plugins
  and skills appear under each provider's Tools.

## Quality goals (pillars)

What CLIde must get right as a whole. Every architecture change (a new plan, a
provider, a dependency, a bug that keeps coming back) is checked against each goal,
plus a pre-mortem ("it failed in six months: why?"), before it is accepted. "Held by"
names the invariants below; "Check" is what catches a break automatically. A goal
with no check is a known gap.

- **Contract.** Every message between server, browser and provider has one typed
  shape. *Breaks:* a field renamed on one side fails silently on the other. Held by
  1. Check: `chat-session.test.ts` (every provider, unequal ids); the shape itself
  is untyped until [runtime plan](docs/plans/agent-runtime-rebuild.md) phase 3.
- **Capabilities.** Each provider declares what it can do; the UI follows that, not
  its name. *Breaks:* controls that do nothing, features for one provider only.
  Held by 2. Check: none until runtime phase 8.
- **One owner per state.** Every piece of state has one true copy. *Breaks:* two
  devices disagree. Held by 1, 9, 11. Check: none; runtime phase 5.
- **Lifecycle.** Start, idle, crash, restart, reconnect and a second device each have
  a defined outcome. *Breaks:* lost replies, stray processes, two writers. Held by
  3, 7. Check: run-registry tests per turn; runtime phases 4–6.
- **Live equals reload.** A chat looks the same after a reload. *Breaks:* rows change
  shape, counts arrive late. Held by 6, 8, 10. Check: none; runtime phase 7.
- **Change over time.** A provider update says what changed and where it belongs.
  *Breaks:* new abilities go unused for months. Held by 4. Check: the settings
  catalog test, the Codex protocol test, `npm run check:providers` (reports only).
  Nothing flags a new message type, option, method or hook with no home until
  runtime phases 7–8.
- **Builds itself.** CLIde is used to develop CLIde, so every change ships alone
  with chat still working. *Breaks:* a bad change locks its maintainer out of the
  fix. Held by 12. Check: branch-test servers; manual by nature.
- **Memory.** A 4 GB host holds everything, and every agent process counts.
  *Breaks:* a chat killed mid-reply. Check: none; runtime phase 4.
- **Speed.** Measured budgets a change may not break. *Breaks:* slowness creeps in
  unnoticed. Held by 15. Check: `npm run bench:chat-history`; the runtime
  scorecard reports turn times but sets no limits yet.
- **Failure handling.** Every call out of CLIde has a defined result when it fails,
  hangs or half-succeeds. *Breaks:* a spinner forever. Held by 5. Check: none;
  runtime phase 3b runs the first full pass.
- **Seeing what happened.** A record shows why something was slow or wrong.
  *Breaks:* fixes become guesses. Check: `[turn]` logs and the runtime scorecard; a
  chat-path recorder comes before runtime phase 2.
- **Trust.** Every agent action passes the same approval rules; secrets never reach
  an agent. *Breaks:* a path that skips approval. Check: none; the agent API skips
  the run registry, and two permission systems remain.
- **Phone first.** The installed phone app is the main surface. *Breaks:* works on
  the desktop, fails on the phone. Held by 14, 15, 17. Check: a real device, by
  nature; target sizing is in [the UI standards map](docs/maps/ui-standards.md).
- **Product bar.** CLIde does what comparable apps have taught users to expect.
  *Breaks:* it feels old while working. Check: none; runtime phase 3b runs the
  first comparison.

## Code map

### `server/`

`server/index.ts` starts the server. Each area is a module under `server/modules/`,
shaped by [the module standards](.agents/skills/backend-module-standards/SKILL.md).

- `providers/` holds one adapter per provider in `list/<provider>/` (runtime, history
  parser, models, settings) plus shared services: runtime selection, capabilities,
  CLI updates and the sessions watcher. Provider SDKs are imported only here.
- `websocket/` is the chat gateway (run registry, session writer, replay, abort) and
  the Shell's terminal connection.
- `database/` is the SQLite connection, migrations and repositories.
- `auth/` and `user/` cover sign-in, per-user Git config and onboarding.
- `projects/`, `file-tree/` and `git/` back project discovery, Files and Source
  Control.
- `browser-use/` runs a Playwright browser per chat and its MCP endpoint.
- `scheduled-messages/` and `notifications/` cover timed sends, Auto-Continue and
  notices.
- `commands/`, `settings/`, `voice/` and `assets/` cover slash commands, app
  settings, speech and chat attachments.
- `agent/` is the external Agent API (HTTP and server-sent events) for other tools.
- `system/` and `cli/` are self-update and the `cloudcli` command-line entry point.

### `src/`

- `App.tsx` wraps the whole app in sign-in, theme and the WebSocket connection.
- `components/<area>/` has one folder per surface: `chat/`, `sidebar/`, `shell/`,
  `git-panel/`, `file-tree/`, `settings/`, `browser-use/` and others.
- `stores/useSessionStore.ts` holds each session's messages, pagination and live
  reconciliation; `contexts/` holds the WebSocket, auth, theme, appearance and
  permission contexts.
- `i18n/` holds the English strings every `t()` call reads; there is no other locale.

### Elsewhere

- `shared/` has types and utilities imported by both server and browser.
- `scripts/` has the `check:*` gates (docs, tests, providers, upstream), benchmarks,
  live SDK probes (`verify-*`), the runtime scorecard, the server tests' database
  preload and worktree setup.
- `.github/workflows/ci.yml` runs typecheck, lint, the docs and test-budget checks and
  both test halves on every push.
- `docs/` has maps, decisions and plans; `docs/TODO.md` is the backlog.
- `designs/` has the logo masters; the assets in `public/` are generated from them.
- `dist/` and `dist-server/` are build output (invariant 12).

## Invariants

Each invariant states what must stay true and what breaks if it does not.

### Sessions and providers

#### 1. Every conversation has two ids, and only CLIde's is an address

CLIde mints `session_id` and stores it in its database; the provider separately
writes `provider_session_id` into its transcript. A running process is only ever
addressed by `session_id`. The provider's id is a lookup key for finding the file,
never a way to reach a running session.

**Breaks:** send, abort or resume reaches the wrong process or none, and one
conversation splits into two sidebar rows. This caused three separate bugs in one
upstream merge.

#### 2. Shared code asks what a provider can do, never which provider it is

Everything above `server/modules/providers/list/` (the UI, the gateway, the
database) works the same for every provider, through capability flags served by
`provider-capabilities.service.ts`.

**Breaks:** an `if (provider === 'claude')` feature does nothing on Codex, or crashes
it, and nobody notices until a Codex session days later.

#### 3. A conversation has one writer: Chat or the Shell, never both

The Shell runs its own copy of the provider's CLI, which reads the conversation once
and then works from memory. While a Shell has a CLI running on a session, Chat
refuses to send to it; while Chat is replying, the Shell refuses to start on it.
Disconnect ends the Shell's CLI; a closed tab or lost signal keeps it 30 minutes for
reattaching.

**Breaks:** both write, the conversation forks, and the last writer wins; the other
side's messages drop out of view though they stay in the file.

#### 4. CLIde follows the installed provider CLI

The installed Claude or Codex launcher owns which version runs. CLIde checks changed
versions, finishes active work before replacing a running process, and offers
updates without installing them on a check
([ADR 0061](docs/decisions/0061-follow-installed-provider-clis.md)).

**Breaks:** a private bundled version misses installed fixes, switching a running
process interrupts work, and an incompatible update chosen silently hides the
problem.

#### 5. A usage limit is read from the provider's marker, not its wording

Claude stamps a stopped turn with a quota record and reset time; Codex names
`usage_limit_exceeded`. Anything that reacts to a limit reads that marker, never the
localized sentence, and notices a reset when usage returns, not at the predicted
time, because providers reset early.

**Breaks:** matching the sentence fails silently the next time it is reworded;
waiting for the predicted time can hold a message for a week after an early reset.

### Transcripts and data

#### 6. The transcript is the record of what ran

Whatever the UI shows or the database recorded, the provider's transcript is what
happened. It is trustworthy as history and untrustworthy as input: validate anything
taken from it before it reaches a command. A parsed transcript is reused only while
every contributing file (including Claude subagent files and Codex parent rollouts)
has the same revision, and a partial or failed read is never kept as complete.
Unchanged messages are not rebuilt when a new one arrives, but an updated reply or
tool result appears immediately.

**Breaks:** a value scraped from an old transcript becomes a live model argument, and
a session resumes on a different model than it started on.

#### 7. A watcher rediscovers anything left on disk

The sessions watcher pushes any transcript it finds into the sidebar, which is how
sessions started outside CLIde appear. Removing a session deletes the file before
the database row.

**Breaks:** in the other order the watcher re-adds the session in the gap; deleted
sessions and test runs reappear as real projects and conversations.

#### 8. Token counting exists in three places that must agree

The context ring's number is assembled separately for the live stream, the polled
API endpoint and history reading. Claude writes synthetic zero-usage rows (error
notices, limit messages) that all three must skip the same way, so a change to
Claude usage counting is made in all three at once
([code anchors](docs/maps/code-anchors.md)).

**Breaks:** the ring reads blank or zero, usually only on sessions that hit a limit,
so it looks intermittent and unrelated to the change.

#### 9. The database lives outside the checkout

Working-tree changes cannot destroy it, and git cannot restore it either. Back it up
before anything touching auth, schema or migrations.

**Breaks:** a bad migration is permanent.

#### 10. Older messages load by bookmark

New replies arrive while older messages are read, so a count from the newest reply
moves; a server bookmark tied to the conversation does not. A refresh keeps the
oldest loaded message when history only grows; a rewind or replacement starts a
fresh window; a cancelled request cannot put abandoned messages back. Hidden tool
records still count toward paging.

**Breaks:** messages repeat, vanish between pages, or reappear after a rewind.

#### 11. A preference either follows the user or belongs to one browser

Most preferences live in browser storage, per browser and per device. A short
allowlist (`shared/synced-preferences.ts`) is mirrored per user in the database:
the server's copy wins on load, then the latest edit wins. Synced today: theme and
font, favourite models, and each provider's tool permissions; chat reading size and
line spacing deliberately are not. A preference syncs if it describes what the user
wants CLIde to be like, and stays local if it describes the device.

**Breaks:** a preference silently resets on a new browser, or one device's text size
follows the user to another. Unsynced tool permissions make one device ask about
work the other was told to allow.

### Build and deploy

#### 12. Client and server deploy differently

The server reads `dist/` (built by `build:client`) from disk on every request, so a
client rebuild plus a refresh is a complete client deploy. `dist-server/` (built by
`build:server`) is loaded once, so only a restart picks it up. A merge changes source
only: dependencies, both builds and the running process are separate boundaries,
each established on its own.

**Breaks:** a refresh shows no change and a working fix is judged failed, or
"merged" is taken for "live" while production serves an older build.

### Browser, phone and the chat surface

#### 13. A Browser window belongs to the chat that opened it

Several chats can browse at once, and a browser can stay open while its agent is
idle. The chat preview shows only a browser linked to that chat. The browser belongs
to the chat, not the reply, so the page persists between messages; it closes on Stop,
when the agent closes it, or after sitting unused. An open window alone is not
activity ([chat browser activity](docs/maps/chat-browser-activity.md)).

**Breaks:** guessing from the most recent browser shows another chat's work, an open
window reads as a false spinner, and a reset between replies lands the agent on a
blank page it thought it had navigated.

#### 14. On the installed phone app the chat scrolls as the page

That is the only way Android keeps text-selection handles moving with the finger
([ADR 0056](docs/decisions/0056-installed-phone-app-scrolls-the-chat-as-the-page.md));
browser tabs and desktop still scroll the chat inside a box. Anything full-screen
over the chat locks the page while open, nothing moves the chat while text is
selected, and every bar floating over the chat lets touches through during a
selection.

**Breaks:** drags scroll the chat underneath an overlay; selection handles slide
under a bar, jump to the top, or get pulled into the composer.

#### 15. Nothing moves the chat that the reader did not scroll

Older messages load above, replies stream below, and rows open while reading; the app
restores the reading position by hand after each. A session opens at the bottom.
While scrolled up, new messages never remove rows above, and the row held still is
the one at the top of the screen. Every change to loading or scrolling is walked in
phone and desktop layouts, pausing between swipes, before it ships
([history map](docs/maps/chat-history-performance.md#position-and-per-step-walk)).

**Breaks:** the view jumps by a message's height, or a chat opens partway up; speed
checks alone let that ship once.

#### 16. Nothing has a published place around the composer

No standard covers placement around the composer. Four reasons decide it, set out in
[the UI standards map](docs/maps/ui-standards.md): thumb reach, the room the keyboard
leaves, whether a thing affects the next message or the whole session, and whether it
is waiting on the user. The strip above the composer is the scarcest space on a
phone: it holds only what needs the user now, plus queued messages about to send, as
one row. Questions share one collapsible frame, at most half the screen when
expanded.

**Breaks:** copying a desktop layout fills the strip with competing cards, one more
per feature.

#### 17. Mobile navigation stays in place before choosing a worktree

Shell, Files and Git need a worktree; a new Chat can begin at the picker. The bottom
bar stays visible with Chat selected while choosing, and destinations that need a
worktree are greyed out, including those inside More. The bar still hides when the
keyboard opens.

**Breaks:** hiding the bar shifts the composer when a worktree is picked; enabled
dependent destinations open views with no working folder.

#### 18. Auto-Continue is a session setting; its waiting message is one action

Settings supplies the message and the default for new chats; each chat keeps its own
mode in the header menu. The limit notice offers enabling only when the mode is off
and no reset message is waiting, and the waiting bubble says what will be sent.
Cancelling that message skips one continuation; turning the mode off stops future
ones.

**Breaks:** showing the setting beside its queued message makes cancelling one send
and disabling the mode look like the same action.

## Reviewing a change

A change needs a second look if it would:

- address a running session by the provider's id (1);
- branch on a provider's name in shared code (2);
- let Chat and the Shell write one conversation (3);
- react to a usage limit by its wording, or wait on a predicted reset time (5);
- feed a transcript value into a live command unchecked (6);
- delete a session's database row before its file (7);
- change Claude token counting in fewer than three places (8);
- touch auth, schema or migrations without a database backup (9);
- add a per-device preference to the synced allowlist (11);
- reach the backend but end with "just refresh" (12);
- open something full-screen over the chat without locking the page, or put the phone
  chat back in a scrolling box (14);
- add a card above the composer for something not waiting on the user (16);
- change the architecture without a check against the quality goals and a
  pre-mortem.

Naming the invariant is enough to raise it; proving the violation is not required.
