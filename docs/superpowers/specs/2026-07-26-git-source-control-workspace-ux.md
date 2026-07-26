# Git source-control and workspace UX for CLIde

- Date: 2026-07-26
- Status: Design reference; implementation not started
- Scope: Git mental model, source-control information architecture, branch and
  remote operations, worktree lifecycle, branch integration, identity, and
  authentication
- Related backlog: `TODO.md` — Source Control worktrees and branch integration;
  Git branch remote labels; Git branch-switcher safety
- Related reference:
  `docs/superpowers/specs/2026-07-25-agentic-coding-ux-reference.md`

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
separate action.

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
2. Present repository → worktree hierarchy and occupancy.
3. Create a linked worktree from a selected base and new branch.
4. Open/select the resulting workspace.
5. Support repository-configured bootstrap guidance.
6. Add safe worktree removal while retaining the branch by default.

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
