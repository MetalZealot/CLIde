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

- **From/to:** repository pin unchanged at `^0.3.165` (lockfile 0.3.165). The
  SDK's bundled runtime is Claude Code 2.1.165; the standalone runtime CLIde
  actually spawns advanced to 2.1.220 on this host.
- **Sources:** installed `sdk.d.ts` and `sdk.mjs`, the bundled
  `@anthropic-ai/claude-agent-sdk-linux-arm64` binary, `claude --help` and
  subcommand help for 2.1.220, and the full Claude adapter under
  `server/modules/providers/list/claude/claude-runtime.provider.js` plus `server/modules/providers/list/claude/`.
- **Measured surface:** 62 top-level `Options` members, 23 `Query` control
  methods, 32 `SDKMessage` types, 30 `HookEvent` values, 6 `PermissionMode`
  values, and 17 top-level exported functions. CLIde binds 19, 2, 2, 1, 5, and 1
  respectively.
- **CLIde-side changes since the baseline:** conversation rewind via
  `resumeSessionAt` (ADR 0007), `enableFileCheckpointing`, authoritative context
  readings via `getContextUsage()` (ADR 0014), signal-first abort via
  `abortController` (ADR 0013), `persistSession: false` for ephemeral runs, and
  compaction-row handling (ADR 0023).
- **Disposition:** integrate `rate_limit_event`, `status`/`api_retry`,
  `supportedCommands()`, the read-only settings cascade, a `PreToolUse` hook for
  interactive tools in `auto`/`bypassPermissions`, and `rewindFiles()` — the
  checkpoints it needs are already being written. Defer thinking config, prompt
  suggestions, plugins, agents, sandbox, and worktrees.
- **Compatibility watches opened:** unpinned SDK/runtime pair with no diagnostic;
  mirrored model-registry provenance cites 0.3.220 while the pin is 0.3.165;
  CLIde-owned plan-mode allow-list; hand-read MCP config duplicating the CLI's
  resolution; unmapped `dontAsk` and `manual` access modes.
- **Verification:** documentation-only audit. No CLIde code changed, so no tests
  were required; every count above was read from the installed artifacts named in
  the sources line.

## Runtime sweep 2.1.220 → 2.1.232 — 2026-08-14

- **From/to:** repository pin unchanged at `^0.3.165` (lockfile 0.3.165), so the
  SDK wrapper and its bundled 2.1.165 runtime are untouched. The runtime CLIde
  actually spawns advanced 2.1.220 → 2.1.232 without anyone asking: the native
  installer self-updates by repointing `~/.local/bin/claude` at
  `~/.local/share/claude/versions/<version>`. `autoUpdates: false` in
  `~/.claude.json` governs only the npm updater, not this.
- **Sources:** the published changelog for 2.1.221–2.1.232 (2.1.220 and 2.1.226
  carry no itemised entries); a `--help` diff of the installed 2.1.226 and
  2.1.232 binaries; `grep -a` over the 2.1.232 binary for the project-path
  encoder; the Claude adapter under `server/modules/providers/list/claude/`.
- **CLI surface:** top-level `--help` is byte-identical between 2.1.226 and
  2.1.232 (242 lines each); 2.1.220–2.1.225 could not be diffed because those
  binaries are no longer on disk. New subcommands landed in that gap
  (`self-hosted-runner`, `remote-control --continue`), so the subcommand surface
  is not flag-identical across the whole window — but CLIde never invokes a
  subcommand, it spawns the binary through the SDK's control protocol.
  The SDK-side surface counts from the 2026-07-30 refresh were not re-measured;
  the pin did not move, so its types are unchanged by construction.
- **Transcript project-directory encoding changed (2.1.224).** The runtime now
  truncates the encoded path and appends a hash once it exceeds 200 characters:
  `s.replace(/[^a-zA-Z0-9]/g,'-')`, then `slice(0,200) + '-' + base36(hash(s))`.
  `resolveClaudeTranscriptPath` implements only the plain-replacement branch, so
  it derives a wrong directory for any workspace whose encoded path passes 200.
  Not reachable today: that fallback runs only when the session row carries no
  `jsonlPath`, and the longest encoded directory on this host is 72 characters.
- **`CLAUDE_CODE_DISABLE_1M_CONTEXT` now holds every 1M model to 200K (2.1.223).**
  `claude-context-window.ts` never reads it, so with that variable set the gauge
  would report a 1M ceiling against a runtime using 200K. Unset on this host. The
  same release kept unrecognised models inside the assumed window, which CLIde's
  `FALLBACK_WINDOW` already matches.
- **Subagent forking is on by default and forks inherit the whole conversation
  (2.1.232).** Four `isSidechain` guards — token usage, both rewind walkers, and
  the session list — assume subagent rows stay sidechain-marked. Unverified: the
  four most recent transcripts contain no sidechain rows at all.
- **No action:** `ultraplan` was removed and `crossSessionInbound` / `dialogExpiry`
  were added; CLIde references none of them. The two new keys are cascade-viewer
  input, not adapter work. The remainder of the window is Remote Control, plugin,
  sandbox, and gateway work on surfaces CLIde does not bind.
- **Disposition:** fix the 200-character encoder branch; leave the 1M env var and
  the fork/sidechain question as watches until either can be reproduced.
- **Verification:** read-only inspection; no CLIde code changed. Live evidence
  that the pairing works — 25 Claude sessions in CLIde's database in the four days
  to 2026-08-14, most recent 13:34, all on runtime 2.1.232 against SDK 0.3.165.

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
  enforced. `claude-context-window.test.ts` re-parses the registry out of the
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
