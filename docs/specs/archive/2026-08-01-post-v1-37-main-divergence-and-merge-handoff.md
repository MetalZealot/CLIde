# Post-v1.37 main divergence and merge handoff

- Date: 2026-08-01
- Status: **Completed and archived 2026-08-04.** Merged, deployed, and closed
  out — see [Closing status](#closing-status--2026-08-04) at the end of this
  document. Remaining work moved to
  [Post-v1.37 remaining work](../2026-08-04-post-v1-37-remaining-work.md);
  read that, not this. This document is retained as provenance for why the
  synchronization was needed and what it cost.
- Scope: Record everything added to CLIde `main` after the upstream v1.37
  integration branch forked, identify the overlap with the in-progress v1.37
  merge, and define how to bring the integration worktree back to `main`
  without losing either line of work
- Integration worktree: `~/Projects/cloudcli-wt-upstream-1.37`
- Integration branch: `chore/upstream-1.37`
- Integration prerequisite:
  [Upstream v1.37.0 integration](../2026-07-29-upstream-1-37-integration.md)
- Post-integration reviews:
  [Source Control and worktrees](../2026-07-30-post-v1-37-source-control-worktree-review.md)
  and
  [WebSocket liveness](../2026-07-30-post-v1-37-websocket-liveness-review.md)

## Purpose and boundary

This is not the final v1.37 release report. The v1.37 merge is still in
progress. This document is the bridge between:

1. the integration work already performed in the isolated worktree;
2. the changes that continued landing on `main` after that worktree forked;
3. the final synchronization and live-verification pass; and
4. the deliberately deferred post-v1.37 specifications.

It is not permission to abort or rebase the conflicted integration worktree,
merge into `main`, push either branch, restart production, replace an occupied
branch-test service, or begin the deferred follow-ups. Those remain separate
explicit actions.

## Snapshot used for this assessment

The measurements below were taken before this document was added.

| Ref or state | Snapshot |
|---|---|
| Integration fork point | `3b892ec0f7e489619ccc01392518e8b6870b210a` |
| `main` | `8c310bd72a78db99c5b27e9149591e7d69584dee` |
| Integration branch tip before its pending merge | `cff37b3f4b5702c2cf20f263ca417cf52de177f0` |
| Immutable upstream merge target | `v1.37.0` / `264e0946d2a168c281b85807cd1183130f40b090` |
| Committed divergence | `main` has 31 unique reachable commits; the integration branch has 4 |
| `main` net change since the fork | 68 paths, +7,697 / -1,709 |
| In-progress integration footprint | 228 paths |
| Path overlap | 14 paths |
| Existing upstream merge conflicts | 39 original paths; 3 paths still unresolved |
| Integration working state | 226 staged paths, 12 paths with unstaged work, no untracked files |

`main` was clean at the time of assessment. The integration worktree was in an
active ancestry-preserving merge of the immutable v1.37.0 commit. Its remaining
unresolved files were:

- `src/components/chat/hooks/useChatComposerState.ts`;
- `src/components/chat/view/ChatInterface.tsx`; and
- `src/components/chat/view/subcomponents/ChatComposer.tsx`.

Those three files contained 17 remaining conflict-marker groups. The large
staged and unstaged resolution state means that aborting, rebasing, or trying
to reconstruct the merge from memory would risk both loss and substantial
rework.

## Executive summary

Continuing work on `main` did create an additional synchronization step, but it
did not invalidate the v1.37 integration.

Of the 68 paths changed on `main`, only 14 overlap the 228 paths currently
involved in the integration worktree. Fifty-four paths are additions or edits
outside the integration footprint and should enter the topic branch normally
when `main` is merged into it. The 14 overlapping paths are concentrated in
five coherent behaviors:

1. Claude `/compact` transcript normalization and referenced-file rendering;
2. history pagination and scroll anchoring;
3. the native PWA attachment picker;
4. authentication bootstrap versus token rotation; and
5. the shared `TODO.md` coordination record.

The final integration should therefore not be attempted by merging the dirty
topic branch directly into the production-serving `main` checkout. Complete
the pending upstream merge first, then merge current `main` into the topic
branch and resolve this bounded second overlap in isolation. Once that result
is tested and personally accepted, `main` can fast-forward to it if `main` has
not advanced again.

## What changed on main after the integration fork

### 1. Claude compact-history behavior

Commit `12a501d` made two related transcript behaviors visible and stable:

- Claude's duplicate `/compact` wrapper is dropped only when a recent genuine
  user row already contains identical text. The genuine prompt survives because
  it is the rewind anchor; other local commands that only have wrapper rows
  remain visible.
- `file` and `compact_file_reference` attachment rows following a compact
  summary are collected as `compactReferences` and rendered as a muted
  `Referenced: ...` line below that summary.

ADR 0023 records why the wrapper, not the prompt, is discarded. The behavior
crosses provider transcript normalization, shared message types, client state,
history pagination, rendering, and i18n. It must be preserved through
upstream's broader attachment and session-history changes.

Primary source paths:

- `server/modules/providers/list/claude/claude-sessions.provider.ts`;
- `server/shared/types.ts`;
- `src/components/chat/hooks/useChatMessages.ts`;
- `src/components/chat/types/types.ts`;
- `src/components/chat/view/subcomponents/MessageComponent.tsx`;
- `src/i18n/locales/en/chat.json`; and
- `src/stores/useSessionStore.ts`.

The accompanying test file
`server/modules/providers/tests/claude-compaction-rows.test.ts` is new on
`main` and does not overlap the pending integration tree, so it should arrive
cleanly and become an acceptance test for the combined behavior.

### 2. History pagination and scroll anchoring

The `fix/chat-scroll-pagination` work was integrated by `12ede24`. Its topic
commits replaced several competing pagination and scroll authorities with one
coordinated flow:

- pagination truth comes from the per-session store;
- top loading is edge-triggered and can chain undersized pages deliberately;
- watcher refresh versions are consumed once per session;
- reconnect and watcher refreshes retain the currently loaded window;
- prepend anchoring follows the first visible message through late layout;
- the anchor is armed before the store notifies React;
- `ResizeObserver` correction runs before paint;
- one passive, animation-frame-throttled scroll listener replaces overlapping
  scroll, wheel, and touch handlers;
- native scroll anchoring and misleading estimated geometry are disabled; and
- the transient load-all overlay was removed in favor of one inline history
  control.

This is an accepted improvement, not a claim that scrolling is finished.
Grayson accepted the combined Chromium, Firefox, and PWA result on 2026-08-01,
while `TODO.md` deliberately retains two residual symptoms: a brief assistant
header/logo flash and occasional viewport movement when the roof is reached
during a load.

Primary overlap paths:

- `src/components/chat/hooks/useChatSessionState.ts`;
- `src/components/chat/view/ChatInterface.tsx`;
- `src/components/chat/view/subcomponents/ChatMessagesPane.tsx`; and
- `src/stores/useSessionStore.ts`.

`src/components/chat/view/subcomponents/LoadAllMessagesOverlay.tsx` is deleted
only on `main`. The combined tree must not accidentally resurrect it while
adapting upstream's Chat UI.

### 3. Native PWA attachment selection and stable auth bootstrap

The attachment work arrived in two stages and must be reviewed as one behavior.

Commit `9aae4d0` introduced a native overlaid image input so a real tap opens
the Android picker, with a dedicated component and focused test. Its three
wiring files are also the three files still unresolved in the upstream merge:

- `src/components/chat/hooks/useChatComposerState.ts`;
- `src/components/chat/view/ChatInterface.tsx`; and
- `src/components/chat/view/subcomponents/ChatComposer.tsx`.

The first live PWA test proved that picker invocation was not the complete
problem. A valid file-selection event was followed 49 ms later by the entire
workspace unmounting. Commit `4b5ac61` fixed the root cause in
`AuthContext.tsx`: adopting a refreshed JWT must update current credentials but
must not change `checkAuthStatus`'s identity and rerun mount-time authentication
bootstrap. ADR 0024 makes token rotation and workspace bootstrap separate
lifecycle operations.

Temporary Samsung lifecycle tracing was introduced by `929a2dc` and removed by
`05cf60c` after the installed PWA passed cold launch, resume, and image
attachment verification. The diagnostics are not a feature to port. Their
absence from the net diff is intentional.

New main-only files that should enter cleanly:

- `src/components/chat/view/subcomponents/NativeImageAttachmentPicker.tsx`;
- `src/components/chat/view/subcomponents/NativeImageAttachmentPicker.test.tsx`;
- `docs/decisions/0024-token-rotation-does-not-restart-auth-bootstrap.md`; and
- the completed record in `docs/todo-done.md`.

### 4. Codex collaboration-mode reset

Commit `3cdeec9` makes every Codex App Server `turn/start` explicit about
collaboration mode. Plan turns send `plan`; ordinary turns send `default`
instead of omitting the field and allowing a resumed thread's previous Plan
state to leak into the next turn. It also requires a resolved model after
thread start/resume/fork and expands transport coverage.

Its two paths do not overlap the current integration footprint:

- `server/modules/providers/list/codex/codex-app-server-chat.transport.ts`;
- `server/modules/providers/tests/codex-app-server-chat.test.ts`.

They should merge structurally without a textual conflict, but the final Codex
focused suite must still prove the behavior against the integrated runtime and
session-identity changes.

### 5. Provider maps, architecture records, and deferred specifications

`main` gained a durable provider-maintenance documentation structure:

- `docs/maps/clide-provider-capability-map.md`;
- provider-native Claude and Codex maps;
- compact Claude and Codex upgrade ledgers;
- `CLIde_Provider_Architecture_Current_Contract.md` as the compact present-state
  architecture handoff; and
- updates to older dated investigations so they point to the living maps rather
  than pretending to remain current inventories.

It also gained or materially revised these implementation plans:

- post-v1.37 Source Control and worktree review;
- post-v1.37 WebSocket liveness review;
- provider/model-selectable Source Control commit-message generation;
- MCP scope-storage collision handling; and
- the provider architecture consolidation plan.

These are documentation inputs to later work, not requirements to implement
inside the v1.37 merge. Most are main-only paths and should merge cleanly. The
integration must preserve them even where the code paths named by an older
source map move during v1.37.

### 6. UI overhaul design material

Commit `480c2eb` added the working `designs/CLIde UI Overhaul.svg` and reference
screenshots under `designs/UI References/`. These are net-new design assets and
do not overlap the v1.37 source integration. They should be retained unchanged;
they do not authorize implementing the UI overhaul as part of this merge.

## Exact overlap with the in-progress integration

The table records the 14 paths changed on both sides. `M` means the upstream
merge currently has a staged resolution for the path; `UU` means it is one of
the three remaining unresolved paths; the `TODO.md` edit is currently unstaged
coordination work.

| Path | Main behavior to preserve | Integration state |
|---|---|---|
| `TODO.md` | Accurate records for compact, scrolling, attachments, auth, and deferred work | Unstaged edit |
| `server/modules/providers/list/claude/claude-sessions.provider.ts` | Compact echo suppression and referenced-file extraction | `M` |
| `server/shared/types.ts` | `compactReferences` shared transport shape | `M` |
| `src/components/auth/context/AuthContext.tsx` | Stable bootstrap callback across JWT rotation | `M` |
| `src/components/chat/hooks/useChatComposerState.ts` | Native attachment input state and wiring | `UU` |
| `src/components/chat/hooks/useChatMessages.ts` | Compact-reference history normalization | `M` |
| `src/components/chat/hooks/useChatSessionState.ts` | Store-owned pagination, refresh consumption, anchor timing | `M` |
| `src/components/chat/types/types.ts` | Compact-reference client shape | `M` |
| `src/components/chat/view/ChatInterface.tsx` | Native picker wiring and scroll/session coordination | `UU` |
| `src/components/chat/view/subcomponents/ChatComposer.tsx` | Native picker presentation and trigger | `UU` |
| `src/components/chat/view/subcomponents/ChatMessagesPane.tsx` | Passive listener, pre-paint anchoring, inline history control | `M` |
| `src/components/chat/view/subcomponents/MessageComponent.tsx` | Compact referenced-file rendering | `M` |
| `src/i18n/locales/en/chat.json` | `Referenced` and attachment copy | `M` |
| `src/stores/useSessionStore.ts` | Pagination authority and compact-reference persistence | `M` |

Path overlap is a review ceiling, not a predicted conflict count. Some of these
paths may merge automatically after the upstream merge is committed; a clean
textual merge still requires behavior-level verification.

## Semantic resolution rules for the main synchronization

### Preserve both attachment models

Upstream v1.37 generalizes image attachments into file attachments. `main`
improves how the installed Android PWA invokes the native image picker. These
are complementary. The resolution must retain upstream's supported attachment
types and server/history transport while preserving the real-tap native input,
its lifecycle, and its test seam. Do not choose one implementation wholesale.

### Keep one pagination authority

Do not reintroduce duplicated `hasMoreMessages`, load locks, or watcher-driven
full-history replacement merely because an upstream component expects the old
shape. Adapt the integrated Chat structure to the store-owned pagination and
pre-paint anchor contract that was accepted on `main`.

### Keep compact-summary identity intact

The surviving `/compact` prompt must remain rewound/editable. Do not solve the
duplicate by retaining only the local-command wrapper. Attachment
generalization must continue to distinguish ordinary user attachments from
the transcript bookkeeping rows that become `compactReferences`.

### Keep auth bootstrap stable

Upstream's auth service and refresh work must not regress ADR 0024. A refreshed
token may update HTTP and WebSocket credentials; it may not put
`ProtectedRoute` back into loading or unmount the workspace.

### Preserve both coordination histories

`TODO.md` is expected to need a hand resolution. Retain the integration
decisions and deferrals, the accepted-but-not-finished scroll status, and the
completed PWA attachment/auth record. Do not resolve the file by taking either
branch wholesale.

## Safe synchronization sequence

### Phase 1: protect and finish the existing upstream merge

1. Fingerprint the integration worktree's index, unstaged diff, unmerged index
   entries, and merge metadata before another Git operation.
2. Preserve a recoverable checkpoint suited to an already-conflicted worktree;
   do not rely on an ordinary stash as the only copy.
3. Resolve the three remaining Chat files using the current `main` versions as
   an additional semantic reference, while still completing the v1.37 merge
   against its recorded parents.
4. Reinspect all 12 unstaged paths and stage only deliberate resolutions.
5. Confirm there are no unmerged entries or conflict markers.
6. Run the focused checks possible at this stage, then create the single
   ancestry-preserving `chore(upstream): integrate v1.37.0` merge commit.

Do not fold the later `main` synchronization into the first merge commit's
parentage. The v1.37 merge should continue to show the immutable upstream tag
as its second parent.

### Phase 2: bring main into the integration branch

1. Recheck `main`, the integration branch, their merge base, and all worktrees.
2. Merge current `main` into `chore/upstream-1.37` from the isolated integration
   worktree.
3. Review all 14 overlapping paths even if Git reports fewer conflicts.
4. Confirm the 54 main-only paths, especially new tests, ADRs, living maps,
   deferred specs, and design assets, are present.
5. Record the synchronization as a separate merge commit so the source of both
   lines remains visible.

This direction is deliberate: bringing `main` into the topic branch keeps
conflict work and build churn away from the checkout serving CLIde. It also
makes `main` an ancestor of the verified integration result.

### Phase 3: verify the combined result

At minimum, run:

```bash
npm run typecheck
npm run lint
npm run build:client
npm run build:server
```

Use the repository's server TypeScript configuration for focused server tests.
The combined result needs focused coverage for:

- Claude compact transcript rows and referenced files;
- Codex ordinary-to-Plan-to-ordinary collaboration-mode transitions;
- auth bootstrap and refreshed-token adoption;
- native attachment picker behavior;
- attachment history and transport;
- pagination/store behavior and watcher refreshes;
- the integrated WebSocket gateway and replay paths; and
- any v1.37 suites already named by the integration specification.

Static checks are not the live gate. The isolated instance must also cover:

- new and resumed Claude and Codex sessions;
- `/compact`, its single rewindable prompt, and referenced files;
- history entry, repeated top loads, project/session switching, and watcher
  refresh behavior;
- Plan followed by a normal Codex turn;
- token refresh without workspace reboot;
- installed-PWA image attachment selection and resume; and
- the original v1.37 integration matrix.

Grayson must personally accept the isolated live result before the integration
branch is merged to `main`.

### Phase 4: merge the verified result back to main

Immediately before the final operation:

1. confirm `git merge-base --is-ancestor main chore/upstream-1.37`;
2. verify `main` is clean and identify the checkout/service using it;
3. re-run a merge prediction if `main` advanced after Phase 2; and
4. fast-forward `main` when possible.

If `main` advanced again, merge the new `main` into the topic branch and repeat
the affected checks. Do not resolve final conflicts for the first time in the
production-serving checkout.

Pushing, production build/deployment, service restart, and cleanup of the topic
branch/worktree remain separate actions after source integration.

## Post-v1.37 follow-up queue

The following documents should be revisited only after the integrated source
is focused-tested, built, isolated-live-verified, accepted, and merged to
`main`.

### 1. Source Control and repository-grouped worktrees

[Post-v1.37 Source Control and worktree review](../2026-07-30-post-v1-37-source-control-worktree-review.md)
rejects upstream's Worktrees feature as shipped. The later implementation must
start from the final integrated Git module and preserve ADR 0016: truthful Git
state, repository-grouped checkouts, canonical refs, occupancy and self-hosting
guards, explicit integration targets, and non-destructive defaults.

### 2. WebSocket liveness

[Post-v1.37 WebSocket liveness review](../2026-07-30-post-v1-37-websocket-liveness-review.md)
will compare the final gateway with ADR 0006. The likely architecture remains
server protocol Ping/Pong plus a browser-visible application probe. The open
question is whether the client watchdog should accept any inbound activity or
require a matched application echo.

### 3. Source Control commit-message model selection

[Source Control commit-message model selection](../2026-07-29-source-control-commit-message-model-selection.md)
is ready for a fresh implementation worktree, but should use the post-v1.37 Git
module and panel as its actual baseline. It must remain a provider-neutral,
ephemeral text job and preserve visible commit/hook errors.

### 4. MCP scope-storage collision guard

[MCP scope storage collisions](../2026-07-30-mcp-scope-storage-collisions.md)
is a focused provider-boundary correction. Re-map its named source paths after
the v1.37 module migration, then prevent same-file/same-table user/project scope
aliases without name-deduplicating legitimate entries.

### 5. Provider architecture and recurring upgrade work

Use the merged
`CLIde_Provider_Architecture_Current_Contract.md` and living maps as the new
source baseline. The larger consolidation plan remains separate from the
release integration; do not use v1.37 path movement as permission to perform
the full provider refactor during conflict resolution.

## Completion update for this document

After the final source merge, append a short outcome section that records:

- the completed v1.37 merge commit;
- the commit that synchronized `main` into the topic branch;
- the final commit merged to `main`;
- which of the 14 overlap paths conflicted and which auto-merged;
- semantic corrections made during the second merge;
- exact test/build results;
- isolated service port and build identity;
- Grayson's live acceptance result;
- production deployment state, separately; and
- the chosen order for the post-v1.37 follow-up worktrees.

Do not change this document's pre-merge measurements after the fact. Preserve
them as the explanation for why the synchronization was required, then add the
actual result beside the prediction.

## Outcome — 2026-08-03

Source integration is complete. `main` fast-forwarded to the verified
integration tip; nothing has been pushed, rebuilt, or deployed.

### Commits

| Role | Commit |
|---|---|
| Phase 1 — v1.37.0 integration merge | `17d9326` (parents `cff37b3`, `264e094`) |
| Phase 2 — `main` synchronized into the topic branch | `49bfcb4` (parents `17d9326`, `bd61d08`) |
| Final commit merged to `main` | `658d536` |
| `main` before the merge (revert anchor) | `bd61d08` |

The v1.37 merge retains the immutable upstream tag as its second parent, as
required, and `264e094` is confirmed an ancestor of `main`. Phase 4 was a true
fast-forward — `main` was already an ancestor of `chore/upstream-1.37`, so no
conflict was ever resolved in the production-serving checkout. 22 commits
advanced `main`.

### Overlap outcome: 5 of the 14 predicted paths conflicted

The prediction was a ceiling, and it held. Conflicted in Phase 2:

- `TODO.md` (hand-resolved, both coordination histories retained);
- `src/components/chat/hooks/useChatComposerState.ts`;
- `src/components/chat/view/ChatInterface.tsx`;
- `src/components/chat/view/subcomponents/ChatComposer.tsx`; and
- `src/components/chat/view/subcomponents/ChatMessagesPane.tsx`.

Auto-merged, and reviewed anyway per the rule that a clean textual merge still
requires behavior-level verification: `claude-sessions.provider.ts`,
`server/shared/types.ts`, `AuthContext.tsx`, `useChatMessages.ts`,
`useChatSessionState.ts`, `src/components/chat/types/types.ts`,
`MessageComponent.tsx`, `src/i18n/locales/en/chat.json`, `useSessionStore.ts`.

`ChatMessagesPane.tsx` conflicted in Phase 2 despite being recorded `M` for the
upstream merge — the two merges have independent conflict sets, and the table's
`M`/`UU` column described only the first.

### Semantic corrections made after Phase 2

Four defects were found post-merge, all of the same shape and **all in files
that merged without any conflict**: upstream and CLIde had refactored toward the
same structure, so Git merged the file moves cleanly and silently dropped the
semantic reconciliation.

| Fix | Defect |
|---|---|
| `fd5d724` | `/context` 500'd — `hasConcreteSessionId` went with upstream's `commands.js` → `commands.routes.ts` move; the CLIde handler merged in still referencing it. `@ts-nocheck` meant typecheck could not catch it. Two tests added. |
| `3e84bd7` | New/resumed/forked Codex sessions failed — upstream flipped the runtime contract to pass the *app* session id, and every runtime got `resolveProviderSessionId` except CLIde's own `codex-app-server-chat.transport.ts`, which upstream had never seen. |
| `21f0088` | User bubble text turned blue-grey — upstream renders user turns through `<Markdown>` with `prose-invert`, whose gray-300 body colour overrode `text-white`. Fixed with `.prose-on-accent`, which sets only the `--tw-prose-invert-*` vars, so there is no specificity race. |
| `9a9d47b` | `chat.abort` never found the run and `chat.subscribe` looked up approvals under the wrong id. Claude survived on its tier-1 AbortController (ADR 0013); **Cursor and OpenCode have no such tier, so Stop did nothing.** Codex worked by accident. Regression coverage in `chat-session-addressing.test.ts` drives all four providers with the two ids deliberately unequal. |

Two further fixes landed during the pre-merge audit and **post-date the live
acceptance below**: `a4af8bf` scopes `getPendingForSession` by provider (Claude
and Codex share one module-level `interactiveRequestRegistry`, so a pending
`AskUserQuestion` was answered once per runtime and the subscribe ack carried
the same `requestId` twice), and `658d536` dedupes the ack client-side so a
later runtime cannot resurrect the symptom.

### Verification at merge time

Re-run on the integration tip immediately before the fast-forward, because the
two permission-dedupe commits post-dated the recorded green run:

| Check | Result |
|---|---|
| `npm run typecheck` | clean, both projects |
| `npm run lint` | **0 errors**, 194 warnings |
| `npm run test:server` | **398/398** (was 389 pre-audit) |
| `npm run test:client` | **94/94** |
| Conflict-marker sweep over `src/`, `server/`, `shared/` | 0 |

Builds were deliberately not run — see production state below.

Spec-required presences and absences confirmed on merged `main`:
`LoadAllMessagesOverlay.tsx` was **not** resurrected; `NativeImageAttachmentPicker`
+ its test, `claude-compaction-rows.test.ts`, ADR 0024, the living provider maps,
and the UI-overhaul design assets are all present; the Codex collaboration-mode
reset (`3cdeec9`) is in `main`; and every deferral held — no `sessions.model`
column (only a comment in `migrations.ts` recording why), no `server/modules/worktrees/`,
no `quick-settings-panel/`, and none of upstream's four composer menu files.

### Isolated service and live acceptance

Live verification ran on the `cloudcli-branch-test` harness at **port 3002**,
serving a build of `~/Projects/cloudcli-wt-upstream-1.37` against a snapshot of
the production database. Grayson accepted on **2026-08-03** at `21f0088`: new
Codex session, resumed Codex session, the usage ring (`/context`), and user-bubble
text colour all confirmed. Pagination and scroll anchoring were separately
accepted on 2026-08-01, with two residual symptoms deliberately retained in
`TODO.md` (assistant header/logo flash; viewport movement when the roof is
reached during a load) — scrolling is improved, not finished.

**Stated plainly: `9a9d47b`, `a4af8bf`, and `658d536` have not been live-verified.**
They carry static coverage only. The duplicate-`AskUserQuestion` panel and Stop
behaviour on Cursor/OpenCode should be exercised on the next live pass.

### Production deployment state — not deployed

Source only. Production on port 3001 is unchanged and still serving its
pre-1.37 build:

- `dist/` and `dist-server/` are gitignored, so the fast-forward could not alter
  what the running service serves;
- `~/Projects/cloudcli`'s `node_modules` is now **stale against the merged
  `package.json`** — `ignore@^7`, `remark-breaks`, `@types/cors`, `jsdom`, and
  `@types/jsdom` are new. `npm install` is required before any build there;
- the server entry moved to `server/index.ts` and the `bin` target to
  `dist-server/server/modules/cli/cli.js`, so this is a **server** change and
  needs a restart, which is **SSH-only — never from inside a CLIde session**;
- nothing has been pushed to `origin`; `main` is 22 ahead. The push will need
  no force, since this was a fast-forward, not a rebase.

Deploy order when it happens: `npm install` → `npm run build` → restart from
SSH → verify on 3001. The topic branch `chore/upstream-1.37` and its worktree
are intentionally left in place until then, so a revert to `bd61d08` stays
cheap.

### Follow-up order

Grayson's call, 2026-08-03, taken before the merge: reassess the fork's own
divergence first, ahead of the five queued specs above. Measured overlap with
upstream is 75 of 641 changed paths (~12%), and **none of the four merge defects
traced to an ADR** — they traced to upstream's restructure meeting a fork that
had been refactoring the same area. The queue is therefore:

1. **ADR reassessment** (this session's finding). Three items carry real cost:
   the ADR 0003 model-picker divergence, which sits in the single hottest
   contested file set and currently stores per-session picks in a sidecar JSON
   outside the database, outside backup, and outside migrations — take upstream's
   additive column as `desiredModel` without letting it outrank transcript truth;
   a yes/no on whether the Codex App Server transport (ADR 0011/0012) earns its
   maintenance, given it is opt-in, invisible to upstream, and broke on the
   runtime-contract flip; and ADR 0016, which is **entirely unimplemented** — no
   `git-common-dir` anywhere in `server/` or `src/` — yet blocks adopting
   upstream's worktrees module. Either build its Phase 0 or downgrade it to
   Proposed and harvest upstream's `listWorktrees` descriptor and test harness.
2. Source Control and repository-grouped worktrees.
3. WebSocket liveness (ADR 0006 vs the final gateway).
4. Source Control commit-message model selection.
5. MCP scope-storage collision guard.

### The lesson worth carrying to the next upstream bump

Only 5 files conflicted textually in Phase 2, and 39 in Phase 1 — but every
genuine defect was in a file that merged **cleanly**. Conflict markers were an
anti-signal here. When both sides refactor toward the same target, diff the
*contract* surfaces — runtime options, gateway addressing, provider context —
rather than trusting Git's conflict set. `chat-session-addressing.test.ts` is
the right shape of artifact: one per contract, driving every provider with the
ids deliberately unequal.

## Closing status — 2026-08-04

Everything this document was written to coordinate is finished. It is archived
so it stops being re-read; the leftovers it names live in
[Post-v1.37 remaining work](../2026-08-04-post-v1-37-remaining-work.md).

### Deployment — done, and the "not deployed" section above is now historical

Production on 3001 was built and restarted from SSH on **2026-08-04 09:20:58
MDT**, in the order the outcome section prescribed: `npm install`, `npm run
build`, SSH restart, verify. `node_modules` is current against the merged
`package.json` (`ignore@^7`, `remark-breaks`, `@types/cors`, `jsdom`,
`@types/jsdom` all present), and the service runs the v1.37 entry point
`dist-server/server/index.js` with the CLI bin at
`dist-server/server/modules/cli/cli.js`.

### Follow-up queue item 1, first bullet — done

The ADR 0003 model-picker divergence closed exactly as this document proposed:
take upstream's additive column, do not let it outrank transcript truth.
Per-session picks now live on the `sessions` row in upstream's `model` column
plus a `model_updated_at` column of ours, and the sidecar JSON is gone from the
code path. `pickSupersedesTranscript` is untouched.

- Commits `6d20dc2` (storage move) and `39610fd` (migration sentinel fix).
- [ADR 0025](../../decisions/0025-session-model-picks-live-in-the-database.md),
  which supersedes the storage half of ADR 0003 and records the three rejected
  alternatives.
- Verified on the 3002 branch-test harness against a snapshot of production,
  then on production itself: 26 legacy picks imported (claude 23, codex 3).
- Consequence for the outcome section above: its recorded deferral "no
  `sessions.model` column (only a comment in `migrations.ts`)" was correct at
  merge time and is no longer true.

### Also closed since the outcome section

- `CLAUDE.md` names `server/index.ts` as the backend entry; the Phase 3 leftover
  is resolved.
- Both `main`-side worktrees created for this work are removed and their
  branches deleted.

### Deliberately still open

Carried forward to the remaining-work document rather than resolved here:
`main` is unpushed; `9a9d47b`/`a4af8bf`/`658d536` still have static coverage
only; the `chore/upstream-1.37` branch and worktree are still in place; and two
of the three ADR reassessments (Codex App Server transport, ADR 0016) plus
queue items 2–5 have not been started.
