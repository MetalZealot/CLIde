# Upstream candidates (PRs to siteboon/claudecodeui)

Split out of `TODO.md` on 2026-07-27 — it had grown to roughly half that file, and the
backlog is read far more often than this list. `TODO.md` remains the daily board and
links here; this file is the upstream-PR ledger.

Process (agreed 2026-07-17): every shipped fix gets tagged here as **upstreamable** or
**personal-preference** (colors, mobile layout taste, etc. stay in the fork). When
investigating a new bug, check `gh` for existing upstream issues/PRs *and record the
links (or "none found") in the bug's entry* — a keyword search finding nothing is weak
evidence (upstream has Chinese-language PRs and vague titles), so say how it was checked.
Grayson decides what actually gets PRed; nothing is submitted without an explicit go-ahead.

## Open candidates

Re-checked 2026-10-01 against `upstream/main` v1.37.3+37 (`dc7cb6c6`) by reading upstream
source; nothing was built or reproduced there.  `gh` searches were keyword-only, so "none
found" is weak evidence.  Upstream moved most client code from `src/components/` to
`src/modules/`, so every port is re-sited by hand.  Ranked by user impact, then by how
cleanly the fix stands alone.

- [~] **Any non-OK `/api/auth/user` logs the user out.** Branch `fix/auth-keep-token-on-server-error` (`fbe2f5dc`, pushed to origin), PR not yet opened. `AuthContext.tsx:236` calls `clearSession()` on every non-OK response, not only 401/403. Narrower than when the fork hit it: #1408 made `checkAuthStatus` run on page load only, not on every token rotation. Still deterministic in upstream's own `npm run dev` — Vite serves the page and answers 500 for `/api` while the backend is down (read from Vite's proxy source). Repro: log in, stop the backend, reload, start it again: still logged out. #980 (idle keep-alive) closed unmerged; that half is separate. **~5 lines — best first PR.**
- [ ] **Chat reconnect during a later run replays nothing** (`55d8c44`) **+ client-side half-open detection** (`dd47ddd`). #1206 closed #554 with per-run seq replay, but `chat-run-registry.service.ts` restarts `lastSeq` at 0 each run with no run id while the client keeps one only-rising counter per session. #1206 also added server ping reaping; the client still has no liveness probe (#953 open, #1270 related). Re-port onto upstream's registry and frame as a #1206 follow-up. **M — strongest impact.**
- [ ] **Two sessions streaming at once mix their text** (`81852c78`). One `accumulatedStreamRef`/`streamTimerRef` in `ChatInterface.tsx` serves every session, so each flush overwrites the other session's bubble. None found (searched "stream interleave", "streamTimerRef", "streaming background session"). **3 files.**
- [ ] **A tool result with no content would blank the chat** (`c91c70a6`). `formatToolResultContent` in `useChatMessages.ts` calls `.trim()` on `JSON.stringify(undefined)`, reachable only from the Claude normalizer. **No observed trigger:** zero content-less `tool_result` blocks across every local Claude transcript (searched 2026-10-02), and the Codex/Cursor/OpenCode normalizers always emit a string; the fork fix came from a code audit. Defensive only — not worth a PR without a repro.
- [ ] **Session list order comes from file mtime, so opening a session reorders it.** `readFileTimestamps` in `server/shared/utils.ts` still returns `stat().mtime`; Claude appends untimestamped rows on open. Fix reads the last timestamped row from a bounded tail. Open #1379 edits adjacent lines in the Claude synchronizer (conflict, not overlap). **4 files.**
- [ ] **Generate commit message leaves a phantom session** (`8c46645d`). The `queryClaudeSDK` call in `git.routes.ts` has no `persistSession: false`. The other half (always returning `chore: update files`) is covered by open #1430, which does not touch persistence. **Small, after #1430.**
- [ ] **A Claude session that moves (EnterWorktree, /cd) snaps back to its starting project** (`a138e031`). The synchronizer takes `cwd` from the first transcript row and `createSession` rewrites `project_path` on every sync. None found (#1170/#1379 concern `jsonl_path`). **4 files.**
- [ ] **Deleted sessions and projects linger in an open sidebar.** The watcher still ignores `unlink`; upstream's `pruneOrphanedSessions` runs only after a full sync; `mergeExpandedSessionPages` still copies stale "load more" pages back. **~3 files.**
- [ ] **Provider-id backfill re-runs on every start** (`5b164e36`). Reachable upstream: `detachProviderSession` nulls `provider_session_id`, so a restart before the next run stamps the app id and the run resumes a conversation that never existed. **2 files.**
- [ ] **Chat force-wraps every code block.** `src/index.css` still has `white-space: pre-wrap !important; word-break: break-all` on `.chat-message pre, code`; scope to `:not(pre) > code`. The fork's sidebar-swipe guard stays here. **1–3 files.**
- [ ] **Commit-hook rejection looks like nothing happened** (`6dc05b23`). `git.routes.ts` returns `error.message` and drops the `stderr` `spawnAsync` attaches; the panel logs it to the console only. **3 files, ~15 lines.**
- [ ] **Pasting a non-image file into the composer does nothing** (drag-and-drop accepts it) (`19ae4a9f`). `useChatComposerState.ts` paste handler filters on `image/`. Core fix is a few lines; the rejection banner is optional.
- [ ] **Running a built-in command from the command button wipes typed text** (`6aba1bc4`). `useSlashCommands.ts` calls `onExecuteCommand` without `preserveInput`. **1 file.**
- [ ] **Consecutive assistant replies hide their timestamps.** `MessageComponent.tsx` still guards the time with `!isGrouped`; #1391 added model labels but kept it. **1 file.**
- [ ] **HTML file preview is an ephemeral popup.** `CodeEditor.tsx` (now `src/modules/code-editor/`) still uses `window.open('', '_blank')` + `srcdoc`. Fork replacement is an isolated inline preview with authenticated asset rewriting. Live-accepted on Firefox, Samsung Internet and the installed PWA. **Medium.**
- [ ] **File browsing eagerly builds one recursive project tree.** `listProjectFiles` still calls depth-10 `buildFileTree`; no lazy-loading PR open (#755 closed, and its lexical containment must not be revived). [ADR 0049](decisions/0049-file-tree-loads-folders-not-projects.md). **Large; stage it: backend contract, then client migrations.**
- [ ] **File-tree Move to…, touch context menu, drag-to-move** (`0efea7d`/`ad9efda`/`8747136`). Upstream has no move route and its context menu is right-click only. **Largest feature PR, ~800 lines.**
- [ ] **Sidebar project stuck on "Loading sessions…" after quick load-more clicks** (`a7f831de`). `useSidebarController.ts` has the identical `shouldLoad`-inside-updater pattern; the race itself is inferred from the fork commit, not reproduced upstream. **1 file.**
- [ ] **Skills synced from claude.ai are missing from the skills list** (`e9ccd4ac`). `claude-skills.provider.ts` scans `~/.claude/skills` without recursing into `synced/`. The fork commit mixes in settings-key changes, so carve it out. **Medium.**
- [ ] **Grep/Glob live result counts** (`931fc81`). `toolConfigs.ts` still uses `numFiles || filenames?.length || 0` with no fallback to `content`. None found. **1 file + test.**
- [ ] **Claude re-login creates a stray sidebar session** (`962ef7a`). `ProviderLoginModal.tsx` still runs `claude … /login`, and `isLoginCommand` matches `'auth login'`, which Claude never hits. Open #1414 edits the same file (working directory only). Needs a CLI with `claude auth`. **XS.**
- [ ] **Haiku loses the effort picker** (`7af88a7`). The Haiku entry in `claude-models.provider.ts` has no `effort`, and `useChatProviderState.ts` returns `option.effort?.values ?? []` for catalogued models. **XS.**
- [ ] **~25 `[css-syntax-error]` minifier warnings** (`5cc4185`). All five `@media` blocks still sit inside `@layer components` in `src/index.css`. **XS.**
- [ ] **Shell shortcuts toolbar hides the CLI's last line** (`f8410b4`). `TerminalShortcutsPanel.tsx` is still a `fixed bottom-0` overlay the terminal reserves no space for. Keep upstream's `backdrop-blur-sm` in the PR. **XS.**
- [ ] **Pinch-to-zoom leaks on Samsung/iOS** (`6a5e1c1`). `index.html` still relies on `user-scalable=no` alone. **S.**
- [ ] **Shimmer loop jumps at the seam.** `tailwind.config.js` keyframes and `src/shared/ui/Shimmer.tsx` unchanged. Cosmetic. **2 files.**
- [ ] **Enter sends instead of newline on touch** (`d9c9d2b`, `0551406`). **Grayson is reworking this himself.** Open #1149 also tries it, bundled with a repo picker and on pre-move paths; mention it.

## Covered by someone else's open PR

- [ ] **Claude composer `default` inherits `permissions.defaultMode`.** `claude-runtime.provider.js` still skips `permissionMode` when it is `default`; open #1160 targets that exact line. Review or comment there rather than opening a duplicate.
- [ ] **Duplicate-session double-send** (still unfixed here, `TODO.md` Bugs). Upstream issue #1306; open #1420 fixes it. If it merges, cherry-pick it.

- [x] **Wrong password blanks the login screen.** The login route answers with the AppError envelope and the form rendered its `error` object as a React child. Upstream issues #1300/#1480; maintainer's open PR #1425 fixes it. Ported here with #1425's `readApiErrorMessage` logic in `src/components/auth/utils.ts`; take #1425's version when cherry-picking it.

## Fixed upstream (closed 2026-10-01)

- [x] **`<synthetic>` model guard** — fixed by #1207 (and #1391). Our PR **#1056 is still open and now redundant**; branch `fix/synthetic-model-guard` exists locally and on origin.
- [x] **AskUserQuestion comma-answer split** — #1249.
- [x] **Claude "logged out" after an idle access token** — #1206 now accepts a valid refresh token.
- [x] **Skill content rendered as user input** (#1009) — #1037 filters by content prefix; compact summaries by #1295. The fork's notice banner is fork UI.
- [x] **Dead files from upstream refactors** — removed by #1153 and #1206.
- [x] **Per-session model stack** — #1037 added a per-session model column and resume resolution. Only the fork's transcript-recency reconciliation is left; not worth a PR on its own.

## Fork-only and declined

- [x] **Compact Auto-Continue controls. Fork-only, personal preference.** Session mode stays in the header menu; the live notice offers enabling only when off with nothing waiting, and the scheduled bubble owns the waiting status.
- [x] **Follow installed CLIs and offer native updates in New Session. Fork-only policy.** Replaces CLIde's manual Codex runtime promotion with automatic compatibility checks and an explicit, idle-safe update action for Claude/Codex. [Decision](decisions/0061-follow-installed-provider-clis.md). No upstream defect or PR claimed.
- [x] **Collapsible asynchronous questions. Fork UI.** Async and blocking questions share a bounded, collapsible frame; async Send now / Queue delivery stays separate. [Rule](maps/orientation.md#14-nothing-has-a-published-place-around-the-composer). No upstream PR proposed.
- [x] **Phase-4 stable history bookmarks. Fork contract.** CLIde pages and refreshes against session-scoped snapshot bookmarks. Inspected upstream `5e73a49b` uses serialized offset requests with a bounded overlap/reconciliation retry; this is a different contract, not a claim that upstream lacks mitigation. No PR proposed. [Details](maps/chat-history-performance.md#phase-4-stable-history-bookmarks).
- [x] **Phase-3 unchanged-message rendering. Fork adaptation.** Upstream snapshot `5e73a49b` already includes projection reuse and memoized Markdown. CLIde adds complete refreshed-record comparison and stable tool groups around its existing store/pane contracts; no separate upstream PR proposed. [Evidence](maps/chat-history-performance.md#phase-3-unchanged-message-rendering).
- [x] **Phase-2 cache review corrections. Fork-only.** Fix dependency-discovery races, swallowed directory-read errors and unbounded identity bookkeeping introduced in CLIde's phase-2 implementation; regression coverage includes overlapping identity changes.
- [x] **Chat-history measurement harness is fork-only; cache hardening is upstreamable.** Synthetic fixtures, explicit pending targets and Browser/server baselines exercise CLIde's contracts. Phase 2 adapts upstream snapshot `5e73a49b`'s main-file cache but adds stable before/after revisions, dependent Claude subagent and Codex parent files, strict failure/partial-write exclusion, identity-safe concurrency and normalized-memory bounds. Those protections apply to upstream's cache independently of CLIde's later rendering plan.
- [x] **Find typing, cached-history visibility, and header Export overflow. Fork-only.** Repairs features introduced by the bottom-navigation branch; regression tests and synthetic browser checks pass; included in the bottom-navigation integration. [Review](plans/archive/2026-09-13-mobile-bottom-navigation.md#final-review).
- [x] **Bottom navigation before worktree selection. Fork-only, personal preference.** Keep the bar visible and disable worktree-dependent destinations; preserve keyboard hiding.
- [x] **Compact header Export panel. Fork-only, personal preference.** Matches the header kebab spacing and removes the fixed list-height cap from its form panel; accepted in the installed PWA.
- [x] **Chat browser preview and selected-page monitoring. Fork-only.** Extends CLIde's official-Playwright MCP monitor; the current `upstream/main` has no browser-use service at that module path (checked locally). Accepted in the installed PWA. No upstream PR proposed.
- [x] **Async-answer delivery recovery. Fork-only.** Lost acknowledgements release Sending on completion, reconnect, or timeout, preserve drafts, and refresh history without automatic retries. The async-answer hook is absent from local `upstream/main` (path checked 2026-09-08); this repairs the fork's own feature.
- [x] ~~**Account usage dashboard, truthful usage cache, and reset alerts.**~~ **Fork-only.**
  The provider-usage service/hook and CLIde's provider-neutral notification preferences do not
  exist on `upstream/main` (checked by path on 2026-08-16), so neither the stale-timestamp fix
  nor the dashboard/monitor can be separated into an upstream patch without first proposing
  the whole account-usage architecture.
- [x] ~~**Stop-button-becomes-queue trap** (`a236952`)~~ — **NOT an upstream bug;
  removed from candidates 2026-07-22 after tracing the fork's own history.** Chain:
  upstream has *two* Stop affordances — the composer submit button (flips to "Queue next
  message" once text is typed, `ChatComposer.tsx` ~289) AND the ActivityIndicator's
  floating-tab Stop (`canInterrupt && onAbort`). The fork's `5b9263b` activity-indicator
  redesign removed the tab's Stop ("stopping is handled by the composer's own stop
  button") — *that* created the trap, and `a236952` (same day) fixed the fork-made
  regression by giving Stop a permanent home in the activity row. On upstream/main the
  tab Stop stays visible while typing — `isInputFocused` only restyles border/shadow,
  never hides it — so upstream users always have a Stop. Fork-only. (Minor residue
  upstream: their composer Stop never checks `canInterrupt` — cosmetic, not PR-worthy.)
- [x] ~~**Settings information-architecture restructure**~~ (`19d078a`…P6, branch
  `feat/settings-ia`) — **deliberately fork-only; not a PR candidate.** Recorded here
  because it is the largest divergence this fork has taken in an upstream-heavy subtree,
  and a cherry-pick from upstream will meet it as conflicts rather than as a feature. What changed:
  the ten-tab pill bar became a registry-driven drill-down (root list → screen →
  sub-screen, max depth 2, desktop rail + detail), `src/components/settings/view/tabs/`
  is gone in favour of `view/screens/` + `view/primitives/`, the QuickSettings edge panel
  was deleted outright ([ADR 0019](decisions/0019-quicksettings-removal.md)), and
  providers were promoted to root. Cherry-pick guidance: upstream changes to a *tab* file
  usually have to be re-sited by hand into the matching screen; upstream changes to
  `src/components/mcp/`, `src/components/plugins/` and the `api-settings/sections/` are
  still ported nearly verbatim, since those were re-parented rather than rewritten. The
  design record is `docs/specs/archive/2026-07-28-settings-information-architecture.md`
  plus ADRs 0018–0021. Upstream check 2026-07-29: nothing proposes an IA change of this
  size — `gh issue list --search "settings redesign"` returned nothing, `"settings tabs"`
  returned only **#508** (a multi-tab right-side *panel*, unrelated), and
  `gh pr list --search "settings redesign" --state all` returned only per-feature
  redesigns inside the existing tabs (**#942** skills/MCP action controls, **#939** design
  tweaks, both merged). PRing this would mean maintaining a second, upstream-shaped
  variant of every screen.
