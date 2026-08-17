# Grayson's TODO

`- [ ]` open, `- [~]` partly done, `- [x]` done (move to [`todo-done.md`](todo-done.md) once verified).
`[x]` means merged, which is not the same as live-verified on the production port.
Sizes: **S** small/frontend-only, **M** medium, **L** large/needs design, **?** unknown until investigated.

**An item is one line: what the work is, plus a pointer.** The detail lives in its plan
([board](plans/README.md)), its map, its ADR, or its commit — not here. 400 characters is
enforced by `npm run check:docs`. Screenshots live in `UI Visual References/` (untracked,
main checkout only).

## Provider maintenance

- [~] **Codex App Server is the default interactive Chat transport; rollout verification remains.** Merged `cbf2960`. Retained as the default 2026-08-13; rewind, fork and approvals are gated on it. What's left is verification, not code — protocol drift, recovery, concurrency, resource use, installed-PWA matrix. [Map](maps/2026-07-25-codex-chat-transport-architecture.md). **L**
- [~] **Codex's Agent screen is decluttered.** Merged `88543d1`; awaiting live verification. Runtime and transport left the account card for a sub-screen, then came back as one collapsible Runtime row matching Claude's; `agent.codex.runtime` now redirects. One state badge per installation, rollback on the previous install's own row, every API enum mapped to a sentence. **S**
- [ ] **Claude, Cursor and OpenCode MCP edits still erase native keys CLIde does not model.** Codex was fixed in `2a4a727`; the shared base now hands `buildServerConfig` the existing record, so each remaining adapter needs the same merge plus its own owned-key list. **S each**
- [ ] **Split [the Claude SDK map](maps/claude-agent-sdk.md)** — 29 KB against a 24 KB cap, and its "Current CLIde mapping" section alone is 13 KB. Split native surface from CLIde mapping, then drop its entry from `SIZE_EXCEPTIONS` in `scripts/check-docs.mjs`. Its 2026-07-19 delta section was already folded into [the ledger](maps/claude-upgrade-ledger.md) on 2026-08-06. **S/M**
- [~] **A usage reset notification fired at a real reset for the first time on 2026-08-17**, 11:50 MDT, on time — but the push only landed when the PWA was reopened, and the numbers behind it never refreshed. High-urgency push, post-reset retries and a reset-pending row shipped since; re-verify at the next boundary. [Archived plan](plans/archive/2026-08-17-usage-dashboard.md). **XS**
- [ ] **Claude's usage panel goes blind whenever the access token idle-expires.** The token lives 8h and only the SDK renews it, as a side effect of sending a message — so an idle night, or a limit that stops your session, refuses every usage fetch until you send one. Renewing it ourselves means writing `~/.claude/.credentials.json` and racing Claude Code's own rotation. **M/?**
- [~] **Recurring provider SDK/CLI update process.** Cadence lives in [the maps README](maps/README.md). Claude's registry-drift test and version-pair recorder landed ([ledger](maps/claude-upgrade-ledger.md)). Open: Cursor and OpenCode maps, automated from/to reports, unknown-method diagnostics, and making the typed capability registry validate the canonical map. **M recurring**
- [~] **Assess upstream 1.37's worktree foundations.** Rejected as shipped; harvest onto CLIde's model instead, from the immutable `v1.37.0` tag. The porcelain parser is harvested (`worktree-inventory.service.ts`); ahead/behind, dirty counts and last-commit reads are not. [Plan](plans/source-control-truthfulness.md). **L**
- [~] **The new-session model default still isn't durable.** Per-session picks landed (ADR 0025); the picker's *default* is still `localStorage` per provider (`useChatProviderState.ts`), so it doesn't follow you across browsers or devices. Any fix must keep ADR 0003's precedence — a stored value never outranks transcript evidence. **M**

## Bugs

- [ ] **Paste is image-only — you can't paste a PDF or text file into the composer.** `handlePaste` (`useChatComposerState.ts`) keeps an `image/` filter and a `clipboardData.files` fallback that were never widened when upstream `06e7ee9` dropped the dropzone's `accept` map. Both filters go; `handleAttachmentFiles` already validates size and count. [upstreamable] **S**
- [ ] **Aborting a new session's first message orphans it into two sidebar rows.** A fourth, distinct id-mapping defect. Full mechanism and fix shape in [code anchors](maps/code-anchors.md) — it's a missing-trigger bug; the merge already exists and simply never runs. Careful tier: back up `auth.db` first. **M**
- [ ] **Cursor's permission-mode picker is mostly cosmetic** — `spawnCursor` never reads `permissionMode`. See [the permission map](maps/provider-permission-modes.md). **S/M**
- [ ] **Composer attachments silently reject oversized or wrong-type files.** No `onDropRejected`, and `imageErrors` renders only on accepted cards. Add rejection feedback without regressing the native Android picker path. [upstreamable] **S**
- [ ] Convo window: clicking the mode selector on desktop shifts the UI and buttons in the message box. **S**
- [ ] File Editor: long lines don't wrap — they push the left edge in and squish the conversation box. Should wrap by default. **S/M**
- [~] **Chat scroll-up pagination.** Merged `12ede24`; branch retired 2026-08-04. Re-verified on the PWA 2026-08-11: the provider-logo flash is **gone**, viewport jump at the roof is reduced but still there. Target is smooth enough that no "Load All" button is wanted. Needs a hands-on touch test — the headless harness gave a false PASS once. **M/?**
- [ ] **A failed commit is completely silent.** Leading suspect is a `commit-msg` hook rejection leaving the index staged. Mechanism and the surrounding status-contract gaps: [the Git truth map](maps/repository-checkout-identity.md); it is Phase 0 item 1 of [the Source Control plan](plans/source-control-truthfulness.md) and blocks everything else there. [upstreamable] **S**
- [ ] Sidebar session names sometimes don't match those shown under `claude /resume`. **?**
- [ ] Shell view: no touch-drag scrolling — pinned to the bottom, can't scroll up through output. **M**
- [ ] **The Git branch switcher can wreck the working tree when the selected project is CLIde's own checkout** — the norm for anyone forking CLIde to hack on CLIde. `handleSwitchBranch` → `switchBranch` → the switch route runs a real `git checkout` on the running app's directory. Needs the self-hosting guard from [the plan](plans/source-control-truthfulness.md). [upstreamable] **M**
- [ ] **Duplicate-session double-send:** pressing send twice on a brand-new chat creates two sessions running the same message. `handleSubmit` (`useChatComposerState.ts`) awaits `POST /api/providers/sessions` before anything visible happens — no optimistic append, no processing state, and **no in-flight guard**. Observed 2026-07-16, two JSONLs 250 ms apart. **S/M**
- [ ] **Project force-delete orphans subagent transcripts on disk.** It unlinks each session's top-level `<slug>/<session-id>.jsonl`, but nested `<slug>/<session-id>/subagents/agent-*.jsonl` were never session rows, so they survive and keep the whole `<slug>/` tree alive against the non-recursive prune. Pre-existing, not caused by `0a738ae`. **S/M**
- [ ] **Browser MCP hardening** — snapshot-first, reference-based automation replacing selector and coordinate targeting. [Plan](plans/browser-mcp-hardening.md). **L**
- [ ] **The desktop row kebab overlaps the row's timestamp and provider logo.** `RowActionsTrigger` (`db5a92f`) renders on top of the right-hand metadata instead of displacing or hiding it while hovered. Found during live verification 2026-08-11. **S**
- [ ] **The usage popover is not translated.** `ContextBreakdownView` has no `useTranslation` at all (~12 visible strings: section titles, "Reserved", "Not counted — loaded on demand"), and `TokenUsageSummary` mixes `t()` with hardcoded English ("Context & Usage", "Session", window labels, "Resets at"). Every other chat surface is translated; ADR 0032 shipped it ahead of its keys. **S**

## Mobile UX polish

- [~] **One owner for safe-area insets.** `body.pwa-mode .fixed.inset-0` (index.css) offsets the app shell and 40 other overlays by `safe+8`; the drawer opts out inline; `#root`'s padding is dead against a fixed shell; nothing applies the bottom inset at shell level. Do this before the bottom nav. **M**
- [ ] **Move the top tab strip to a bottom nav** — core tabs go in a bottom bar, design decided 2026-07-22 (ADR 0005). Supersedes the old "plugin buttons cramp the conversation title" item. Blocked on the inset item above; `--mobile-nav-*`, `.mobile-nav-float` and `.chat-input-mobile` are dead tokens from an earlier attempt. **M**
- [ ] Kebab menu: add "Copy session ID" for the **current** session. The long-press sidebar menu covers other sessions; copying the id of the chat you're in still means hunting for it. **S**
- [ ] General condensing of UI elements and popup menus on mobile — some assets and text get cut off. **M — grab-bag, itemize as found**
- [ ] Sidebar: needs-action amber can stick if a background session's pending permission is answered in **another client**. Opening deliberately preserves unresolved attention; it clears only when this client receives `permission_cancelled` or the session is removed. Acceptable for now. **S**
- [ ] Tool-call copy button placement on mobile: always-visible since `05b176b`, but it spans the whole right edge of the tool row, which is heavy. Compact or fold into a row action; keep hover-reveal on desktop. **S/M — design decision first**
- [ ] **Git branch picker: label branches by remote (origin/ vs upstream/), grouped per remote.** Tier 1 (compact header dropdown) is done. Blocked on the structured-refs work in [the Source Control plan](plans/source-control-truthfulness.md), since the API currently strips remote namespaces. **M**

## Sidebar information architecture

Inventory and placement tiers: [the sidebar surface map](maps/sidebar-surface.md). Decide the tier before designing the control.

- [ ] **Adopt a tier-1 budget, or decide not to.** The map names three tiers; nothing yet says the permanent tier is fixed-size, so every new control still only has to clear "is this useful?" — which it always does. If adopted, it's an ADR. **S — decision, blocks the three below**
- [ ] **`sidebar.json` is ~40% untranslated in all nine non-`en` locales.** The `worktrees`, `sessionView`, `browseView` and `selection` blocks — 79 keys, every fork-built sidebar feature — exist only in `en` and render through `defaultValue`. **M**
- [ ] **A repository row tap does different things per breakpoint** — mobile `onClick` only expands, desktop also selects the project (`SidebarRepositoryItem`, `toggleProject` vs `selectAndToggleProject`). No comment says why. Either is defensible; the divergence being undocumented is not. Parity table: [the sidebar map](maps/sidebar-surface.md). **S**
- [ ] **The version is unreachable on mobile** — the OSS/version line is `hidden md:block` in the footer, and the version modal only opens from the update banner. A phone with no update pending can't see what it's running. **S**
- [ ] **Session count reads "3 sessions" on mobile and "3" on desktop** from the same `getSessionCountDisplay`. Pick one. **S**
- [ ] **Archive row actions are 28px at both breakpoints** — restore and delete are `h-7 w-7` in the shared archive tree, against 44px targets everywhere else on mobile, and they're the archive's only affordances. The shared-component risk the [parity table](maps/sidebar-surface.md) describes. **S**
- [ ] **Should the repository row carry a TaskMaster indicator at all?** `TaskIndicator` rendered nowhere for its whole life (`md:hidden` parent, `md:inline-flex` child) and the dead prop chain is gone; `getTaskIndicatorStatus` and the component remain. Restoring it means spending a tier-1 slot, so it waits on the budget item. **S**

## Model picker follow-ups

This section is the complete outstanding model-picker list (2026-07-13 and 2026-07-16 reviews).

- [ ] **Per-session effort tracking.** Existing sessions inherit the browser's last provider effort. Persist requested effort, resolve it behind newer transcript truth, and make `SessionStore` the one model/effort owner. [Plan](plans/session-effort-tracking.md). **M**
- [ ] **#8 PRIORITY — live-verify the per-session model stack** (`8771eea` + `5d9da84`). Three tests: (a) leak — A on Fable, B picks Haiku without sending, back to A must still send Fable; (b) stale-pick resume — popup pick X, then change via Shell `/model`, the newer choice must win; (c) fresh-session popup/header agreement. **S to run**
- [ ] **#15 — model has two client caches.** `useSessionStore.slot.model` drives sends while `useChatProviderState.sessionModel` drives display; both fetch `/active-model` and can disagree. Collapse them in the [per-session effort plan](plans/session-effort-tracking.md). **M — verify with #8**
- [ ] #2 — Shell `/model` stdout regex over-captures: a Default pick in the CLI's own picker shows the raw sentence "Default (recommended)" with no card highlight until the next turn. The `(.+?)\.?$` capture in `claude-models.provider.ts` takes too much. **S**
- [ ] #4 — `getCurrentActiveModel` reads and parses the entire session JSONL (4.5 MB on a long session) on every `/models` open, even when a fresh pick wins anyway. Stat the file and skip when the pick is newer than mtime, or read only the tail. **S/M**
- [ ] #7 — client-side race: a `fetchModel` GET in flight when the user makes a popup pick resolves *after* `setModel` and clobbers the optimistic slot value, possibly to null. Display-only — the server's pick-recency gate still resolves correctly. **S**
- [ ] #10 — housekeeping: `pickSupersedesTranscript` lives in `claude-models.provider.ts` but is imported by the provider-agnostic `provider-models.service.ts`. The function is generic; move it. **S**
- [ ] #11 — upstreaming opportunity: upstream issue #981 and PR #996 hit the same bug family as the `85ddd7e`/`5d9da84`/`8771eea` stack. Consider a PR — needs Grayson's go-ahead. **S**

## Shell sync

- [ ] **Shell shows a stale transcript snapshot; Disconnect/Restart don't reliably refresh it.** The Shell tab is a separate `claude --resume <id>` CLI in a server-side PTY: it renders the transcript as of process start and never live-tails web-chat turns, so *some* staleness is inherent. Two real defects sit behind that — separate them before fixing. Observed 2026-07-16. **M**

## Theming

- [ ] **Typography overhaul** — self-hosted Figtree + Commit Mono, removing Merriweather and the Google Fonts CDN. [Plan](plans/typography-system.md). **M**
- [ ] **Colour theming overhaul** — OKLCH tokens, monochrome/accent/full-colour presets with derived light and dark, a corner-radius dial, and provider accents. Supersedes the old accent-picker and provider-branding items. Cost is Phase 0: 2,335 hardcoded palette classes across 118 files bypass the token layer. [Plan](plans/colour-theming-system.md). **L**
- [ ] **Custom project icon**, second half of Customize after the colour strip. Pick an image from the project (or upload) via a modal reusing `useFileTreeData` + `isImageFile`, not a Files-tab detour — the tab has no pick mode and the cross-tab return trip is the real cost. Store a downscaled data URI on the project row, path as provenance only: a file in the repo breaks on worktrees. **M**

## Features (bigger ideas)

- [ ] **Register CLIde as a Web Share Target** — the only remaining way to get a native file-attach flow on Android. The composer's attachment control is at the ceiling of what `accept` can do (ADR 0026): eleven variants were probed on the installed PWA and an in-app source menu was built and reverted the same day, because it could only add a tap in front of the same chooser. **M**
- [ ] **Opt-in diagnostics flight recorder** under Settings. [Plan](plans/diagnostics-flight-recorder.md). **M**
- [ ] **Move `/status` into Settings → System → Diagnostics.** Replace its Chat-only modal with system-owned process details, remove redundant package/provider/model/health claims, and keep the command only as a hidden redirect. [Plan](plans/system-diagnostics.md). **M**
- [ ] **Claude Code settings are almost entirely unreachable from CLIde** — ~140 settings-cascade keys, `/config` exposes ~50, CLIde exposes zero. The plumbing already exists: `settingSources` means `~/.claude/settings.json` is already in force in every session. Inventory: [the settings audit map](maps/2026-07-28-claude-code-settings-surface-audit.md). **L**
- [~] **Source Control: manage worktrees and integrate branches without leaving CLIde.** Identity and grouping shipped (ADRs 0016, 0028, 0029); truthfulness and lifecycle remain. [Plan](plans/source-control-truthfulness.md). **L**
- [~] **Worktree manager selection and discovered-checkout targeting.** Session totals, compact row menus, registered-only batch Archive/Delete, and Add-before-select are built for isolated live verification. [ADR 0035](decisions/0035-discovered-checkout-selection-registers-first.md). **M**
- [ ] **True session syncing?** Using Claude Code directly doesn't list CLIde conversations. **? — needs investigation: where does each store sessions?**
- [ ] **Subagent tracking in the UI.** Claude writes subagent transcripts to `<slug>/<session-id>/subagents/agent-<id>.jsonl`; the synchronizer *deliberately* skips them (`isSubagentTranscript`) so a spawned agent never becomes its own sidebar session. Within a session they're grouped under the parent via `parent_tool_use_id`. **M/L**
- [ ] **Does usage tracking count subagent tokens?** Answered — two systems, two behaviours. Plan-window % and credits come live from Anthropic's OAuth endpoint and **already include** agent tokens. The per-session context ring skips `isSidechain` rows by design. Remaining work is deciding whether to surface that difference. **S — decision**
- [ ] **Compaction is inherited but unsurfaced** — no `/compact`, no auto-compact signal, no boundary marker. The SDK already reads `autoCompactEnabled`/`autoCompactWindow` via `settingSources`, and CLIde already renders compaction summaries. What's missing is the command and the visible boundary. **M**
- [ ] `/context`: use the SDK breakdown's `gridRows` for a closer match to the CLI's square-grid panel. CLIde parses it away and rebuilds a stacked bar. **S**
- [ ] `/usage`: per-model cost breakdown like the CLI's — plan bars, a "This session" line, then a per-model table. **M**
- [ ] **`/stats`: put the SDK's account usage stats in Context & Usage.** Probe `usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET()` with `scripts/verify-context-usage-sdk.ts` first — is `behaviors` populated on this account? The [live gate](plans/archive/2026-08-17-claude-sdk-0.3.233-upgrade.md) is the constraint: an idle surface can't hold a query open. **M/?**
- [ ] `!` shell mode in the conversation window. **M**
- [ ] Conversation "map" sidebar: a minimap of where user/assistant messages sit, tap to scroll. Depends on the scroll residuals above. **L**
- [~] **Double-tap Esc to stop mid-send and immediately edit.** The stop-and-recover half landed (`e5ede32` + `adab285`, ADR 0013). Remaining: (a) the Esc gesture itself — today it's the Stop button only; (b) editing a turn the provider *did* take, which is a rewind, not a retraction. **M**
- [ ] `/rewind` shipped; the broader audit of which Claude Code CLI commands CLIde is missing stays open, plus the Codex equivalent. **L**
- [~] **Rewind via the transcript.** Phase A (conversation-only) shipped and live-verified 2026-07-22 (`daea812`…`845ed24`), ADR 0007. `enableFileCheckpointing` is on so checkpoints accumulate for Phase B — file-state rewind — which is the remaining half. **L**
- [ ] Modern IDE features: `@`-ing files, highlighting editor text to reference in chat, following edits in realtime. **L**
- [ ] More IDE-like desktop layout: split panels for convo, files, and editor at once. **L**
- [ ] **Composer prompt stash and lossless draft handoff.** Project selection can overwrite pre-project text, while New Session can detach visible text from its saved project draft. Preserve both before adding a `+` popover for Attach, Stash, and Stashed prompts. [Plan](plans/composer-prompt-stash.md). **M — design agreement first**
- [ ] **Scheduled messages.** When usage runs out you often want work to resume the moment it resets, mid-task. A "schedule send" in the composer; also useful for follow-ups. **M/L**
- [ ] **Background-session notifications** — in-app banner plus header roll-up dot, and stop the redundant OS notification while you're looking at the session. [Plan](plans/background-session-notifications.md). **M**
- [ ] Voice Settings: the Base URL field is editable but the server ignores any client value (`resolveConfig` always uses `ENV.baseUrl`). Hide it, or make it a read-only "configured on server" indicator driven off `/api/voice/health`. Provider-agnostic, so it stays correct for OpenAI/Groq users. **S**
- [~] **Half-open WebSocket: dead Stop, frozen "thinking", then a wall of missed messages.** All four parts of the fix are implemented (`dd47ddd`, ADR 0006). What remains is deciding whether the watchdog keeps its permissive "any frame" rule or moves to matched echoes: [plan](plans/websocket-liveness.md). **M**
- [ ] **Adopt upstream #1050's chat-scroll perf fixes** (complementary to `55d8c44`). Three causes still present here: `normalizedToChatMessages` mints new objects every ~100 ms flush, defeating `React.memo`; `Markdown`/`CodeBlock` are unmemoized; and the third from the issue. Render-side, distinct from the pagination item above. **M**

## Agent context in worktrees

- [x] **Worktree sessions started with zero memory.** Memory is keyed by absolute cwd with no fallback: main had 30 facts, every worktree had 0. `setup-worktree.sh` now symlinks the worktree's `~/.claude/projects/<slug>/memory` to main's; verified by probe. All four live worktrees backfilled. **S**
- [ ] **Host `CLAUDE.md` still doesn't reach worktree sessions.** The stub only *points* at it, and `@` imports outside the project tree do not resolve (both absolute and `../` forms tested). Only fix left is `setup-worktree.sh` inlining main's host sections into the real stub — accepts drift. **S**
- [ ] **Two missing agent guardrails in `AGENTS.md`.** A session drove Browser into its own live session and used its Shell; the same session asked for and typed Grayson's password into a login form, against the existing "the user clicks through, not you" rule. Add both as explicit invariants. **S**

## Upstream candidates (PRs to siteboon/claudecodeui)

Moved to [`upstream-candidates.md`](upstream-candidates.md) on 2026-07-27 — the ledger of
fixes tagged **upstreamable**, their issue/PR checks, and PR status. Nothing is PRed without
Grayson's explicit go-ahead.

## Done

Moved to [`todo-done.md`](todo-done.md) on 2026-07-27. Append finished items there and delete
them from the sections above.
