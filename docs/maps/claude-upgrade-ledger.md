# Claude Code and Agent SDK upgrade ledger

This is the compact decision history for Claude runtime upgrades in CLIde.

- The [living surface map](claude-agent-sdk.md) is the current source of truth
  for capability mapping and integration destinations.
- This ledger records what changed in each audited release, what CLIde decided,
  and what verification remains.
- Generated type dumps, binary `strings` extracts, and raw help output are
  temporary audit artifacts. Git history preserves detailed changes to the
  living map.

## Entry format

Each audited change records:

- previous and current version set: repository pin, installed SDK, SDK-bundled
  runtime, and the runtime actually on `PATH`;
- sources consulted;
- SDK declaration, CLI, settings-schema, and behavioral changes;
- disposition: integrated, mapped candidate, compatibility watch, or no action;
- CLIde commit, automated verification, and live evidence.

Claude Code has no public tagged source repository, so installed artifacts and
live behavior take precedence over documentation. See the map's evidence policy.

## Baseline survey — 2026-07-19

- **Observed:** SDK 0.3.165, one `query()` per turn, a plain string prompt, and
  `interrupt()` as the only control method in use.
- **Key correction established:** the Agent SDK is not an API client. `query()`
  spawns the full Claude Code CLI and speaks a control protocol with it, which is
  why CLIde and Shell sessions are interchangeable.
- **Decision:** treat the persistent streaming-input query as the architectural
  unlock behind mid-session control, and prioritize the stream messages CLIde
  drops over new option plumbing.
- **Result:** informed the rewind stack, the context-usage work, and the
  permission-mode parity finding.

## Settings-surface audit — 2026-07-28

- **Sources:** `strings` over the native binary 2.1.220 (full settings
  JSON-Schema plus the `/config` row table) cross-checked against the SDK's
  exported `Settings` type; both verified live.
- **Findings:** CLIde already inherits the settings cascade
  (`settingSources: ['project','user','local']`), so the gap is authoring and
  visibility, not plumbing. `resolveSettings()` and `filterEscalatingDefaultMode()`
  are exported at runtime and give effective values with provenance for free.
  `~/.claude.json` is a separate store that never reaches an SDK session.
  `model`, `effortLevel`, `permissions.defaultMode`, `env`, and `systemPrompt` are
  silently overridden on every query.
- **Disposition:** read-only cascade viewer first, then Tier A writes starting
  with permissions reconciliation. Never surface terminal-only keys.
- **Detail:** [settings surface audit](2026-07-28-claude-code-settings-surface-audit.md).

## Living-map refresh — 2026-07-30

- **From/to:** pin `^0.3.165`; runtime on `PATH` 2.1.220. Measured 62 `Options`,
  23 `Query` methods, 32 `SDKMessage` types; CLIde bound 19, 2 and 2.
- **Disposition:** integrate `rate_limit_event`, `status`/`api_retry`,
  `supportedCommands()`, the read-only settings cascade and `rewindFiles()`;
  defer thinking config, prompt suggestions, plugins, agents, sandbox, worktrees.

## Runtime sweep 2.1.220 → 2.1.232 — 2026-08-14

- **From/to:** pin unchanged; the runtime self-updated by repointing
  `~/.local/bin/claude`. `autoUpdates: false` governs only the npm updater.
- **Findings, all closed by the 0.3.233 entry below:** the 200-character
  project-directory hash (2.1.224), `CLAUDE_CODE_DISABLE_1M_CONTEXT` (2.1.223),
  and forked subagents vs the `isSidechain` guards (2.1.232).

## SDK 0.3.165 → 0.3.233 — 2026-08-16

- **From/to:** pin `^0.3.165` → `^0.3.233`, lockfile and installed SDK 0.3.165 →
  0.3.233, SDK-bundled runtime 2.1.165 → 2.1.233. The runtime on `PATH` was
  already 2.1.233 and is unchanged.
- **Correction — the bump does not move Chat's runtime.** The plan was written on
  the premise that `query()` spawns the SDK's bundled binary, so Chat was 68
  releases behind Shell. It is not: CLIde always sets
  `pathToClaudeCodeExecutable` (`'claude'` on non-Windows), and the SDK resolves
  its bundled binary only in the `if (!pathToClaudeCodeExecutable)` branch. Three
  lines of evidence agree — the adapter source, that branch in `sdk.mjs`, and
  203 transcripts on this host carrying 16 distinct runtime versions from 2.1.212
  to 2.1.233 with **not one** at the bundled 2.1.165. So this is a library-layer
  bump: control-protocol client, types, and the fallback binary used only if
  `claude` ever leaves `PATH`. The map's snapshot row was right all along, and
  the three runtime-gated items below were already reaching Chat, not waiting on
  this bump to start.
- **Sources:** old and new `sdk.d.ts` / `sdk-tools.d.ts` / `agentSdkTypes.d.ts`,
  the new `sdk.mjs` model registry, `strings`/`grep -a` over the bundled 2.1.233
  binary for the context-window and project-path encoders, and both
  `scripts/verify-*-sdk.ts` run against the new SDK.
- **Exported surface:** four `ConnectRemoteControl*` / `InboundPrompt` types and
  the `assistant` entrypoint were removed; a repo-wide grep confirms CLIde binds
  none of them. Everything else is additive: `Options` 62 → 64
  (`resumeDropsTurn`, `supportedDialogKinds`), `Query` +`reinitialize`,
  +`setMcpPermissionModeOverride`, +`usage_EXPERIMENTAL…`, `SDKMessage` 32 → 39,
  `HookEvent` 30 → 31 (`DirectoryAdded`), `PermissionMode` unchanged at 6, 17
  exported functions unchanged, 22 new `sdk-tools` input/output pairs.
- **Model registry re-read from 0.3.233 `sdk.mjs`:** all 17 entries and the four
  family aliases are byte-identical to the table in `claude-context-window.ts`.
  The stale 0.3.220 provenance line is now 0.3.233.
- **`CLAUDE_CODE_DISABLE_1M_CONTEXT` decoded and implemented.** The mechanism is
  not the credit latch the 2026-08-14 entry assumed: the flag fails every 1M path
  (`[1m]` suffix, beta header, native) so the window falls through to a flat
  200,000 for every model. `resolveClaudeContextCeiling` now mirrors that, using
  the runtime's own truthy vocabulary (`1`/`true`/`yes`/`on`).
- **The 200-character project-directory hash is identified.** `h*31 + c` over the
  ORIGINAL path, `Math.abs(...).toString(36)`, appended to the encoded path cut
  at 200. Verified by running the bundled 2.1.233 binary from a 264-character
  cwd: `encodeClaudeProjectDir` reproduces the written directory byte for byte.
- **Forked subagents no longer reach the parent transcript at all (closes the
  `isSidechain` watch).** One subagent run on 2.1.233 wrote its 5 rows to
  `<project>/<session-id>/subagents/agent-<id>.jsonl`, every row
  `isSidechain: true`, and left 0 sidechain rows in the parent. CLIde reads only
  the parent, so the four guards are unaffected and token accounting is unchanged.
- **Disposition:** `resumeDropsTurn` is a mapped candidate — it is the companion
  guard to the `resumeSessionAt` rewind path (ADR 0007), not needed for the bump.
  `usage_EXPERIMENTAL…` stays deliberately unspent (usage dashboard plan).
  `supportedDialogKinds` fails closed when absent, which is CLIde's current
  behaviour, so no action.
- **Verification:** `typecheck`, `lint` (0 errors), `check:docs`, `build:server`,
  and the full suite — 458 server + 173 client, 0 failures. Both probes reproduce
  their recorded findings on 0.3.233: `getContextUsage()` still resolves at init
  and mid-stream but not after `result`, and `resumeSessionAt` still accepts only
  assistant uuids while keeping the session id. `sonnet` now resolves to
  `claude-sonnet-5` and both the SDK and CLIde report a 200,000 ceiling for it —
  this host's `~/.claude/settings.json` sets `autoCompactWindow: 200000`, so that
  is agreement, not a regression. All probe transcripts and rows were removed.

## Update-safety mechanisms — 2026-08-16

Two gates so the next bump costs less than this one did, modelled on Codex's
`EXPECTED_CODEX_VERSION` pin and protocol-drift check.

- **Registry drift is now a test, not an instruction.** The 0.3.233 re-read above
  was a manual re-parse of `sdk.mjs` that the header comment demanded and nothing
  enforced. `claude-context.test.ts` re-parses the registry out of the
  installed bundle (bounded `models:[` … `],aliases:{`, each entry bounded at the
  next id — an unbounded slice reads the following entry's fields) and diffs it
  against `CLAUDE_MODEL_CONTEXT_SPECS` and `CLAUDE_MODEL_ID_ALIASES`. One
  `deepEqual` covers drifted values, new models, and specs left behind; the alias
  case allows CLIde's deliberate extras but requires them to resolve to a live id.
  It fails loudly if the parser matches nothing, so it cannot pass vacuously.
- **The (SDK, runtime) pair is recorded.** Both are deliberately unpinned and move
  independently, so a pinned test would be wrong and a runtime that self-updated
  underneath a session was previously invisible.
  `claude-version-pair.ts` writes `~/.cloudcli/claude-version-pair.json` — the
  pair, when it was observed, and the pair it replaced — and logs the move once.
  It costs no new process: `ClaudeProviderAuth.checkInstalled` already ran
  `claude --version` and discarded the output. That call also treated a missing
  binary as installed, because `spawn.sync` reports ENOENT in its result rather
  than throwing; it now checks the result.
- **Verification:** 463 server tests, 0 failures; `lint`, `build:server` clean.
  Live against the built `dist-server`: `getStatus()` reports installed and
  authenticated, and recorded `{ sdk: 0.3.233, runtime: 2.1.233 }`.

## The version pair is visible in Settings — 2026-08-17

The pair was already recorded on every auth check and then dropped: the only
consumer was a `console.warn`, so the mechanism that exists to catch a silent
runtime self-update could only be read by someone tailing the server log.

- **What changed.** `checkInstalled` returns the record instead of a boolean, and
  `ProviderAuthStatus` carries an optional `versions` (runtime, sdk, observedAt,
  and the pair it replaced). Claude's account card renders one **Runtime** row —
  `2.1.233 · SDK 0.3.233` — plus a warning line naming the half that moved, for
  seven days after a move. No new endpoint, no new process, no new fetch.
- **Read-only on purpose.** Codex's equivalent is a whole sub-screen because
  CLIde installs, pins and rolls back that binary (ADR 0034). CLIde only
  *observes* the `claude` on `PATH`, so there is nothing to act on and nowhere
  to drill into; a row that navigated nowhere would imply controls that cannot
  exist.
- **Presence-driven, not provider-driven.** The row renders when a provider
  reports a pair rather than on `provider === 'claude'`, per the capability rule
  that provider facts do not belong in React branches.
- **The notice decays.** `previous` is kept indefinitely in the store, so the
  move line is gated on a seven-day window — otherwise the first self-update
  would leave permanent furniture on the card.
- **Verification:** typecheck, focused lint (0 errors), 473 server tests and 182
  client tests, 0 failures. Eight new tests cover the pair formatting, which half
  moved, the window, a corrupt timestamp, and the three render states.

## SDK 0.3.246 / runtime 2.1.246 — 2026-08-26

The model registry left the SDK bundle. Through 0.3.233 `sdk.mjs` carried the
full `models:[{id:"claude-…}]` table; 0.3.246 ships none of it — no
`max_output_tokens`, no `native_1m` — and the only copy is the `claude` binary
CLIde already spawns.

- **What changed.** The registry-drift test now finds the marker by a chunked
  scan of the runtime executable (`CLAUDE_CLI_PATH`, else the first `claude` on
  `PATH`, `realpath`-resolved) and decodes a 1 MB window as `latin1`. The parser
  itself is unchanged: the block's shape is byte-identical to the one the SDK
  used to carry. This is the better source anyway — the binary is the half that
  self-updates.
- **No spec drift.** `CLAUDE_MODEL_CONTEXT_SPECS` and `CLAUDE_MODEL_ID_ALIASES`
  matched 2.1.246's registry exactly on the first run; no model facts moved.
- **Type surface.** 101 signature lines changed, none of them used here.
  Removed: `bypass_permissions_disabled` from `ExitReason`, and the `get_plan`
  and `get_workspace_diff` control requests — CLIde references none of the
  three. Added: `account_on_hold` to `SDKAssistantMessageError`, `'max'` to the
  effort union (CLIde already offers it), and settings rows `promptCacheTtl`,
  `subagentPromptCacheTtl`, `modelSettings`, `modelPicker`, `modelPricing`,
  `keybindingFlavor`, `spellcheck`, `autoContinueAtUsageLimit`, `headersHelper`.
  Those settings are candidates for the command-surface map, not adopted work.
- **From the changelog**, 2.1.234 → 2.1.247 (`anthropics/claude-code` publishes
  `CHANGELOG.md` for every runtime version; the SDK publishes none). The first
  pass of this audit read only the newest entry and missed the last four items
  below:
  - `Notification` now fires while a sandbox network prompt waits, and `/fork`
    from an already-forked or backgrounded session no longer starts empty.
    CLIde registers exactly one hook and owns fork, so both are upstream fixes
    to surfaces it depends on — no CLIde change.
  - MCP tool arguments are no longer stringified when a parameter's schema is
    `{}`, and interrupted MCP calls report an interrupted error rather than
    "completed with no output".
  - Sonnet 5's default auto-compact window became its full 1M, so the ceiling is
    ~967K rather than ~934K. `LONG_CONTEXT_RESERVE` already produced 967,000;
    the registry test confirms it at 2.1.246.
  - `ultracode` is an *effort keyword* for dynamic workflows, not a model and
    not an SDK effort value — the SDK union stops at `max`. Do not add a picker
    row for it.
  - Eleven settings keys were added between 0.3.233 and 0.3.246, none removed;
    each now has a destination or a stated non-mapping in the command-surface
    map. The survey exposed a live defect: skills synced from a claude.ai
    account sit at `~/.claude/skills/synced/<name>/`, one level below the root
    CLIde scanned, so they ran in a session and never appeared in its list.
    **Adopted** — the synced root is now its own skill source. `modelPicker`
    (CLIde's catalog ignores a curated `/model` list) and the same question for
    synced *plugins* are open in the map.
  - `ANTHROPIC_DEFAULT_MODEL` (2.1.236) seeds what new sessions start on, below
    a managed setting and above the tier default, and is distinct from
    `ANTHROPIC_MODEL`'s hard override. CLIde's seed chain did not read it at
    all; it now does, consulted last. **Adopted.**
  - `perTaskStopAffordance` is the single new SDK `Options` key, and pairs with
    2.1.238's per-task Stop fix. Absence fails closed — interrupt kills
    background tasks — which is correct until CLIde renders a per-task stop
    control. Logged as a trap, not a win.
  - 2.1.239 stopped treating a touched or reopened transcript as recently
    changed. CLIde had it in three synchronizers, not two — Claude, Codex and
    Cursor; OpenCode already read a real `time_updated`. Claude appends
    untimestamped `last-prompt` and `permission-mode` rows on open, so opening a
    session was enough to reorder it: mtime ran 30 minutes past the last message
    on a real transcript here. **Adopted** — `readLastJsonlTimestamp` reads the
    last timestamped row from a bounded tail, mtime stays the fallback. Still
    live upstream; logged in `docs/upstream-candidates.md`.
  - 2.1.239 also fixed an Esc-with-queued-prompt race that left a session idle
    while work continued. CLIde owns abort (ADR 0008); worth a look when abort
    is next touched.
- **Verification:** typecheck, lint, 520 server and 262 client tests, 0
  failures; `build` clean. The registry test is the live evidence — it reads the
  installed 2.1.246 binary rather than a fixture.

## SDK 0.3.246 → 0.3.258, runtime 2.1.252 → 2.1.258 — 2026-09-01

- **Version set:** pin `^0.3.246` → `^0.3.258`; standalone Claude Code on `PATH`
  2.1.252 → 2.1.258, self-updated. Span audited: 2.1.247–2.1.258.
- **Sources:** the published `CHANGELOG.md` across the span, the shipped
  `sdk.d.ts` diff, and the registry read out of the installed binary.
- **The model registry moved, and the drift tests named it.** Fable 5.1
  (`claude-fable-5-1`) and Mythos 5.1 (`claude-mythos-5-1`) landed at 1M native
  context and 64K default output, and the registry's `fable` alias now defaults
  to Fable 5.1 — only the gateway row still resolves to Fable 5. **Adopted:**
  both specs added, `fable` and `mythos` repointed, picker row relabelled.
  `resolveClaudeModelAlias` needed nothing — it already reduces
  `claude-fable-5-1` to `fable` by substring.
- **`systemPromptSnapshot` needs no change.** Recording the system prompt once
  is already the default for a bare `claude_code` preset with no `append`, which
  is exactly what CLIde sends.
- **`Pre`/`PostModelSwitch` hooks are not a candidate**, for the reason Codex's
  `Interrupt` hooks are not: a hook is the runtime's own extension point, and
  CLIde owns the picker that caused the switch. Their payloads
  (`context_tokens`, `prompt_cache_warm`, `estimated_cache_write_usd`) are the
  interesting part and are unreachable without registering one.
- **Three settings keys added, none removed** — 159 top-level `Settings` keys
  against 156 at 0.3.246 on the same count. `timeFormat`/`timeZone` are CLI clock
  rendering; `desktopSessionCleanupPeriodDays` bounds a Desktop/Cowork exemption.
  Nested `permissions.blockReadsOutsideWorkingDirectories` is the one real
  restriction CLIde has no control for.
- **Candidates, none adopted:** `ModelUsage.thinkingTokens` (already inside
  `outputTokens`, so a display field only); `getContextUsage({ detail:
  'summary' })`, which skips the per-category token-count calls but may not
  populate the `breakdown` CLIde consumes — measure first; `ambient` on the task
  messages, marking housekeeping work hosts should hide; `resource_links` on a
  backgrounded MCP task's notification; per-server MCP `timeout`; `--restricted`
  (2.1.248); `updateSettings(source: 'localSettings')`, allowlisted to
  `outputStyle` alone.
- **`defaultMode: "bypassPermissions"` in project settings is now ignored**
  (2.1.257). CLIde is unaffected — it sends `permissionMode` explicitly.
- **Two watches.** 2.1.251 fixed transcripts silently overwritten when a
  directory change relocated a session onto an existing same-ID transcript —
  the failure class CLIde's session-to-checkout pinning addresses, one layer
  down; the two must not disagree. 2.1.258 fixed re-sent permission approvals
  failing with "user messages must have non-empty content"; CLIde replays
  approvals (ADR 0012) and the fix is runtime-side.
- **Five permission and file-tool escapes close by upgrading alone:** a symlink
  swapped after the check in Read/Write/Edit, and deny rules skipped by
  Grep/Glob through a symlinked path (2.1.251); plugin paths escaping the plugin
  directory, `permissions.ask` skipped inside a compound command, and Bash deny
  rules ignoring `< file` and `tac`/`egrep` (2.1.257).
- **Verification:** 565 server tests, 0 failures; typecheck clean. The registry
  and alias drift tests are the live evidence — they read the installed 2.1.258
  binary, and both failed before the change and pass after.

## SDK 0.3.258 → 0.3.286, runtime 2.1.286 — 2026-10-01

- **Version set:** pin `^0.3.258` → `^0.3.286`; bundled runtime 2.1.258 →
  2.1.286; runtime on `PATH` already 2.1.286, self-updated. Span audited:
  2.1.259–2.1.286, all 25 changelog entries.
- **Sources:** the published `CHANGELOG.md`, the `sdk.d.ts` diff, the registry
  in the installed binary, the live model list, and both `verify-*-sdk.ts` probes.
- **The checker hid this diff.** `check:providers --types` printed "comments
  only" for 329 changed signature lines: `diff` exits 1 on a difference and the
  runner read that as failure. Fixed.
- **Type surface:** nothing CLIde calls was removed. `Options` +4
  (`projectConfigRoot`, `verbatimPrompts`, `permissionPrompts`, `pluginDelivery`),
  `Query` +`reloadOutputStyles`, +`readMcpResource`, +`prewarm()`. Thirteen
  settings keys classified; `maxEffortLevel` (caps effort) is the one the
  picker should eventually honour.
- **Sonnet 5.5 had already reached Chat (2.1.284).** The `sonnet` alias moved to
  `claude-sonnet-5-5` (1M, 128K output) and the drift tests named it. **Adopted:**
  spec added, alias repointed, fallback picker rows re-copied from the live
  model list, which no longer quotes prices.
- **To-do tools: the changelog and the runtime disagree.** 2.1.268 says
  TodoWrite and the Task tools are offered only to older models, but Opus 5.5
  sessions on 2.1.286 still list `TaskCreate`/`Get`/`List`/`Update` as deferred
  tools; only `TodoWrite` is absent. CLIde renders both families. No action.
- **Watches.** With `autoCompactEnabled: false`, `getContextUsage()` reports
  1,000,000 for Sonnet 5.5 where `resolveClaudeContextCeiling` derives 967,000;
  only the pre-first-reply ring uses the derived figure. Background Bash now
  stops at 30 min (2.1.285); a dangerous `rm` in auto mode auto-denies after
  2 min (2.1.281). New uuid-less transcript rows `cost-state` and `atis-latch`
  are ignored like the other metadata rows.
- **Free fixes worth knowing:** `setModel` now applies the new model's output
  limit and compact window (2.1.285); interrupt right after the first prompt is
  honoured (2.1.261); `rewindFiles` no longer reports success when nothing was
  restored (2.1.260); `settingSources` reaches spawned subagents (2.1.281).
- **Verification:** typecheck, lint, `build:server`, 717 server tests, 0
  failures. Live: the model list returned 12 models in 2.3 s through the new SDK;
  `getContextUsage()` still answers at init and mid-stream but not at `result`;
  `resumeSessionAt` still takes only assistant uuids, branches in place, and
  keeps the session id.
