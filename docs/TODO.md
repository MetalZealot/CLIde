# Grayson's TODO

`- [ ]` open, `- [~]` partly done, `- [x]` done (move to [`todo-done.md`](todo-done.md) once verified).
`[x]` means merged, which is not the same as live-verified on the production port.
Sizes: **S** small/frontend-only, **M** medium, **L** large/needs design, **?** unknown until investigated.

**An item is one line: what the work is, plus a pointer.** The detail lives in its plan
([board](plans/README.md)), its map, its ADR, or its commit — not here. 400 characters is
enforced by `npm run check:docs`. Screenshots live in `UI Visual References/` (untracked,
main checkout only).

## Operations

- [~] **Repo cleanup: CLIde presents and builds as itself.** New README, one CI workflow; upstream's desktop, Docker and release tooling, CloudCLI's plugin system and non-English locales removed on `chore/repo-cleanup`. Awaiting Grayson's check on the branch-test slot, then merge. Refusals in [the sync map](maps/upstream-sync.md). **M**

## Provider maintenance

- [~] **Rebuild the agent runtime: long-lived Claude sessions, one typed wire, a home for every SDK message.** Grayson's priority, exempt from the plan size cap. Phases 1 and 1b built, awaiting Grayson's checks after a deploy. Absorbs the mid-turn controls, streaming, slash menu, orphaned-first-message and live `tool_use_result` items. [Plan](plans/agent-runtime-rebuild.md). **L**
- [ ] **The last six backend JavaScript files become TypeScript.** Four provider runtimes, the notification orchestrator and Codex token usage; `checkJs` is off, so `typecheck` reads none of them. Codex first, Claude last. [Plan](plans/server-typescript-conversion.md). **L**
- [ ] **Tools pages can show plugins and skills but not control them.** Turn plugins/skills/connectors on and off from CLIde, then optionally browse each provider's marketplace, add a marketplace, and install. Writes each provider's own config; land the native-key MCP fix below first. Follows [the finished Tools plan](plans/archive/2026-09-29-provider-tools-page.md). **L — design first**
- [ ] **Multiple Codex clients can claim the same native thread.** Add App Server-native Chat compaction and cross-process single-writer coordination so Shell, another CLIde service, or an external client cannot strand Chat behind raw writer errors. [Plan](plans/codex-chat-shell-ownership.md). **L — design agreement first**
- [ ] **Claude, Cursor and OpenCode MCP edits still erase native keys CLIde does not model.** Codex was fixed in `2a4a727`; the shared base now hands `buildServerConfig` the existing record, so each remaining adapter needs the same merge plus its own owned-key list. **S each**
- [ ] **Split [the Claude SDK map](maps/claude-agent-sdk.md)** — 29 KB against a 24 KB cap, and its "Current CLIde mapping" section alone is 13 KB. Split native surface from CLIde mapping, then drop its entry from `SIZE_EXCEPTIONS` in `scripts/check-docs.mjs`. **S/M**
- [ ] **Claude's usage panel goes blind whenever the access token idle-expires.** The token lives 8h and only the SDK renews it, as a side effect of sending a message — so an idle night, or a limit that stops your session, refuses every usage fetch until you send one. Renewing it ourselves means writing `~/.claude/.credentials.json` and racing Claude Code's own rotation. **M/?**
- [ ] **Composer message recall (upstream `#1238`).** ↑ in the composer walks previously sent messages; no provider work needed. The last open "build" verdict. [Plan](plans/upstream-feature-harvest.md), [map](maps/upstream-sync.md). **S**
- [~] **Recurring upstream-fork sync process.** `npm run check:upstream` reports the span and which commits are ruled on; verdicts and the ledger live in [the map](maps/upstream-sync.md). Open: five commits unassessed as of 2026-09-23. **M recurring**
- [~] **Recurring provider SDK/CLI update process.** `npm run check:providers` reports versions, notes, `.d.ts` diffs and Codex protocol counts for all four providers; cadence in [the maps README](maps/README.md). Open: Cursor/OpenCode maps, blocked until either is installed; unknown-method diagnostics; the typed capability registry validating the canonical map. **M recurring**
- [~] **Assess upstream 1.37's worktree foundations.** Rejected as shipped; harvest onto CLIde's model instead, from the immutable `v1.37.0` tag. The porcelain parser is harvested (`worktree-inventory.service.ts`); ahead/behind, dirty counts and last-commit reads are not. [Plan](plans/source-control-truthfulness.md). **L**
- [~] **Per-browser settings don't follow you.** The new-chat model seed and Claude's Allowed Tools sit in `localStorage`, per device and site; Allowed Tools skip Ask-mode prompts unseen elsewhere. Keep ADRs 0003/0025. **M**
- [ ] **Codex's thread store moved and CLIde still reads the old path.** `~/.codex/session_index.jsonl` is gone; the newest `state_*.sqlite` `threads` table holds `title`, `name`, `archived`, `model`, effort. Name lookup gets nothing, then a watcher race titles from the first agent reply. Use `name`, else the first prompt, never an agent reply. [Map](maps/codex-cli-sdk-app-server.md). **M**
- [ ] **Claude 0.3.258 left four cheap wins unclaimed.** `ambient` marks housekeeping tasks hosts should hide from activity indicators; `ModelUsage.thinkingTokens` is unread; `getContextUsage({detail:'summary'})` skips the per-category token-count calls; `resource_links` reports a backgrounded MCP task's files. [Ledger](maps/claude-upgrade-ledger.md). **S each**
- [ ] **Codex 0.152.1 exposes two limits CLIde never sets.** App-server clients can configure `thread/shellCommand` timeouts past an hour, so long commands currently sit on the default deadline; individual MCP tools take an `output_token_limit` truncated consistently across resumes. [Map](maps/codex-cli-sdk-app-server.md). **S each**
- [ ] **Claude's `--restricted` mode has no CLIde equivalent.** `CLAUDE_CODE_RESTRICTED=1` drops the command-running tools and `WebFetch`, holds file tools to the working directory, refuses `bypassPermissions`, and ignores user/project/local settings. A runtime-enforced narrow mode needs a capability-flag decision before it reaches shared UI. **M — design first**

## Browser

- [ ] **Record short Browser clips an agent can inspect.** Start/stop within one turn, frames for the agent via ffmpeg; no timer or download in the first version. [Plan](plans/browser-video-clips.md). **M — Phase 0 proof first**

## Bugs

- [~] **Background shells died when a Claude turn ended.** The run now holds its input open until background tasks settle, then the agent reports back; 30-min silence backstop. Fork reimplementation of upstream `#1347`'s hold; its background-task strip and per-task stop are not taken. **S — awaiting live check**
- [ ] **New Claude sessions ignore `permissions.defaultMode`**; a one-off Bypass carries into the next session. [Plan](plans/claude-permission-default.md). **S/M**
- [ ] **Rewinding to the first message lists a second session.** It starts fresh and the original stays listed. **S**
- [ ] **Auto-Continue sends with no permission mode.** Its `usage-reset` row has no options, so the turn runs in `default` and approvals time out. Store the mode when arming. **S**
- [ ] **Claude thoughts come back empty because CLIde never requests summaries.** Passing `thinking: { display: 'summarized' }` returned text where the current run returns 0 characters (probe, 2026-09-24). Check adaptive vs fixed-budget models first. [Map](maps/tool-activity-stream.md#settings-that-decide-what-is-sent). **S**
- [ ] **Codex history never flags a failed command.** Reloaded `exec` results never set `isError`; 18 failed commands in one sample came back unflagged. The rollout's `CommandExecution` records carry exit code and duration. [Map](maps/tool-activity-stream.md). **S**
- [ ] **Cursor `ApplyPatch` edits show 0/0 line counts.** It is renamed `Edit` but only `patch` is filled. Source only; no Cursor session to test. [Map](maps/tool-activity-stream.md). **S**
- [ ] **OpenCode live tool rows may be empty.** Live parsing reads top-level `tool`/`input`/`output`; history nests them under `state`. Unverified — needs one real OpenCode run. [Map](maps/tool-activity-stream.md). **S/?**
- [ ] **Claude's live stream drops `tool_use_result`.** The SDK sends snake_case; `normalizeMessage` reads camelCase, so search counts and diffs appear only after reload. Source only. [Map](maps/tool-activity-stream.md). **S**
- [ ] **Aborting a new session's first message orphans it into two sidebar rows.** A fourth, distinct id-mapping defect. Full mechanism and fix shape in [code anchors](maps/code-anchors.md) — it's a missing-trigger bug; the merge already exists and simply never runs. Careful tier: back up `auth.db` first. **M**
- [ ] **Cursor's permission-mode picker is mostly cosmetic** — `spawnCursor` never reads `permissionMode`. See [the permission map](maps/provider-permission-modes.md). **S/M**
- [ ] Convo window: clicking the mode selector on desktop shifts the UI and buttons in the message box. **S**
- [ ] File Editor: long lines don't wrap — they push the left edge in and squish the conversation box. Should wrap by default. **S/M**
- [~] **Chat history loading, scrolling and Find remain slow.** Phases 1–6, 8 and 9 complete. Position faults fixed (`61440326`, `3a83002a`); a walk now checks position and per-step work in both scroll modes. Next: cut the ~50 ms fixed frame cost of scroll restoration, then load history ahead. [Plan](plans/chat-history-performance.md), [evidence](maps/chat-history-performance.md). **L**
- [ ] **A failed commit is completely silent.** Leading suspect is a `commit-msg` hook rejection leaving the index staged. Mechanism and the surrounding status-contract gaps: [the Git truth map](maps/repository-checkout-identity.md); it is Phase 0 item 1 of [the Source Control plan](plans/source-control-truthfulness.md) and blocks everything else there. [upstreamable] **S**
- [ ] Sidebar session names sometimes don't match those shown under `claude /resume`. **?**
- [ ] Shell view: no touch-drag scrolling — pinned to the bottom, can't scroll up through output. **M**
- [ ] **The Git branch switcher can wreck the working tree when the selected project is CLIde's own checkout** — the norm for anyone forking CLIde to hack on CLIde. `handleSwitchBranch` → `switchBranch` → the switch route runs a real `git checkout` on the running app's directory. Needs the self-hosting guard from [the plan](plans/source-control-truthfulness.md). [upstreamable] **M**
- [ ] **Duplicate-session double-send:** pressing send twice on a brand-new chat creates two sessions running the same message. `handleSubmit` (`useChatComposerState.ts`) awaits `POST /api/providers/sessions` before anything visible happens — no optimistic append, no processing state, and **no in-flight guard**. Observed 2026-07-16, two JSONLs 250 ms apart. **S/M**
- [ ] **Project force-delete orphans subagent transcripts on disk.** It unlinks each session's top-level `<slug>/<session-id>.jsonl`, but nested `<slug>/<session-id>/subagents/agent-*.jsonl` were never session rows, so they survive and keep the whole `<slug>/` tree alive against the non-recursive prune. Pre-existing, not caused by `0a738ae`. **S/M**

## Mobile UX polish

- [ ] **Single-row composer on mobile**, settings in a sheet. [Plan](plans/composer-single-row.md). **M — probe first**
- [~] **Context & Usage popover redesign, with a Claude prompt-cache countdown.** Big session %, cache pill, auto-compact/breakdown buttons, limits as open columns with pace ticks (probe variant F, `~/Projects/mockups/usage-popover`); breakdown is its own view. Tests pass; awaiting phone check. **M**

- [ ] **Consider floating New Session above the sidebar footer instead of inside it.** `--app-footer-height` is 60px, accepted with the bottom nav; ChatGPT and T3 both float the compose action over the list rather than embedding it in a solid bar. Revisit if the button misfires near the gesture strip. **S — on trial, don't act unprompted**
- [ ] General condensing of UI elements and popup menus on mobile — some assets and text get cut off. **M — grab-bag, itemize as found**
- [ ] Sidebar: needs-action amber can stick if a background session's pending permission is answered in **another client**. Opening deliberately preserves unresolved attention; it clears only when this client receives `permission_cancelled` or the session is removed. Acceptable for now. **S**
- [ ] Tool-call copy button placement on mobile: always-visible since `05b176b`, but it spans the whole right edge of the tool row, which is heavy. Compact or fold into a row action; keep hover-reveal on desktop. **S/M — design decision first**
- [ ] **Git branch picker: label branches by remote (origin/ vs upstream/), grouped per remote.** Tier 1 (compact header dropdown) is done. Blocked on the structured-refs work in [the Source Control plan](plans/source-control-truthfulness.md), since the API currently strips remote namespaces. **M**

## Sidebar information architecture

Inventory and placement tiers: [the sidebar surface map](maps/sidebar-surface.md). Decide the tier before designing the control.

- [ ] **Audit fifteen compact controls across eleven locations in context** — including repository New Session/kebab and session kebab in touch-driven Desktop View. Being below 44px is not itself a defect: verify WCAG size/spacing, collisions, adjacency, consequence, and Samsung usability before changing one. Table and helper in [the sidebar map](maps/sidebar-surface.md). **S**
- [ ] **A repository row tap does different things per breakpoint** — mobile `onClick` only expands, desktop also selects the project (`SidebarRepositoryItem`, `toggleProject` vs `selectAndToggleProject`). No comment says why. Either is defensible; the divergence being undocumented is not. Parity table: [the sidebar map](maps/sidebar-surface.md). **S**

## Model picker follow-ups

This section is the complete outstanding model-picker list (2026-07-13 and 2026-07-16 reviews).

- [~] **Default effort follows Claude Code's per-model setting.** The picker shows the level Default runs at, badged, with no separate Default stop; new chats always start on it; Settings › Claude › Default Effort writes the key the CLI slider saves. Awaiting a phone check. [ADR 0063](decisions/0063-effort-default-is-claude-codes-own-setting.md). **M**
- [~] **Fast mode switch in the model menu, per session, for Claude Opus and Codex.** Browser-checked on 3002; no live fast send yet (Claude needs usage credits). Stored in `sessions.fast_mode`. **M**
- [ ] #2 — Shell `/model` stdout regex over-captures: a Default pick in the CLI's own picker shows the raw sentence "Default (recommended)" with no card highlight until the next turn. The `(.+?)\.?$` capture in `claude-models.provider.ts` takes too much. **S**
- [ ] #4 — `getCurrentActiveModel` reads and parses the entire session JSONL (4.5 MB on a long session) on every `/models` open, even when a fresh pick wins anyway. Stat the file and skip when the pick is newer than mtime, or read only the tail. **S/M**
- [ ] #11 — upstreaming opportunity: upstream issue #981 and PR #996 hit the same bug family as the `85ddd7e`/`5d9da84`/`8771eea` stack. Consider a PR — needs Grayson's go-ahead. **S**

## Shell sync

- [ ] **A new Codex, Cursor or OpenCode Shell still detaches from its sidebar row.** They cannot be handed an id at launch, so the PTY stays filed under no session; only Claude gets the minted id (`shell-websocket.service.ts`). **M**
- [ ] **Shell shows a stale transcript snapshot; Disconnect/Restart don't reliably refresh it.** The Shell tab is a separate `claude --resume <id>` CLI in a server-side PTY: it renders the transcript as of process start and never live-tails web-chat turns, so *some* staleness is inherent. Two real defects sit behind that — separate them before fixing. Observed 2026-07-16. **M**

## Theming

- [ ] **Maybe: pick the activity-dot motions in Settings**, as Activity Messages has its own settings. The round-4 probe holds 13 Working/Thinking motions to choose from. **S/M**
- [ ] **Try the CLIde logo as the activity indicator.** Light runs along the logo's own band (round-3 probe, family H); liked, "with a few tweaks", after living with the dots. Reuses the dots' state-to-state blending. **S/M**
- [~] **Chat's non-message text uses two sizes and one grey.** Activity rows and metadata (timestamps, notices, citations, divider) become `text-chat-activity`/`text-chat-meta` in muted grey, scaling with reading size. Awaiting a look on phone and desktop. [ADR 0062](decisions/0062-chat-metadata-scales-with-reading-size.md). **S**
- [ ] **Older standalone tool panels adopt the chat text roles.** To-do and task lists, plans and question forms still mix 9–13px and raw greys. [ADR 0062](decisions/0062-chat-metadata-scales-with-reading-size.md). **S/M**
- [ ] **Colour theming overhaul** — OKLCH tokens, monochrome/accent/full-colour presets with derived light and dark, a corner-radius dial, and provider accents. Supersedes the old accent-picker and provider-branding items. Cost is Phase 0: 2,335 hardcoded palette classes across 118 files bypass the token layer. [Plan](plans/colour-theming-system.md). **L**
- [ ] **Custom project icon**, second half of Customize after the colour strip. Pick an image from the project (or upload) via a modal reusing `useFileTreeData` + `isImageFile`, not a Files-tab detour. Store a downscaled data URI on the project row, path as provenance only: a file in the repo breaks on worktrees. **M**

## Features (bigger ideas)

Queued work first. Below the rule is **someday**: real ideas, but nothing here is
started, sliced, or blocking anything — skip it unless you are deliberately picking
new work.

- [~] **Generated HTML project dashboard.** V1 renders plans, backlog shape, maps and ADRs into one page; its HTML-preview prerequisite is live-accepted. Paused deliberately until the page has been used for real work. [Plan](plans/project-dashboard.md). **M**
- [ ] **Opt-in diagnostics flight recorder** under Settings. [Plan](plans/diagnostics-flight-recorder.md). **M**
- [ ] **Move `/status` into Settings → System → Diagnostics.** Replace its Chat-only modal with system-owned process details, remove redundant package/provider/model/health claims, and keep the command only as a hidden redirect. [Plan](plans/system-diagnostics.md). **M**
- [~] **Source Control: manage worktrees and integrate branches without leaving CLIde.** Identity and grouping shipped (ADRs 0016, 0028, 0029); truthfulness and lifecycle remain. [Plan](plans/source-control-truthfulness.md). **L**
- [ ] **Four Claude command surfaces sit behind the CLI's** — the slash menu (11 hardcoded vs 56 live), `/context`'s grid, `/usage`'s per-model costs, and `/stats`. Sized and detailed in [the command surface map](maps/claude-command-surface.md); the slash menu is the cheapest. **S–M each**
- [ ] **Codex history shows edits as raw `exec` source.** An apply_patch, `write_stdin` or `web__run` call reloads as an untranslated `exec` row, not `FileChanges`; the activity parses edits client-side, but other opened calls show source text. Translate it in the Codex adapter. [Map](maps/tool-activity-stream.md). **S**
- [ ] **A turn that edited files ends with a changed-files card.** Codex, Cursor and T3 Code each close an editing turn with the files touched, their `+N −M` counts and a Review action; CLIde has none. After tool-activity phase 4. [UI standards](maps/ui-standards.md#tool-activity-rows). **M**
- [~] **Rewind via the transcript.** Phase A (conversation-only) shipped and live-verified 2026-07-22 (`daea812`…`845ed24`), ADR 0007. `enableFileCheckpointing` is on so checkpoints accumulate for Phase B — file-state rewind — the remaining half, waiting on runtime rebuild phase 7. **L**
- [ ] **Composer prompt stash and lossless draft handoff.** Project selection can overwrite pre-project text, while New Session can detach visible text from its saved project draft. Preserve both before adding a `+` popover for Attach, Stash, and Stashed prompts. [Plan](plans/composer-prompt-stash.md). **M — design agreement first**
- [ ] **Background-session notifications** — in-app banner plus header roll-up dot, and stop the redundant OS notification while you're looking at the session. [Plan](plans/background-session-notifications.md). **M**

---

- [ ] **Threads with no project**, each in its own scratch folder, so a new user can message before adding one. [Plan](plans/no-project-threads.md). **M/L**
- [ ] **Scheduled tasks** — saved prompts that run on a repeat, into one chat or a new chat each run, with approvals that wait and push to the phone. Builds on scheduled messages. [Plan](plans/scheduled-tasks.md). **L**
- [~] **Markdown-native cross-project dashboard and Kanban board.** A possible built-in or extension surface over authoritative project docs, with deterministic partial adoption, optional agent-assisted setup, and later constrained source edits—no task database or orchestration layer. [Plan](plans/markdown-project-board.md). **L — observe dashboard V1 first**
- [ ] **Register CLIde as a Web Share Target** — the only remaining way to get a native file-attach flow on Android. The composer's attachment control is at the ceiling of what `accept` can do (ADR 0026): eleven variants were probed on the installed PWA and an in-app source menu was built and reverted the same day, because it could only add a tap in front of the same chooser. **M**
- [~] **Claude Code settings are almost entirely unreachable from CLIde** — all 172 cascade keys are classified and drift-tested, and settable from Agents › Claude's categories and Advanced. [Plan](plans/claude-settings-surface.md). **L**
- [ ] **Environments**: a second machine in the same app. [Plan](plans/environments.md). **L**
- [ ] **True session syncing?** Using Claude Code directly doesn't list CLIde conversations. **? — needs investigation: where does each store sessions?**
- [~] **Subagents are invisible while they run and unreadable after.** Phases 1–4 landed (3 merged, not yet live-verified); next, open an agent's whole transcript in place. Never re-index them as sessions. [Plan](plans/subagent-visibility.md). **M/L**
- [ ] `!` shell mode in the conversation window. **M**
- [ ] Conversation "map" sidebar: a minimap of user/assistant messages, tap to scroll. Depends on the direct-navigation foundation and stable rendering in the [history performance plan](plans/chat-history-performance.md); its visual design remains separate. **L**
- [ ] Codex equivalent of the Claude command-surface audit — which of its commands and config keys CLIde is missing. **L**
- [ ] Modern IDE features: `@`-ing files, highlighting editor text to reference in chat, following edits in realtime. **L**
- [ ] More IDE-like desktop layout: split panels for convo, files, and editor at once. **L**
- [ ] **Workspace tabs like the desktop apps** — Terminal for Shell; Tasks and Agents tabs dropped. [Plan](plans/workspace-surfaces.md). **M/L**
- [~] **One edit model for queued, scheduled, and earlier messages.** Scheduled messages move into the thread, queued ones share one row by the input, editing marks the original instead of a banner, and cancel restores the prior draft. Phases 1–2 are live. [Plan](plans/message-edit-model.md). **M/L**
- [~] **Send a queued message into the running turn.** *Send now* on the queued row steers the active Claude or Codex turn instead of waiting for it to end; Enter still queues. [Plan](plans/send-queued-now.md). **M**

## Upstream candidates (PRs to siteboon/claudecodeui)

Tracked in [`upstream-candidates.md`](upstream-candidates.md). Nothing is PRed without
Grayson's explicit go-ahead.

## Done

Finished items move to [`todo-done.md`](todo-done.md).
