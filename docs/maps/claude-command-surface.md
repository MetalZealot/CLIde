# Claude Code's command surface, and where each part belongs in CLIde

Measured 2026-08-19 against CLI **2.1.235** / SDK **0.3.233**; command
definitions, `/config` rows and settings keys re-measured 2026-08-26 against
**2.1.246** / **0.3.246**. The live `/help` and `supportedCommands()` counts below
are still the 2.1.235 ones — both need a running session, and neither was re-run.
Companion to the [settings audit](2026-07-28-claude-code-settings-surface-audit.md),
which inventories the settings *keys*; this map inventories the **100 commands**
`/help` lists, the **59 rows** `/config` renders, and the **157 keys** of the
public `Settings` interface, and gives each one a destination.

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

Of 75 definitions recovered by pattern at 2.1.246, 54 are `local-jsx`, 19 `local`,
2 `prompt`.
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

### Terminal-bound — hide them, build nothing (21)

`exit` · `tui` · `statusline` · `scroll-speed` · `keybindings` · `terminal-setup` ·
`ide` · `radio` · `stickers` · `mobile` · `passes` · `upgrade` ·
`install-github-app` · `install-slack-app` · `chrome` · `claude-in-chrome` ·
`design-login` · `teleport` · `powerup` · `usage-credits` · `cloud-plugins`

Predicted membership only. Read `terminal_slash_commands` and hide what it names.

### Open parity gaps, cheapest first

Each is a surface CLIde already has, missing what the CLI shows in the same place.

| Gap | What is missing | Size |
|---|---|---|
| Slash menu | Nine hardcoded commands where `supportedCommands()` returns 52 live, without sending a turn. Hide what `terminal_slash_commands` names. | M |
| `/context` | The SDK breakdown's `gridRows` is parsed away and rebuilt as a stacked bar; using it directly matches the CLI's square-grid panel. | S |
| `/usage` | Per-model cost breakdown — plan bars, a "This session" line, then a per-model table. | M |
| `/stats` | Account usage stats in Context & Usage. Probe `usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET()` with `scripts/verify-context-usage-sdk.ts` first: is `behaviors` populated on this account? An idle surface cannot hold a query open. | M/? |

### Becomes a setting, or a button on a settings screen (16)

| Command | Destination | Note |
|---|---|---|
| `autocompact` | Agents → Claude | Shipped, [plan](../plans/archive/2026-08-23-autocompact-visibility.md) |
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

### Stays a slash command — the fix is enumeration, not UI (26)

Prompt expansions and bundled skills. Each already works as text; they are missing
only because CLIde's menu is a hardcoded list.

`agents` · `artifacts` · `artifact-capabilities` · `artifact-design` ·
`artifact-diagramming` · `autofix-pr` · `batch` · `claude-api` · `code-review` ·
`dataviz` · `design` · `design-sync` · `fewer-permission-prompts` · `init` ·
`insights` · `loop` · `run` · `run-skill-generator` · `schedule` ·
`security-review` · `simplify` · `team-onboarding` · `ultrareview` ·
`update-config` · `verify` · `plugin-types`

`plugin-types` is the odd one: a `local` command, not a prompt expansion. It writes
`claude-code-mcp.d.ts` describing the connected MCP tools, and reports what it wrote
as `local_command_output` — the message type CLIde drops. Enumeration alone would
list it and then show nothing when it ran.

### Deliberately not doing (4)

`login` / `logout` — terminal flow only; a native design is a prerequisite, not a
command port. `remote-control` / `remote-env` — Anthropic's own remote surface,
which CLIde is an alternative to.

## `/config` — 59 rows across two stores

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

One row was added between 2.1.235 and 2.1.246: `remoteHomeSettings`, "Use this
machine's settings in cloud sessions". It governs Anthropic's own cloud sessions,
which CLIde is an alternative to, so it joins that list.

## Settings keys — 157 in the public `Settings` interface

**The cascade is already in force in every CLIde session.**
`claude-runtime.provider.js` passes `settingSources = ['project', 'user', 'local']`,
so a key written into `~/.claude/settings.json` changes CLIde's behaviour whether or
not CLIde renders a control for it. A key needs a CLIde control only when the user
would otherwise have no way to reach it; it needs a *non-mapping* recorded when
CLIde must deliberately ignore it.

`~/.claude.json` no longer nests a `globalConfig` object; its 67 top-level keys are
now nearly all cache, onboarding, and telemetry state. Several prefs the July audit
placed there (`editorMode`, `autoScrollEnabled`, `defaultView`) are cascade keys now,
so **more of `/config` is reachable than that audit concluded**.

157 keys at 0.3.246, 146 at 0.3.233, **none removed**. The eleven added:

| Key | What it decides | CLIde destination |
|---|---|---|
| `promptCacheTtl` | `5m` or `1h` cache for the main conversation; unset = 1h on a subscription, 5m on an API key. `CLAUDE_CODE_PROMPT_CACHE_TTL` outranks it | **Agents → Claude.** The one with a real product surface: it decides whether an idle session's cache survives a break, which is exactly CLIde's usage pattern |
| `subagentPromptCacheTtl` | Same, for subagents, workflows and background requests; unset = 5m | **Agents → Claude**, paired with the row above |
| `modelPicker` | Curated `/model` list with custom labels, replacing or extending the built-in lineup. Honored from managed, `--settings`/SDK and *user* settings | **Divergence, not yet closed.** CLIde builds its catalog from the runtime registry and never reads this, so a user who curates the CLI picker sees the full lineup in CLIde. `claude-models.provider.ts` is where it would be read |
| `modelSettings` | Per-model persisted `effortLevel`, keyed by canonical model name | **Non-mapping.** CLIde owns effort per session, not per model (ADR 0025); reading a global default would fight the session value |
| `autoContinueAtUsageLimit` | Wait out a usage limit and continue instead of pausing | **Agents → Claude** — already listed above as the `/config` row `Continue automatically at usage limit` |
| `syncClaudeAiSkills` | Whether skills enabled on claude.ai download to `~/.claude/skills/synced` | **Fixed in code, not in UI.** The runtime loads synced skills into a CLIde session, but CLIde's skills list scanned only `~/.claude/skills/<name>/`, one level too shallow. `claude-skills.provider.ts` now scans the synced root as its own source |
| `syncClaudeAiPlugins` | Same for plugins, into `~/.claude/plugins/synced` | **Open, unconfirmed.** CLIde enumerates plugins only from `enabledPlugins` × `installed_plugins.json`. Whether the CLI also registers `~/.claude/plugins/synced` entries there is undetermined — no synced plugin was available to observe. Enable one on claude.ai and read that file before building anything |
| `modelPricing` | Contracted per-Mtok rates that re-price every spend figure | **Non-mapping.** Managed settings only, so it cannot be set on a personal install. Worth knowing if CLIde's cost figures ever have to agree with an enterprise `/cost` |
| `managedSourcesBehavior` | How multiple managed-settings sources compose | **Non-mapping.** Enterprise policy composition |
| `keybindingFlavor` | `classic` or `readline` word-editing keys in the prompt input | **Non-mapping.** Terminal-bound; CLIde's composer is its own |
| `spellcheck` | Underline misspellings in the prompt input via aspell/hunspell | **Non-mapping.** Terminal-bound; the browser already does this |

Earlier keys still without a CLIde destination, from the 0.3.233 pass: `advisorModel`,
`dialogExpiry`, `crossSessionInbound`, `fileCheckpointingEnabled`, `voice`/`voiceEnabled`,
`disableAutoMode`, `skipDangerousModePermissionPrompt`, `agent`, `fileSuggestion`,
`skipWebFetchPreflight`, `inputNeededNotifEnabled`, `agentPushNotifEnabled`.

`terminal_slash_commands` and `local_command_output` did not exist in the July audit.
They are the two facts that make the command half of this work cheap.

## Re-measuring after a CLI update

The CLI self-updates; this map does not. Each step is one command and bounded output.

**Diff two versions; never re-read a whole list.** Old runtime builds stay under
`~/.local/share/claude/versions/`, so the previous one is usually still on disk, and
the delta is what needs a destination. `V=<old> W=<new>`:

```bash
claude --version && grep -m1 '"version"' node_modules/@anthropic-ai/claude-agent-sdk/package.json

# /config rows, and command definitions with their type. Same shape for both:
# grep the two binaries, sort -u, comm.
grep -a -o -E '\{id:"[A-Za-z0-9_]+",label:(f8r\()?"[^"]{0,70}"' ~/.local/share/claude/versions/$W | sort -u
grep -a -o -E '\{type:"(local|prompt|local-jsx)",name:"[a-zA-Z0-9_-]+",description:"[^"]{0,110}"' ~/.local/share/claude/versions/$W | sort -u

# Settings keys: top-level members of the exported Settings interface. The file is
# CRLF, and nested option objects sit deeper, so the 4-space indent is the filter.
sed -n "$(grep -n 'interface Settings' node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts | head -1 | cut -d: -f1),\$p" \
  node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts | tr -d '\r' | awk '/^}/{exit} {print}' \
  | grep -oE '^    [$A-Za-z_][A-Za-z0-9_]*' | tr -d ' ' | sort

# The previous SDK, for the other side of that diff:
npm pack @anthropic-ai/claude-agent-sdk@<old> && tar xzf *.tgz package/sdk.d.ts
```

A key's meaning is in its doc comment above the declaration; read those rather than
guessing from the name — `modelSettings` and `modelPicker` are not what they sound
like.

The SDK and the CLI are released in lockstep (`0.3.N` ↔ `2.1.N`) but move
independently here, because the CLI self-updates while the SDK moves only when
`package.json` is bumped. `claude-version-pair.ts` already records the pair; a
measurement in this map is only valid for the pair named at the top.
