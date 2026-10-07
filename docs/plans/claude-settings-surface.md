# Claude Code's settings, changeable from CLIde

- Status: 3/6
- Next: Phase 4 live check, then Phase 5 — editors for the structured keys. Phase 6 reads session state from [the agent runtime rebuild](agent-runtime-rebuild.md)'s phase 5
- Context: per-key tiers and destinations in `server/modules/providers/list/claude/claude-settings-catalog.ts`,
  which a drift test holds to the installed SDK

The goal is that changing a Claude Code setting never needs a terminal. The
cascade is already in force in every CLIde session; what is missing is a way to
reach it. Coverage beats polish: a generated control for every simple key comes
before a hand-built home for any one of them, and a key a release adds should
arrive with a working control without anyone building it.

## Phases

- [x] 1. Every key in the SDK's `Settings` interface is classified in CLIde, and
  an unclassified one fails a test by name. All 172 sit in
  `claude-settings-catalog.ts` as `exposed` (4), `adapt` (60), `display` (20),
  `terminal` (35) or `out-of-scope` (53).
- [x] 2. A read-only Configuration screen (Agents › Claude) shows the effective
  cascade with a source badge per key, via `resolveSettings()`, with a project
  picker; `env` values never leave the server. Verified live by the maintainer.
- [x] 3. One safe writer for the user `settings.json`, replacing the three
  per-feature writers (auto-compact, default effort, update channel). Writes are
  atomic, re-read the file immediately before writing, refuse a file they
  cannot parse, and follow a symlinked file rather than replacing it.
  `claude-settings-file.ts`; every new control writes through it.
- [~] 4. Agents › Claude reorganised into categories — Model & thinking,
  Responses, Memory, Git, History & privacy — with hand-labelled rows in
  `claudeSettingsLayout.ts`; Claude-app pushes on Notifications, hook and skill
  switches on Tools. Everything else editable sits in a searchable Advanced,
  generated from `sdk.d.ts`; a key newer than the catalog lands there under
  "New in this version". The cascade view is Advanced's last row. Switch
  defaults are decoded from the CLI 2.1.286; server-decided ones offer "Claude
  decides". Exercised on 3003; not yet seen on 3001.
- [ ] 5. Structured keys get their own editors: plugins, marketplaces and
  `.mcp.json` servers on Tools; `worktree`, `fallbackModel`, `modelPicker`,
  `skillOverrides`, `fileSuggestion`, custom `attribution` text.
- [ ] 6. The two permission systems reconciled, behind an ADR written first.
  The skip toggle is already gone (ADR 0064). A setting that hides Bypass from
  the picker writes Claude Code's `permissions.disableBypassPermissionsMode`.

## Done when

- `npm test` fails, naming the key, when a release adds or removes a `Settings`
  key CLIde has not classified.
- Every `adapt` key can be set and reset from CLIde, and `/config` in a
  terminal Shell agrees with the result.
- A malformed or symlinked `settings.json` survives a CLIde write untouched or
  correctly updated, never truncated or replaced.

## Not doing

- **Terminal-only and enterprise keys** — 88 of the 172. Where CLIde has its own
  equivalent, the CLIde control is the only one that should exist.
- **`hooks` and `sandbox` editors.** Both need their own scope; a JSON blob
  behind a text area is worse than no control.
- **Managed and policy keys.** Shown read-only with a badge, never edited.
- **Writing project or local files.** Every control writes the user file, the
  same one `/config` writes. Revisit only if a control needs per-project scope.
- **Preserving comments.** The maintainer's file has none, and plain JSON is
  what every current writer produces.

## Traps

- **Two permission systems are live at once.** CLIde's Permissions screen writes
  SDK tool lists; `permissions.allow/deny/ask` from the cascade is also in
  force. Phase 6 resolves that; nothing before it should extend either surface.
- **`resolveSettings()` is `@alpha`.** It is the read path only; a write never
  depends on it. It skips an admin `policyHelper` and reports
  `permissions.defaultMode` unfiltered.
- **`~/.claude/settings.json` is shared with the terminal CLI** and every other
  session. CLIde cannot lock it against the CLI, so each write re-reads and
  changes only the keys it was asked to.
- **Claude-specific stays in the `claude` provider slot.** Codex has an
  analogous `config.toml`; a Claude-only entry in a shared surface is the
  failure mode to avoid.
