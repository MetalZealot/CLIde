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
- **Detail:** [settings surface audit](../specs/2026-07-28-claude-code-settings-surface-audit.md).

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
