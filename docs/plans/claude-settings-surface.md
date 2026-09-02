# Claude Code's settings cascade, reachable from CLIde

- Status: 1/5
- Next: Phase 2 — a read-only cascade screen, which is where the `@alpha` `resolveSettings()` risk gets taken
- Context: per-key tiers in [the settings audit](../maps/2026-07-28-claude-code-settings-surface-audit.md);
  destinations in [the command surface map](../maps/claude-command-surface.md);
  the release-to-release history in [the Claude ledger](../maps/claude-upgrade-ledger.md)

The cascade is already in force in every CLIde session — `settingSources` puts
`~/.claude/settings.json` behind every turn whether or not CLIde renders a
control. So this is not about making settings work. It is about two separate
things that got conflated: **knowing** when the surface moves, and **reaching**
the settings worth reaching.

Phase 1 delivers the first alone, and is the reason the phases are in this
order. A screen never tells anyone that Anthropic added a key last week; a
failing test does.

## Phases

- [x] 1. Every key in the SDK's `Settings` interface is classified in CLIde, and
  an unclassified one fails a test by name. All 159 sit in
  `claude-settings-catalog.ts` as `exposed` (2), `adapt` (58), `display` (19),
  `terminal` (33) or `out-of-scope` (47); the drift test reports only the
  difference, so a release names its own keys.
- [ ] 2. A read-only Claude configuration screen shows the effective cascade with
  a source badge per key. `resolveSettings()` supplies `effective`, `provenance`
  and per-source raw settings without spawning the CLI. Lands in the existing
  `claude` provider slot, not a new tab.
- [ ] 3. One shared writer for `settings.json`, preserving comments and
  formatting. Today's only writer round-trips through `JSON.parse`, which keeps
  unknown keys but discards everything else in the file.
- [ ] 4. `adapt` controls, in batches. 58 keys carry that tier — more than the
  2026-07-28 audit's ~25, so the first job of this phase is ordering them, not
  building. The obvious first batch: thinking mode, output style, memory,
  workflows, transcript retention, git attribution, MCP gating.
- [ ] 5. The two permission systems reconciled, behind an ADR written first.

## Done when

- `npm test` fails, naming the key, when a Claude Code release adds or removes a
  `Settings` key CLIde has not classified.
- Settings → Agents → Claude shows what the cascade resolved to and which file
  set each value, on a machine whose `~/.claude/settings.json` has entries CLIde
  has no control for.
- A Tier A setting changed in CLIde survives a CLI restart, and `/config` in a
  terminal Shell agrees with it.
- Editing a `settings.json` that has comments through CLIde leaves the comments
  intact.

## Not doing

- **Tier C — terminal-only keys.** Roughly 80 of the 159 are terminal chrome or
  enterprise plumbing. Where CLIde has its own equivalent, the CLIde control is
  the only one that should exist.
- **`hooks` and `sandbox` editors.** Both need their own scope; a JSON blob
  behind a text area is worse than no control.
- **Managed and policy keys.** Not settable on a personal install; they belong
  in Phase 2's read-only view with a badge, never as an editor.
- **Copying `/config`.** It is a terminal-shaped menu — about 34 of its 59 rows
  are Tier C. The schema, filtered by what survives headless, is the better
  source.

## Traps

- **Two permission systems are live at once.** CLIde's Permissions screen writes
  `localStorage` and SDK tool lists; `permissions.allow/deny/ask` from the
  cascade is also in force and invisible. Phase 5 exists to resolve that, and
  nothing before it should extend either surface.
- **`resolveSettings()` is `@alpha`.** Phase 2 is where that risk is taken, on a
  read path, before Phase 3 makes anything depend on it. It also does not run an
  admin `policyHelper`, and reports `permissions.defaultMode` unfiltered.
- **`~/.claude/settings.json` is shared mutable state** with the terminal CLI and
  every other session on this machine. Whether CLIde writes the user file at all,
  or confines itself to project and local scopes, is a Phase 3 decision.
- **Anything Claude-specific stays inside the per-provider slot.** The registry
  already models `claude`/`cursor`/`codex`/`opencode` with subsystem slots;
  Codex has an analogous `config.toml`. A Claude-only entry in a shared surface
  is the failure mode to avoid.
