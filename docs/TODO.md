# Grayson's TODO

`- [ ]` open, `- [~]` partly done, `- [x]` done (move to [`todo-done.md`](todo-done.md) once verified).
`[x]` means merged, which is not the same as live-verified on the production port.
Sizes: **S** small/frontend-only, **M** medium, **L** large/needs design, **?** unknown until investigated.
When a session claims an item on a topic branch, tag it `— in progress on <branch>` and commit so other sessions see the claim.

**An item is one line: what the work is, plus a pointer.** The detail lives in its plan
([board](plans/README.md)), its map, its ADR, or its commit — not here. 400 characters is
enforced by `npm run check:docs`. Screenshots live in `UI Visual References/` (untracked,
main checkout only).

## Provider maintenance

- [~] **Codex App Server is the default interactive Chat transport; rollout verification remains.** Merged `cbf2960`. What's left is verification, not code — protocol drift, recovery, concurrency, resource use, installed-PWA matrix. Whether it earns its keep is [plan](plans/post-v1-37-adr-reassessment.md) item 2; design in [the map](maps/2026-07-25-codex-chat-transport-architecture.md). **L**
- [ ] **Split [the Claude SDK map](maps/claude-agent-sdk.md)** — 29 KB against a 24 KB cap, and its "Current CLIde mapping" section alone is 13 KB. Split native surface from CLIde mapping, then drop its entry from `SIZE_EXCEPTIONS` in `scripts/check-docs.mjs`. Its 2026-07-19 delta section was already folded into [the ledger](maps/claude-upgrade-ledger.md) on 2026-08-06. **S/M**
- [~] **Recurring provider SDK/CLI update process.** Cadence lives in [the maps README](maps/README.md). Open: Cursor and OpenCode maps, automated from/to reports, unknown-method diagnostics, a Claude SDK-vs-runtime version-pair check (both are deliberately unpinned), and making the typed capability registry validate the canonical map. **M recurring**
- [ ] **Assess upstream 1.37's worktree foundations.** Rejected as shipped; harvest `listWorktrees` and its test harness onto CLIde's model instead. Start from the immutable `v1.37.0` tag — none of it is in the merged tree. [Plan](plans/source-control-truthfulness.md). **L**
- [~] **The new-session model default still isn't durable.** Per-session picks landed (ADR 0025); the picker's *default* is still `localStorage` per provider (`useChatProviderState.ts`), so it doesn't follow you across browsers or devices. Any fix must keep ADR 0003's precedence — a stored value never outranks transcript evidence. **M**
- [ ] **Composer menu follow-ups from 1.37.** By benefit-per-risk: adopt `useComposerMenuAnchor` for the effort dropdown (CLIde duplicates ~60 lines and mispaints the first frame) **S**; replace the permission-mode cycling button with `ComposerPermissionMenu` **S/M**; `ComposerModelMenu` only as a *replacement* for the `/models` popup, never alongside — needs an ADR 0003 review. **M/L**

## Bugs

- [ ] **Paste is image-only — you can't paste a PDF or text file into the composer.** `handlePaste` (`useChatComposerState.ts`) keeps an `image/` filter and a `clipboardData.files` fallback that were never widened when upstream `06e7ee9` dropped the dropzone's `accept` map. Both filters go; `handleAttachmentFiles` already validates size and count. [upstreamable] **S**
- [ ] **The permission-mode picker's "Default" sends no mode at all**, so you silently inherit `settings.json`. Mechanism, the two layers that compound it, and the fix options: [the permission map](maps/provider-permission-modes.md). The real deliverable is the terminology pass — "default" means three different things across CLI, SDK, and picker. [upstreamable] **M**
- [ ] **Aborting a new session's first message orphans it into two sidebar rows.** A fourth, distinct id-mapping defect. Full mechanism and fix shape in [code anchors](maps/code-anchors.md) — it's a missing-trigger bug; the merge already exists and simply never runs. Careful tier: back up `auth.db` first. **M**
- [ ] **Cursor's permission-mode picker is mostly cosmetic** — `spawnCursor` never reads `permissionMode`. See [the permission map](maps/provider-permission-modes.md). **S/M**
- [ ] **Composer attachments silently reject oversized or wrong-type files.** No `onDropRejected`, and `imageErrors` renders only on accepted cards. Add rejection feedback without regressing the native Android picker path. [upstreamable] **S**
- [ ] Convo window: clicking the mode selector on desktop shifts the UI and buttons in the message box. **S**
- [ ] File Editor: long lines don't wrap — they push the left edge in and squish the conversation box. Should wrap by default. **S/M**
- [~] **Chat scroll-up pagination.** The accepted improvement merged (`12ede24`); branch retired 2026-08-04. Residual: the provider logo can still flash, and reaching the roof mid-load can still move the viewport. **Don't call pagination fixed.** Any fix needs a hands-on touch test on the real PWA — the headless harness gave a false PASS on a regression. **M/?**
- [ ] **A failed commit is completely silent.** Leading suspect is a `commit-msg` hook rejection leaving the index staged. Mechanism and the surrounding status-contract gaps: [the Git truth map](maps/repository-checkout-identity.md); it is Phase 0 item 1 of [the Source Control plan](plans/source-control-truthfulness.md) and blocks everything else there. [upstreamable] **S**
- [ ] Sidebar session names sometimes don't match those shown under `claude /resume`. **?**
- [ ] Shell view: no touch-drag scrolling — pinned to the bottom, can't scroll up through output. **M**
- [ ] **The Git branch switcher can wreck the working tree when the selected project is CLIde's own checkout** — the norm for anyone forking CLIde to hack on CLIde. `handleSwitchBranch` → `switchBranch` → the switch route runs a real `git checkout` on the running app's directory. Needs the self-hosting guard from [the plan](plans/source-control-truthfulness.md). [upstreamable] **M**
- [ ] **Duplicate-session double-send:** pressing send twice on a brand-new chat creates two sessions running the same message. `handleSubmit` (`useChatComposerState.ts`) awaits `POST /api/providers/sessions` before anything visible happens — no optimistic append, no processing state, and **no in-flight guard**. Observed 2026-07-16, two JSONLs 250 ms apart. **S/M**
- [ ] **Project force-delete orphans subagent transcripts on disk.** It unlinks each session's top-level `<slug>/<session-id>.jsonl`, but nested `<slug>/<session-id>/subagents/agent-*.jsonl` were never session rows, so they survive and keep the whole `<slug>/` tree alive against the non-recursive prune. Pre-existing, not caused by `0a738ae`. **S/M**
- [ ] **Browser MCP hardening** — snapshot-first, reference-based automation replacing selector and coordinate targeting. [Plan](plans/browser-mcp-hardening.md). **L**

## Mobile UX polish

- [ ] **Move the top tab strip to a bottom nav** — core tabs go in a bottom bar, design decided 2026-07-22 (ADR 0005). Supersedes the old "plugin buttons cramp the conversation title" item. **M**
- [ ] Kebab menu: add "Copy session ID" for the **current** session. The long-press sidebar menu covers other sessions; copying the id of the chat you're in still means hunting for it. **S**
- [ ] General condensing of UI elements and popup menus on mobile — some assets and text get cut off. **M — grab-bag, itemize as found**
- [~] **Sidebar Activity section and collapsed-rail indicator.** Activity ordering/duplication, persistent search, footer Archive, rail status, matched open/close icons, and a full-width mobile drawer trial are on `cloudcli-wt-sidebar-activity-section`; awaiting follow-up acceptance and merge. [ADR 0030](decisions/0030-sidebar-activity-persistent-search-footer-archive.md). **S**
- [ ] Sidebar: needs-action amber can stick if a background session's pending permission is answered in **another client** — it clears only on open or a `permission_cancelled` frame. Acceptable for now. **S**
- [ ] Tool-call copy button placement on mobile: always-visible since `05b176b`, but it spans the whole right edge of the tool row, which is heavy. Compact or fold into a row action; keep hover-reveal on desktop. **S/M — design decision first**
- [ ] **Git branch picker: label branches by remote (origin/ vs upstream/), grouped per remote.** Tier 1 (compact header dropdown) is done. Blocked on the structured-refs work in [the Source Control plan](plans/source-control-truthfulness.md), since the API currently strips remote namespaces. **M**

## Model picker follow-ups

This section is the complete outstanding model-picker list (2026-07-13 and 2026-07-16 reviews).

- [ ] **#8 PRIORITY — live-verify the per-session model stack** (`8771eea` + `5d9da84`). Three tests: (a) leak — A on Fable, B picks Haiku without sending, back to A must still send Fable; (b) stale-pick resume — popup pick X, then change via Shell `/model`, the newer choice must win; (c) fresh-session popup/header agreement. **S to run**
- [ ] **#15 — `currentProviderModel` is a second, unmaintained copy of the session's model.** `useChatProviderState.ts` reads `sessionModel ?? providerModels[provider]`; its comment claiming sessions show what they run with **is false**. `sessionModel` is written only by a popup pick, never read from the session, never cleared on switch. `slot.model` is the real value. **S/M**
- [ ] #2 — Shell `/model` stdout regex over-captures: picking Default shows the raw sentence "Default (recommended)" with no card highlight until the next turn. The `(.+?)\.?$` capture in `claude-models.provider.ts` takes too much. **S**
- [ ] #3 — 1M-context picks via Shell map to the non-1M alias: `resolveClaudeModelAlias` recognises only the literal `[1m]` token, so "Sonnet 4.5 (1M context)" highlights plain Sonnet. Fix in the same pass as #2 — same function, same test file. **S**
- [ ] #4 — `getCurrentActiveModel` reads and parses the entire session JSONL (4.5 MB on a long session) on every `/models` open, even when a fresh pick wins anyway. Stat the file and skip when the pick is newer than mtime, or read only the tail. **S/M**
- [ ] #7 — client-side race: a `fetchModel` GET in flight when the user makes a popup pick resolves *after* `setModel` and clobbers the optimistic slot value, possibly to null. Display-only — the server's pick-recency gate still resolves correctly. **S**
- [ ] #9 — decide "Default" pick semantics: since `8771eea` a session adopts its transcript's concrete alias from turn 2, so Default survives literally for exactly one turn before pinning. Decide whether that's intended. **S — decision**
- [ ] #10 — housekeeping: `pickSupersedesTranscript` lives in `claude-models.provider.ts` but is imported by the provider-agnostic `provider-models.service.ts`. The function is generic; move it. **S**
- [ ] #11 — upstreaming opportunity: upstream issue #981 and PR #996 hit the same bug family as the `85ddd7e`/`5d9da84`/`8771eea` stack. Consider a PR — needs Grayson's go-ahead. **S**
- [ ] #13 — pinned legacy models: **not pursuing** (2026-08-06, Grayson's call — older models lose access anyway). The alias-resolution trap it uncovered still bites any non-alias id and is recorded in [code anchors](maps/code-anchors.md).

## Shell sync

- [ ] **Shell shows a stale transcript snapshot; Disconnect/Restart don't reliably refresh it.** The Shell tab is a separate `claude --resume <id>` CLI in a server-side PTY: it renders the transcript as of process start and never live-tails web-chat turns, so *some* staleness is inherent. Two real defects sit behind that — separate them before fixing. Observed 2026-07-16. **M**

## Theming

- [ ] **Typography overhaul** — self-hosted Figtree + Iosevka, removing Merriweather and the Google Fonts CDN. [Plan](plans/typography-system.md). **M**
- [ ] Colour picker for accent colour; maybe a slight background hue shift. Light and dark variants. **M**
- [ ] Optional presets matching model-provider branding (Anthropic, OpenAI, Google). **S once the picker exists**

## Features (bigger ideas)

- [ ] **Register CLIde as a Web Share Target** — the only remaining way to get a native file-attach flow on Android. The composer's attachment control is at the ceiling of what `accept` can do (ADR 0026): eleven variants were probed on the installed PWA and an in-app source menu was built and reverted the same day, because it could only add a tap in front of the same chooser. **M**
- [ ] **Opt-in diagnostics flight recorder** under Settings. [Plan](plans/diagnostics-flight-recorder.md). **M**
- [ ] **Claude Code settings are almost entirely unreachable from CLIde** — ~140 settings-cascade keys, `/config` exposes ~50, CLIde exposes zero. The plumbing already exists: `settingSources` means `~/.claude/settings.json` is already in force in every session. Inventory: [the settings audit map](maps/2026-07-28-claude-code-settings-surface-audit.md). **L**
- [~] **Source Control: manage worktrees and integrate branches without leaving CLIde.** Identity and grouping shipped (ADRs 0016, 0028, 0029); truthfulness and lifecycle remain. [Plan](plans/source-control-truthfulness.md). **L**
- [ ] **True session syncing?** Using Claude Code directly doesn't list CLIde conversations. **? — needs investigation: where does each store sessions?**
- [~] **Codex plan usage: limit windows, credit/reset balance, account activity** — merged (`25952ea`) via the app-server's `account/rateLimits/read` and `account/usage/read`. Provider-neutral types keep Claude's spend/cap behaviour; API-key auth reports unsupported cleanly. Awaiting production restart verification. **M**
- [ ] **Subagent tracking in the UI.** Claude writes subagent transcripts to `<slug>/<session-id>/subagents/agent-<id>.jsonl`; the synchronizer *deliberately* skips them (`isSubagentTranscript`) so a spawned agent never becomes its own sidebar session. Within a session they're grouped under the parent via `parent_tool_use_id`. **M/L**
- [ ] **Does usage tracking count subagent tokens?** Answered — two systems, two behaviours. Plan-window % and credits come live from Anthropic's OAuth endpoint and **already include** agent tokens. The per-session context ring skips `isSidechain` rows by design. Remaining work is deciding whether to surface that difference. **S — decision**
- [ ] **Compaction is inherited but unsurfaced** — no `/compact`, no auto-compact signal, no boundary marker. The SDK already reads `autoCompactEnabled`/`autoCompactWindow` via `settingSources`, and CLIde already renders compaction summaries. What's missing is the command and the visible boundary. **M**
- [ ] `/context`: use the SDK breakdown's `gridRows` for a closer match to the CLI's square-grid panel. CLIde parses it away and rebuilds a stacked bar. **S**
- [ ] `/usage`: per-model cost breakdown like the CLI's — plan bars, a "This session" line, then a per-model table. **M**
- [ ] `!` shell mode in the conversation window. **M**
- [ ] Conversation "map" sidebar: a minimap of where user/assistant messages sit, tap to scroll. Depends on the scroll residuals above. **L**
- [~] **Double-tap Esc to stop mid-send and immediately edit.** The stop-and-recover half landed (`e5ede32` + `adab285`, ADR 0013). Remaining: (a) the Esc gesture itself — today it's the Stop button only; (b) editing a turn the provider *did* take, which is a rewind, not a retraction. **M**
- [ ] `/rewind` shipped; the broader audit of which Claude Code CLI commands CLIde is missing stays open, plus the Codex equivalent. **L**
- [~] **Rewind via the transcript.** Phase A (conversation-only) shipped and live-verified 2026-07-22 (`daea812`…`845ed24`), ADR 0007. `enableFileCheckpointing` is on so checkpoints accumulate for Phase B — file-state rewind — which is the remaining half. **L**
- [ ] Modern IDE features: `@`-ing files, highlighting editor text to reference in chat, following edits in realtime. **L**
- [ ] More IDE-like desktop layout: split panels for convo, files, and editor at once. **L**
- [ ] Landing page on entry — currently a blank page. Recent conversations with last-messaged time, token count, project, model. **M**
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
