# Diffs and Previews: each chat works in its own copy, is reviewed and previewed alone, then merged

- Status: draft
- Plan: [Diffs and Previews](../plans/source-control-truthfulness.md)
- Context: ADRs [0016](../decisions/0016-repository-grouped-checkouts.md),
  [0028](../decisions/0028-worktree-creation-precedes-phase-0.md),
  [0033](../decisions/0033-discovered-checkouts-are-derived-not-stored.md)
  · [provider capabilities](../providers.md)

A chat that changes code works in its own copy of the project (a worktree on its own
branch), so its edits are only its own. Grayson reviews them in the chat's **Diffs**
tab, runs them in the chat's **Preview**, sends line comments back, and merges. `main`
changes only on Merge. The upstream Git tab's repository views survive behind the
Diffs header; Pi-Ops keeps the host, not per-branch test servers.

## Starting point

Read from source or measured on the date given; recalled where labelled.

- The Git tab is upstream's VS Code-shaped panel: Changes, History and Branches; per-file
  stage, discard, commit with a generated message, fetch, pull, push, publish, branch
  switching, 23 server routes (2026-10-10). No line comments, per-hunk staging, merge
  or pull request. Commit-message generation accepts only Claude or Cursor.
- Sessions start on `main` by default and leave work uncommitted until Grayson tests
  it (`AGENTS.md`, 2026-10-10). Several sessions' untested edits pile up in one
  checkout with nothing saying whose they are; on 2026-10-12 an unattributed fix sat
  there 18 hours and a server build shipped it with another session's work.
- Nothing attributes an edit to a session. Tool rows show what edit tools touched;
  shell commands, other sessions and hand edits change files with no row.
- Worktree creation exists in the New Session launcher (`git worktree add -b`, no
  setup). `scripts/setup-worktree.sh` runs `npm ci`.
- Measured 2026-10-12: a fresh CLIde copy takes 0.5 s for the files and 82 s for
  `npm ci` (1.1 GB, warm npm cache), with MemAvailable never below 1,004 MiB while
  other sessions ran. 80 GB of disk free. An idle branch-test server holds 106 MiB;
  production 206 MiB. A build's peak memory is unmeasured.
- Branch testing is two fixed slots (3002, 3003), each with a database snapshot, a
  fake home, and a fixed HTTPS route for installing a test PWA (9442, 9443). Pi-Ops
  starts, stops and rebuilds them.
- Product bar, recalled 2026-10-12, not re-checked: Claude Code desktop, Codex's app
  and T3 Code give a thread its own worktree; Cursor tracks each chat's edits in one
  folder; VS Code, Cursor and JetBrains run a project from a Run button, and Replit,
  Bolt and Lovable keep a live preview beside the chat.
- Product bar for review, from Grayson's screenshots 2026-10-13: a scope picker
  (working tree, branch, latest turn, any turn; Claude's desktop app adds staged and
  unstaged), unified/split, wrap and whitespace toggles, and an in-chat card per turn
  listing edited files with counts, a folder tree when long, Review and Undo.

## Settled with Grayson

- 2026-10-10: agents commit once per finished task, after he has tested it, never per
  edit. CLIde supports reviewing before that.
- 2026-10-10: skip auto-merge, CI auto-fix and splitting changes into several PRs.
- 2026-10-12: **a chat that changes code gets its own copy by default**; "work on
  `main`" stays for quick jobs. This reverses 2026-10-10's "no worktree per session".
- 2026-10-12: **in its own copy an agent commits freely on its branch**; Grayson tests
  in the chat's Preview, and Merge is the "after he has tested it" step. The rules
  files change when copies ship (plan phase 6), not before.
- 2026-10-12: **the tab is Diffs**, scoped to the chat, not Source Control.
- 2026-10-12: **Previews replace the two fixed slots**; Pi-Ops keeps production, the
  other services, host health and recovery while CLIde is down.
- 2026-10-12: built after the runtime rebuild.
- 2026-10-13: **a copy's turns are snapshotted**, so Diffs scopes to one turn and
  each turn ends with an edited-files card; split view on wide screens; Undo for
  the latest turn. Reverses the earlier "no turn snapshots" and "no split view".

## Design positions

- **Isolation is the default, attribution is not attempted.** A chat's diff is its
  copy's branch against its base plus its uncommitted edits: complete by
  construction. Attributing edits inside a shared folder misses shell edits and
  breaks when turns overlap, which is the common case. A `main` chat's Diffs shows the
  checkout's whole diff, headed by the other live sessions in it.
- **A copy snapshots each turn's start and end.** In its own copy the chat's agent is
  the only writer, so the difference between the two is exactly that turn's edits,
  shell edits included. A snapshot is a git tree written through a temporary index
  (no file, branch or staging change), pinned by a hidden ref so gc keeps it. It is
  git-level, so every provider gets it with no capability flag. A `main` chat offers
  a turn's diff only when no other session ran during it; otherwise it says why.
  Hand edits made during a turn show in that turn: accepted.
- **Scopes are This chat, Last turn, Turn ▸ and Not committed yet.** Staged and
  unstaged are left out: agents do not stage, and neither does Grayson.
- **Undo reverts the latest turn only**, in a copy, through the shared preflight,
  refusing when a touched file has changed since. The next message tells the agent
  its files were put back, so it does not build on code that has gone.
- **One copy per chat, made at New Session.** The launcher's Own copy toggle is on for
  a git project and remembers the last choice per project. The copy is a worktree on
  `clide/<slug>-<short id>` from the chosen base (default: the project's default
  branch). Non-git projects have no toggle.
- **Setup runs in the background; the first turn waits for it.** Files land at once;
  the project's setup command (CLIde: `npm ci`, plus the Claude memory link) streams
  in the chat while Grayson types. A sent message waits with "Setting up the copy ·
  1:12", because an agent that builds or tests before dependencies exist fails in
  ways that look like code bugs. Setups run one at a time.
- **Diffs is the chat's review, Repository is the project's.** The tab holds the
  chat's changes only. History, Branches, fetch, pull and push move to a Repository
  sheet opened from the Diffs header, because they describe the repository, not the
  chat. Placement in the sheet is maintainer taste; the probe settles it.
- **Line comments go into the composer, not straight to the agent.** Each carries its
  file, line and quoted line; one message holds them all, so context can be added.
  All four providers take it as a plain user message.
- **Merge is a person's action and squashes.** One finished task becomes one commit on
  the base, which matches the commit rule. It runs in the base's checkout after a
  preflight; fast-forward and a merge commit sit under Advanced.
- **Conflicts are resolved in the chat's copy, by its agent, never in `main`.** A
  conflicted merge aborts and restores the base. "Update from main" asks the agent to
  bring the base into its branch and resolve there. The Diffs header shows when the
  base has moved since the copy was made.
- **Removing a copy is offered after a merge, ticked by default, and refuses unsafe
  removal.** It refuses while there is uncommitted, unmerged (tree comparison, so a
  squash counts as merged) or unpushed work, and keeps the branch unless asked.
  Copies are 1.1 GB each for CLIde; leaving them by default rebuilds today's pile.
- **A Preview runs one copy.** A project declares a preview command (CLIde: the
  branch-test build and serve, with its database snapshot and fake home; a site:
  its dev or static server). The Preview tab starts it, shows its log and address,
  and offers Restart and Stop. A preview is a systemd user unit, so it outlives a
  CLIde restart and Pi-Ops can list it.
- **Three ways to look at one preview.** Inline in the Preview tab, as an embedded
  frame, for a quick look without leaving the chat; Open in browser, full screen, for
  layout checks, since the inline view sits between the header and the bar; and a
  phone address, for installed-app behaviour a frame cannot show (standalone mode,
  safe areas). A project that refuses framing shows Open in browser instead. "Have
  the agent check it" opens the same address in the chat's Browser, which is the
  agent's view, not Grayson's.
- **Previews are limited by memory, not by count.** Builds queue one at a time. A
  preview stops after 30 idle minutes (no requests). A start is refused, with the
  reason, when MemAvailable would fall under a floor: 600 MiB to start with, to be
  measured against a real build in phase 4.
- **Two fixed phone addresses survive.** 3002 and 3003 become small proxies behind the
  existing HTTPS routes (9442, 9443). "Use on phone address A" points one at any
  preview, so an installed test PWA keeps its origin and nothing needs `sudo`.
- **Previews are tailnet-only.** They take ports from a fixed range bound for the
  tailnet; ufw keeps LAN off, as for the slots. A preview never uses production's
  database.
- **Merging into the serving checkout says what follows.** For CLIde's own `main`, the
  merge sheet says whether a client build or a server restart is needed, offers the
  build (queued), and leaves the restart to Pi-Ops or an explicit action.
- **Create PR depends on the host, targets the push remote, and is named on screen.**
  `owner/repo ← branch`, passed explicitly; in a fork the GitHub CLI's default can pick
  the parent, and an accidental upstream pull request is the worst failure here.
  Without the GitHub CLI signed in for the remote's host, Create PR says why.
- **"Ask for a review" runs the provider's own review command**, declared per adapter
  or absent. Claude's is `/code-review`; the others are verified in their phase.
- **Per-hunk stage and revert come last**, on the line addressing comments build.

### Guardrails

- **Read-only** (status, log, diff, listings, fetch, preview logs): no confirmation.
- **Working-tree mutations** (switch, restore, discard, merge, copy removal): one
  shared preflight first. A dirty or conflicted target is refused by default.
- **History and remote mutations** (commit, amend, branch deletion, push, pull
  request): explicit targets, never an unqualified force push.
- **Self-hosting**: CLIde knows which checkout serves it and blocks or elevates
  actions that rewrite it. A preview never binds 3001.

## Target design

### The bar

Chat, **Diffs**, Files, Terminal, **Preview**, as in the 2026-09-29 mockup. Diffs
carries a count badge of changed files; Preview a dot while running. Every level gets
probed before it is built.

### Diffs

- **Header**: the copy's branch and base, ahead/behind, "base moved" when it has, and
  a Repository button. A `main` chat's header names the other live sessions. Below
  it, the scope picker (turns listed by their prompt's first words) and toggles for
  wrap, ignore whitespace and, on a wide screen, split view.
- **Body**: `+N −M` and file count; file chips that mark a file viewed; each file a
  collapsible diff (unified on the phone) loaded on demand. Lockfiles, generated and
  very large files start collapsed with their size. Tapping a line opens a comment
  field.
- **Footer**: Send N comments, Ask for a review, Merge… (Commit… in a `main` chat).
- **Merge sheet**: source, target, the branch's commits and files, strategy, the
  preflight's result, what follows for a serving checkout, "Remove this copy"
  (ticked), then Merge. Create PR sits beside Merge.
- **Repository sheet**: History, Branches, fetch, pull, push, restyled onto the same
  row and diff components.

### Preview

Not running: the project's preview command and Start. Building: the queue position or
the streamed build log. Running: the live page inline, with the address, Open in
browser, the phone-address picker, Have the agent check it, Restart, Stop, and the
log behind a toggle. Stopped by idle or a failure: why, and Start.

### From the chat

A turn that changed files ends with a card: "Edited N files +A −B", each file with its
counts (a folder tree with per-folder totals past about 8 files), Review and, on the
latest turn, Undo. A file opens Diffs on that turn at that file; Review opens the
turn. Counts come from the snapshots, not from tool rows. The finished-session card
offers Review N files and Preview, as in the mockup.

### Server contract

- Every mutation returns success, or a failure with `code`, `message` and `detail`
  (git's or a hook's stderr). The client shows it beside the action and keeps what was
  typed.
- Reads: a chat's review summary (per-file counts, base, base moved, occupancy for
  `main` chats), for the whole chat or one turn; the chat's turn list; host capabilities (GitHub CLI state, the remote's host); previews
  (unit, copy, port, state, phone address, idle time).
- Mutations: create a copy and run its setup; merge with explicit source, target and
  strategy; remove a copy; a pull request with an explicit remote and base; start,
  restart and stop a preview; point a phone address; undo the latest turn.
- Log lines: `[git]` per mutation (operation, checkout, result, ms); `[copy]` per
  setup (copy, ms, exit); `[turn]` gains snapshot ms or failure; `[preview]` per start, stop, idle stop and refusal (copy,
  port, build ms, MemAvailable).

### Lifecycle

- A copy is created with its chat, set up once, and removed by Grayson after a merge or
  from the Worktrees page, which shows each copy's age, size and chat. Its turn
  snapshot refs go with it.
- Diffs refreshes when a turn ends, when the tab gains focus, and when asked. A file
  that changes while open is marked updated, not swapped silently.
- Comment drafts are stored per `session_id` in the browser until sent; a draft whose
  line has gone shows as outdated and is never dropped silently.
- A preview starts on request, stops on Stop, idle or failure, and survives CLIde
  restarting. Removing a copy stops its preview first.

### Failure handling

Each has a stated outcome on screen: setup failing (output, Retry, or Continue on
`main`); a hook rejecting a commit; a rejected push (offer Pull); a merge conflict
(abort, restore the base, list the files, offer Update from main); the GitHub CLI
missing, signed out or offline; a preview build failing (its log); a preview refused
for memory (MemAvailable and what to stop); a diff too large to render; a turn
whose snapshot failed (its scope says unavailable, never shows a wrong diff); Undo
refused (which files changed since).

## Pre-mortem: it failed in six months because…

- **Waiting 1.5 minutes per new chat felt slow**, so chats went back to `main`. The
  plan measures the wait in use and, if needed, keeps one prepared copy ready.
- **Copies piled up**: removal after merge is ticked by default, and the Worktrees page
  lists age and size.
- **Long-running chats conflicted at merge**: "base moved" shows early, and Update from
  main resolves in the copy.
- **Previews starved the Pi**: idle stop, the memory floor and the build queue, with
  every refusal logged.
- **Turn diffs went quietly wrong**: a turn boundary missed by the runtime merges two
  turns. Snapshots are taken from the runtime's own turn start and end, and a
  missing one marks the turn unavailable rather than guessing.
- **A test PWA lost its address**: the phone addresses are proxies, so their origins
  never change.

## What Grayson gives up

- Each CLIde copy costs 1.1 GB and about 1.5 minutes of setup.
- A `main` chat still shares one diff with every other `main` chat.
- A squash merge leaves the branch's step-by-step commits off the base; they live only
  until the branch is deleted.
- A comment drafted on the phone is not on the laptop.
- Hand edits made in a copy while a turn runs are counted as that turn's.
- Undo reaches back one turn only.
- CI results, auto-merge and pull request discussion stay on GitHub's page.

## Not doing

- Per-session edit attribution inside a shared checkout; turn snapshots there serve
  only a turn no other session overlapped.
- Staged and unstaged scopes.
- Upstream's standalone Worktrees tab with its destructive defaults and hidden cleanup.
- A pull request to any repository other than the checkout's push remote.
- A split diff view on the phone, auto-merge, CI auto-fix, or splitting changes into several PRs.
- Reviewing other people's pull requests inside CLIde.
