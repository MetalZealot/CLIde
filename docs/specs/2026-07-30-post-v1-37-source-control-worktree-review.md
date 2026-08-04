# Post-v1.37 Source Control and worktree review

- Date: 2026-07-30
- Status: Source assessment complete; implementation deferred until the
  upstream v1.37 integration is complete and live-verified
- Scope: Reassess upstream v1.37's Git and worktree implementation against
  CLIde's Source Control design, retain compatible Git improvements, and define
  what may be harvested for a later guarded worktree implementation
- Reviewed upstream tag: `v1.37.0`
- Reviewed upstream commit:
  `264e0946d2a168c281b85807cd1183130f40b090`
- Upstream feature squash: `06e7ee9`
- Integration prerequisite:
  [Upstream v1.37.0 integration](2026-07-29-upstream-1-37-integration.md)
- Governing design:
  [Git Source Control and workspace UX](2026-07-26-git-source-control-workspace-ux.md)
- Governing decision:
  [ADR 0016 — projects group checkouts by repository](../../decisions/0016-repository-grouped-checkouts.md)
- Related follow-up:
  [Source Control commit-message model selection](2026-07-29-source-control-commit-message-model-selection.md)

## Executive decision

Do not integrate or expose upstream v1.37's Worktrees feature as shipped.

The feature contains useful, testable backend foundations, but its product
contract conflicts with CLIde's accepted repository/checkout identity model and
adds destructive operations before the existing Source Control panel can
truthfully represent conflicts, detached HEAD, in-progress Git operations,
remote identity, runtime occupancy, or self-hosting risk.

Keep the worktree files out of the active v1.37 integration, as already decided.
After that integration is complete and live-verified:

1. make existing Git state truthful and branch switching safe;
2. establish repository-grouped checkout inventory and occupancy;
3. port selected upstream parsing, listing, validation, compensation, conflict
   rollback, and test foundations onto that model; and
4. expose creation, integration, and removal only after the Source Control
   specification's refusal and self-hosting gates pass.

The right classification is therefore:

- **adopt now:** compatible non-worktree Git improvements;
- **harvest later:** implementation primitives whose contracts can be adapted;
- **replace:** upstream identity, integration, cleanup, and lifecycle behavior;
  and
- **reject:** destructive defaults, hidden cleanup, hardcoded layout, and the
  standalone Worktrees tab as shipped.

## Why this is a post-integration follow-up

The active `chore/upstream-1.37` worktree is already resolving the upstream
server-module migration and shared Git-panel changes. The Worktrees subsystem
has deliberately been excluded from that merge, not retained unregistered.
Reviewing its source at the immutable tag is sufficient to decide what is worth
keeping, but implementing it against the mid-merge tree would target a
transient architecture and overlap the current conflict-resolution work.

Begin implementation only after the v1.37 worktree has:

1. completed source integration;
2. passed its focused tests, typecheck, lint, and builds;
3. been live-verified by Grayson in isolation; and
4. been merged into `main`.

Use the then-current integrated Git module and Git-panel components as the
baseline. Do not assume either pre-v1.37 CLIde paths or upstream v1.37 paths
survived unchanged.

This document is not permission to restart production, replace an occupied
branch-test service, modify real projects or sessions, or enable mutating
worktree routes.

## What upstream v1.37 changed

The reviewed Source Control and worktree slice changes 43 paths with
approximately 4,393 insertions and 431 deletions. Most of the work arrived in
the single upstream feature squash rather than isolated Git-focused commits, so
the source tree, not the commit subject, is the evidence.

### Git module and conventional panel changes

Upstream:

- moves `server/routes/git.js` into a TypeScript Git module;
- injects filesystem, process, project-resolution, and provider dependencies;
- extracts status and history parsing into a testable service;
- adds route tests for Git parsing and repository initialization;
- adds `POST /api/git/init` and a one-click initialization state in the panel;
- distinguishes history loading from ordinary status loading;
- rejects stale history responses after the selected project changes;
- makes Git tabs horizontally scrollable;
- keeps confirmation actions visible while long confirmation content scrolls;
  and
- adjusts the empty initial-repository state.

The existing branch, checkout, status, remote-status, pull, push, publish,
stage, unstage, discard, and commit contracts otherwise remain substantially
unchanged.

Upstream removes the AI commit-message button and client wiring from the commit
composer, but leaves `/api/git/generate-commit-message` in the server route.
That produces an orphaned route rather than a coherent removal. CLIde must
retain both its visible generator and the separately specified provider/model-
selectable ephemeral-job design.

### Worktrees backend

Upstream adds 18 files under `server/modules/worktrees/`:

- seven service files;
- eight test files totalling approximately 35 KB;
- the module composition root;
- the HTTP routes; and
- the barrel export.

The service API provides:

- `GET /api/worktrees`;
- `POST /api/worktrees/create`;
- `POST /api/worktrees/open`;
- `POST /api/worktrees/merge`; and
- `POST /api/worktrees/remove`.

The list response describes each checkout with:

- path;
- branch and HEAD SHA;
- main/current, locked, and detached flags;
- changed-file count;
- ahead/behind counts relative to the main worktree's local branch;
- last commit subject and date; and
- linked-project ID and archive state.

Per-worktree Git inspection is fanned out with a concurrency cap of four, which
is a sensible default for CLIde's resource-constrained host.

### Worktrees client

Upstream adds five worktree-specific client files:

- `useWorktreesController.ts`;
- `WorktreesView.tsx`;
- `NewWorktreeModal.tsx`;
- `MergeWorktreeModal.tsx`; and
- `RemoveWorktreeModal.tsx`.

`GitViewTabs.tsx` registers Worktrees as a fourth view beside Changes, Commits,
and Branches. Opening a worktree registers or restores a separate CloudCLI
project row, refreshes the top-level project list, selects that project, and
navigates away from the current project/session.

The row presentation contains useful visual material: main and linked
checkouts use different icons, detached state includes a short SHA, and locked,
dirty, ahead/behind, and last-commit state are visible. Those presentation
patterns may be reused in CLIde's future repository-grouped checkout selector;
the standalone tab and project-switch behavior should not be.

## Upstream behavior as shipped

### Inventory and opening

`git worktree list --porcelain` is the source of truth. Every requested
worktree path is resolved against that inventory before a mutating command is
allowed, preventing the API from becoming a generic "run Git in an arbitrary
directory" surface.

Opening a worktree does not add a repository-grouped checkout. It creates or
restores another top-level project named `repo · branch`. The only relationship
between it and the main checkout is a naming convention.

### Creation

Creation:

- validates a restricted local branch name;
- refuses a branch already checked out in another worktree;
- refuses an occupied destination directory;
- checks out an existing local branch or creates a new one from a local base
  branch;
- hardcodes the destination as
  `<repo-parent>/<repo-name>-worktrees/<sanitized-branch>`;
- creates or restores a top-level project row for the new path; and
- compensates for project-registration failure by removing only the worktree
  and branch it just created.

Creation stops after `git worktree add`. It does not link dependencies, install
packages, copy allowlisted ignored configuration, assign ports, run a project
bootstrap, or distinguish "Git succeeded, setup failed."

For CLIde itself, that means the created checkout is not ready to run. The
existing `scripts/setup-worktree.sh` exists because a bare worktree lacks the
dependency links and port allocation this repository requires.

### Merge

Merge:

- treats the first porcelain entry as the main worktree;
- treats that worktree's currently checked-out branch as the implicit target;
- refuses a dirty source or dirty target;
- offers squash or forced merge-commit behavior;
- uses `git merge --squash` plus `git commit`, or `git merge --no-ff`;
- captures conflicted paths;
- attempts `git reset --merge` after failure;
- reports rollback failure separately; and
- optionally removes the source worktree after a successful merge.

The merge dialog initializes both `squash` and `removeAfterMerge` to `true`.
When removal is requested, the backend hardcodes `deleteBranch: true`; there is
no separate user choice for retaining the source branch. The removal service
then attempts `git branch -D` and silently treats deletion failure as best-
effort cleanup.

This does not guarantee that the branch is deleted—the command can fail—but it
does mean upstream unconditionally attempts destructive branch deletion when
post-merge removal is enabled.

### Removal

Removal:

- refuses to remove the main worktree;
- checks ordinary porcelain dirtiness unless forced;
- runs `git worktree remove`, optionally with `--force`;
- optionally attempts `git branch -D`;
- archives the linked top-level project after Git removal; and
- reports project-archive failure without undoing successful Git removal.

The removal dialog initializes branch deletion to `true`. It does not prove
that the branch is integrated into an explicit target, reachable from another
ref, or pushed to its tracking branch. It does not inventory ignored files or
report sessions, agents, terminals, services, or runtimes using the directory.

## Impact on CLIde if integrated unchanged

| Concern | Upstream v1.37 | Impact on CLIde |
|---|---|---|
| Project identity | One top-level project per checkout | Contradicts ADR 0016 and preserves the scattered-agent problem |
| Repository identity | No `--git-common-dir` grouping | Cannot show all checkouts and agents for one repository together |
| Branch identity | Strips `refs/heads/` | Conflicts with canonical full-ref requirements |
| Remote identity | Existing branch API strips remote names | Cannot distinguish `origin/main` from `upstream/main` |
| Status truth | Conflicts remain folded into `modified` | Destructive operations can refuse without the panel explaining why |
| Operation state | No merge/rebase/cherry-pick detection | Cannot distinguish an active Git operation from ordinary dirtiness |
| Detached HEAD | Partial worktree display only | Existing branch/status surfaces still render detached state incorrectly |
| Occupancy | No agent/runtime/service/terminal state | Misses the main agent-platform purpose of repository-grouped worktrees |
| Branch switching | Existing bare `git checkout` remains | The checkout-clobbering bug is not fixed |
| Merge target | Main worktree's current branch, implicit | Source, target, direction, and intended mainline are not user-controlled |
| History policy | Squash defaults on; otherwise always `--no-ff` | No fast-forward policy and unsafe default history rewriting |
| Cleanup | Worktree removal and branch deletion coupled | Violates separate authorization and non-destructive defaults |
| Remote safety | Ahead/behind compares only local branches | Cannot distinguish unmerged work from unpushed work |
| Bootstrap | Hardcoded directory and no setup | Creates an unusable CLIde checkout |
| Self-hosting | No serving-checkout guard | Merge can rewrite the source tree beneath the running app |
| Commit UX | Generator button removed | Regresses CLIde and collides with the ephemeral-job follow-up |
| Styling | Five Git-panel modals use `backdrop-blur-sm` | Violates ADR 0001 |

## Relationship to the checkout-clobbering bug

Upstream does not fix CLIde's existing branch-switch hazard. Its checkout route
still validates a string and runs:

```text
git checkout <branch>
```

It does not refuse a dirty checkout, detect that the branch is occupied by
another worktree, preserve remote identity, detect an in-progress operation, or
protect the checkout serving CLIde.

The Worktrees feature adds a second path to the same failure family. Merge runs
inside the main worktree and rewrites its checked-out files. When the main
worktree is also the checkout serving CLIde, a merge can churn the running
source tree exactly as the branch switcher does.

Worktree support may reduce the need to switch branches in place, but it is not
a fix unless both branch switching and integration share one checkout-mutation
preflight with:

- dirty/conflicted state;
- detached and in-progress operation state;
- branch occupancy;
- agent, terminal, service, and runtime occupancy;
- serving-checkout detection; and
- an explicit target directory and canonical target ref.

## Collision with CLIde's Source Control plan

Upstream implements much of the planned workspace-inventory phase before the
truthfulness and identity phases it depends on.

### Identity collision

ADR 0016 defines repository, checkout, branch, remote, and thread as distinct
objects. Repository identity is derived from:

```text
git rev-parse --git-common-dir
```

`projects.project_path` and `sessions.project_path` remain checkout/thread
targets. A grouping layer above those rows makes every checkout of one
repository visible in one project.

Upstream instead turns each checkout into an unrelated top-level project and
tries to group them visually with a display-name convention. Adopting that
model would require a later sidebar and database retrofit precisely where ADR
0016 deliberately established permanent divergence.

### Information-model collision

CLIde's plan requires:

- structured local, remote-tracking, and remote refs;
- canonical full refs end to end;
- an explicit comparison ref for every ahead/behind count;
- conflict and in-progress-operation state;
- runtime and agent occupancy;
- separate branch and checkout lists and actions; and
- separate local Git, remote transport, and hosting-service state.

Upstream provides string branch names, local-base comparisons, and top-level
project links. Its inventory is useful input, not the final data model.

### Integration-flow collision

CLIde's planned integration flow makes source, target, direction, preflight,
and history result explicit. It defaults to fast-forward when possible, uses a
merge commit when divergence requires one, and puts squash, rebase, and cherry-
pick behind informed advanced choices.

Upstream:

- assumes the source from the chosen linked worktree;
- assumes the target from whatever the main checkout currently has checked out;
- defaults to squash;
- defaults to cleanup;
- attempts forced branch deletion during cleanup; and
- has no push, pull request, verification, or separately authorized cleanup
  stages.

That is the exact "friendly Finish button hides several operations" pattern the
Source Control design rejects.

## Adopt during the v1.37 integration

These changes are independent of the deferred Worktrees feature and should be
ported where they fit the final integrated components:

1. TypeScript Git-module boundary and explicit dependency injection.
2. Extracted status and history parsers.
3. Git parsing, initialization, and route tests.
4. Repository initialization route and UI.
5. Separate history-loading state and stale-project response checks.
6. Horizontally scrollable, accessible Git tabs.
7. Confirmation dialogs whose action buttons remain reachable with long
   content.
8. Refresh and initialization feedback that surfaces server failures.

Preserve CLIde's improvements while adopting them:

- visible multiline hook/server errors;
- retained commit input after failure;
- AI commit-message generation UI and route;
- provider/model-selectable ephemeral generation design;
- local-versus-remote branch grouping; and
- the planned self-hosting branch-switch guard.

## Harvest after truthfulness and identity foundations

Harvest at function or service level from immutable `v1.37.0`; do not copy the
product model around the code.

| Upstream material | Keep | Required adaptation |
|---|---|---|
| `worktree-git.service.ts` | Injected Git runner, stderr details, branch validation, porcelain parsing, membership guard, dirty counting | Preserve canonical refs, locked reason, prunable state, and structured status |
| `worktree-list.service.ts` | Last-commit reader and concurrency-capped fan-out | Group by common Git dir; compare each branch with its tracking ref; add operation and occupancy state |
| `worktree-create.service.ts` | Occupied-path and checked-out-branch refusal | User-selectable location, structured base ref, disk/readiness checks, and bootstrap contract |
| `worktree-create-and-open.service.ts` | Compensation after registration failure | Register a grouped checkout, not a new top-level project; separate Git success from bootstrap failure |
| `worktree-merge.service.ts` | Clean-source/target checks, conflict paths, `reset --merge` rollback, rollback-failure reporting | Explicit target checkout/ref, fast-forward policy, serving guard, no implicit cleanup or deletion |
| `worktree-remove.service.ts` | Main-worktree refusal and project-history preservation concept | Refuse locked, active, dirty, conflicted, unintegrated, unpushed, serving, selected, and ignored-state risk by default |
| `worktrees.routes.ts` | Route/service separation and injected project-path resolution | Final route shape follows repository-grouped identity and shared preflight |
| Eight test files | Test harness and injected fakes | Reverse destructive expectations and add CLIde's refusal matrix |
| Worktree row presentation | Main/linked distinction, detached SHA, locked/dirty/activity display | Place under the repository/checkout hierarchy and add tracking plus occupancy |

The membership guard is non-negotiable: every worktree mutation must continue
to prove that its target came from the selected repository's porcelain
inventory before invoking Git.

## Leave behind

Do not port:

- project-per-worktree identity;
- display-name-based pseudo-grouping;
- the standalone Worktrees tab as shipped;
- implicit main-worktree merge target;
- default squash;
- default remove-after-merge;
- default branch deletion;
- hardcoded post-merge `deleteBranch: true`;
- swallowed forced-branch-deletion failure;
- hardcoded `<repo>-worktrees/<branch>` layout;
- creation without readiness/bootstrap reporting;
- local-base-only ahead/behind;
- stripped canonical refs;
- force removal without the full refusal matrix;
- hidden cleanup as part of merge success; or
- backdrop filtering.

## Required implementation sequence

### Phase 0: make existing Git state truthful and safe

Before adding worktree controls:

1. return conflicts separately from ordinary modifications;
2. return detached HEAD as detached state plus SHA, not branch `HEAD`;
3. detect merge, rebase, cherry-pick, and revert state;
4. return structured server errors on every consequential operation;
5. retain commit input after failure;
6. preserve hook stderr;
7. preserve canonical local and remote refs;
8. distinguish `origin`, `upstream`, and other remotes;
9. refuse dirty or conflicted branch switching;
10. refuse or elevate mutations of the checkout serving CLIde; and
11. report branch occupancy in another linked worktree.

The branch switcher and future merge flow must use the same checkout-mutation
preflight rather than accumulating operation-specific warnings.

### Phase 1: repository and checkout inventory

Add the ADR 0016 grouping layer:

1. derive repository identity with `git rev-parse --git-common-dir`;
2. group existing path-keyed project rows by repository;
3. keep sessions bound to their checkout path;
4. inventory main, linked, locked, detached, and prunable worktrees;
5. show branch, tracking ref, dirty/conflict/operation state, and last activity;
6. add agent/session, terminal, dev-service, branch-test, and serving occupancy
   where CLIde can prove it; and
7. keep non-Git projects unchanged.

No mutation is required for this phase. Establish truthful read-only inventory
before adding power.

### Phase 2: guarded creation and opening

Adapt upstream creation and compensation around CLIde's model:

1. choose repository, base ref or commit, new/existing branch, and location;
2. reject occupied branches, unsafe/nested paths, ambiguous refs, and existing
   destinations;
3. create the linked checkout;
4. register it beneath the repository grouping without moving existing
   sessions;
5. run a visible project bootstrap such as `scripts/setup-worktree.sh`;
6. report Git creation and bootstrap as separate outcomes;
7. allocate dependency links and a free port pair for CLIde worktrees; and
8. compensate only state created by the current operation.

Never copy ignored files or secrets by default. Any allowlisted copy policy must
be explicit and visible.

### Phase 3: explicit integration and cleanup

Build integration from CLIde's contract, using upstream rollback primitives:

1. choose and display the source checkout/ref;
2. choose and display the target checkout/ref;
3. refresh and report merge base, unique commits, changed files,
   fast-forwardability, dirty/operation state, occupancy, and push state;
4. default to fast-forward when possible;
5. use an explicit merge commit when divergence requires one;
6. keep squash, rebase, and cherry-pick under Advanced;
7. execute only in the resolved clean target checkout;
8. protect the checkout serving CLIde;
9. abort conflicts and prove target recovery;
10. report verification, push, pull request, worktree, and branch state
    separately; and
11. require separate actions and authorization for worktree removal and branch
    deletion.

There is no single "Finish" action that may silently verify, push, remove a
directory, and delete a branch.

## Exposure gate

Do not register mutating Worktree routes or render reachable Worktree controls
until all of the following are true:

- repository and checkout identity conform to ADR 0016;
- canonical full refs and remote identity survive end to end;
- conflicts, detached HEAD, and in-progress operations are representable;
- the shared checkout-mutation preflight protects dirty, occupied, locked,
  active, and serving checkouts;
- creation has a readiness/bootstrap contract;
- integration has explicit source, target, direction, and history policy;
- removal proves uncommitted, unintegrated, unpushed, ignored-file, and
  occupancy risks;
- branch deletion is independent and defaults off;
- all server refusal details reach a visible UI surface;
- no modal uses backdrop filtering; and
- the focused automated and isolated live verification below passes.

Internal parser or service foundations may land earlier if they are used and
tested by read-only inventory. Do not retain unused unregistered code merely to
claim upstream parity.

## Required automated verification

### Truth and identity

1. Canonical local, remote-tracking, and remote-ref parsing.
2. Same-named refs on `origin` and `upstream` remain distinct.
3. Detached HEAD carries a short SHA and no fake branch.
4. Conflicted files are separate from staged and modified files.
5. Merge/rebase/cherry-pick/revert state is detected.
6. Multiple checkouts resolve to one common repository identity.
7. Non-Git projects remain ordinary projects.

### Checkout mutation

1. Dirty and conflicted branch switches refuse before `git checkout`.
2. Occupied branches return the existing checkout path.
3. Serving-checkout mutation refuses or requires the explicit elevated policy.
4. Locked, prunable, selected, agent-active, terminal-active, and service-active
   states produce the specified refusal or warning.
5. A requested path outside the selected repository's porcelain inventory never
   reaches a Git mutation.

### Creation

1. Existing branch and new branch flows use the selected canonical base ref.
2. Occupied branch and destination path refuse without partial state.
3. Project registration failure compensates only newly created state.
4. Compensation failure reports both the original and rollback failures.
5. Bootstrap failure leaves an accurately reported created-but-not-ready
   checkout.
6. CLIde bootstrap assigns dependency links and a free port pair.

### Integration

1. Fast-forward, merge-commit, and explicit squash policies produce the stated
   history.
2. Source and target dirtiness refuse before mutation.
3. In-progress source or target operations refuse.
4. Conflict abort restores the target and reports conflicted paths.
5. Rollback failure is never reported as a successful abort.
6. Merge into the serving checkout refuses or uses the explicitly chosen
   elevated policy.
7. `removeAfterMerge` cannot imply branch deletion.
8. Cleanup failure does not hide merge success or lose the remaining cleanup
   state.

### Removal

1. Main, dirty, conflicted, locked, active, selected, serving, unintegrated, and
   unpushed worktrees refuse by default.
2. Ignored-file risk is disclosed.
3. Removing a checkout retains its branch by default.
4. Branch deletion requires a second, explicit authorization.
5. An unsuccessful branch deletion remains visible and retryable.
6. Sessions remain recoverable after checkout removal.

### Existing Source Control behavior

1. Commit-hook stderr remains multiline and visible.
2. A failed commit retains the message.
3. AI commit-message generation remains provider-neutral.
4. Repository initialization is idempotent.
5. History loading never flashes a false empty state.
6. Git tabs and confirmation content remain usable at mobile widths.

Run server tests with CLIde's server TypeScript configuration:

```bash
./node_modules/.bin/tsx --tsconfig server/tsconfig.json --test \
  <matching server Git and worktree test files>
```

Then run:

```bash
npm run typecheck
npm run lint
npm run build:server
npm run build:client
```

## Required isolated live verification

Use disposable repositories and worktrees. Do not test removal, forced cleanup,
branch deletion, or schema-affecting project behavior against real user
projects.

Verify:

- a repository with `origin` and `upstream` branches sharing names;
- a clean linked worktree;
- dirty, conflicted, detached, locked, and prunable worktrees;
- two sessions sharing one checkout;
- separate sessions in sibling worktrees of one repository;
- an occupied branch;
- a worktree with ignored local files;
- a new CLIde worktree whose bootstrap links dependencies and allocates ports;
- fast-forward and divergent integration;
- an integration conflict and successful rollback;
- refusal to mutate the checkout serving the isolated CLIde instance;
- removal that retains the branch;
- separately authorized branch deletion;
- project/session visibility after a checkout is removed; and
- real mobile/touch use of inventory, confirmations, errors, and long paths.

Report source, installed dependencies, client build, server build, isolated
service/ports, and production service state separately. The production service
must remain untouched until Grayson approves deployment after isolated
verification.

## Completion criteria

This follow-up is complete only when:

- the v1.37 integration is complete and live-verified;
- Phase 0 truthfulness and checkout safety are implemented;
- repository-grouped checkout inventory conforms to ADR 0016;
- selected upstream foundations are ported rather than copied wholesale;
- the Worktrees tab and project-per-checkout behavior are absent;
- branch switching and merge share one tested checkout-mutation preflight;
- creation produces a usable, accurately reported checkout;
- integration has explicit source, target, direction, and history policy;
- cleanup, worktree removal, and branch deletion are independent;
- all automated and isolated live checks pass;
- production remains unchanged until explicit approval; and
- `TODO.md` records the verified implementation commit and any remaining
  advanced integration work.

If implementation requires changing the accepted repository/checkout model or
the non-destructive cleanup policy, do not rewrite ADR 0016. Propose a new ADR
that explicitly supersedes it and explains the migration and safety costs.
