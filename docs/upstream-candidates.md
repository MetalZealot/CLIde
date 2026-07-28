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

- [ ] **Grep/Glob live result counts** (see `todo-done.md`, 2026-07-23, `931fc81`) — client-only
  `toolConfigs.ts` fix; affects every provider that surfaces Grep/Glob, nothing
  fork-specific. No upstream issue/PR search done yet — check `gh` before PRing.
- [ ] **Spurious logouts: transient-failure token wipe + no idle token refresh** (see
  `todo-done.md`, 2026-07-23) — all client-side, auth is provider-agnostic. Upstream overlap: the
  keep-alive + in-memory-token-sync halves are the same two gaps as **open PR
  siteboon/claudecodeui#980** ("refresh auth token for idle WS/SSE clients", closes #754,
  unmerged as of 2026-07-23 — checked via `gh pr view 980`); our fix is narrower (no WS
  expiry teardown / "session expired" LoginForm copy). The *first* half — `checkAuthStatus`
  clearing the token on any non-OK `/api/auth/user`, not just 401/403 — is **not** in #980
  and looks like a clean standalone PR. Decide: PR the standalone half, or wait and see if
  #980 lands and rebase onto it.
- [ ] **Skill-content leak + synthetic-notice/compact-summary rendering** (see
  `todo-done.md`, 2026-07-23) — the skill-injection filter directly fixes **open upstream issue
  siteboon/claudecodeui#1009** ("skill content rendered as user input in web UI",
  no fix PR as of 2026-07-23 — only a CodeRabbit auto-comment; checked via
  `gh issue view 1009` + PR search). Upstream's `normalizeMessage` has the identical
  gap (`isMeta`-only check misses the live stream's `isSynthetic`). The
  `isSystemNotice` banner + compact-summary collapsible parts are more
  fork-flavored UI, but the server-side filter is a clean standalone PR.
  **Strong second-PR candidate.**
- [ ] **Shimmer loop discontinuity** (see `todo-done.md`, 2026-07-23) — verbatim upstream bug:
  `git show upstream/main:{tailwind.config.js,src/shared/view/ui/Shimmer.tsx}` at v1.36.3
  is byte-identical to our pre-fix state, and upstream has four call sites (`Reasoning`,
  `PlanDisplay` ×2, `ActivityIndicator`), so it's visible on every provider. Upstream check
  2026-07-23: no issue or PR — searched issues for "shimmer" / "thinking animation" /
  "animation stutter" (zero hits) and PRs for "shimmer" (only fuzzy title matches, none
  about the animation). Two-line diff, no tests possible (pure CSS) — **easy PR, but
  cosmetic; low priority next to #1009.**

- [ ] **`<synthetic>` transcript-placeholder guard** (`422411f`) — upstream has the same
  unguarded `extractClaudeEventModel`; exposure there is display-only (their
  `resolveResumeModel` never reads the transcript), but the popup showing `<synthetic>`
  after an API error is a real upstream bug. Small, self-contained, test-covered.
  Upstream check 2026-07-17: no issue/PR mentions it (searched "synthetic", "selected
  model", "529", "active model"; read #981/#996/#998 bodies; confirmed by reading
  upstream/main's code). **Best first-PR candidate.**
  **PR SUBMITTED 2026-07-22: siteboon/claudecodeui#1056** — first upstream PR. Branch
  `fix/synthetic-model-guard` (off `upstream/main` v1.36.3, pushed to origin), worktree
  `../cloudcli-wt-synthetic-guard` kept alive for review feedback. The fork's test file
  couldn't be cherry-picked as-is (it was born with the per-session model-stack DI,
  `85ddd7e`/`5d9da84`, which isn't upstreamed), so the PR carries a rewritten
  `claude-models.test.ts` in upstream's own idiom (isolated-DB harness from
  `opencode-sessions.test.ts`, real `sessionsDb`): control + guard + all-synthetic
  fallback, 3/3 pass, guard tests confirmed failing on unpatched upstream/main. Run
  upstream tests with `npx tsx --tsconfig server/tsconfig.json --test <path>` (the root
  tsconfig maps `@/` to `src/`, not `server/`). Check off when merged.
- [ ] **AskUserQuestion comma-answer split** (`9450562`) — upstream-checked + test-covered
  (see `todo-done.md`, 2026-07-20: both files predate the fork, no issue/PR). **Ready.**
- [ ] **File-tree Move to… + touch context menu + drag-to-move**
  (`0efea7d`/`ad9efda`/`8747136`) — upstream-checked (see `todo-done.md`: #436/#444 merged
  the context menu but no move op, right-click-only) and verified live 2026-07-22.
  Server + client + i18n — the largest candidate; PR as one feature branch. **Ready.**
- [ ] **CSS minifier warnings fix** (`5cc4185`) — inherited from upstream, repros on
  `upstream/main` (~25 `[css-syntax-error]` build warnings from `@layer` re-emission).
  Self-contained `src/index.css` move. Upstream check 2026-07-22: no issue/PR (searched
  "css-syntax-error", "css warning", "build warnings", "minify" — only unrelated hits);
  corroborated in upstream/main code: `@layer components` spans `src/index.css` 566–805
  and all five `@media` blocks (608/686/702/763/769) still sit inside it. **Ready.**
- [ ] **Haiku effort-picker gap** (`7af88a7`) — re-verified on upstream/main 2026-07-22
  (v1.36.3): `claude-models.provider.ts:107` haiku entry still has no `effort` field, and
  `useChatProviderState.ts:319` returns `option.effort?.values ?? []` for catalogued
  models (provider fallback only runs for models absent from the catalog) — so Haiku
  still loses the picker. No issue/PR (searched "effort"; #943 is the merged effort
  feature that introduced the gap, #998 is model-select display, unrelated). **Ready.**
- [ ] **Pinch-to-zoom leak on Samsung/iOS** (`6a5e1c1`) — upstream check 2026-07-22:
  no issue/PR (searched "pinch", "zoom"; hits #954/#986/#923 are all *terminal touch
  scrolling*, unrelated); corroborated: upstream/main `index.html` still relies on the
  viewport meta alone (`user-scalable=no`), no gesture-suppression script — the leak
  repros on engines that ignore the meta. **Ready.**
- [ ] **Enter sends instead of newline on touch** (`d9c9d2b`) — **deferred; Grayson will
  rework this into a proper PR himself.** Upstream check 2026-07-22: no issue/PR for the
  touch case (searched "enter key", "newline", "enter send mobile"; adjacent: #58
  IME-composing Enter — already guarded via `isComposing` in their `handleKeyDown`; #74
  is Shell-side). Note discovered 2026-07-22: a **"Send by Ctrl+Enter" toggle already
  exists** on both upstream and this fork — Quick Settings panel
  (`quick-settings-panel/constants.ts` `INPUT_SETTING_TOGGLES`), i18n'd in all 10
  locales, framed as an IME-user feature — so "add a settings toggle" is already done;
  the open PR angles are the touch *default* (the `isTouchPrimary` carve-out) and/or
  surfacing the toggle in the main Settings modal for discoverability. Follow-up shipped
  2026-07-22 (`0551406`): on touch devices Quick Settings now swaps the (no-op there)
  Ctrl+Enter row for an opt-in **"Enter to send"** toggle (`enterToSend` pref, default
  off) — a future PR can bundle both as "correct default on touch + escape hatch",
  which preempts the "just use the existing setting" objection.
- [ ] **Shell toolbar hiding the CLI's last line** (`f8410b4`) — repro confirmed in
  upstream/main code 2026-07-22: `TerminalShortcutsPanel.tsx` still renders
  `pointer-events-none fixed inset-x-0 bottom-0 z-20` — a floating overlay the terminal
  reserves no space for. No issue/PR (searched "terminal last line", "toolbar terminal",
  "shortcuts toolbar"; PR #411 introduced the panel). **Caveat: the fork commit bundles
  the personal backdrop-blur removal** — a PR needs to keep upstream's `backdrop-blur-sm`
  or split the diff.
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
- [ ] **Per-session model stack** (`85ddd7e`/`5d9da84`/`8771eea`) — already tracked as
  model-picker #11. Blocked on live verification (#8) and on watching open PRs #996/#998,
  which overlap; if they merge, reconcile instead of PRing wholesale.
- [ ] The duplicate-session double-send (`TODO.md` Bugs section, unfixed) is almost certainly an
  upstream bug too — search upstream when we fix it.
- [ ] **WS reliability pair: half-open detection (`dd47ddd`) + run-scoped exactly-once
  replay (`55d8c44`, comment cleanup `7ae4aa2`).** Provider-neutral by construction
  (shared `/ws` gateway + run-registry layer), 17/17 tests, verified live on the fork
  2026-07-22 — including an unexpected scroll-smoothness win (see the replay-protocol
  item in `TODO.md` Bugs). Upstream
  check 2026-07-22 (searched issues "duplicate"/"scroll"/"reconnect", PRs
  "reconnect websocket"/"duplicate"): **this exact bug family is on file upstream.**
  Issue **#554** (open, 2026-03) "Mobile chat responses lost due to WebSocket reconnect
  race condition" = our silent-loss hole; **#567** (closed, 2026-04) "Duplicate
  responses on WebSocket reconnect — double token consumption" = our replay dup race;
  **#953** (open) "half-open sockets never reaped" is the shell-side sibling of the
  `dd47ddd` server sweep (open PR #960 covers shell only); **#769** (closed) added the
  server protocol pings that `dd47ddd`/ADR 0006 found insufficient for client-side
  detection (browsers answer them in the network stack). No open PR overlaps the chat
  path (#1016/#980 are token-refresh bugs). PR as one branch or two commits; ADR 0006
  can seed the description, and #554/#567 give it ready-made repro reports. **Ready
  pending the half-open-WS item's desktop/network-tab check — strongest-impact candidate.**

- [ ] **Claude re-login creating stray sidebar sessions** (`962ef7a`) — upstream runs the
  same `claude --dangerously-skip-permissions /login` in `ProviderLoginModal.tsx`, so
  every Claude re-login leaves a junk REPL transcript session there too, and their
  `isLoginCommand` fresh-PTY detection (`'auth login'`) never matches Claude either.
  One-file swap to `claude auth login`. Upstream check 2026-07-23: no issue/PR (searched
  issues "login session", PRs "auth login"; adjacent hits #551 cursor login, #1051 slash
  command rendering — different bugs); open PR #1035 already uses `claude auth status`,
  so the `auth` subcommand family is accepted there. Caveat for the PR: needs a CLI new
  enough to have `claude auth` (2.1.x). **Pending live verification on the fork.**

