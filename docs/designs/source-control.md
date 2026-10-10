# Source Control: review a session's work, then commit, merge or open a pull request

- Status: draft
- Plan: [Source Control](../plans/source-control-truthfulness.md)
- Context: ADRs [0016](../decisions/0016-repository-grouped-checkouts.md),
  [0028](../decisions/0028-worktree-creation-precedes-phase-0.md),
  [0033](../decisions/0033-discovered-checkouts-are-derived-not-stored.md)
  · [workspace surfaces](../plans/workspace-surfaces.md) (the Git tab's place in
  the bar) · [provider capabilities](../providers.md)

An agent leaves its work uncommitted. Grayson opens the review from the chat, reads
the diff on the phone, sends line comments back, and then commits, merges or opens a
pull request from the same screen. The Git tab stays one of the bar's five and is
redesigned at every level; no Diff tab joins it. Repository identity (ADR 0016) and
the truthfulness fixes stay, and come first.

## Starting point

Read from source on 2026-10-10 unless labelled.

- The Git tab is upstream's VS Code-shaped panel with three views: Changes, History
  and Branches. It can stage and unstage per file, discard, commit with a generated
  message, fetch, pull, push and publish, switch, create and delete branches, and show
  each commit's diff. It has 23 server routes. It has no line comments, no per-hunk
  staging, and no merge or pull request.
- On a failed commit, the server returns the hook's stderr and the client puts it in
  the panel header (`6dc05b23`). The backlog still calls a failed commit silent;
  nobody has checked this live.
- Commit-message generation accepts only Claude or Cursor.
- Nothing creates a pull request or asks the GitHub CLI anything.
- The New Session launcher already picks or creates a worktree for a new session.
  Creation runs `git worktree add -b` and nothing after it, so the new checkout has
  no dependencies installed.
- Nothing attributes file edits to a session. Tool rows show what a turn's edit tools
  touched, but shell commands, other sessions and hand edits change files with no row.
- Nothing shows how many live sessions share a checkout, so one checkout's diff can
  mix several sessions' work without any sign of it.
- Measured on 2026-10-10: CLIde's own dependency install is 1.1 GB per checkout. In
  the seven days before, 105 commits landed on `main`, 29 of them docs-only. Agents
  then committed after every edit.

## Settled with Grayson

- 2026-10-10: agents commit once per finished task, after he has tested it, never
  per edit (`AGENTS.md`). CLIde should support reviewing before that commit.
- 2026-10-10: adopt the following, in this order. Visible Git failures. A Changes
  review reachable from the chat, with line comments sent to the agent. Commit and
  Create PR at the end of the review. An isolated (worktree) option at New Session that
  ends in Merge or Create PR. A warning when two sessions share a checkout. Per-hunk
  stage and revert last.
- 2026-10-10: no worktree per session by default. Use one for parallel work, risky
  work, or work to be reviewed as a pull request.
- 2026-10-10: skip auto-merge, CI auto-fix and splitting changes into several PRs.

## Design positions

- **The review shows the checkout's diff, not the session's.** It shows the working
  tree against `HEAD`, and on a branch it also shows the branch against its base.
  Per-session attribution would have to ignore shell, hand and other-session edits,
  so it would look complete while missing changes. Isolation is how a session gets a
  diff of its own. Codex's Local/Worktree split and Claude desktop's
  worktree-per-session give the same answer.
- **One Git tab, redesigned. No Diff tab.** Changes is the Git tab's first screen and
  the chat links to it. A second diff surface would duplicate it.
- **The chat links to the review when a turn changed the checkout.** A `+N −M`
  link opens Changes. Without a link on the path, the review gets skipped in favour of
  "commit it" typed in chat. Placement is maintainer taste, and the probe settles it.
- **Line comments go into the composer, not straight to the agent.** Tapping a line
  drafts a comment. "Send N comments" then places one message in the composer, with
  each comment carrying its file, line and quoted line, so a sentence of context can
  be added before sending. It is a plain user message, so all four providers take it
  with no capability flag. This rejects Claude desktop's send-at-once, which suits a
  keyboard better than a phone.
- **Commit is a person's action, taken from the review.** The commit sheet shows a
  generated message (editable), the files with checkboxes, and Commit. An agent asked
  in chat writes to the same history, and the Git tab shows either.
- **The ship actions follow the checkout's branch.** On the default branch: Commit,
  then Push. On any other branch: Commit, then Merge into the base or Create PR. Each
  is a separate action. No "Finish" button commits, pushes, merges and deletes in one
  step.
- **Merging into the base defaults to squash.** One finished task becomes one commit
  on `main`, which matches the commit rule. Fast-forward and a merge commit sit under
  Advanced. This reverses the plan's earlier fast-forward default, because
  fast-forward brings a branch's work-in-progress commits onto `main`. A squashed
  branch never looks merged to Git, so removal compares trees instead of ancestry.
- **A pull request targets the checkout's push remote, named on screen and passed
  explicitly.** The sheet shows `owner/repo ← branch`. In a fork, the GitHub CLI's
  default can pick the parent repository, and a pull request opened upstream by
  accident is the worst failure in this design. A pull request to any other
  repository is not built.
- **Create PR depends on the host, not a provider.** The server reports whether the
  GitHub CLI is installed and signed in for the remote's host. Without it, Create PR
  says why and what fixes it. For a remote not on GitHub, Create PR is absent.
- **"Ask for a review" runs the provider's own review command, when it has one.**
  Each adapter declares the command, or declares none and the button hides. Claude's
  is `/code-review`. The other three are unverified, and their phase checks them.
- **Isolation is a New Session option, off by default.** The launcher's worktree choice
  becomes one Isolated toggle: create a worktree from a chosen base and start the
  session in it. Each isolated checkout costs a dependency install, and for CLIde
  itself a test-server slot. That rejects Claude desktop's worktree-per-session
  default, which assumes a laptop.
- **A project may declare a worktree setup command.** It runs once, after creation,
  with its output streamed. If it fails, CLIde shows the failure and keeps the
  checkout. Without one, the first build in a new worktree fails for lack of
  dependencies.
- **Occupancy shows where the review is.** The review header names any other live
  session in the same checkout. A mixed diff is the cost of not isolating, and showing
  it is the mitigation.
- **Per-hunk stage and revert come last.** They reuse the line addressing that
  comments build.

### Guardrails

- **Read-only** (status, log, diff, listings, fetch, previews): no confirmation.
- **Working-tree mutations** (switch, restore, discard, delete-untracked, merge,
  worktree removal): a state-aware preflight first. A dirty or conflicted target is
  refused by default.
- **History and remote mutations** (commit, amend, branch deletion, push, pull
  request): explicit targets, and never an unqualified force push.
- **Self-hosting**: CLIde knows which checkout serves it and any registered dev or
  test workspaces, and it blocks or elevates actions that rewrite them. A merge into
  the serving checkout reports whether a client build or a server restart is needed
  before the change shows.

## Target design

### The Git tab

Phone first, with the same screens in the desktop side panel. Every level below gets
probed before it is built.

- **Header**: checkout folder, branch, ahead/behind, and occupancy.
- **Changes** (default): a summary line (`+N −M`, file count), then file chips that
  mark a file as viewed. Each file is a collapsible unified diff, loaded on demand.
  Lockfiles, generated files and very large files start collapsed with their size
  shown. Tapping a line opens a comment field. Footer: Send N comments, Ask for a
  review, Commit….
- **Commit sheet**: message, files, Commit. After a commit it offers Push on the
  default branch, or Merge… and Create PR on any other branch.
- **Merge sheet**: source and target, the branch's commits and files, the strategy,
  the preflight's results, then Merge. Removing the worktree is a separate action
  afterwards, and it keeps the branch by default.
- **Pull request sheet**: `owner/repo ← branch`, a title and body generated from the
  commits, a draft toggle, and Create. It returns the PR's link.
- **History and Branches**: restyled onto the same row and diff components. Their
  behaviour changes only where Phase 0 changes how refs and state are shown.

### From the chat

The `+N −M` link opens Changes. "Send N comments" fills the composer of the session
the review was opened from.

### Server contract

- Every mutation returns either success, or a failure with `code`, `message` and
  `detail`, where `detail` carries git's or a hook's stderr. The client shows the
  failure beside the action that failed and keeps what was typed.
- New reads: a review summary (per-file counts, base, occupancy) and host
  capabilities (GitHub CLI present and signed in, the remote's host).
- New mutations: a pull request with an explicit remote and base; a merge with an
  explicit source, target and strategy; running a worktree's setup command.
- Each mutation writes one `[git]` log line: operation, checkout, result, duration.

### Lifecycle

- The diff refreshes when a turn ends, when the tab gains focus, and when asked. A
  file that changes while open is marked as updated, not swapped silently.
- Comment drafts are stored per `session_id` in the browser until sent. A draft whose
  quoted line has gone shows as outdated and is never deleted silently.
- An isolated session ends in Merge, Create PR, or Keep. Removal is a separate step.
  It refuses while there is uncommitted, unmerged (tree comparison) or unpushed work.
  The Worktrees page shows each worktree's age and size, so a kept one stays visible.

### Failure handling

Each of these has a stated outcome on screen: a hook rejecting a commit; a rejected
push (offer Pull); a merge conflict (abort, restore the target, list the files); the
GitHub CLI missing, signed out, or offline; a failed setup command; a diff too large
to render.

## What Grayson gives up

- A session in a shared checkout shows every session's edits. Only isolation gives a
  per-session diff.
- Each isolated session costs a dependency install (1.1 GB for CLIde) and, for CLIde,
  a test-server slot to verify on.
- A squash merge leaves the branch's step-by-step commits off `main`. They exist only
  until the branch is deleted.
- A comment drafted on the phone is not on the laptop.
- CI results, auto-merge and pull request discussion stay on GitHub's page.

## Not doing

- A Diff tab, or upstream's standalone Worktrees tab with its destructive defaults
  and hidden cleanup.
- Per-session edit attribution.
- A pull request to any repository other than the checkout's push remote. Upstream
  pull requests stay a manual, approved step.
- A split diff view, auto-merge, CI auto-fix, or splitting changes into several PRs.
- Reviewing other people's pull requests inside CLIde.
