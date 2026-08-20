# Claude Code's command surface, and where each part belongs in CLIde

Measured 2026-08-19 against CLI **2.1.235** and `@anthropic-ai/claude-agent-sdk`
**0.3.233**. Companion to the [settings audit](2026-07-28-claude-code-settings-surface-audit.md),
which inventories the settings *keys*; this map inventories the **100 commands**
`/help` lists and the **58 rows** `/config` renders, and gives each one a destination.

The measurements here are reproducible (see the last section). The *destinations*
are mostly the maintainer's call — house taste, not a standard — with one
exception, which is the point of the next two sections.

## Three kinds of command, and only one kind can reach a client

Every command definition in the binary carries its own `type`:

| `type` | What it is | Reaches a non-terminal client? |
|---|---|---|
| `prompt` | Expands into text and goes to the model | Yes — it is only a prompt |
| `local` | Runs in the CLI process, returns text | Yes, as `system`/`local_command_output` |
| `local-jsx` | Renders a terminal UI component | **Never** |

Of 74 definitions recovered by pattern, 53 are `local-jsx`, 18 `local`, 3 `prompt`.
So the large majority of what `/help` advertises is terminal UI that no web client
can host — it can only be *re-implemented* natively, or dropped.

Two live measurements set the size of the real problem:

- `/help` lists **100** commands.
- `query().supportedCommands()` returns **52** — verified on this machine against a
  session that yields no message, so **enumeration costs nothing and sends no turn**.
  Of those 52, 41 are in `/help` and 11 are skills or internal commands `/help` hides.
- **59 of the 100 never appear over the SDK at all.**

CLIde is therefore not missing a hundred commands. It is missing one enumeration
call, roughly fifteen native features, and a short list of settings.

## Anthropic publishes the "hide this" list — do not hand-curate it

`system`/`init` carries two fields CLIde reads neither of:

- `slash_commands: string[]` — everything the session advertises.
- `terminal_slash_commands?: string[]` — "Subset of slash_commands whose UX is bound
  to the local terminal (e.g. exit, statusline). **Phone/remote UIs should hide these
  from command menus**; desktop surfaces may keep them."

That is an external standard, and it is the one part of this document that should
never be a judgment call: the drop list below is a *prediction* of that field, and
the implementation must read the field instead. It is optional and absent on older
CLIs, so a static fallback is still needed — but as the fallback, not the source.

Two more contract facts, from the same declarations:

- `SDKLocalCommandOutputMessage` (`system` / `local_command_output`) — a `local`
  command's text output arrives as a typed stream message. Nothing in this repo
  references it, so today that output would be dropped.
- The `UserPromptExpansion` hook fires with `expansion_type: 'slash_command'`, which
  is how a `prompt` command submitted as plain text becomes a real prompt. That is
  the supported path for the whole skill-command family.

## What CLIde reaches today

Nine commands, and no runtime enumeration:

- Seven hardcoded server-side (`server/modules/commands/commands.routes.ts`):
  `/help`, `/models`, `/usage`, `/context`, `/memory`, `/config`, `/status`.
- Two client-side and capability-gated (`useSlashCommands.ts`): `/rewind`, `/fork`.
- Custom commands are found by scanning `.claude/commands/`, read from disk, and
  expanded server-side (`POST /api/commands/execute`).

`slash_commands`, `terminal_slash_commands`, and `local_command_output` appear
nowhere in `server/`, `src/`, or `shared/`. Every bundled skill command —
`/code-review`, `/security-review`, `/simplify`, `/dataviz`, `/loop`, `/schedule`,
`/run`, `/init`, `/verify`, `/insights` — is absent from CLIde's slash menu, though
each is a plain prompt expansion with no terminal dependency.

## The inventory

### Already CLIde's — do not add a second control (20)

`clear` (new session) · `resume` (sidebar) · `rename` · `rewind` · `fork` ·
`model` (picker, ADR 0003/0025) · `context` (usage popover) · `usage` ·
`status` (moving to Settings → System, `docs/plans/system-diagnostics.md`) ·
`config` · `help` · `memory` · `mcp` · `skills` · `permissions` · `theme` ·
`voice` · `diff` (Source Control) · `plan` + `effort` (composer controls)

`permissions` is the known trap: CLIde's Permissions screen writes `localStorage`
and SDK tool lists, while `permissions.allow/deny` from the settings cascade is
*also* in force and invisible. Reconciling them needs an ADR before either surface
is extended — see the settings audit.

### Terminal-bound — hide them, build nothing (20)

`exit` · `tui` · `statusline` · `scroll-speed` · `keybindings` · `terminal-setup` ·
`ide` · `radio` · `stickers` · `mobile` · `passes` · `upgrade` ·
`install-github-app` · `install-slack-app` · `chrome` · `claude-in-chrome` ·
`design-login` · `teleport` · `powerup` · `usage-credits`

Predicted membership only. Read `terminal_slash_commands` and hide what it names.

### Becomes a setting, or a button on a settings screen (16)

| Command | Destination | Note |
|---|---|---|
| `autocompact` | Agents → Claude | In flight, [plan](../plans/autocompact-visibility.md) phase 3 |
| `fast` | Agents → Claude | `fastMode`; no CLIde surface at all today |
| `sandbox` | Agents → Claude | Needs its own design; `bubblewrap` on Linux |
| `hooks` | Agents → Claude | View-only first; a JSON editor is a project of its own |
| `privacy-settings` | Account | Verify where it writes before building |
| `auto-mode-setup` | Agents → Claude | Pairs with the permission-mode control |
| `advisor` | Agents → Claude | `advisorModel`; new since the last audit |
| `plugin`, `reload-plugins` | Extensions | **Name collision:** Settings → Plugins is CLIde's own system |
| `reload-skills` | Agents → Claude → Skills | A button, not a row |
| `import` | Agents | One-shot action |
| `doctor`, `debug` | System → Diagnostics | Existing TODO + [flight recorder plan](../plans/diagnostics-flight-recorder.md) |
| `release-notes`, `bug`, `feedback` | About | Links out; nothing to host |

### Belongs on a chat surface, not in Settings (15)

Per-session actions. A composer kebab is the obvious home for most; none of them is
a durable preference.

`compact` (shipped: menu command plus a boundary divider) · `export` · `copy` · `branch` · `btw` · `subtask` ·
`background` (pairs with [background-session notifications](../plans/background-session-notifications.md)) ·
`focus` · `color` · `goal` · `recap` · `tasks` · `list-agents` ·
`add-dir` and `cd` (project scope, and CLIde already owns checkout identity — ADR 0033/0041)

### Stays a slash command — the fix is enumeration, not UI (25)

Prompt expansions and bundled skills. Each already works as text; they are missing
only because CLIde's menu is a hardcoded list.

`agents` · `artifacts` · `artifact-capabilities` · `artifact-design` ·
`artifact-diagramming` · `autofix-pr` · `batch` · `claude-api` · `code-review` ·
`dataviz` · `design` · `design-sync` · `fewer-permission-prompts` · `init` ·
`insights` · `loop` · `run` · `run-skill-generator` · `schedule` ·
`security-review` · `simplify` · `team-onboarding` · `ultrareview` ·
`update-config` · `verify`

### Deliberately not doing (4)

`login` / `logout` — terminal flow only; a native design is a prerequisite, not a
command port. `remote-control` / `remote-env` — Anthropic's own remote surface,
which CLIde is an alternative to.

## `/config` — 58 rows across two stores

The panel is a single table in the binary: `{id, label, type, onChange}` rows, 43 of
which are visible in the current build (the rest are platform- or flag-gated).
Row `type` is `boolean`, `enum`, or `managedEnum` — the last meaning enterprise
policy can pin it.

**Rows write to one of two stores, and the panel hides which.** That distinction, not
the row list, is what decides whether CLIde can honour a control:

- `~/.claude/settings.json` (the cascade) — **already in force in every CLIde
  session** via `settingSources`. Confirmed empirically: this machine's file holds
  `theme`, `verbose`, `showTurnDuration`, `askUserQuestionTimeout`,
  `autoCompactEnabled`, `inputNeededNotifEnabled`, `agentPushNotifEnabled`, `model`,
  `effortLevel`, `permissions`, `worktree` — all of them toggled from `/config`.
- `~/.claude.json` — CLI-process-local; **never reaches a CLIde session**, so
  anything surfaced from it would be decorative. Its rows share one setter pair in
  the bundle: `copyOnSelect`, `copyFullResponse`, `defaultToAgentsView`,
  `leftArrowOpensAgents`, `externalEditorContext`, `prStatusFooterEnabled`,
  `diffTool`, `autoConnectIde`, `autoInstallIdeExtension`,
  `claudeInChromeDefaultEnabled`, `showStatusInTerminalTab`.

Per-row store is worth re-confirming at implementation time; a few rows write both.

Rows worth surfacing in CLIde, all cascade-backed:

`Auto-compact` · `Thinking mode` · `Fast mode` · `Prompt suggestions` ·
`Session recap` · `Rewind code (checkpoints)` · `Dynamic workflows` ·
`Ultracode keyword trigger` · `Dynamic workflow size` · `Artifacts` ·
`Default permission mode` (read-only — CLIde overrides it) · `Worktree base ref` ·
`Use auto mode during plan` · `Output style` · `Language` (Claude's *response*
language, not CLIde's UI language — label it carefully) ·
`Question auto-continue timeout` · `Model` (read-only; the picker owns it) ·
`Continue automatically at usage limit` · `Switch models when a message is flagged` ·
`Dialog expiry` · `Messages from your other sessions` · `Claude-proposed goals` ·
`Precompute compaction`

Rows CLIde must **not** surface, because it has its own control and a second switch
that does nothing is worse than no switch: `Theme`, `Reduce motion`, `Auto-scroll`,
`Show message timestamps`, `Show turn duration`, `Verbose output`, `Notifications`,
`Push when actions required`, `Push when Claude decides`, `Editor mode`,
`Default view`, `Agents view`, `Terminal progress bar`, `Show tips`.

## What moved since the 2026-07-28 audit

- CLI 2.1.220 → 2.1.235; SDK 0.3.233. The public `Settings` interface now has **146
  keys**. New and CLIde-relevant: `advisorModel`, `dialogExpiry`, `crossSessionInbound`,
  `fileCheckpointingEnabled`, `voice`/`voiceEnabled`, `disableAutoMode`,
  `skipDangerousModePermissionPrompt`, `agent`, `fileSuggestion`, `skipWebFetchPreflight`,
  `inputNeededNotifEnabled`, `agentPushNotifEnabled`.
- `~/.claude.json` no longer nests a `globalConfig` object; its 67 top-level keys are
  now nearly all cache, onboarding, and telemetry state. Several prefs the audit
  placed there (`editorMode`, `autoScrollEnabled`, `defaultView`) are cascade keys now,
  so **more of `/config` is reachable than that audit concluded**.
- `/config` is 58 rows, not ~50.
- `terminal_slash_commands` and `local_command_output` did not exist in that audit.
  They are the two facts that make the command half of this work cheap.

## Re-measuring after a CLI update

The CLI self-updates; this map does not. Each step is one command and bounded output.

```bash
claude --version && grep -m1 '"version"' node_modules/@anthropic-ai/claude-agent-sdk/package.json

# Command list, live, no turn sent: query() with a prompt that never yields,
# then supportedCommands(). See docs/maps/claude-agent-sdk.md §8.

# /config rows: one contiguous table in the binary.
grep -a -b -o -E '\{id:"[A-Za-z0-9_]+",label:(f8r\()?"[^"]{0,70}"' \
  ~/.local/share/claude/versions/<version>

# Command definitions with their type.
grep -a -o -E '\{type:"(local|prompt|local-jsx)",name:"[a-zA-Z0-9_-]+",description:"[^"]{0,110}"' \
  ~/.local/share/claude/versions/<version>

# Settings keys: the exported Settings interface in sdk.d.ts.
```

The SDK and the CLI are released in lockstep (`0.3.N` ↔ `2.1.N`) but move
independently here, because the CLI self-updates while the SDK moves only when
`package.json` is bumped. `claude-version-pair.ts` already records the pair; a
measurement in this map is only valid for the pair named at the top.
