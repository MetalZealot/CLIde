# Git source-control and workspace UX for CLIde

- Date: 2026-07-26; merged with the 2026-07-27 UX reference on 2026-07-27
- Status: Design reference; implementation not started
- Scope: Git mental model, CLIde's project/repository/checkout identity model,
  source-control information architecture, branch and remote operations,
  worktree lifecycle, branch integration, agent thread targeting, labels and
  iconography, identity, and authentication
- Related backlog: `TODO.md` — Source Control worktrees and branch integration;
  Git branch remote labels; Git branch-switcher safety; silent commit failures
- Decision record: ADR 0016 — projects group checkouts by repository; a project
  is not a directory (`docs/decisions/0016-repository-grouped-checkouts.md`)
- Related reference:
  `docs/superpowers/specs/2026-07-25-agentic-coding-ux-reference.md`
- Absorbed: an external reference, *CLIde Source Control, Git Workspaces &
  Agent Workflow UX* (prepared 2026-07-27, deleted after merging). Its
  object-model discipline, iconography and colour rules, integration-naming
  rule, safe-removal copy, per-turn change review, and accessibility rule live
  here now, with its CLIde-specific factual errors corrected — see "Corrections
  applied from the 2026-07-27 reference" below. This document is the only
  surviving copy of that material.

## Corrections applied from the 2026-07-27 reference

The absorbed reference was written without visibility into CLIde's code. Three
of its claims do not hold here, and the corrections change what gets built:

1. **CLIde has no execution-environment axis.** The reference asserts CLIde
   already shows environment chips (`[ Default Cloud Environment ] [ CLIde ]
   [ main ]`) and models `Environment` as a first-class entity. There is no
   SSH-host, container, or cloud-execution concept anywhere in the schema or
   the provider adapters; the `projects` table stores a local absolute path and
   nothing else. **Environment is out of scope.** Its underlying advice — never
   label the main checkout "Local" — is kept, but the cure is to name the
   checkout honestly, not to add a chip that renders a constant.
2. **"Pin each thread to its checkout" is already satisfied.** `sessions.project_path`
   *is* the checkout identity. No `checkoutId` field is required.
3. **"Group threads under the project, not under branch names" is not a
   labelling change.** In CLIde a project *is* a checkout, so a new worktree
   currently produces a new top-level project. Honouring this requires the
   repository-grouping layer specified in the next section.

## Purpose

CLIde already has a capable Git panel, but its model is still mostly “the
current directory plus a branch picker.” That is insufficient for a product
where people and agents routinely use several linked worktrees, where the app
may be serving one of those worktrees, and where a fork commonly has both an
`origin` and an `upstream`.

This reference has two jobs:

1. Explain Git in a way that makes CLIde's own development workflow legible.
2. Define how a conventional IDE should expose Git state and guarded controls
   without hiding consequential behavior behind friendly labels.

The most important product decision is:

> CLIde should present a worktree as the active workspace, a branch as a movable
> history label checked out in that workspace, and a remote as a synchronization
> target. It must not collapse those three concepts into one branch picker.

## Executive summary

The expected source-control experience has four layers:

1. **Workspace:** which repository and worktree am I changing?
2. **Local history:** which branch and commit am I on, and what is staged or
   modified?
3. **Synchronization:** which remote-tracking branch does this local branch
   follow, and what is incoming or outgoing?
4. **Collaboration:** has the branch been pushed, does it have a pull request,
   and what does the remote host report?

CLIde is already reasonably strong in local changes, staging, committing,
history, and current-branch push/pull. Its main gaps are truthfulness and
workspace lifecycle:

- remote branch identity is discarded, so `origin/main` and `upstream/main`
  cannot be represented faithfully;
- branch switching mutates the selected directory without understanding whether
  it is dirty, occupied by another worktree, or serving the running CLIde app;
- worktrees cannot be listed, created, opened, or safely removed;
- a finished topic branch cannot be previewed and integrated into its target;
- conflict state and in-progress Git operations are not first-class;
- commit identity, GitHub API login, remote transport credentials, and the host
  operating-system account are presented as though they were one identity.

The implementation should first make existing state truthful, then add a
worktree inventory, and only then add guarded integration operations.

## Git mental model

### The repository is history, not the folder of visible files

A Git repository stores a directed graph of immutable commits. Each commit is a
snapshot plus metadata and parent links. The files visible in an editor are a
checked-out view of one point in that graph.

The common pieces are:

| Concept | Meaning | Typical UI representation |
| --- | --- | --- |
| Repository | Shared object database, refs, and configuration | Repository selector |
| Commit | Immutable snapshot with parent link(s) | History graph row |
| Branch | Movable local name pointing to a commit | Local branch row |
| `HEAD` | What is currently checked out; normally points through a branch | Current-branch indicator |
| Working tree | Files currently visible and editable in one directory | Workspace/project |
| Index | Proposed contents of the next commit | “Staged Changes” |
| Worktree | One working tree plus its own `HEAD` and index, linked to the shared repository | Workspace entry |
| Remote | Named URL used to exchange Git objects and refs | `origin`, `upstream` |
| Remote-tracking ref | Local observation of a remote branch after the last fetch | `origin/main` |
| Upstream/tracking branch | Remote-tracking ref associated with a local branch for pull/push comparison | `main → origin/main` |
| Tag | Usually stable name for a release commit | Tag/ref decoration |

“Upstream” is overloaded in Git conversation:

- `upstream` can be the literal name of a remote, as in this fork.
- A local branch's “upstream branch” is its configured tracking ref and could be
  `origin/main`, `upstream/main`, or something else.

The UI should prefer the unambiguous term **tracking branch** except when showing
the literal remote name.

### Working tree, index, and commit are three distinct states

For a tracked file, a developer can have:

```text
HEAD commit  →  index/staging area  →  working-tree file
```

- Editing changes the working-tree copy.
- Staging copies the selected result into the index.
- Committing creates a snapshot from the index and advances the current branch.
- Unstaging changes the index without discarding the working-tree edit.
- Discarding changes modifies files and is therefore much more consequential
  than unstaging.

An IDE should preserve this distinction in its labels and confirmations. “Undo”
is too vague for an action that might mean unstage, restore a file, revert a
commit, or reset a branch.

### Branches are labels; checking one out changes a worktree

A branch is not a second folder or a copy of the repository. It is a movable
reference to a commit. Checking out or switching a branch updates the current
worktree's `HEAD`, index, and visible files.

That explains CLIde's current self-hosting footgun: when the selected project is
the checkout from which CLIde itself is running, a branch switch rewrites the
application's source tree underneath its dev server or build workflow.

A local branch normally cannot be checked out in two linked worktrees at the
same time. Therefore a branch list must show worktree occupancy and offer
**Open Worktree**, not **Switch**, for a branch already checked out elsewhere.

### A worktree is another checkout, not another clone

One non-bare repository has a main worktree and zero or more linked worktrees.
They share commits, refs, remotes, and most configuration, but each has its own:

- directory of checked-out files;
- `HEAD`;
- staging index;
- uncommitted changes;
- in-progress operation state such as a merge or rebase.

This makes worktrees appropriate for parallel feature work and coding agents:
each task gets separate files and an index without duplicating the repository's
object database.

Worktrees do **not** automatically share ignored dependencies or environment
files. A Node worktree may need its own install, a symlink to an intentionally
shared `node_modules`, or a repository-specific bootstrap step. CLIde should
make this post-create setup visible rather than implying the new workspace is
ready merely because Git created it.

Worktree and branch cleanup are separate:

- removing a worktree removes its checkout directory and worktree metadata;
- deleting its branch removes the branch ref;
- neither should silently imply the other.

### Local branches and remote branches are different refs

`origin/main` is not “the `main` branch on GitHub right now.” It is the local
remote-tracking ref recorded by the most recent fetch. Fetching updates that
observation without modifying the worktree.

Checking out a remote-tracking ref for development should be an explicit flow:

```text
remote selection: upstream/feature
local branch:      feature
tracking branch:   upstream/feature
worktree:          current or new linked worktree
```

An IDE should not strip `upstream/` and pass the ambiguous basename `feature`
into `git checkout`.

### Fetch, pull, push, and publish

- **Fetch** downloads remote objects and updates remote-tracking refs. It does
  not integrate them into the current branch or modify working files.
- **Pull** fetches and then integrates the configured tracking branch, normally
  by merge or rebase according to repository/user policy.
- **Push** asks a remote to update a branch from local commits.
- **Publish branch** is the first push of an untracked local branch and normally
  establishes its tracking branch.
- **Sync** is an IDE convenience that usually pulls and then pushes. It should
  disclose that sequence and require an explicit policy for divergence.

Ahead/behind is always relative to a named comparison ref. Showing “2 ahead”
without `of origin/main` is incomplete.

### Merge, rebase, and cherry-pick solve different problems

- **Merge** integrates the complete histories of two branches. It either
  fast-forwards the target or creates a merge commit when histories diverged.
- **Rebase** rewrites a sequence of commits onto a new base. It is useful for
  cleaning a local topic branch, but changes commit identities and may require a
  force-with-lease push when the old commits were already published.
- **Cherry-pick** copies selected commit changes onto the current branch as new
  commits. It does not establish that the source branch was integrated.

For CLIde's first integration workflow, the safe hierarchy is:

1. fast-forward when possible;
2. explicit merge commit when histories diverged and the user approves;
3. rebase and cherry-pick as later advanced actions.

“Merge branch” must identify both directions. The useful sentence is:

> Merge `feat/example` into `main`.

The target branch is the branch that moves. The source branch remains.

### Git and GitHub are separate systems

Git can commit, branch, merge, and work offline. GitHub hosts remote repositories
and adds accounts, pull requests, reviews, issues, Actions, and an API.

Four identities may coexist on one CLIde host:

| Identity | Example in this environment | What it controls |
| --- | --- | --- |
| OS account | `gnuthall` | Local files, processes, and home directory |
| Git commit author | `MetalZealot <email>` | Author metadata written into new commits |
| Remote transport credential | SSH key for `git@github.com` | Fetch/push authorization |
| GitHub API account | `gh` authenticated as `MetalZealot` | PRs, issues, Actions, and API operations |

CLIde may also store its own GitHub token for provider-specific UI features.
That is a fifth credential lifecycle and should be labelled as such.

Changing `git config user.name` affects future commit metadata. It does not
rename the Linux account, change the GitHub login, alter SSH authorization, or
rewrite old commits. GitHub primarily associates command-line commits with an
account through the commit email.

## Projects, repositories, and checkouts in CLIde

This is the load-bearing section for the UI revamp. Everything else in this
document depends on getting these three objects apart.

### The distinction, stated plainly

- A **repository** is the history: commits, branches, tags, remotes,
  configuration. It lives once, in the `.git` object database.
- A **checkout** (working tree) is a *directory of files on disk* produced by
  pointing that history at one commit. The files you edit are a checkout. The
  repository is not a folder of files; the checkout is.
- One repository can have **many checkouts at once**. The original directory is
  the *main checkout*. Each additional one created with `git worktree add` is a
  *linked worktree*. They share commits, branches, and remotes, but each has its
  own directory, its own `HEAD`, its own staging index, its own uncommitted
  changes, and its own in-progress merge/rebase state.
- A **branch** is a movable name pointing at a commit. It is not a folder and it
  does not hold uncommitted changes. Checking a branch out changes which commit
  a *checkout* is showing.

The one-sentence version: **the repository is the history, a checkout is a
folder showing one point in that history, and a branch is a label on a commit.**

Git enforces one rule that makes this visible: the same branch normally cannot
be checked out in two linked worktrees simultaneously, because two directories
cannot both be the working state of one branch. CLIde must detect and explain
that state rather than surfacing a generic checkout failure:

```text
Branch 'clide/source-control' is already checked out in:
/home/gnuthall/Projects/cloudcli-wt-source-control

Open that checkout, choose another branch, or create a new branch here.
```

### What CLIde does today

CLIde's project *is* a checkout. `projects.project_path` is `NOT NULL UNIQUE`
and is the identity for everything downstream:

- `sessions.project_path` is a foreign key to it, so a session belongs to a
  directory;
- the provider's own on-disk transcript storage is keyed by encoded path
  (`~/.claude/projects/<slug>`), independently of CLIde's database.

Two consequences follow directly, and neither is a labelling choice:

1. **Threads are already pinned to checkouts.** This is correct behaviour and
   comes for free.
2. **A linked worktree becomes a separate top-level project.** Running
   `git worktree add ../cloudcli-wt-topic -b feat/topic main` and starting a
   session there yields a second sidebar project with its own session list,
   unrelated in the UI to the project it was branched from. There is no object
   in CLIde today that says these two directories are the same repository.

That second consequence is the gap between CLIde's current source control and
what a modern agentic IDE is expected to do.

### Target model

The product goal is: **one project, containing every checkout of its
repository, with each checkout's branch, remote state, dirty state, and agent
occupancy visible in one place** — so concurrent agents working in parallel
worktrees are observable together rather than scattered across unrelated
sidebar entries.

That requires one new object, not a rewrite:

```text
Project  (organisational container, what the user names and opens)
  └─ Repository  (identified by `git rev-parse --git-common-dir`)
       ├─ Checkout: main            /home/gnuthall/Projects/cloudcli
       │    branch main → origin/main · clean · serving CLIde
       ├─ Checkout: worktree        /home/gnuthall/Projects/cloudcli-wt-topic
       │    branch feat/topic · unpublished · 8 changes · 2 agents active
       └─ Checkout: worktree        /home/gnuthall/Projects/cloudcli-wt-exp
            detached at a4c29e1 · clean
```

Design rules:

- **`git rev-parse --git-common-dir` is the repository identity.** Every
  checkout of one repository resolves to the same common dir; that is the join
  key, and it is derivable from data CLIde already has (a path per project). No
  user input, no migration of session data.
- **Keep `project_path` as the checkout identity.** Sessions stay bound to a
  directory. Repository grouping is a layer added *above* the existing rows, not
  a replacement for them. This deliberately keeps the change additive.
- **Checkout identity remains path-derived**, which means moving or renaming a
  worktree directory breaks continuity with its sessions and its provider
  transcripts. Recorded as an accepted deviation from the ideal (stable opaque
  IDs), because both CLIde's schema and the provider's on-disk layout are
  path-keyed and neither is ours alone to change.
- **A checkout can hold several threads.** When it does, say so, because those
  agents share one working tree and their edits can collide. This is the
  concurrency hazard the current one-project-per-directory view hides.
- **Non-Git projects stay ordinary projects.** Repository grouping is an
  enrichment for Git roots, not a precondition for using CLIde.

### What this costs

Grouping projects by repository changes the sidebar's data shape, so it must be
decided *before* the sidebar revamp lands, not retrofitted after. Open questions
to settle at implementation time:

- Does adding a worktree create a project row automatically, or is a worktree a
  child of an existing project that never appears as a top-level entry?
- Does an existing project silently become a child when a sibling worktree is
  discovered, and how is that presented to a user who did not ask for it?
- Do starring, archiving, and custom names apply to the project, the repository,
  or the individual checkout?

## CLIde's fork workflow as a concrete example

The intended long-lived layout is:

```text
siteboon/claudecodeui
  upstream/main          clean upstream development observed after fetch
          \
MetalZealot/CLIde
  main                   integrated CLIde product; tracks origin/main
    \
     feat/...            local topic branch in a linked worktree
```

The names mean:

- `origin` is the user's `MetalZealot/CLIde` fork.
- `upstream` is `siteboon/claudecodeui`.
- local `main` is the operating CLIde branch and tracks `origin/main`.
- `upstream/main` is sufficient as the clean upstream reference; a clean local
  mirror branch is optional.

A normal task lifecycle is:

1. Fetch remotes so comparisons are current.
2. Create `feat/topic` from local `main` in a new linked worktree.
3. Work, review diffs, stage, commit, and verify inside that worktree.
4. Preview `feat/topic → main`.
5. Integrate into `main` using the chosen history policy.
6. Build and verify the integrated result.
7. Push `main` explicitly.
8. Remove the linked worktree.
9. Delete the local topic branch only after Git confirms it is integrated.

The worktree isolates unfinished files. The topic branch records finished local
history. The remote preserves shared/published history. Those are complementary
mechanisms, not competing ways to do the same thing.

## What developers expect from an IDE

### Persistent workspace status

The always-visible status area should answer, without opening a menu:

- repository name;
- active worktree, especially when it is not the main worktree;
- current branch or detached `HEAD`;
- clean, dirty, conflicted, merging, or rebasing state;
- tracking branch;
- precise incoming/outgoing counts;
- unpublished state;
- whether this checkout is being used by CLIde, a dev server, a branch-test
  service, or an active agent session.

A compact form could be:

```text
CLIde · cloudcli-wt-git-ux
docs/git-source-control-ux → origin/docs/git-source-control-ux · 3 files · ↑2
```

Status should be passive information. Clicking the branch name can open the
workspace/branch picker, but must not perform a switch by itself.

### Repository/worktree selector

Worktrees should appear as workspace entries under their shared repository:

```text
CLIde
├─ main                 /home/.../cloudcli                  clean · serving
├─ docs/git-source...  /home/.../cloudcli-wt-git-...       1 modified
└─ feat/example         /home/.../cloudcli-wt-example       clean · agent active
```

Each entry should show:

- main versus linked worktree;
- path;
- branch or detached commit;
- clean/dirty/conflict/locked/prunable state;
- last activity;
- ahead/behind relative to that branch's tracking ref;
- runtime or agent occupancy known to CLIde;
- actions appropriate to its state.

Selecting a worktree changes CLIde's selected workspace. It should not secretly
switch the branch of the current directory.

### Changes view

The conventional default view remains:

- merge conflicts;
- staged changes;
- unstaged tracked changes;
- untracked files;
- per-file and per-hunk diff;
- stage, unstage, discard, open, and compare actions;
- commit message and commit action.

CLIde should add explicit operation state above file groups:

- merge/rebase/cherry-pick in progress;
- source and target refs;
- continue, abort, or open conflict resolver;
- validation/test results associated with the proposed commit when available.

Destructive file actions should state whether they affect the index, working
tree, untracked files, or history.

### History and comparison graph

The history view should show:

- all relevant local and remote refs without discarding their namespaces;
- current `HEAD`;
- branch and tag decorations;
- merge topology;
- incoming and outgoing commits;
- “compare with current worktree/branch”;
- “create branch/worktree from this commit”;
- “cherry-pick” as an advanced action;
- commit details and changed files.

The default graph should prioritize the active branch and its tracking branch,
with an option to show all refs.

### Branches and remotes

The branch view should group refs truthfully:

```text
Local
  main                       → origin/main       clean · here
  feat/example               unpublished         in worktree: ../...

Remote: origin
  origin/main
  origin/fix/example

Remote: upstream
  upstream/main
  upstream/feat/example
```

Expected branch actions include:

- switch in current clean worktree;
- open existing worktree;
- create branch from selected ref or commit;
- create new worktree from selected ref or commit;
- compare with current;
- merge into current;
- choose as source for an integration flow;
- rename local branch;
- publish or push to a specifically selected remote;
- delete local branch with merged/unmerged status;
- delete remote branch as a separate, highly explicit action.

Remote configuration deserves its own inspectable section showing fetch URL,
push URL, default/fallback behavior, last fetch, authentication method, and
fetch/prune controls.

### Integration flow

Branch integration should be a guided operation, not a generic “Merge” button.

#### 0. Name the actual operation

Applying a patch, cherry-picking commits, merging a branch, and replacing a
destination checkout produce different history and different conflict
behaviour. CLIde must never offer an unqualified **Apply**. When work finishes
in a linked worktree, the user chooses between named outcomes:

```text
Bring changes from Worktree: source-control into Main checkout

( ) Apply as uncommitted changes    working tree only, no commits, no history
(*) Merge branch                    moves main; keeps feat branch history
( ) Cherry-pick commits             copies selected commits as new commits
```

“Apply as uncommitted changes” must also state its mechanism — patch
application, temporary commit, stash, or file copy. The mechanism is not
allowed to be invisible.

#### 1. Select direction

```text
Source: docs/git-source-control-ux
Target: main
Result: merge source into target
```

The UI should default the source to the active topic branch and the target to
the repository's configured/default mainline, but both remain visible.

#### 2. Preflight

Refresh refs if requested, then report:

- source and target commits;
- merge base;
- commits unique to each side;
- files changed;
- whether the target can fast-forward;
- dirty or conflicted worktrees;
- whether either branch is checked out and where;
- runtime/agent occupancy;
- whether the source has unpushed commits;
- whether the source is already integrated;
- expected push and PR state after the local operation.

#### 3. Choose local history result

- **Fast-forward** when possible.
- **Create merge commit** when divergence exists.
- **Cancel and update topic branch** when the target advanced and policy calls
  for a rebase or merge into the topic first.

Squash, rebase, and cherry-pick can be offered under Advanced after their
history-rewriting implications are explained.

#### 4. Execute in the target worktree

Git merges into the currently checked-out target. CLIde must resolve the target
worktree and refuse to operate if it is dirty or has another Git operation in
progress.

If the target checkout serves CLIde or a dev process, apply the configured
protection:

- block when changing files would destabilize the active development runtime;
- otherwise clearly disclose that the source tree will change and that a build
  or restart may still be required.

#### 5. Report, verify, and clean up separately

After integration, show:

- resulting target commit;
- conflicts or success;
- verification still required;
- push still required;
- linked worktree still present;
- topic branch still present.

Offer separate actions:

- Open target workspace
- Run configured verification
- Push target
- Create/open pull request
- Remove source worktree
- Delete integrated source branch

No “Finish” action should silently perform all of them.

### Worktree creation flow

Required fields:

- source repository;
- base branch or commit;
- new or existing local branch;
- worktree location;
- optional repository-specific bootstrap profile.

Preflight must detect:

- branch already checked out in another worktree;
- destination already exists or is nested unsafely;
- invalid branch name;
- missing or ambiguous remote;
- insufficient disk space where practical;
- ignored files/dependencies that will not appear automatically.

After creation, CLIde should be able to:

- open/select the new worktree;
- associate a task or agent session with it;
- run a safe configured bootstrap;
- show readiness and failures;
- preserve the original workspace unchanged.

A new worktree is a fresh checkout: ignored files, installed dependencies, and
generated assets do not appear automatically, so "Git created it" is not the
same as "it is usable". The setup policy needs three rules:

- a project-defined bootstrap command (install dependencies, link a shared
  `node_modules`, build) that is visible and re-runnable;
- an explicit per-project allowlist for copying selected ignored files, such as
  local environment configuration — **never copy secrets by default**;
- **setup failures reported separately from Git failures.** "Worktree created,
  bootstrap failed" is a different state from "worktree not created", and
  collapsing them leaves the user with a directory they think does not exist.

## Agent threads, checkouts, and per-turn change review

### Thread targeting and handoff

A thread's target is the checkout it edits. It should be recorded on the thread
rather than inferred from whatever project is selected later — which CLIde
already does, since sessions carry `project_path`.

What is missing is making changes to that target *legible*:

- a branch switch or checkout change performed by an agent should appear as an
  explicit timeline event in the conversation, not as silent state drift;
- moving a conversation to another checkout is a deliberate handoff with a
  reported result, not a dropdown side effect;
- when several threads share one checkout, every one of them should say so.

```text
Switched branch main → clide/source-control
Checkout unchanged: Worktree source-control
```

### Per-turn diffs are a provider capability, not a Git feature

A useful agent result card summarises the changes attributable to *that turn*:

```text
Changed 8 files   +243 / −61
4 modified · 2 added · 1 deleted · 1 renamed
```

Repository status alone cannot reconstruct turn attribution — that needs
snapshot boundaries. **Before building a new Git-snapshot subsystem, check what
CLIde's existing rewind support already records** (`claude-rewind.util.ts`,
`RewindEditCard`, `provider-capabilities.service.ts`). Claude Code exposes a
native rewind concept with checkpoint-like boundaries; a parallel snapshot
system would duplicate it.

Rewind is Claude-specific. Per the multi-provider rule, turn-scoped diffs must
be gated on a declared provider capability and degrade to hidden for Cursor,
Codex, and OpenCode rather than hardcoding Claude-shaped checkpoints into
shared surface.

### Worktree removal flow

Default refusal conditions:

- dirty or conflicted worktree;
- untracked files;
- locked worktree;
- branch contains commits not integrated into the selected comparison target;
- active agent, terminal, dev server, test service, or CLIde runtime uses it;
- main worktree or currently selected workspace.

The confirmation should explicitly say:

- directory to be removed;
- whether the branch will be retained;
- whether all commits are reachable from another named ref;
- whether ignored files exist that Git cannot assess.

The default action removes only the worktree. Branch deletion is a subsequent,
separate action, and the dialog must offer them as distinct choices rather than
one destructive default:

```text
Remove worktree 'source-control'?

/home/gnuthall/Projects/cloudcli-wt-source-control contains:
  - 8 uncommitted file changes
  - 2 commits not merged into main
  - branch clide/source-control (pushed to origin)
  - 3 sessions bound to this directory

[Cancel]  [Keep branch, remove checkout]  [Delete everything…]
```

Ignored files (dependencies, local environment configuration, build output) are
invisible to Git's own assessment, so a worktree Git considers clean may still
hold unreproducible state. Say so rather than reporting "clean".

## Labels, iconography, and colour

Labels carry the meaning. Icons reinforce the label; they never replace it.

| Concept | Icon language | Rule |
| --- | --- | --- |
| Project | Folder or project grid | Organisational container; may hold several checkouts |
| Repository | Repository / Git-root mark | The shared history and object database |
| Branch | Branch/fork glyph | A named reference only — never used for a checkout |
| Checkout / worktree | Stacked folder or folder with checkout marker | A physical directory; must not reuse the branch icon |
| Main checkout | Folder with home marker | The repository's original working directory |
| Detached HEAD | Commit node plus text | Always the word "Detached" and a short SHA |
| Remote | Network / remote-repository mark | `origin`, `upstream` — a Git endpoint |
| Pull request | Standard PR glyph | Remote review state, not intrinsic Git state |
| Modified / untracked / conflict | `M` / `?` / warning | Conventional SCM status letters |
| Ahead / behind | Up/down arrows with counts | Always paired with the comparison ref |
| Clean | Checkmark or plain text | A neutral state, not a success celebration |

Naming rules that follow from the identity model:

- **Never label the main checkout "Local".** It is the main checkout; it may sit
  on any machine. CLIde has no execution-environment axis to contrast it with.
- **Never display a bare branch name where a checkout is meant**, and never the
  reverse. "Worktree: source-control" and "Branch: clide/source-control" are
  different facts and are frequently different strings.
- **Never invent a branch label for a detached `HEAD`.**

### Colour semantics

| Role | Meaning |
| --- | --- |
| Neutral | Clean state, current context, ordinary status |
| Amber | Uncommitted changes, no tracking branch, attention needed |
| Red | Conflicts, failed operations, destructive actions |
| Green | Successful completion feedback |
| Accent | Selected context, remote sync, active controls |

**Colour is supplemental.** Every state needs a label, count, symbol, or
tooltip that survives monochrome rendering and colour-vision deficiency. No
status may be encoded by colour alone.

### Mobile representation

The compact context collapses to two lines and stays readable:

```text
CLIde / clide/source-control
Worktree: source-control · 8 changes · ↑2
```

Tapping it opens **one unified sheet** — project, repository, checkout path and
kind, branch or detached commit, tracking branch, working-tree status, agent
occupancy, and PR state — rather than several small unrelated popovers. This
lines up with the bottom-nav direction in ADR 0005; the status line is passive
information and tapping it must never perform a switch.

## Current CLIde implementation

### What is already strong

The current Git panel already provides much of a conventional local workflow:

- working-tree status grouped by modified, added, deleted, and untracked;
- a real staged-files model;
- stage and unstage;
- file diffs;
- commit and initial-commit flows;
- recent history with commit topology and ref decorations;
- local-versus-remote branch sections in the client;
- local branch creation and safe `git branch -d` deletion;
- current-branch tracking status;
- fetch, pull, push, and first-publish actions;
- explicit confirmations for several consequential actions.

This foundation should be evolved, not replaced.

### Truth and safety gaps

#### Remote identity is lost

The `/api/git/branches` route strips `remotes/<remote>/` from every ref and
deduplicates by basename. The client consequently cannot distinguish
`origin/main` from `upstream/main`, represent branches that exist on several
remotes, or safely create a tracking branch from the selected remote ref.

The API should return structured refs rather than parallel string arrays.

#### The status contract cannot express conflicts, operations, or detached HEAD

Verified 2026-07-27. `GET /api/git/status` returns
`{ branch, hasCommits, modified, added, deleted, untracked, staged }`, and:

- **Conflicts are deliberately folded into `modified`.**
  `parseGitStatusOutput` (`server/routes/git.js`, the `isConflict` branch)
  detects `U`/`AA`/`DD` entries and then pushes them onto `modified` so they can
  never appear staged. The intent is sound, but the consequence is that conflict
  state is not representable in the API at all — a conflict count cannot be
  displayed because the data never leaves the server.
- **No in-progress operation detection exists.** There are no references to
  `MERGE_HEAD`, `REBASE_HEAD`, or `CHERRY_PICK_HEAD` anywhere in the codebase.
  The operation banner is entirely greenfield.
- **Detached `HEAD` renders as a branch named `HEAD`.**
  `getCurrentBranchName` (`server/routes/git.js`) tries
  `git symbolic-ref --short HEAD` and falls back to
  `git rev-parse --abbrev-ref HEAD`, which returns the literal string `HEAD`
  when detached. The UI then displays it as though it were a branch.
- Ahead/behind lives in a separate `/remote-status` call and covers only the
  current branch.

Phase 1 is therefore a status-contract change on the server, not a UI addition.

#### Consequential failures are discarded silently

`commitChanges` (`useGitPanelController.ts`) logs to the console and returns
`false` for both non-2xx responses and thrown fetches, and `handleCommit`
(`CommitComposer.tsx`) only clears the message box on success — so a commit
rejected by a `commit-msg` hook is indistinguishable from a dead button, no
matter how many times it is pressed (observed 2026-07-27; see `TODO.md`).

This is a prerequisite for everything else in this document. A panel that
silently swallows errors cannot host guarded destructive operations: every
refusal, preflight failure, and conflict report specified here depends on the
UI being able to show a server-side error at all.

#### Checkout lacks workspace preflight

The checkout route validates the branch name and runs `git checkout <branch>`.
It does not provide structured checks for:

- dirty files that will move or block;
- selected remote-tracking ref and intended local branch;
- branch checked out in another worktree;
- detached `HEAD`;
- merge/rebase state;
- the checkout being used to serve CLIde.

The existing warning is therefore not enough to make the operation safe.

#### Remote status is only current-branch status

Ahead/behind is derived for the current branch's tracking ref, which is correct
for the header but insufficient for a branch/worktree inventory. Each local
branch needs its own optional tracking relation and comparison state.

Fetch should also offer all-remotes behavior. A fork workflow often wants
`fetch origin` and `fetch upstream`, while pull and push still target the current
branch's configured relation.

#### Integration and worktree state are absent

There is no structured worktree inventory, merge preflight, merge execution,
conflict workflow, branch occupancy, or safe cleanup path. These should be
implemented as a cohesive workspace lifecycle rather than independent endpoint
buttons.

#### Identity and authentication are conflated

Git Settings edits the global commit author name and email. GitHub credential
settings and onboarding exist elsewhere. The product does not clearly explain
that these differ from:

- the operating-system username;
- SSH/HTTPS remote credentials;
- the `gh` API account;
- a CLIde-managed GitHub integration token.

This caused a real, understandable confusion: commits authored as `gnuthall`
were already correctly attributed by GitHub to `MetalZealot`, because the email
was associated with that GitHub account.

## Proposed data model

The API should return structured, stable identities instead of display strings.
A conceptual shape is:

```ts
type RepositoryGitState = {
  repositoryId: string;
  commonDir: string;
  remotes: GitRemote[];
  worktrees: GitWorktree[];
  localBranches: LocalBranchRef[];
  remoteBranches: RemoteBranchRef[];
  operation?: GitOperationState;
};

type GitWorktree = {
  id: string;
  path: string;
  isMain: boolean;
  headCommit: string | null;
  branchRef: string | null;
  isDetached: boolean;
  isLocked: boolean;
  isPrunable: boolean;
  cleanliness: 'clean' | 'dirty' | 'conflicted' | 'unknown';
  occupancy: WorkspaceOccupancy[];
};

type LocalBranchRef = {
  fullName: `refs/heads/${string}`;
  shortName: string;
  commit: string;
  trackingRef: `refs/remotes/${string}` | null;
  ahead: number | null;
  behind: number | null;
  checkedOutInWorktreeIds: string[];
  published: boolean;
};

type RemoteBranchRef = {
  fullName: `refs/remotes/${string}/${string}`;
  remoteName: string;
  shortName: string;
  commit: string;
};
```

Important design rules:

- full ref names are canonical API identities;
- short names are display values only;
- worktree IDs should not be inferred from mutable paths in the client;
- ahead/behind always carries the comparison ref;
- destructive endpoints accept resolved canonical identities plus an expected
  state token or commit, so stale previews fail closed;
- CLIde runtime/agent occupancy is application state layered onto Git state,
  not guessed from branch names.

Use Git's porcelain formats intended for machines where available, including
`git worktree list --porcelain` and `git status --porcelain`.

### Mapping onto CLIde's existing tables

The grouping layer is additive. Nothing about session binding changes:

| Concept | CLIde storage | Change required |
| --- | --- | --- |
| Checkout | `projects.project_path` (`NOT NULL UNIQUE`) | none — already the identity |
| Thread target | `sessions.project_path` FK | none — already pinned |
| Repository | *does not exist* | new: `git rev-parse --git-common-dir`, cached per project |
| Checkout kind | *does not exist* | new: main vs linked, from `git worktree list --porcelain` |
| Occupancy | *does not exist* | new: application state — serving runtime, dev server on 5173, branch-test on 3002, active sessions |

Occupancy is knowable rather than guessable: CLIde runs from a known checkout,
and the `cloudcli-dev` and `cloudcli-branch-test` services have fixed, queryable
workspaces. It must never be inferred from branch names.

The reference's `Environment` entity is intentionally omitted (see
"Corrections applied"). If remote execution is ever added, an environment is a
property of the *server host*, not of each thread, and should be shown once.

## Identity and authentication UX

Settings should separate two cards.

### Commit identity

Show:

- effective author name;
- effective author email;
- scope and source: repository, global, system, or environment override;
- whether GitHub associates the email with the connected account when that can
  be checked safely;
- explanation: affects future commits only.

Offer repository-specific override and global default as distinct choices.

### Remote hosting and authentication

For each relevant integration, show an independently tested status:

- Git remote name and URL;
- SSH or HTTPS transport;
- transport credential status where it can be checked;
- GitHub CLI/API account and scopes;
- CLIde GitHub integration account/token;
- last successful validation and a **Reconnect** action.

Error messages should name the failed layer:

- “GitHub CLI API token is invalid”
- “SSH authentication to `github.com` failed”
- “Remote `origin` denied push”
- “CLIde GitHub integration needs reconnection”

Avoid the generic “GitHub authentication expired” when the application knows
which credential failed.

## Guardrail policy

### Read-only operations

Status, log, diff, branch listing, worktree listing, remotes, fetch preview, and
merge preview may run without confirmation.

Fetch changes remote-tracking refs but not working files. It can normally be a
one-click action with visible progress and errors.

### Working-tree mutations

Switch, restore/discard, delete-untracked, merge, rebase, cherry-pick, and
worktree removal require state-aware preflight. Refuse by default when the
target worktree is dirty or conflicted.

### History and remote mutations

Commit, amend, branch deletion, push, force-with-lease, tag deletion, and remote
branch deletion require explicit targets. Never expose an unqualified force
push. If force-with-lease is later supported, show the expected remote commit
and fail when it changed.

### Self-hosting protection

CLIde must know the repository/worktree containing its runtime source and any
registered dev/test service workspaces. Actions that rewrite those files should
be blocked or elevated with precise consequences. A dirty-tree warning alone
does not cover runtime disruption.

## Recommended implementation sequence

### Phase 0: make what already exists truthful and safe

The existing panel already performs consequential operations. These items make
current behaviour honest before any new power is added; each is small and
independently shippable, and several are upstreamable.

1. Surface commit and operation errors in the UI instead of the console.
2. Split conflicts out of `modified` in the status contract.
3. Detect and report in-progress merge/rebase/cherry-pick state.
4. Render detached `HEAD` as `Detached at <sha>`, never as a branch.
5. Report unborn-branch state distinctly from detached `HEAD`.

### Phase 1: truthful state and identity

1. Replace branch string arrays with structured local and remote refs.
2. Group remote branches by actual remote and preserve duplicate basenames.
3. Make remote checkout explicitly create a named local tracking branch.
4. Show tracking target beside ahead/behind counts.
5. Add dirty/in-progress/worktree-occupancy preflight to switching.
6. Protect the checkout serving CLIde.
7. Separate commit identity from GitHub/transport authentication in Settings.

This phase resolves known correctness and safety problems before adding more
power.

### Phase 2: workspace inventory and creation

1. Add structured worktree discovery.
2. Derive repository identity from `--git-common-dir` and group projects by it.
3. Present project → repository → checkout hierarchy and occupancy in the
   sidebar. **Decide this before the sidebar revamp lands** — it changes the
   sidebar's data shape and cannot be retrofitted cheaply.
4. Show shared-checkout thread counts so concurrent agents are visible.
5. Create a linked worktree from a selected base and new branch.
6. Open/select the resulting workspace.
7. Support repository-configured bootstrap guidance, including the ignored-file
   allowlist and separate reporting of bootstrap versus Git failures.
8. Add safe worktree removal while retaining the branch by default.
9. Add per-turn change review where the provider supports it.

### Phase 3: branch integration

1. Add source/target selection and merge preview.
2. Support fast-forward integration.
3. Support explicit merge commits with conflict reporting.
4. Report verification, push, PR, worktree cleanup, and branch cleanup as
   separate remaining actions.
5. Add an integrated-branch deletion check.

### Phase 4: advanced history and collaboration

- rebase with explicit rewrite consequences;
- cherry-pick;
- stash/shelve workflow;
- three-way conflict editor;
- pull-request state and checks;
- branch protection visibility;
- agent/session attribution and turn-scoped change review.

## Acceptance criteria

The design is successful when a developer can answer these questions from the
UI without knowing Git's command syntax:

- Which directory and worktree will this action modify?
- Which local branch is checked out there?
- Is that branch checked out anywhere else?
- What remote branch, if any, does it track?
- Are the displayed remote facts current as of the last fetch?
- What changes are unstaged, staged, conflicted, or untracked?
- What exactly will be committed?
- Which branch will move if I merge?
- Can the merge fast-forward, and what commits/files will it integrate?
- Will this affect the checkout serving CLIde or an active agent?
- Is the next action local only, or will it write to a remote?
- Does cleanup remove a directory, a branch, or both?
- Which identity authors commits, which credential pushes Git data, and which
  account performs GitHub API actions?

No branch, remote, or worktree action should rely on a stripped display name as
its canonical identity. No destructive cleanup should be the hidden side effect
of a friendly “finish” action.

### Product contract

> Without opening a terminal, a user can determine: which directory this thread
> is editing, which repository that directory belongs to, which branch or commit
> it has checked out, what uncommitted changes it holds, who else is working in
> it, and exactly which operation brings the result into the normal working copy.

### Implementation checklist

- [ ] Project, repository, checkout, branch, and thread are distinct objects.
- [ ] Every checkout of one repository is visible in one place.
- [ ] Threads remain bound to their checkout unless an explicit handoff occurs.
- [ ] Shared-checkout occupancy is visible when several threads share a directory.
- [ ] Staged, unstaged, untracked, and conflicted states are separately inspectable.
- [ ] In-progress merge/rebase/cherry-pick states are prominent, never hidden
      behind a generic dirty indicator.
- [ ] Detached `HEAD` is displayed truthfully, with a short SHA.
- [ ] Branches and checkouts have separate lists, separate icons, and separate actions.
- [ ] Ahead/behind always names its comparison ref.
- [ ] Remote-tracking refs keep their remote namespace end to end.
- [ ] Integration actions state whether they patch, cherry-pick, or merge.
- [ ] Worktree removal protects uncommitted work, unmerged commits, and ignored files.
- [ ] Branch deletion is never implied by checkout removal.
- [ ] Operations that rewrite the checkout serving CLIde are blocked or elevated.
- [ ] Server-side failures are visible in the UI.
- [ ] Mobile context is inspectable in one sheet, without icon-only chips.
- [ ] Colour is supplemental; every state is labelled.
- [ ] Per-turn diffs are gated on provider capability, not assumed.

## Official references

Accessed 2026-07-26:

- [Git worktree documentation](https://git-scm.com/docs/git-worktree.html)
- [Git user manual](https://git-scm.com/docs/user-manual)
- [VS Code: branches and worktrees](https://code.visualstudio.com/docs/sourcecontrol/branches-worktrees)
- [VS Code: repositories and remotes](https://code.visualstudio.com/docs/sourcecontrol/repos-remotes)
- [VS Code: merge conflicts](https://code.visualstudio.com/docs/sourcecontrol/merge-conflicts)
- [JetBrains: manage Git branches](https://www.jetbrains.com/help/idea/manage-branches.html)
- [JetBrains: use Git worktrees](https://www.jetbrains.com/help/idea/use-git-worktrees.html)
- [JetBrains: merge, rebase, and cherry-pick](https://www.jetbrains.com/help/idea/apply-changes-from-one-branch-to-another.html)
- [Zed Git integration](https://zed.dev/docs/git)
- [GitHub: setting a commit email address](https://docs.github.com/en/account-and-profile/how-tos/email-preferences/setting-your-commit-email-address)
- [GitHub CLI authentication](https://cli.github.com/manual/gh_auth)
- [GitHub token expiration and revocation](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/token-expiration-and-revocation)
