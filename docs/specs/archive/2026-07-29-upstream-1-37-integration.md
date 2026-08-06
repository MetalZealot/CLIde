# Upstream v1.37.0 integration

- Date: 2026-07-29
- Status: Completed and archived 2026-08-04. Integrated into `main` in
  `658d536`, deployed to port 3001, and accepted by Grayson.
- Scope: Integrate `siteboon/claudecodeui` v1.37.0 into CLIde while
  preserving CLIde's provider-neutral runtime, session identity, model,
  context-usage, Source Control, WebSocket, Settings, and worktree safety
  decisions
- Upstream tag: `v1.37.0`
- Upstream commit: `264e0946d2a168c281b85807cd1183130f40b090`
- Upstream feature squash: `06e7ee9`
- Upstream OAuth fix: `75ff8a5`
- Reviewed CLIde commit:
  `6aba1bc40dcea19a0b2435858d40e82c827085d4`
- Reviewed merge base:
  `27eaf0146a46aa8a55178f3d394360ff7465420f`
- Re-measured against CLIde `main` at `3b892ec` after the Settings IA merge —
  see [Re-measurement after the Settings IA
  merge](#re-measurement-after-the-settings-ia-merge-2026-07-29). **Read that
  section before Phase 6 or before resolving anything QuickSettings-shaped.**
- Related upstream work:
  - [PR #1037 — numerous bugfixes and features](https://github.com/siteboon/claudecodeui/pull/1037)
  - [PR #979 — recognize `CLAUDE_CODE_OAUTH_TOKEN`](https://github.com/siteboon/claudecodeui/pull/979)
- Related CLIde decisions:
  - [ADR 0001 — no backdrop blur](../../decisions/0001-no-backdrop-blur.md)
  - [ADR 0003 — per-session model tracking](../../decisions/0003-per-session-model-tracking.md)
  - [ADR 0006 — app-level WebSocket liveness](../../decisions/0006-app-level-ws-liveness.md)
  - [ADR 0012 — Codex rewind and fork session identity](../../decisions/0012-codex-rewind-and-fork-session-identity.md)
  - [ADR 0013 — abort is signal-first](../../decisions/0013-abort-is-signal-first-not-provider-id-keyed.md)
  - [ADR 0014 — context ceiling comes from the SDK](../../decisions/0014-context-ceiling-from-sdk.md)
  - [ADR 0016 — repository-grouped checkouts](../../decisions/0016-repository-grouped-checkouts.md)
  - [ADR 0019 — QuickSettings panel removed; no second settings surface](../../decisions/0019-quicksettings-removal.md)
- Related CLIde specifications:
  - [Settings information architecture](2026-07-28-settings-information-architecture.md)
  - [Git and Source Control workspace UX](2026-07-26-git-source-control-workspace-ux.md)
  - [Source Control commit-message model selection](2026-07-29-source-control-commit-message-model-selection.md)
  - [Codex chat transport architecture](../../maps/2026-07-25-codex-chat-transport-architecture.md)

## Status and sequencing

**Gate satisfied 2026-07-29.** `feat/settings-ia` was completed, live-verified,
and merged into `main` at `3b892ec`. Implementation may begin. The original
gate text is kept below because its rationale still governs *how* Phase 6 is
resolved.

Implementation starts only after the `feat/settings-ia` worktree has been
completed, live-verified, and merged into `main`. Upstream 1.37 changes
QuickSettings, authentication context, Git UI, session state, and shared
settings-adjacent components. Integrating it while Settings IA has uncommitted
changes would make it impossible to tell an upstream conflict from unfinished
local restructuring.

**Gate reaffirmed 2026-07-29, with a corrected rationale.** Grayson chose to
honour this gate. Measurement shows its value is working-tree hygiene, *not*
conflict reduction: `git merge-tree feat/settings-ia upstream/main` produces the
**identical** 39-path conflict list as `git merge-tree main upstream/main`, and
only four paths are touched by both efforts (`ChatInterface.tsx`,
`QuickSettingsPanelView.tsx`, `useProjectsState.ts`,
`src/i18n/locales/en/settings.json`). Do not restate the gate as though
integrating first would cost extra conflicts. See
[Claim verification](#claim-verification-2026-07-29).

**Confirmed after the merge.** Against `main` at `3b892ec` the conflict count is
still exactly 39, and only two IA-touched paths overlap upstream at all. The
gate's real value turned out to be different again: it did not reduce conflicts,
but the merge now hides two upstream changes *inside clean auto-merges* that
would have been visible conflicts before the restructure. See
[Re-measurement after the Settings IA
merge](#re-measurement-after-the-settings-ia-merge-2026-07-29).

When implementation begins:

1. re-read `AGENTS.md`, the relevant `TODO.md` items, the decisions and
   specifications linked above, and the ignored local `CLAUDE.md`;
2. run `git status --short`, `git worktree list --porcelain`, and
   `git fetch upstream --tags --prune`;
3. verify that `refs/tags/v1.37.0` resolves to the reviewed commit — it is an
   **annotated** tag, so compare `git rev-parse 'refs/tags/v1.37.0^{commit}'`,
   not the bare ref, which yields the tag object; treat any later
   `upstream/main` commits as a separate integration target;
4. claim the integration in `TODO.md`;
5. create a fresh topic worktree from the then-current `main`. The suggestion
   below was superseded in practice on 2026-07-29 by branch
   `chore/upstream-1.37`, worktree `~/Projects/cloudcli-wt-upstream-1.37`,
   ports **3003/5175**. Reuse those rather than creating a second worktree:
   - branch: `integrate/upstream-1.37`
   - worktree: `../cloudcli-wt-upstream-1-37`;

   **`chore/upstream-1.37` is stale as of the Settings IA merge.** It is
   `87d8fef` (old `main`) plus one doc commit, so it does *not* contain the
   Settings IA result and Phase 0 acceptance step 4 fails as it stands. Bring it
   up to `main` before forming the upstream merge — rebase the single doc commit
   onto `main` rather than merging, so the upstream merge stays the branch's only
   merge commit. Every measurement in the re-measurement section below simulated
   `main` directly, so those numbers describe the post-update branch;
6. do not reuse, replace, or reconfigure an occupied branch-test service;
7. keep all commits on the topic branch until Grayson has verified the
   isolated live result; and
8. do not merge, push, or restart the production service before that
   verification.

The implementation worktree must begin from the current CLIde `main`, not from
the reviewed commit recorded above. The hashes in this document preserve the
evidence behind the analysis; they are not instructions to discard work merged
after 2026-07-29.

## Executive decision

Integrate v1.37.0 as an **ancestry-preserving upstream merge with deliberate
semantic conflict resolution**.

Do not:

- cherry-pick the feature squash as though it were one coherent CLIde feature;
- replay hundreds of CLIde commits one by one through the upstream squash;
- resolve modify/delete conflicts with blanket `ours` or `theirs`;
- replace a CLIde implementation merely because upstream touched the same
  path; or
- expose an upstream feature whose behavior violates an existing CLIde
  decision.

On the topic branch, form one no-commit merge of the immutable `v1.37.0` tag
and resolve the resulting tree once. Do not merge a later `upstream/main` by
accident. The eventual integration commit should use an allowed Conventional
Commit subject such as:

```text
chore(upstream): integrate v1.37.0
```

This approach preserves both ancestries, makes the imported upstream release
visible to future comparisons, and avoids repeatedly resolving the same
architectural move while replaying CLIde's post-1.36 history. The topic branch
itself can later be fast-forwarded or merged into `main` according to the
repository state after live verification.

The release should not be treated as a version-number bump. Version metadata
changes only after the integrated source builds, tests, and runs as CLIde.

## Why this requires a dedicated integration

The reviewed upstream range changes 257 files with approximately 19,204
insertions and 9,284 deletions. Seventy-four paths also changed in CLIde, and a
clean merge-tree simulation against the reviewed `main` predicted 39 direct
conflicts.

The high conflict count is not the only risk. Upstream moves critical behavior
while also changing its semantics:

- `server/index.js` and `server/cli.js` are deleted in favor of
  `server/index.ts` and module-owned routes;
- provider execution moves from `server/claude-sdk.js` and
  `server/openai-codex.js` into provider runtime adapters;
- app session IDs replace provider-native IDs as runtime ownership keys;
- a database `sessions.model` column becomes the preferred session-model
  source;
- worktree creation, merge, and deletion become product features;
- image attachments become general file attachments;
- application JWT refresh, WebSocket authentication, and token propagation
  change together;
- QuickSettings is retained upstream while CLIde's Settings IA removes it
  (**corrected 2026-07-29**: upstream's only change to the entire
  `quick-settings-panel/` directory is two z-index lines — `z-40`→`z-[9999]`,
  `z-30`→`z-[9998]`. There is no repositioning, and the conflict is trivial.
  **Partly wrong — amended after the Settings IA merge:** the *directory* is
  indeed only two z-index lines, but upstream moves the panel's **mount point**
  from `ChatInterface.tsx` into `AppContent.tsx`, which auto-merges and
  resurrects the deleted panel. See [Re-measurement after the Settings IA
  merge](#re-measurement-after-the-settings-ia-merge-2026-07-29));
- the AI commit-message generator loses its UI wiring upstream while CLIde
  retains and extends it (**corrected 2026-07-29**: the server route and client
  hook both survive upstream — see [Claim
  verification](#claim-verification-2026-07-29)); and
- token-usage extraction is centralized using rules that do not preserve
  CLIde's Claude synthetic-row and context-ceiling invariants.

The correct unit of review is therefore behavior, not filename.

## Claim verification (2026-07-29)

Every quantitative claim above was re-checked against the repository on
2026-07-29 with `main` at `87d8fef`. The numbers are exact. Four behavioral
claims were overstated and are corrected here; the corrections change how much
work Phase 1, Phase 4, and Phase 6 actually require.

### Confirmed exactly

- `refs/tags/v1.37.0^{commit}` = `264e0946`, with nothing on `upstream/main`
  beyond it. `06e7ee9` and `75ff8a5` are the squash and OAuth commits named
  above. `27eaf014` is `chore(release): v1.36.3` and the true merge base.
- 257 files, +19,204/−9,284; 74 overlapping paths; 39 conflicts — 1 add/add,
  34 content, 4 modify/delete.
- `server/index.js` and `server/cli.js` are deleted; `server/index.ts` is added.
- `sessions.model` exists, and `schema.ts:112` documents it as "Model this
  session runs with" — literally the ambiguity Phase 3 objects to.
- The 160,000 fallback is real:
  `provider-token-usage.service.ts:167`, `claude-runtime.provider.js:320,352`.
- The worktree defaults are as described, and worse than "not safe by default":
  `MergeWorktreeModal` initialises `squash` **and** `removeAfterMerge` to
  `true`, `RemoveWorktreeModal` initialises `deleteBranch` to `true`, and
  `worktree-remove.service.ts:61` runs `git branch -D` inside a `try {} catch {}`
  that discards the failure. All four worktree/branch modals use
  `backdrop-blur-sm`. **Amended 2026-07-30:** `worktree-merge.service.ts` also
  hardcodes `deleteBranch: true` in its post-merge cleanup call, which no
  checkbox controls — see [Review
  2026-07-30](#review-2026-07-30-what-upstream-ships-and-what-to-keep).
- Export hardcodes "Claude" (`chatExport.ts:56,103`) and its "PDF" path is
  `win.print()`. The Claude Usage plugin recommendation is at
  `PluginSettingsTab.tsx:37`.
- New dependencies are exactly `ignore@^7.0.6`, `remark-breaks@^4.0.0`,
  `@types/cors@^2.8.19`. Upstream moves to `@openai/codex-sdk@^0.144.0` against
  CLIde's exact `0.146.0`, and adds an `npm test` script CLIde does not have.
- `X-Auth-Error` + `POST /refresh`, `~/.codex/skills`, the Shell stale-socket
  test, and app-session-keyed `provider-runtime.service.ts` are all present.

### Corrections

1. **The AI commit-message generator is not removed upstream.** Upstream
   v1.37.0 keeps `POST /generate-commit-message` (`git.routes.ts:946`,
   `generateCommitMessageWithAI` at `:1019`) and keeps `generateCommitMessage`
   in `useGitPanelController.ts:631` and `types/types.ts:119`. Only the UI
   wiring is gone — no view consumes it, and upstream's `CommitComposer.tsx`
   has no generate affordance. Better still, `server/routes/git.js` →
   `server/modules/git/git.routes.ts` is a 91%-similarity rename that
   **auto-merges with no conflict**, so CLIde's Git server work carries over for
   free. The remaining task is re-wiring `ChangesView`/`CommitComposer`;
   `GitPanel.tsx`'s conflict is two lines on CLIde's side.
2. **QuickSettings is not repositioned upstream** — see the corrected bullet
   above. Nothing needs rejecting beyond discarding two z-index lines.
   **Superseded 2026-07-29 (post-Settings-IA):** this correction over-corrected.
   Upstream does not reposition the panel *within* its directory, but it does
   relocate the mount from `ChatInterface.tsx` to `AppContent.tsx`, and that
   relocation arrives with no conflict at all. "Nothing needs rejecting" is
   false. See [Re-measurement after the Settings IA
   merge](#re-measurement-after-the-settings-ia-merge-2026-07-29).
3. **Rename detection removes most of Phase 1's apparent porting work.** Git
   pairs the moved files, so CLIde's changes land in the destination module
   paths automatically: `claude-sdk.js`→`claude-runtime.provider.js` (88%),
   `openai-codex.js`→`codex-runtime.provider.js` (83%),
   `cursor-cli.js` (79%), `opencode-cli.js` (82%),
   `routes/commands.js`→`commands.routes.ts` (88%),
   `middleware/auth.js`→`auth.middleware.ts` (71%),
   `routes/git.js`→`git.routes.ts` (91%, clean), plus
   `provider-image-history.test.ts`→`provider-attachment-history.test.ts` and
   `chat-image-filter.test.ts`→`chat-attachment-filter.test.ts`. Only three
   paths have no rename pair and need genuine hand-porting:
   `server/index.js` (−1651 upstream, CLIde +180/−31),
   `server/routes/agent.js` (−1257, CLIde **3 lines**), and
   `server/routes/tests/commands.test.js` (−82, CLIde +48). Phase 1's rule
   ("port CLIde behavior into the destination module") still stands — but as
   review of an auto-merged result, not a from-scratch rewrite.
4. **`engines` does not drift.** Both sides declare
   `"node": "^22.0.0 || ^24.0.0"`. The only Node pin difference is `.nvmrc`
   (CLIde v24, upstream v22), and upstream has not touched `.nvmrc` since
   v1.36.3, so CLIde's v24 survives with no conflict. Phase 7's concern is
   real only for the Codex SDK pin.

### Where the conflict work actually sits

Churn on both sides of the 39 conflicted paths, to budget against:

- **Heavy on both sides:** `useChatComposerState.ts` (ours +423, theirs
  +207/−117), `server/shared/types.ts` (+208 / +658/−21),
  `provider-models.service.test.ts` (+140/−35 / +450/−349),
  `codex-sessions.provider.ts` (+195 / +331), `WebSocketContext.tsx` (+243 /
  +28), `CommandResultModal.tsx` (+593 / +4/−5), `chat-websocket.service.ts`
  (+176/−30 / +73/−61), `claude-models.provider.ts` (+217/−38 / +1/−12), and
  `claude-runtime.provider.js` (rename plus 855 new upstream lines).
- **Trivial despite conflicting:** `GitPanel.tsx`, `ConfirmActionModal.tsx`,
  `ImageAttachment.tsx`, `useFileTreeUpload.ts`, `QuickSettingsPanelView.tsx`,
  `server/routes/agent.js`, `websocket/README.md`, `projects/index.ts`.
- Upstream's heartbeat helper is `attachWebSocketHeartbeat`, exported from
  `websocket-server.service.ts`. CLIde's application-level ping
  (`chat-ping.test.ts`) is a different layer, so the two coexist rather than
  compete — consistent with Phase 2's instruction to keep both.

## Re-measurement after the Settings IA merge (2026-07-29)

Everything above was measured against `main` at `87d8fef`. `feat/settings-ia`
has since merged, rewriting the entire Settings surface: 109 files,
+6,995/−4,083, including deletion of `src/components/quick-settings-panel/` and
of every `settings/view/tabs/*` file, and five new ADRs (0018–0022). This
section re-measures the integration against `main` at `3b892ec` and is
authoritative wherever it contradicts an earlier section.

### The conflict budget did not change

| | `main` @ `87d8fef` | `main` @ `3b892ec` |
|---|---|---|
| Merge base | `27eaf014` | `27eaf014` (unchanged) |
| `refs/tags/v1.37.0^{commit}` | `264e0946` | `264e0946`, still tip of `upstream/main` |
| Total conflicts | 39 | **39** |
| add/add | 1 | 1 |
| content | 34 | 33 |
| modify/delete | 4 | 5 |

Exactly one path changed category: `QuickSettingsPanelView.tsx` moved from
content to modify/delete. Every churn estimate under [Where the conflict work
actually sits](#where-the-conflict-work-actually-sits) still holds.

Of the 109 IA-touched paths, only **two** are also touched by upstream 1.37:

- `src/components/quick-settings-panel/view/QuickSettingsPanelView.tsx` — IA
  deleted it, upstream changed two z-index lines. Resolve modify/delete by
  keeping the deletion; the z-index lines are moot.
- `src/components/plugins/view/PluginSettingsTab.tsx` — IA renamed it to
  `src/components/settings/view/screens/ExtensionsPluginsScreen.tsx` (80%
  similarity), so git pairs them and upstream's change **auto-merges into the
  renamed file**.

Of the four "touched by both efforts" paths named in the sequencing section,
`useProjectsState.ts` and `src/i18n/locales/en/settings.json` auto-merge cleanly;
only `ChatInterface.tsx` still conflicts on both sides.

### Post-merge deletion checklist — changes that arrive with no conflict

This is the section's main product. The Settings restructure converted two
"reject the upstream change" ledger items from *conflict resolutions you cannot
miss* into *silent auto-merges*. Conflict-driven review will not surface them.
Verified by inspecting the actual merged tree (`6393581`, from
`git merge-tree --write-tree main 264e0946`).

1. **`AppContent.tsx` resurrects the deleted QuickSettings panel.** Upstream
   removes `import { QuickSettingsPanel }` and `<QuickSettingsPanel />` from
   `ChatInterface.tsx` and adds both to `AppContent.tsx`. IA never touched
   `AppContent.tsx`, so upstream's edit there is a clean auto-merge and the
   merged tree contains:

   ```text
   src/components/app/AppContent.tsx:7    import { QuickSettingsPanel } from '../quick-settings-panel';
   src/components/app/AppContent.tsx:258        <QuickSettingsPanel />
   ```

   pointing at a directory that no longer exists. Both lines must be deleted by
   hand. Note that ADR 0019 names `ChatInterface.tsx` as *the* mount point, which
   is why this is easy to miss — upstream changed where the mount lives.
   `npm run build` / `npm run typecheck` will fail on the unresolved module, so
   this cannot ship silently, but Phase 6's "resolve all QuickSettings conflicts
   in favor of the merged Settings IA" will not catch it: `AppContent.tsx` is not
   a conflict.

2. **The Claude Usage plugin recommendation lands in the IA screen.** Because of
   the rename pairing, upstream's addition arrives inside
   `ExtensionsPluginsScreen.tsx` with no conflict. The merged tree contains
   `CLAUDE_USAGE_PLUGIN_URL` at `:37`, the `claude-usage` recommendation entry at
   `:125`, and `BarChart3` already imported at `:5` (so there is no unused-import
   or undefined-symbol signal either). The `claudeUsagePlugin` string block also
   lands at `src/i18n/locales/en/settings.json:576`. Rejecting this is now an
   active three-site deletion, not a declined conflict — and nothing but this
   checklist will remind you.

Also merged silently but harmless: a `BrowserUseSettingsTab` mention in an
`ExtensionsBrowserScreen.tsx` comment, and CLIde's browser-use MCP hardening
(`server/modules/browser-use/browser-use-mcp.ts`, `browser-use.service.ts`),
which auto-merge correctly.

### Settings screens need no API rewiring

Every endpoint the new Settings screens call survives upstream's server
restructure at an identical path, so IA's `useCredentialsSettings`,
`useSettingsController`, `useGitSettings`, `AgentAccountCard`, and
`ExtensionsBrowserScreen` need no changes:

| Called by IA screens | Upstream 1.37 location | Path |
|---|---|---|
| `/api/settings/api-keys`, `/credentials`, `/notification-preferences`, `/push/*` | `server/modules/settings/settings.routes.ts` | unchanged |
| `/api/user/git-config` | `server/modules/user/user.routes.ts` | unchanged |
| `/api/providers/codex/capabilities` | `provider.routes.ts:533` | unchanged |
| `/api/browser-use/*` | `server/modules/browser-use/` (exists upstream) | unchanged |

`server/routes/settings.js` is deleted upstream with no rename pair, and CLIde
never modified it since the merge base, so it is a clean deletion with no
conflict. The only obligation is that the `server/index.js` hand-port mounts
`settingsRoutes` from `server/modules/settings/` and the `user` module. Related
Phase 1 relief: upstream's `server/index.ts` already imports and mounts
`browserUseRoutes`, `browserUseMcpRoutes`, and `browserUseService`, including
`stopAllSessions()` in its shutdown path, so that fork surface does not need
hand-reconstruction.

The settings registry and `searchIndex.ts` need **no new rows** for upstream
1.37. Chat export, general attachments, and worktrees are all non-Settings
surfaces, and the worktrees UI sits in `git-panel` behind this spec's own
exposure gate.

### Newly identified gap: upstream's composer menus

Not covered anywhere else in this specification, and unrelated to Settings
except that it lands in the same Phase 6 pass. Upstream adds four files:
`ComposerModelMenu.tsx` (168 lines), `ComposerPermissionMenu.tsx` (147),
`ComposerMenuPrimitives.tsx` (94), and `useComposerMenuAnchor.ts` (82). Upstream's
`ChatComposer.tsx` is 492 lines against CLIde's 650.

**This is not a refactor of CLIde's pickers — the two forks put these controls in
different places.** Mapping the three affordances, because the phrase "composer
menu extraction" hides the real asymmetry:

| Affordance | Upstream 1.37 | CLIde `main` |
|---|---|---|
| Model choice | `ComposerModelMenu`, in the composer | the `/models` command popup, `CommandResultModal.tsx` (CLIde +593 lines, a heavy conflict) |
| Reasoning effort | a section of `ComposerModelMenu` | inline dropdown in `ChatComposer.tsx` (state ~228–290, render ~525–570) |
| Permission mode | `ComposerPermissionMenu`, an explicit list with per-mode descriptions | a **cycling button** (`onModeSwitch`), which can only ever show the current mode's description |

So adopting `ComposerModelMenu` would not replace a CLIde component — it would
add a *second* model surface alongside the `/models` popup, which is the ADR 0003
surface carrying per-session desired/effective tracking, fast-mode handling, and
transcript-derived truth. Upstream's menu is presentation-only and models none of
that.

**Decision (Grayson, 2026-07-29): keep CLIde's.** Resolve `ChatComposer.tsx` in
CLIde's favor for all three affordances and take upstream's non-menu composer
changes. Do not adopt the extraction inside this merge.

#### Where adopting parts of it later would genuinely help

Recorded so the deferral is an informed one, not an omission. In rough
benefit-per-risk order:

1. **`useComposerMenuAnchor` — worth taking, cheapest win.** CLIde's inline
   effort dropdown already duplicates ~60 lines of the same machinery
   (`getBoundingClientRect`, Escape via capture, outside-`pointerdown`,
   `resize`/`scroll` re-anchoring, portal), so this is duplicated logic rather
   than new capability. The difference is the anchoring model: upstream anchors
   with `right`/`bottom`, CLIde with `left`/`top`. Upstream's own comment states
   the payoff — a menu anchored from its bottom-right "never paints in the wrong
   spot for a frame" because it can grow up and leftward without measuring itself
   first, and its `maxWidth` shrinks the menu on phones instead of letting it run
   off the left edge. Both are real bug classes on the S20 form factor. Adopting
   just this hook and pointing CLIde's existing effort dropdown at it is a small,
   self-contained, ADR-neutral change.
2. **`ComposerPermissionMenu` — a real UX win, moderate cost.** A cycling button
   is poor discoverability for four or five modes, and it forces blind cycling on
   touch. CLIde already computes `permissionModeLabel` and
   `permissionModeDescription` (`ChatComposer.tsx:296–305`) but can only show one
   at a time; a list shows all modes with their descriptions at the point of
   choice. Provider-neutral, since which modes exist already comes from the
   backend. Worth its own small branch.
3. **`ComposerModelMenu` — do not adopt without a decision about `/models`
   first.** The composer is arguably the better home for model choice, but that
   is a *replacement* question for the `/models` popup, not an addition. It needs
   an ADR-0003 review and would have to carry desired/effective distinction, fast
   mode, effort capability gating, and per-session state that upstream's version
   does not have. Two model surfaces would be worse than either one alone.

Track these as post-integration TODO items, not merge work.

### Decisions taken 2026-07-29 (Grayson)

Eight questions raised by this re-measurement, answered. These are binding for
the implementation session; the phase sections below carry the detail.

| # | Question | Decision |
|---|---|---|
| 1 | Claude Usage recommendation | **Delete all three sites**, i18n strings included |
| 2 | Composer menus | **Keep CLIde's**; deferral rationale and future benefit recorded [above](#newly-identified-gap-upstreams-composer-menus) |
| 3 | Session model persistence | **Keep CLIde's** mechanism; see [Phase 3](#phase-3-desired-model-effective-model-and-context-usage) for what upstream changed and what the deferral costs |
| 4 | Scope | Do the phases; **worktree foundations deferred**, to be assessed later — see [Phase 4](#phase-4-git-and-worktree-integration) |
| 5 | `feat/settings-ia` worktree | **Removed** 2026-07-29, branch deleted (fully contained in `main` at `3b892ec`) |
| 6 | Bring branch up to `main` | **Rebase** the two doc commits — neither branch was ever pushed to `origin`, so no history is shared and nothing downstream breaks |
| 7 | `de`/`fr` `settings.json` | **English only**; drift noted below |
| 8 | Upstream's `npm test` | Proven broken on CLIde; adopt only in corrected form — see [Phase 7](#phase-7-dependencies-build-and-package-metadata) |

**i18n drift (decision 7).** Settings IA changed `src/i18n/locales/en/settings.json`
only. `de` and `fr` still carry a `quickSettings` block (`de:52`, `fr:52`) whose
panel no longer exists, and neither has the new IA keys, so those locales fall
back to English for every new Settings string. This predates the integration and
is not made worse by it — do not attempt to fix it inside the merge. The only
integration-time obligation is not to *add* new non-English keys: upstream's
`claudeUsagePlugin` block is English-only and is being deleted anyway.

## Goals

1. Adopt upstream's stronger backend module boundaries, dependency injection,
   route tests, and provider-owned runtime structure.
2. Preserve all CLIde behavior that is more complete, provider-neutral, or
   protected by an ADR.
3. Combine overlapping fixes when upstream and CLIde each solve a different
   layer of the same failure.
4. Make session identity unambiguous across the app database, provider
   runtime, transcripts, WebSockets, rewind/fork, and abort.
5. Make desired model selection durable without misreporting it as the model
   that actually ran.
6. Reuse safe upstream worktree primitives without shipping its separate-
   project identity model or destructive defaults.
7. Add useful chat, attachment, deep-link, Git, Codex-history, and skill
   improvements without replacing CLIde-specific interaction behavior.
8. Finish with an isolated, provider-aware live build that Grayson can verify
   before production changes.

## Non-goals

- Rewriting unrelated CLIde components to match upstream style.
- Removing fork-only features merely to reduce the diff.
- Completing every deferred Source Control or Settings feature in the same
  branch.
- Enabling upstream's worktree UI before the CLIde repository/worktree safety
  contract is satisfied.
- Adding the unofficial Claude Usage plugin recommendation.
- Reintroducing QuickSettings after Settings IA removes it.
- Downgrading the Codex SDK or loosening CLIde's pinned runtime/tooling
  requirements.
- Restarting production, changing live credentials, or mutating real sessions
  during implementation.
- Opening or updating an upstream PR.

## Conflict-resolution rules

Apply these rules in order:

1. **Preserve user data and stable IDs.** Never choose a resolution that can
   orphan sessions, confuse app and provider session IDs, or migrate live data
   without a backup and rollback path.
2. **Use the new architectural destination.** When upstream moves a legacy
   file into a module, port CLIde behavior into the destination module rather
   than restoring the legacy monolith.
3. **Existing ADRs win.** Upstream behavior that contradicts an ADR is adapted
   or left disabled until the ADR is explicitly superseded.
4. **Provider-neutral shared surfaces win.** Claude-specific assumptions must
   stay inside the Claude adapter or be expressed through capabilities.
5. **The more complete failure path wins.** Preserve input, return structured
   errors, and render actionable diagnostics instead of accepting silent
   failure.
6. **Requested and effective state stay distinct.** A picker value, provider
   alias, transcript value, and database preference are not interchangeable.
7. **Local tests are additive.** Do not delete a CLIde regression test because
   upstream has a differently scoped test. Adapt both to the final structure.
8. **Dependencies do not drift backward.** Preserve CLIde's exact Codex SDK,
   Node engine, build, lint, Playwright, and hook portability decisions unless
   a separately verified change supersedes them.
9. **No unsafe feature exposure.** Code may be integrated behind an internal
   boundary or remain unregistered when its product contract is not yet safe.
10. **Generated artifacts follow their source.** Do not hand-edit generated
    public assets or generated App Server schemas.

## Decision ledger

### Adopt with minimal adaptation

- `CLAUDE_CODE_OAUTH_TOKEN` discovery and precedence tests, adapted to
  CLIde's current Claude credential helper.
- Shell stale-socket ownership guards and reconnect-timer rechecks.
- Codex user-skill discovery under `~/.codex/skills`.
- Symlink-aware skill discovery, repeated-load suppression, and hiding injected
  skill bodies from conversation rendering.
- `.gitignore` filtering for `@` file mentions.
- Authoritative session lookup for deep links, extended through CLIde's
  provider-session aliases.
- Scrollable Git tabs, mobile session rename visibility, and scrollable commit
  confirmation content.
- Explicit rejection of single-dollar inline math if it prevents ordinary
  currency text from being parsed as mathematics.

### Adopt the boundary, adapt the behavior

- TypeScript server entrypoint and module-owned routes.
- Provider runtime registration and app-session-ID ownership.
- Auth refresh service and WebSocket token replacement.
- ~~Session-model database persistence.~~ **Deferred 2026-07-29** (decision 3) —
  keep CLIde's mechanism, leave `sessions.model` unread. See
  [Phase 3](#decision-2026-07-29-keep-clides-mechanism-do-not-wire-upstreams-column).
- Provider token-usage service.
- ~~Worktree parsing, injected Git services, and tests.~~ **Deferred 2026-07-29**
  (decision 4) — left out of the tree entirely. See
  [Phase 4](#decision-2026-07-29-worktree-foundations-deferred-out-of-this-release).
- General file attachments and history restoration.
- Codex wrapped command, tool, and subagent history reconstruction.
- User-message Markdown and collapsed tool-error presentation.
- Chat export.

### Retain CLIde or reject the upstream change

- Retain the Source Control commit-message generator and its visible commit
  error path. Corrected 2026-07-29: there is no upstream removal to reject —
  upstream keeps the route and the hook and drops only the UI wiring, so this
  reduces to re-wiring `ChangesView`/`CommitComposer` after `git.routes.ts`
  auto-merges.
- Retain Settings IA's removal of QuickSettings. Corrected 2026-07-29: upstream
  did not reposition the panel; discard its two z-index lines and let the
  Settings IA deletion win. **Amended after the merge:** the z-index lines are
  moot (the path is now modify/delete), but upstream's relocated mount in
  `AppContent.tsx` auto-merges and must be deleted by hand — item 1 of the
  [post-merge deletion
  checklist](#post-merge-deletion-checklist--changes-that-arrive-with-no-conflict).
- Retain transcript/provider evidence as the effective-model truth; reject a
  database picker value being presented as proof of what ran.
- Retain SDK-derived context ceilings and synthetic/sidechain usage guards;
  reject upstream's 160,000-token fallback as CLIde's general algorithm.
- Retain CLIde's app-level WebSocket watchdog, wake probe, run/sequence
  reconciliation, and reconnect UI.
- Retain Codex App Server transport, SDK 0.146.0, rewind/fork aliases,
  tombstones, usage accounting, and message identity reconciliation.
- Reject separate top-level projects for every Git worktree.
- Reject implicit merge targets and default squash, cleanup, or branch
  deletion.
- Reject `backdrop-blur` in worktree dialogs.
- Reject provider-branded export labels such as calling every assistant
  "Claude".
- Reject the unofficial Claude Usage plugin recommendation. **Amended after the
  merge:** this is an active three-site deletion inside an auto-merged file, not
  a declined conflict — item 2 of the [post-merge deletion
  checklist](#post-merge-deletion-checklist--changes-that-arrive-with-no-conflict).

## Phase 0: Freeze the integration baseline

Before forming the merge:

1. record the current topic-base `main` commit;
2. record `upstream/main`, `refs/tags/v1.37.0`, and their merge base;
3. save:
   - `git diff --stat <merge-base>..upstream/main`;
   - `git diff --name-status <merge-base>..upstream/main`;
   - the CLIde-only path list;
   - the overlapping path list; and
   - a fresh merge-tree conflict list;
4. verify that the Settings IA result is present in the topic base — concretely,
   that `src/components/settings/registry/registry.ts` exists and
   `src/components/quick-settings-panel/` does not. `chore/upstream-1.37` fails
   this until it is brought up to `main`; see sequencing step 5;
5. verify that no other worktree has the proposed branch checked out;
6. check available memory before dependency installation or broad builds; and
7. identify the exact isolated service/port available for later live testing.

Do not modify `~/.cloudcli/auth.db` during this phase.

### Phase 0 acceptance

- The integration target and topic base are written into the worktree notes or
  commit description.
- Every pre-existing dirty or untracked path is accounted for and preserved.
- No production process or occupied branch-test process has been replaced.

## Phase 1: Establish the upstream module architecture

Resolve structural moves before feature behavior. The end state should use
upstream's module boundaries without losing CLIde capabilities.

| Current CLIde area | Upstream destination | Required CLIde behavior |
|---|---|---|
| `server/index.js` | `server/index.ts` plus feature modules | Startup ordering, batch-move routing, context endpoints, Codex transport selection, token/context surfaces, service shutdown |
| `server/routes/auth.js` | `server/modules/auth/` | Transient-failure-safe auth, refresh-token handling, structured auth errors |
| `server/routes/git.js` | `server/modules/git/` and `server/modules/worktrees/` | Hook stderr, structured commit failures, commit-message generation, self-hosting safety |
| `server/routes/agent.js` | provider routes/services | Live provider models, capabilities, Codex transport state |
| `server/claude-sdk.js` | `claude-runtime.provider.js` | Signal-first abort, context usage, rewind/checkpoints, ephemeral jobs, stable session ownership |
| `server/openai-codex.js` | `codex-runtime.provider.js` | App Server transport, SDK 0.146, rewind/fork, usage, aliases and tombstones |
| Cursor/OpenCode runner files | provider runtime adapters | Clean no-op capabilities, stable app session IDs, current model/send behavior |
| WebSocket service files | `server/modules/websocket/` | App-level heartbeat contract, run IDs, sequence handling, auth refresh |

The new `server/index.ts` must be composition-only. Logic recovered from
`server/index.js` belongs in the relevant module, not in a translated
TypeScript monolith.

**Mechanics, verified 2026-07-29.** Git detects every row of this table except
the first two as a rename, so the merge carries CLIde's changes into the
destination path and marks only the genuinely overlapping hunks. Review those
auto-merged results rather than re-porting them by hand. `routes/git.js` →
`modules/git/git.routes.ts` auto-merges cleanly and is not among the 39
conflicts at all. The real hand-ports are `server/index.js` and
`server/routes/agent.js` (plus `routes/tests/commands.test.js`), which have no
rename pair — see [Claim verification](#claim-verification-2026-07-29) for the
similarity scores and line counts.

Upstream's backend-module skill may be used as a directory-shape reference,
but it must not replace CLIde's `AGENTS.md`. Resolve its inconsistencies during
the port:

- runtime adapters that remain JavaScript are an explicit migration exception,
  not proof that every module may mix languages;
- shared `types.ts` and `utils.ts` files must not become cross-module dumping
  grounds; and
- provider-specific behavior stays behind adapter interfaces.

### Phase 1 tests

- Server starts and shuts down cleanly from the TypeScript entrypoint.
- Every registered module mounts once.
- No legacy and module route both claim the same endpoint.
- Provider registry tests cover all four providers.
- Build output and package/bin entrypoints reference the new server artifact.

## Phase 2: Runtime identity, abort, WebSocket, and authentication

These changes are coupled because all four depend on which session and socket
owns a running turn.

### Stable runtime ownership

Use the app-owned `session_id` as the key for:

- active processes;
- abort controllers;
- pending permissions/approvals;
- WebSocket turn ownership;
- reconnect/replay state; and
- runtime lookup.

Resolve `provider_session_id` only at provider resume or transcript boundaries.
Do not overwrite, alias, or collapse the app ID when the provider emits a new
native ID.

For Codex, preserve:

- `session_provider_aliases`;
- superseded provider-ID tombstones;
- rewind/fork parent and child identity;
- App Server thread IDs; and
- stable message identity across live and final history.

### Abort

Combine the two implementations:

1. CLIde's `AbortController` signal remains the immediate cancellation tier,
   including before a provider ID exists.
2. Upstream's app-session-keyed runtime lookup becomes the ownership tier.
3. Provider-native cancellation is a later best-effort tier.
4. Optimistic-message retraction still depends on whether work was delivered
   to the provider.

Add equivalent signal support or an explicit capability/no-op path for Cursor,
Codex, and OpenCode. Shared UI must not imply that all adapters can cancel at
the same provider-native tier.

### Chat WebSocket

Upstream's heartbeat helper may replace duplicated server timer code, but
CLIde must retain:

- inbound traffic marking a socket alive;
- client `chat.ping`/application-level liveness;
- wake-from-background probing;
- reconnect banners and state;
- run ID and sequence-number deduplication;
- replay reconciliation; and
- protection against delayed events from an old socket.

Port upstream's equivalent stale-socket guard to Shell so a delayed close from
an old WebSocket cannot detach the replacement PTY.

### Application authentication

Use a hybrid contract:

- keep CLIde's retry and token-retention behavior for transient network and 5xx
  failures;
- adopt an explicit refresh endpoint and refresh scheduling based on JWT
  lifetime;
- use `X-Auth-Error` or an equivalent structured reason to distinguish
  invalid/expired credentials from infrastructure failure;
- propagate refreshed tokens consistently to fetch, upload, Shell, Chat, and
  other realtime clients; and
- close or replace sockets authenticated with the superseded token without
  creating reconnect loops.

Add `CLAUDE_CODE_OAUTH_TOKEN` after the existing Anthropic key/token sources,
matching upstream's tested precedence, but implement it through CLIde's
`readClaudeOAuthCredentials` path so stale access tokens with usable refresh
credentials remain correctly understood.

### Phase 2 tests

- First-turn abort before provider-session creation.
- Abort after provider-session creation.
- Old Chat and Shell sockets cannot detach or mutate replacement sockets.
- Background/wake reconnect with an expired application token.
- Transient `/api/auth/user` and refresh failures do not log the user out.
- Definitively invalid/expired credentials do log the user out with a visible
  reason.
- Refreshed tokens reach all HTTP and realtime clients.
- Codex rewind/fork aliases still resolve after reconnect.

## Phase 3: Desired model, effective model, and context usage

Upstream's database persistence solves a real cross-client durability problem,
but its single `sessions.model` value conflates user intent with evidence of
what actually ran.

### Decision 2026-07-29: keep CLIde's mechanism, do not wire upstream's column

**Decided by Grayson.** The desired/effective data contract below is retained as
the design CLIde is aiming at, but it is **not built in this merge**. CLIde's
existing model machinery stays as-is and upstream's `sessions.model` is not read.
The rest of this phase's *token and context usage* rules are unaffected and still
apply in full.

#### What upstream actually changed

- `sessions.model TEXT` added to the schema (`schema.ts:112–115`), via an
  additive migration (`migrations.ts:406–416`,
  `addColumnToTableIfNotExists`) that leaves pre-existing rows `NULL` on purpose
  and falls back to the old resolver for them.
- `sessions.setSessionModel(sessionId, model)`
  (`repositories/sessions.db.ts:223`), reached through
  `providerModelsService.setSessionModel` (`provider.routes.ts:419`,
  `provider-models.service.ts:330–345`).
- Written **both** when the user picks a model and **on every send**
  (`sessions.db.ts:219–221`).
- Read with top priority: upstream's own tests are named `resolveSessionModel
  prefers the recorded session model over everything else`
  (`provider-models.service.test.ts:319`) and `resolveResumeModel prefers the
  recorded session model over the requested one` (`:416`).

#### What CLIde has instead

- The picker's choice lives in **`localStorage`**, one key per provider —
  `claude-model`, `codex-model`, `cursor-model`, `opencode-model`
  (`useChatProviderState.ts:96–112`), also read directly by the `/models` popup
  (`CommandResultModal.tsx:350`).
- Per-session model *changes* live in a server-side sidecar JSON outside the
  database, `~/.cloudcli/provider-session-active-model-changes.json`
  (`server/shared/utils.ts:546`).
- The effective model comes from provider/transcript evidence via
  `GET /api/providers/:provider/sessions/:sessionId/active-model`
  (`useChatProviderState.ts:552`) plus `resolveResumeModel` /
  `pickSupersedesTranscript`, with the synthetic-row guard. This is the ADR 0003
  contract: transcript is ground truth.

#### Why keeping CLIde's is defensible

Upstream's write-on-every-send plus "recorded model outranks everything else"
inverts ADR 0003 directly: a picker value in a database row would outrank
transcript evidence of what actually ran. That is the exact conflation this phase
was written to prevent, and adopting it would mean superseding an ADR inside an
already-large merge.

#### What the deferral costs — state this plainly rather than let it look free

CLIde keeps two real gaps that upstream's column would have closed:

1. **The picker choice is per-browser, not per-session.** Because it is
   `localStorage` keyed by provider, opening the same session on the laptop and
   on the phone's PWA can seed different models, and clearing site data loses the
   choice. This is the "cross-client durability problem" named above, and it stays
   open.
2. **The sidecar is outside the database.** It gets no transactionality with the
   session rows it describes, is not covered by the `~/.cloudcli/auth.db` backup
   and migration tooling, and can drift from a session that was renamed, forked,
   or tombstoned.

Neither is a regression introduced by the integration — both are today's
behavior. The decision is to not fix them *here*.

#### Follow-up

Add a `TODO.md` item for a proper `desired_model` / effective-model design using
the contract below, sized separately. Recommended shape when it happens: take
upstream's additive column but name it `desiredModel` in TS/API and never let it
outrank transcript evidence. Whether to accept upstream's migration now as a
dormant column was considered and rejected for this merge — a column documented
as "the model this session runs with" that nothing reads is a trap for the next
reader, and the migration is trivially re-addable later.

### Data contract

Do not document an ambiguous column as "the model this session runs with."
Prefer:

```text
sessions.desired_model
sessions.desired_model_updated_at
```

The desired model is:

- written when the user explicitly picks a model for that session;
- optionally confirmed from an explicit send request;
- stored against the app session ID;
- provider-scoped through the session row; and
- never presented as transcript proof.

The effective model is resolved from provider/transcript evidence using the
existing validation and timestamp rules. It may be cached, but the cache must
record its source and observation time.

If keeping upstream's physical `model` column is substantially simpler, its
TypeScript/API name must still be `desiredModel`, and comments, tests, and
responses must use the desired/effective distinction. A later schema rename is
preferable to permanently ambiguous semantics.

### Resolution rules

Separate two questions:

1. **What should the next turn request?**
   - a valid, newer, explicit desired-model choice;
   - otherwise a valid effective model when resuming requires one;
   - otherwise the provider default.
2. **What model actually ran?**
   - current provider state when available;
   - otherwise the newest validated real transcript turn;
   - never an unverified picker alias, `default`, `<synthetic>`, or arbitrary
     Shell output.

Preserve:

- transcript-derived model validation;
- the synthetic placeholder guard;
- Shell `/model` handling;
- fast-mode handling;
- desired/effective timestamps;
- provider model aliases and concrete model IDs; and
- capability-gated effort values.

Plan a one-time migration from
`~/.cloudcli/provider-session-active-model-changes.json` only after backing up
both that file and `~/.cloudcli/auth.db`. Migration must be idempotent and must
not overwrite a newer database choice.

### Token and context usage

Adopt `provider-token-usage.service.ts` as the route/service boundary, not its
Claude accounting algorithm.

Provider adapters should supply usage through a capability or method rather
than a central provider-name switch. Preserve all current Claude safeguards in
all three paths:

1. live extraction;
2. the `/token-usage` endpoint; and
3. history extraction.

In particular:

- skip synthetic zero-input rows;
- skip sidechain rows where required;
- prefer current SDK context data;
- derive context ceilings and autocompact thresholds from the SDK/model
  registry;
- retain 200k/1M model distinctions;
- keep Codex accounting separate; and
- return explicit unknown/unavailable state instead of substituting 160,000 as
  a universal truth.

### Phase 3 tests

- Picker choice survives browser/device reconnect.
- Shell `/model` produces the correct effective model without corrupting the
  desired model.
- `default`, `<synthetic>`, and malformed model text never become send
  arguments.
- A newer explicit choice wins for the next send; a newer real transcript wins
  for effective display.
- Claude synthetic and sidechain rows do not inflate usage.
- 200k and 1M context ceilings remain model-correct.
- Codex usage and context continue to work through both SDK and App Server
  transports.
- Model sidecar migration is backed up, idempotent, and timestamp-aware.

## Phase 4: Git and worktree integration

Upstream's worktree backend is useful implementation material, but its product
contract is not safe to expose unchanged.

### Decision 2026-07-29: worktree foundations deferred out of this release

**Decided by Grayson: do the other phases; assess the worktree foundation
later.** For this integration, do **not** merge upstream's worktree services,
routes, controller, or modals — not even unregistered. Resolve worktree-only
upstream additions by taking neither side: leave the files out of the tree.

Rationale: the [exposure gate](#exposure-gate) below already forbids shipping the
feature, so merging the code unregistered would add review surface, tests, and
`server/shared/types.ts` churn for something no user can reach. Upstream's tag is
immutable, so the material stays available at `v1.37.0` for whenever the
assessment happens — nothing is lost by leaving it out.

Consequences for the rest of this phase: everything under **Reuse** and
**Replace** below, and the worktree rows of the Phase 4 test list, are deferred
with it. What still applies now is **Other Git behavior** — CLIde's commit-error
visibility, retained commit message, AI commit-message generation, and
self-hosting branch-switch protection, plus porting upstream's Git
initialization, history loading, refresh feedback, tab scrolling, and
confirmation-modal scrolling. Recall from [Correction
1](#corrections) that `routes/git.js` → `modules/git/git.routes.ts` auto-merges
cleanly, so the Git server side arrives for free either way.

Add a `TODO.md` item for the deferred assessment, pointing at both this section
and `2026-07-26-git-source-control-workspace-ux.md`.

### Review 2026-07-30: what upstream ships, and what to keep

Read directly out of the `v1.37.0` tree, since the files are deliberately absent
from the merge. The deferral stands; this section exists so the later assessment
starts from an inventory rather than a re-read.

**Inventory.** 19 server files under `server/modules/worktrees/` (5 services,
routes, module, index, and **8 test files totalling ~35 KB**) plus 5 client
files: `WorktreesView.tsx`, `useWorktreesController.ts`, and New/Merge/Remove
modals. `GitViewTabs.tsx` registers `worktrees` as a fourth tab beside Changes,
Commits, and Branches. The API is `GET /api/worktrees` and `POST` `/create`
(create-and-open), `/open`, `/merge`, `/remove`.

**The list payload is the part CLIde does not have.** `listWorktrees` returns,
per worktree: `path`, `branch`, `headSha`, `isMain`, `isCurrent`, `isLocked`,
`isDetached`, `changedFileCount`, `ahead`/`behind`, last commit subject and ISO
date, `linkedProjectId`, and `linkedProjectArchived` — fanned out with a
concurrency cap of 4. That inventory is comparable to what Zed and VS Code
worktree support display, and it is the single strongest reason to harvest
rather than rewrite.

**Findings not previously recorded**, all confirmed against the tag:

- `worktree-merge.service.ts` **hardcodes `deleteBranch: true`** in the
  post-merge cleanup call. This is worse than the modal defaults already noted:
  it is not a default the user can override, so the merge path deletes the
  source branch unconditionally whenever `removeAfterMerge` is set — and the
  deletion runs through the same swallowed `git branch -D` at
  `worktree-remove.service.ts:61`.
- `countAheadBehind` compares only against the local base branch, never against
  a remote-tracking ref, so the payload cannot distinguish *unmerged* from
  *unpushed*. There is no tracking, upstream, or remote-identity field anywhere
  in the descriptor.
- `parseWorktreeListPorcelain` strips `refs/heads/`, discarding the canonical
  ref this specification requires be preserved.
- The base branch is `entries[0].branch` — whatever the main worktree happens to
  have checked out. The merge target is never chosen, and there is no rebase,
  fast-forward policy, push, or PR path.
- `isPrunable` is parsed and never surfaced; no merge/rebase/cherry-pick
  in-progress state is detected.
- **Nothing reports agent or runtime occupancy.** For the goal that motivates
  ADR 0016 — observing concurrent agents inside one project — the feature is
  silent.
- `createWorktree` hardcodes the layout
  `<repoParent>/<repoName>-worktrees/<sanitized-branch>` and does nothing
  further, so a created worktree has no `node_modules` and no port assignment.
  CLIde's own `scripts/setup-worktree.sh` exists precisely because a bare
  `git worktree add` is not usable in this repository.
- Merging rewrites the main worktree with no self-hosting guard. Where that
  checkout is the one serving CLIde — the normal case for anyone forking
  CloudCLI to work on CloudCLI — this is the `TODO.md` branch-switcher footgun
  reachable from a second button.
- 1.37 does **not** close the Phase 0 truthfulness gaps: the merged
  `git-parsing.service.ts:38` still folds conflicts into `modified`. The
  worktree feature therefore adds power on top of a panel that still cannot
  display a conflicted file.

**Assessment.** Upstream delivers roughly Phase 2 of
`2026-07-26-git-source-control-workspace-ux.md` (workspace inventory and
creation) on a data model that predates Phases 0 and 1. The plumbing is better
than expected and largely portable; the product contract is the
"worktree as a display option" model ADR 0016 rejected —
`worktree-open.service.ts` registers each worktree as a *separate top-level
project* named `repo · branch`, joined to its parent by nothing but a
convention in the display string. Sequencing Phases 0 and 1 first and porting
this material onto the resulting model is cheaper than adopting the model and
retrofitting identity underneath it.

### Reuse

Harvest at file level. Paths are upstream's, at `v1.37.0`.

| Upstream file | Take | Amend before use |
|---|---|---|
| `services/worktree-git.service.ts` | Nearly whole: porcelain parser, `validateWorktreeBranchName`, `findWorktreeEntryByPath`, `countChangedFiles`, the injected `runGitCommand` | Preserve full refs instead of stripping `refs/heads/`; surface `isPrunable` and the locked reason |
| `services/worktree-list.service.ts` | `countAheadBehind`, `readLastCommit`, and the concurrency-capped fan-out | Add remote-tracking comparison, repository grouping by `--git-common-dir`, and agent/runtime occupancy |
| `services/worktree-merge.service.ts` | Both-sides cleanliness preflight, `git reset --merge` rollback, structured `409` conflict reporting with the conflicted path list | Explicit merge target; remove the hardcoded `deleteBranch: true`; add the self-hosting guard |
| `services/worktree-create-and-open.service.ts` | The compensation pattern: roll back the created worktree when registration fails, and escalate loudly when the rollback also fails | Replace "open" with grouped-checkout registration, not a new top-level project |
| `worktrees.routes.ts` | The route/service split, and resolving project paths through an injected service so transport never reaches the Database module | Route shape follows the final identity model |
| `tests/*.test.ts` (8 files, ~35 KB) | The whole harness as a starting point | Re-point at CLIde's data shape; add the refusal cases from [Phase 4 tests](#phase-4-tests) |

The membership guard is worth calling out separately: every mutating route
resolves its path against `git worktree list --porcelain` before touching git,
which is what stops these endpoints becoming a "run git anywhere" backdoor. Keep
that property in any rewrite.

Leave behind entirely: the project-per-worktree identity model, the implicit
base branch, all four destructive defaults, the hardcoded post-merge branch
deletion, the hardcoded `-worktrees/` layout, and the Worktrees tab as shipped.

### Replace

Replace upstream assumptions with the contract in the existing Git and Source
Control specification:

- group checkouts by `git rev-parse --git-common-dir`;
- represent repository, checkout/worktree, branch, and remote separately;
- preserve canonical full refs such as `refs/heads/feature`;
- preserve remote identity such as `origin` versus `upstream`;
- make source, target, and integration direction explicit;
- detect detached HEAD and in-progress merge/rebase/cherry-pick state;
- expose conflicts separately from ordinary modifications;
- account for locked worktrees and active agent/runtime occupancy;
- protect the checkout serving CLIde;
- keep worktree removal separate from branch deletion;
- refuse dirty, conflicted, active, locked, or unintegrated deletion by default;
- default to keeping the branch;
- never default to squash plus cleanup plus branch deletion;
- do not use `git branch -D` without proving the user explicitly authorized
  loss of an unmerged branch — including from the post-merge cleanup path,
  where upstream hardcodes the authorization it should be asking for;
- distinguish unmerged from unpushed by comparing against the remote-tracking
  ref, not only the local base branch;
- let the worktree location be chosen rather than fixed at
  `<repoParent>/<repoName>-worktrees/<branch>`, and run CLIde's worktree setup
  (`scripts/setup-worktree.sh`: dependency links and a free port pair) as part
  of creation, so a created worktree is actually usable; and
- refuse or hard-warn on any operation that rewrites the checkout serving
  CLIde, merge included — the same hazard as the branch switcher.

Use solid scrims such as `bg-black/50`; remove upstream
`backdrop-blur-sm`.

### Exposure gate

The upstream Worktrees tab and mutating endpoints must not become reachable
until the above identity and preflight contract is implemented and tested.

The 1.37 integration may still complete with:

- internal parser and service foundations merged;
- tests adapted to CLIde's final data shape; and
- the UI/routes unregistered or capability-disabled.

Enabling the feature is a separate acceptance gate tied to
`2026-07-26-git-source-control-workspace-ux.md`. Do not ship an unsafe
intermediate UI merely to claim parity with upstream 1.37.

### Other Git behavior

Preserve CLIde's:

- visible multiline commit-hook and server errors;
- retained commit message after failure;
- AI commit-message generation route;
- provider/model-selectable ephemeral job design; and
- self-hosting branch-switch protection.

Port upstream's Git initialization, history loading, refresh feedback, tab
scrolling, and confirmation-modal scrolling where they fit the final
components.

### Phase 4 tests

- Canonical full-ref parsing and per-remote grouping.
- Multiple worktrees share one repository identity.
- Dirty, conflicted, locked, active, serving, and unintegrated removal
  refusals.
- Explicit fast-forward, merge-commit, and squash policies.
- Conflict abort leaves source and target recoverable.
- Cleanup and branch deletion require separate authorization, and a merge with
  cleanup enabled still leaves the branch intact unless deletion was authorized
  on its own.
- Ahead/behind distinguishes unmerged from unpushed.
- Merge and removal refuse, or hard-warn, when the target is the checkout
  serving CLIde.
- A newly created worktree comes back usable: dependency links and a port pair
  assigned.
- Commitlint/hook stderr remains visible and the composer retains input.
- Commit-message generation remains provider-neutral and ephemeral.
- No modal uses backdrop filtering.

## Phase 5: Sessions, attachments, deep links, Codex history, and skills

### Deep links

Adopt the authoritative provider session-detail route so a direct link can
resolve a session omitted from a paginated project payload.

Resolution must accept:

- app session ID;
- current provider session ID; and
- CLIde provider-session aliases, including superseded rewind/fork IDs.

Return the canonical app session ID and preserve `isStarred`. Any fetched
session added to a list must still pass through
`compareSessionsStarredFirst`.

### General file attachments

Generalize the composer and history model from image-only to file attachments,
but retain provider capabilities:

- JPEG, PNG, GIF, and WebP may use a provider's native image path when
  supported;
- SVG is a general file, not a Claude-native image;
- non-image files use validated server paths and an explicit text/file
  handoff;
- symlink and path-boundary checks occur server-side;
- attachments survive queued-send, history, reconnect, rewind, and optimistic
  reconciliation; and
- providers without a native attachment capability receive a clean supported
  fallback or a visible rejection.

Add `onDropRejected` or an equivalent explicit rejection path. Maximum size,
count, and type failures must never look like a no-op.

Do not assume upstream's increase to 10 MB is automatically correct for every
provider. Verified 2026-07-29: upstream's client and backend maxima already
agree (`useChatComposerState.ts:157` `MAX_ATTACHMENT_SIZE = 10 * 1024 * 1024`,
`assets.routes.ts:47` `fileSize: 10 * 1024 * 1024`), so the open question is
provider-specific limits, not a client/backend mismatch. Surface those limits
before sending when known.

Add a composer submission mutex/ref so a brand-new chat cannot create duplicate
sessions through rapid repeated submission. Upstream's image-only
reconciliation fix does not replace this guard.

### Codex history

Port upstream's broader history reconstruction for:

- orchestration-wrapped `exec` calls;
- wait/poll cells;
- Bash command presentation;
- subagent calls;
- array-shaped tool output; and
- hidden orchestration control tools.

Merge it with, rather than replace:

- App Server message normalization;
- SDK 0.146 schema changes;
- rewind/fork metadata;
- live/final message deduplication;
- context and usage events;
- memory citations; and
- CLIde's tool presentation components.

### Skills

Adopt:

- `~/.codex/skills`;
- symlinked skill directories;
- repeated-load suppression; and
- hiding full injected skill instructions from ordinary chat history.

Keep `.agents/skills` and `.codex/skills/.system` behavior. Resolve roots
through the provider skill capability instead of placing Codex-specific
directories into shared UI code.

### Phase 5 tests

- Direct link to an unloaded app ID, provider ID, and superseded alias.
- Starred deep-linked session remains starred and sorted correctly.
- Native images, SVG, text/code files, oversize files, too many files, and
  unsupported provider attachments.
- Attachment history and reconnect round trips.
- Rapid double-submit creates only one new app session.
- Codex SDK and App Server history render the same wrapped command once.
- Skill symlinks, user roots, deduplication, and hidden injected bodies.

## Phase 6: Chat and UI refinements

Port small UI changes manually into the final CLIde components.

### User messages and tool failures

- Render user Markdown with the same sanitization and link policy as assistant
  content.
- Add `remark-breaks` only if it is required by the chosen rendering path.
- Disable single-dollar math while preserving fenced/block math.
- Collapse non-Bash tool failures to a useful error summary.
- Do not auto-expand failed Bash output merely because it failed.

Do not replace `MessageComponent.tsx` wholesale. Preserve:

- rewind/edit actions;
- compact summaries;
- system notices;
- memory citations;
- CLIde timestamps;
- custom Bash/tool layouts;
- live/final identity reconciliation; and
- provider-neutral assistant presentation.

### Export

Treat upstream export as a starting point:

- use the actual provider/assistant label rather than hardcoded "Claude";
- include user, assistant, tool, attachment, and thinking data according to an
  explicit export policy;
- escape HTML;
- make Markdown and HTML deterministic;
- label browser print as Print/PDF rather than implying a native PDF renderer;
  and
- exclude hidden injected skill bodies and secrets.

### Settings and QuickSettings

Resolve all QuickSettings conflicts in favor of the merged Settings IA:

- do not restore the edge panel;
- keep tool-display and input preferences in the Chat settings screen;
- keep theme/language in Appearance;
- keep voice in Chat;
- update upstream call sites to the settings registry; and
- remove imports and state that exist only for the old panel.

**Conflict resolution is not sufficient here.** Work the [post-merge deletion
checklist](#post-merge-deletion-checklist--changes-that-arrive-with-no-conflict)
as a separate explicit step: `AppContent.tsx:7` and `:258` reintroduce the panel
through a clean auto-merge, and `QuickSettingsPanelView.tsx` is now modify/delete
(keep the deletion, discard the z-index lines). ADR 0019 is the authority, but
note it names `ChatInterface.tsx` as the mount point — upstream moved it.

The Settings screens themselves need no API rewiring; see [Settings screens need
no API rewiring](#settings-screens-need-no-api-rewiring). No new registry or
`searchIndex.ts` rows are required for 1.37.

### Composer menus

Upstream adds `ComposerModelMenu`, `ComposerPermissionMenu`,
`ComposerMenuPrimitives`, and `useComposerMenuAnchor`. **Decided 2026-07-29: keep
CLIde's.** Resolve `ChatComposer.tsx` in CLIde's favor for the model, effort, and
permission-mode affordances, and take upstream's non-menu composer changes. Leave
the four new files out rather than merging them unused.

Note that these are not upstream refactors of CLIde components — the forks site
these controls differently (CLIde's model choice lives in the `/models` popup, and
permission mode is a cycling button, not a menu). See [Newly identified gap:
upstream's composer
menus](#newly-identified-gap-upstreams-composer-menus) for the
affordance-by-affordance mapping and for the three follow-ups worth taking later,
`useComposerMenuAnchor` first.

### Upstream recommendations

Do not add the unofficial Claude Usage plugin recommendation. CLIde already
provides native usage and credits surfaces; a second recommendation would be
duplicative and could confuse source-of-truth behavior.

**Decision (Grayson, 2026-07-29): delete all three sites, i18n strings
included.** Those are the `CLAUDE_USAGE_PLUGIN_URL` constant and the
`claude-usage` recommendation entry in
`src/components/settings/view/screens/ExtensionsPluginsScreen.tsx`, plus the
`claudeUsagePlugin` block in `src/i18n/locales/en/settings.json`. `BarChart3` is
used by another recommendation, so leave the import. Record the deletion in the
merge message so the next upstream integration does not silently re-add it.

### Phase 6 tests

- Markdown lists, ordinary dollar amounts, block math, links, and code.
- Failed Bash and non-Bash tools in desktop and mobile layouts.
- Provider-neutral exports from Claude and Codex sessions.
- No QuickSettings affordance, import, dead setting, or duplicate control.
  Specifically: `git grep -i quicksettings -- src/` returns only the surviving
  `quickSettings.*` i18n keys that the Chat settings screen consumes, plus the
  `de`/`fr` blocks, and no import of `quick-settings-panel` anywhere.
- `git grep -i 'claude-usage\|claudeUsagePlugin' -- src/` returns nothing.
- Settings deep links, search, and the command palette still resolve every
  registry screen id after the merge.
- Mobile rename and Git tabs on a real touch device.

## Phase 7: Dependencies, build, and package metadata

Review `package.json` and lockfile changes line by line.

Expected additions may include:

- `ignore`;
- `remark-breaks`; and
- `@types/cors`.

CLIde must retain:

- exact `@openai/codex-sdk` and bundled Codex version `0.146.0` or a separately
  approved newer exact version — upstream moves to `^0.144.0`, so this is the
  one dependency where the merge genuinely tries to drift backward;
- Node 24 development/runtime pinning with Node 22 compatibility where already
  required — verified 2026-07-29: `engines` is identical on both sides
  (`^22.0.0 || ^24.0.0`), and the only difference is `.nvmrc` (CLIde v24,
  upstream v22), which upstream has not touched since v1.36.3, so CLIde's pin
  survives without a conflict;
- Husky and project-local hook portability;
- lint and TypeScript cache behavior;
- clean server emit behavior;
- Playwright dependencies and scripts used by CLIde;
- current client/server build separation; and
- service/package naming.

Do not adopt upstream's broad `npm test` command as the verification authority
until it is proven to honor CLIde's server TypeScript configuration and path
aliases. Focused server tests continue to use:

```bash
./node_modules/.bin/tsx --tsconfig server/tsconfig.json --test <matching *.test.ts files>
```

**Measured 2026-07-29 — upstream's script is broken on CLIde, not merely
unproven.** Upstream adds:

```text
"test": "node --import tsx --test \"server/**/*.test.ts\" \"server/**/*.test.js\""
```

It omits `--tsconfig`, so tsx resolves the nearest config from the cwd — the root
`tsconfig.json`, which maps `@/*` to `src/*` (the *client*). CLIde's server maps
`@/*` to `server/*` in `server/tsconfig.json`, deliberately, so both sides can use
the same alias name without sharing one compiler configuration. 35 server test
files import through `@/`. Running upstream's exact form against one of them
fails outright:

```text
Error [ERR_MODULE_NOT_FOUND]: Cannot find package '@/modules' imported from
  server/modules/providers/tests/provider-models.service.test.ts
```

**Decision (Grayson, 2026-07-29): adopt only in corrected form, as a convenience,
never as the authority.** Add the `--tsconfig` flag CLIde's documented runner
already uses:

```text
"test": "tsx --tsconfig server/tsconfig.json --test \"server/**/*.test.ts\" \"server/**/*.test.js\""
```

Then prove it: it must pass before it is written into `AGENTS.md`, `CLAUDE.md`, or
this specification's verification matrix as a substitute for the focused command.
Keep the `*.test.js` glob — CLIde has JavaScript server tests
(`server/routes/tests/commands.test.js` is one of the 39 conflicts). If the
corrected form does not pass cleanly, omit the script entirely rather than commit
a red `npm test`; a script everyone learns to ignore is worse than none.

Update `server`/`bin` script paths only after the TypeScript entrypoint and
compiled output locations are verified.

Set the package/UI version to 1.37.0 only in the final coherent integration
commit, after the built client, built server, and package metadata agree.

## Database migration and rollback

Upstream's session-model column makes this a data-affecting release.

Before the first DB-backed test or isolated server start:

1. stop using real user data for tests;
2. create a timestamped backup of `~/.cloudcli/auth.db`;
3. back up the active-model sidecar if it exists;
4. record the source schema version;
5. run migrations against a disposable database first; and
6. verify downgrade/rollback behavior before touching the real database.

Migration requirements:

- additive and idempotent;
- no rewrite of `session_id` or `provider_session_id`;
- no loss of aliases, stars, archives, custom names, project paths, or
  timestamps;
- desired-model semantics documented in schema and repository types;
- sidecar migration chooses the newest timestamp and can be safely rerun; and
- failure leaves the original DB and sidecar recoverable.

Live-session test cleanup order remains:

1. remove test transcript/filesystem data;
2. allow or stop the watcher as appropriate; and
3. remove test database rows last so the watcher cannot rediscover them.

## Verification matrix

### Static and focused automated verification

Run the narrowest relevant checks throughout, then the complete integration
gate:

```bash
npm run typecheck
npm run lint
npm run build:client
npm run build:server
```

Focused server suites must cover at least:

- auth service and token refresh;
- provider runtime registry;
- provider model resolution and migration;
- provider token/context usage;
- Chat and Shell WebSocket ownership/liveness;
- session detail/deep-link aliases;
- attachment filtering/history;
- Codex history and identity;
- skills discovery;
- Git commit errors; and
- worktree parsing and safety services.

Do not treat a truncated build line such as `transforming...` as a build
failure. Check the exit code and artifacts.

### Isolated live verification

Use the available branch-test service or another explicitly approved isolated
instance. Do not take over port 3001 or an occupied 3002 instance.

Verify:

1. new and resumed Claude chats;
2. new and resumed Codex chats over the configured transport;
3. Cursor and OpenCode capability/no-op behavior where installed;
4. picker changes, Shell `/model`, fast mode, and browser refresh;
5. context ring/usage values for a normal and large-context model;
6. abort before and after provider-session creation;
7. background/wake WebSocket recovery;
8. application token refresh without transient logout;
9. rewind/fork and superseded deep links;
10. native image, SVG, and general file attachment behavior;
11. Git hook failure visibility and commit-message generation;
12. Settings search/navigation with no QuickSettings regression; and
13. worktree feature absence or fully compliant gated behavior.

For PWA safe-area, touch, and long-press behavior, the final check must use the
installed app on a real device. The Vite page is not sufficient.

### Source, build, and service truth

Report these separately:

- integration source commit;
- installed dependencies;
- client build timestamp/artifact;
- server build timestamp/artifact;
- isolated service process and port;
- production service state; and
- bundled child App Server/CLI version.

A passing source build does not mean production is updated. A production
service still running the old build is not a failed integration.

## Commit structure

Git records resolution of an ancestry-preserving merge as one merge commit.
Do not try to manufacture a stack of ordinary commits while the repository is
in an unresolved merge state.

Keep the merge reviewable by tracking conflict resolution in this conceptual
order:

1. upstream ancestry and structural module moves;
2. runtime identity/auth/WebSocket adaptation;
3. model and usage persistence;
4. session, attachment, Codex, and skill adaptations;
5. Git/worktree foundations and safety gating;
6. client UI refinements and Settings conflict resolution; and
7. dependency, build, migration, and documentation updates.

Run the narrow tests for each area as it becomes coherent, but record the
completed resolution with one merge commit. Its message must summarize the
semantic decisions rather than say only "resolve conflicts."

Optional improvements that are not required to make the merged v1.37.0 tree
correct may follow as separate commits on the same topic branch. Each such
commit must be self-contained and tested. The complete gate runs before
Grayson's live verification.

## Rollback

Before live testing, retain:

- the pre-integration topic-base commit;
- the database and sidecar backups;
- the last known-good client/server build;
- the existing production service configuration; and
- the isolated test service's prior state.

Rollback means:

1. stop only the isolated integration instance;
2. restore its disposable data or backed-up DB as appropriate;
3. return the test service to its prior branch/build if it was explicitly
   borrowed;
4. leave production untouched; and
5. keep the integration branch for diagnosis rather than deleting evidence.

Never use `git reset --hard` against the main checkout or another user's dirty
worktree.

## Completion criteria

The work is complete only when all of the following are true:

- v1.37.0 ancestry is present in the topic branch;
- all direct conflicts have documented semantic resolutions;
- the server runs from the new module/TypeScript architecture;
- all four providers retain correct capability boundaries;
- stable app and provider session IDs remain distinct;
- abort, reconnect, rewind, and fork behavior pass focused tests;
- desired and effective models remain distinguishable;
- token/context usage preserves CLIde's three guarded paths;
- commit errors and AI commit-message generation remain functional;
- QuickSettings is not resurrected — including the auto-merged mount in
  `AppContent.tsx`, not only the conflicted paths;
- the Claude Usage plugin recommendation and its strings are absent from the
  merged tree;
- every item of the [post-merge deletion
  checklist](#post-merge-deletion-checklist--changes-that-arrive-with-no-conflict)
  is worked and recorded;
- upstream's worktree services, routes, controller, and modals are absent from
  the tree (deferred by decision 4), not merged-but-unregistered;
- CLIde's model machinery is unchanged and `sessions.model` is unused (decision 3);
- upstream's four composer menu files are absent (decision 2);
- `npm test`, if present at all, passes (decision 8);
- attachments and deep links pass round-trip tests;
- Codex remains on the approved SDK/App Server version and transport;
- typecheck, lint, client build, server build, and focused tests pass;
- a live isolated build has been personally verified by Grayson;
- production has not been restarted without explicit approval;
- `TODO.md` is updated with the verified outcome and commit;
- completed work is recorded in `docs/todo-done.md`; and
- only then is the topic branch merged and, with explicit approval, pushed.

## ADR follow-up

No ADR is required merely to perform this one release integration.

Ask whether to add or supersede an ADR if implementation establishes either of
these as a lasting contract:

- the database schema/API distinction between desired and effective session
  models; or
- an ongoing policy that major squashed upstream releases are integrated with
  ancestry-preserving merge commits rather than rebasing CLIde's full history.

Do not rewrite ADR 0003 or ADR 0016 in place.
