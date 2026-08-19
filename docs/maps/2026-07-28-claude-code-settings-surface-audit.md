# Claude Code settings surface — inventory and CLIde feasibility audit

Date: 2026-07-28
Status: assessment only, no implementation
Superseded in part by the [Claude command surface map](claude-command-surface.md),
measured 2026-08-19 at CLI 2.1.235: the `/config` row list, the two-store split, and
the key inventory are current there. This audit remains the per-key tier analysis.
Related: `docs/specs/archive/2026-07-28-settings-information-architecture.md`
(the IA revamp, which explicitly declares "no new settings are introduced" — this
audit is the follow-on that decides which new settings are worth introducing);
[Claude Code and Agent SDK living surface map](../maps/claude-agent-sdk.md);
[canonical CLIde provider capability map](../maps/clide-provider-capability-map.md)

## What this covers

Answer two questions:

1. What settings does Claude Code actually have, and which of them does `/config`
   expose?
2. Which of them could CLIde adapt, at what cost, and which are dead ends?

## Method

`/config` is an in-session slash command, not a CLI verb — `claude config list`
does not exist (it is parsed as a *prompt*). The inventory was recovered from
two authoritative sources rather than documentation:

- `strings` over the native binary (`~/.local/share/claude/versions/2.1.220`),
  which carries the full settings JSON-Schema key list and every description
  string, plus the `/config` panel's row table.
- The bundled `@anthropic-ai/claude-agent-sdk` type declarations
  (`sdk.d.ts`), whose exported `Settings` interface is generated from the same
  schema.

Both were cross-checked; the binary's schema is a small superset (it carries
`@internal` keys the public SDK type omits).

## Headline finding

**CLIde already inherits `~/.claude/settings.json` in every session.**
`claude-runtime.provider.js` sets:

```js
sdkOptions.settingSources = ['project', 'user', 'local'];
```

So the gap is not plumbing — behavioural settings already take effect today. The
gap is that CLIde has **no authoring UI for any of them**, and no way to *see*
what is in effect. That reframes the work from "wire up settings" to "build an
editor over a cascade that is already live."

## The three stores — do not conflate them

This is the single most important distinction, and `/config` hides it by writing
to two of them transparently.

| Store | Location | Size | Read by CLIde's SDK path? |
|---|---|---|---|
| **Settings cascade** | `~/.claude/settings.json`, `.claude/settings.json`, `.claude/settings.local.json`, managed/policy tiers | ~140 public keys (+~15 `@internal`) | **Yes** — already |
| **CLI global config** | `~/.claude.json` (`globalConfig`) | ~45 keys | **No** — CLI-process-local only |
| **CLIde's own prefs** | browser `localStorage` (`claude-settings`, `cursor-tools-settings`, `codex-settings`) + `/api/settings` (SQLite) | ~20 keys | Yes, but as *SDK options*, not settings |

`~/.claude.json` no longer nests a `globalConfig` object; as of 2.1.235 its 67
top-level keys are nearly all cache, onboarding, and telemetry state, plus a
shrinking set of prefs (`diffTool`, `autoConnectIde`, `copyOnSelect`,
`leftArrowOpensAgents`, `defaultToAgentsView`, `externalEditorContext`).
**None of it reaches a CLIde session.** Anything CLIde surfaces from this store
would be decorative. Prefs the CLI has since moved into the cascade — `editorMode`,
`autoScrollEnabled`, `defaultView` — are reachable; check the current list rather
than this one.

Note also that CLIde's Settings → Plugins tab manages *CLIde* plugins
(`server/routes/plugins.js`, its own `getPluginsConfig`/`savePluginsConfig`), which
is a different thing from Claude Code's `enabledPlugins` / marketplaces. Name
collision to be careful about in any new UI.

## What CLIde exposes today

Ten tabs: Agents, Appearance, Git, API & Tokens, Voice, Tasks, Browser,
Notifications, Plugins, About — plus the QuickSettings edge panel (slated for
removal). Of these, **exactly zero** read or write the Claude Code settings
cascade. Every one is about CLIde itself.

The nearest miss is Settings → Agents → Claude → **Permissions**, which looks like
it should map to `permissions.allow`/`deny` but does not:

- It writes `localStorage['claude-settings']` → `{ allowedTools, disallowedTools,
  skipPermissions }`.
- Those become `sdkOptions.allowedTools` / `disallowedTools` / a
  `permissionMode: 'bypassPermissions'` flip (`claude-runtime.provider.js`).

Meanwhile `permissions.allow`/`deny` from `settings.json` are *also* in force via
`settingSources`. **Two parallel permission systems, neither aware of the other,
neither visible from the other's UI.** A user who added `Bash(npm run *)` to
`settings.json` sees an empty Permissions tab in CLIde.

## Settings CLIde already overrides (the trap)

`mapCliOptionsToSDK` sets these explicitly on every query, which means the
corresponding `settings.json` keys are **silently ignored** in CLIde:

| settings.json key | Overridden by |
|---|---|
| ~~`model`~~ | **Fixed 2026-08-10.** The runtime now omits `sdkOptions.model` when the user has made no explicit choice, so `model` from the cascade applies. It previously sent the literal string `"default"`, which is not an alias Claude Code accepts — the CLI fell back to its built-in Sonnet default and the configured model never took effect. The catalog reads the cascade to badge the real default, and Settings › Agents › `<provider>` › Default Model sets an in-app override. |
| `effortLevel` | `resolveClaudeEffort` → `sdkOptions.effort` |
| `permissions.defaultMode` | the composer's permission-mode control → `sdkOptions.permissionMode` |
| `env` | `sdkOptions.env = { ...process.env }` |
| — | `sdkOptions.systemPrompt` is pinned to the `claude_code` preset |

Any settings UI that offers these four as editable fields would be lying. Either
CLIde must stop overriding them when the user has not made an explicit in-app
choice, or they must be rendered read-only with a "CLIde controls this" note.

## The two SDK APIs that make this cheap

Both verified live on this machine against the installed SDK.

### 1. `resolveSettings()` — read the cascade without parsing files

Exported at runtime (confirmed: `Object.keys(sdk)` includes `resolveSettings`).
Runs the CLI's own merge engine in-process:

```js
const r = await resolveSettings({ cwd: projectPath });
// r.effective   → merged Settings object
// r.provenance  → per-top-level-key { source, path }
// r.sources     → per-tier raw settings, low→high precedence
```

Live output in this repo:

```
sources: [ 'user /home/gnuthall/.claude/settings.json',
           'local /home/gnuthall/Projects/cloudcli/.claude/settings.local.json' ]
provenance: { permissions: { source: 'local', … }, model: { source: 'user', … }, … }
```

This is the cornerstone. It means a CLIde settings screen can show **effective
value + which file it came from + which tier would win** for free, including the
managed/policy tier — without CLIde reimplementing precedence, JSONC parsing, or
MDM lookup. It is marked `@alpha`, so it needs a version-pin note and a
try/catch fallback.

Caveat carried in its own docs: `permissions.defaultMode` is reported raw across
all tiers; pass it through the co-exported `filterEscalatingDefaultMode()`
(also confirmed present at runtime) before acting on it.

### 2. `Options.settings` — write without touching disk

`query()` accepts an inline `Settings` object (or a path) in the **flag tier**,
the highest user-controlled precedence:

```js
sdkOptions.settings = { alwaysThinkingEnabled: false, autoCompactEnabled: true };
```

This is the right mechanism for **per-session** and **per-project** overrides:
CLIde can layer its own choices on top of the user's files without ever
rewriting `~/.claude/settings.json`. Writing the user's global file remains an
option for genuinely global prefs, but is not required, and should be avoided
for anything session-scoped.

There are also control-protocol messages (`SDKControlGetSettingsRequest`,
`SDKControlApplyFlagSettingsRequest`) for mid-session changes; not yet
investigated for reachability from the public `query()` handle.

## Inventory by tier

~140 public top-level keys. Grouped by what CLIde should do with them.

### Tier A — worth adapting, real user value, works headless (≈25 keys)

These change agent behaviour, are meaningful in a web UI, and are not already
overridden.

| Key | Notes |
|---|---|
| `permissions.allow` / `.deny` / `.ask` | The big one. Reconciles the two-parallel-systems problem. |
| `permissions.additionalDirectories` | Currently unreachable in CLIde. |
| `alwaysThinkingEnabled` | `/config` → "Thinking mode". |
| `autoCompactEnabled`, `autoCompactWindow` | Already *read* by `claude-context-window.ts`; no way to change it. Pairs with the open compaction TODO item. |
| `showThinkingSummaries` | Affects stream content CLIde renders. |
| `fastMode`, `fastModePerSessionOptIn` | Fast mode has no CLIde surface at all. |
| `askUserQuestionTimeout` | CLIde renders AskUserQuestion; the timeout is invisible. |
| `outputStyle` | Real behavioural change. |
| `language` | Distinct from CLIde's UI language — this is *Claude's response* language. Prime confusion risk; needs careful labelling. |
| `autoMemoryEnabled`, `autoMemoryDirectory`, `autoDreamEnabled` | Memory is live on this machine and completely unsurfaced. |
| `skillOverrides`, `disableBundledSkills` | CLIde already has a Skills tab that reads `settings.json` (`claude-skills.provider.ts:111`) — this is the closest thing to an existing precedent. |
| `disableSkillShellExecution` | Security-relevant. |
| `enableWorkflows` / `disableWorkflows`, `workflowSizeGuideline`, `workflowKeywordTriggerEnabled`, `ultracode` | Whole feature invisible in CLIde. |
| `enableArtifact` / `disableArtifact` | Same. |
| `cleanupPeriodDays` | Transcript retention — directly affects CLIde's own session list. |
| `attribution.commit` / `.pr`, `includeCoAuthoredBy`, `includeGitInstructions` | Natural fit for the planned **Projects & Git** screen. |
| `respectGitignore` | Affects the file picker CLIde also has. |
| `worktree.baseRef`, `.sparsePaths`, `.bgIsolation` | `baseRef` is in `/config`; CLIde has a git panel. |
| `fallbackModel` | Complements the model picker rather than colliding with it. |
| `promptSuggestionEnabled`, `emojiCompletionEnabled` | Cheap toggles; `promptSuggestions` is also an `Options` field. |
| `disabledMcpjsonServers`, `enabledMcpjsonServers`, `enableAllProjectMcpServers` | CLIde has an MCP tab already; these are the missing gating controls. |
| `sandbox` | High value, but a spec of its own (nested object, platform-dependent, needs `bubblewrap` on Linux). |
| `hooks` | High value, high effort — a JSON editor at minimum. Deserves its own spec. |

### Tier B — read-only / display-only (≈15 keys)

Show the effective value with provenance, do not offer to edit. Either CLIde
overrides them, or they are enterprise policy that a user editing locally would
merely be confused by.

`model`, `effortLevel`, `permissions.defaultMode`, `env`, `availableModels`,
`enforceAvailableModels`, `modelOverrides`, `allowedMcpServers`,
`deniedMcpServers`, `allowManaged*Only`, `strictPluginOnlyCustomization`,
`claudeMd`, `claudeMdExcludes`, `minimumVersion` / `requiredMin/MaximumVersion`,
`companyAnnouncements`.

A "Claude Code configuration" screen that renders the resolved cascade read-only,
with source badges, would be genuinely useful on its own and is by far the
cheapest thing here.

### Tier C — terminal-only, meaningless in a web UI (≈45 keys)

Do not adapt. Several are in `/config` and will tempt a naive port.

`theme`*, `editorMode`, `vimInsertModeRemaps`, `hideVimModeIndicator`, `verbose`*,
`tui`, `viewMode`, `defaultView`, `autoScrollEnabled`,
`wheelScrollAccelerationEnabled`, `terminalProgressBarEnabled`,
`showTurnDuration`*, `showMessageTimestamps`*, `todoFeatureEnabled`*,
`spinnerTipsEnabled`, `spinnerVerbs`, `spinnerTipsOverride`,
`syntaxHighlightingDisabled`*, `terminalTitleFromRename`, `preferredNotifChannel`,
`prefersReducedMotion`*, `statusLine`, `subagentStatusLine`, `prUrlTemplate`,
`footerLinksRegexes`, `teammateMode`, `defaultShell`, `respondToBashCommands`,
`daemonColdStart`, `feedbackSurveyRate`, `feedbackDrafts`,
`showClearContextOnPlanAccept`, `switchModelsOnFlag`, `precomputeCompactionEnabled`,
plus everything in `~/.claude.json` (`diffTool`, `autoConnectIde`,
`autoInstallIdeExtension`, `copyOnSelect`, `copyFullResponse`,
`leftArrowOpensAgents`, `defaultToAgentsView`, `externalEditorContext`, …).

\* = CLIde already has its own native equivalent (its own theme, its own
timestamps, its own thinking toggle, its own reduced-motion story, its own todo
rendering). Surfacing the Claude Code key alongside CLIde's own control would
create a second switch that does nothing. **This is the main design hazard.**

### Tier D — enterprise / auth plumbing, out of scope (≈35 keys)

`apiKeyHelper`, `proxyAuthHelper`, `awsCredentialExport`, `awsAuthRefresh`,
`gcpAuthRefresh`, `processWrapper`, `policyHelper`, `otelHeadersHelper`,
`forceLoginMethod`, `forceLoginGatewayUrl`, `forceLoginOrgUUID`,
`parentSettingsBehavior`, `forceRemoteSettingsRefresh`, `strictKnownMarketplaces`,
`blockedMarketplaces`, `pluginSuggestionMarketplaces`, `disableSideloadFlags`,
`allowedHttpHookUrls`, `httpHookAllowedEnvVars`, `allowManagedHooksOnly`,
`wslInheritsWindowsSettings`, `sshConfigs`, `remote`, `autoUploadSessions`,
`remoteControlAtStartup`, `isolatePeerMachines`, `disableAgentView`,
`disableRemoteControl`, `disableDeepLinkRegistration`, `autoUpdatesChannel`,
`channelsEnabled`, `allowedChannelPlugins`, `defaultEnvironmentId`,
`plansDirectory`, `pluginTrustMessage`.

Most are managed-settings-only (the CLI ignores them outside the policy tier), so
a UI writing them to user settings would produce no effect.

### `/config` panel coverage

The interactive panel exposes 58 rows (measured 2.1.235; 43 visible in the current
build, the rest platform- or flag-gated), and it mixes the two stores freely. Mapped against the tiers above: ~12 rows are Tier A,
~4 are Tier B, and ~34 are Tier C. **`/config` is therefore a poor template for
CLIde's UI** — it is a terminal-shaped menu, and copying it would import mostly
terminal-only toggles. The schema, filtered by "does this survive headless," is
the better source.

## Effort estimate

| Piece | Size |
|---|---|
| Server: `GET /api/providers/claude/settings` wrapping `resolveSettings()` (effective + provenance + sources) | **S** |
| Read-only "Claude Code configuration" screen with source badges | **S/M** |
| Server: write path (targeted JSONC key writes to user/project/local, preserving comments) | **M** — the CLI uses `jsonc-parser` edits, not rewrite; CLIde should too |
| Tier A editors (grouped toggles/selects, ~25 controls) | **M** |
| Reconcile the two permission systems (localStorage vs `permissions.*`) | **M** — needs a migration/decision, likely an ADR |
| Per-session overrides via `Options.settings` | **S** once the write path exists |
| `hooks` editor | **L** — separate spec |
| `sandbox` editor | **M/L** — separate spec |

## Recommendation

1. **Do not fold this into the IA revamp.** That spec is a reorganisation with a
   stated no-new-settings non-goal; keep it clean. This lands as a new screen
   under the revamp's *Claude* provider row afterwards.
2. **Ship the read-only viewer first.** It is `S/M`, it depends on nothing, it
   immediately answers "why is Claude behaving like that in CLIde," and it makes
   the two-parallel-permission-systems bug visible instead of theoretical. It
   also derisks `resolveSettings()`'s `@alpha` status before anything depends on
   writes.
3. **Then Tier A writes, in two batches** — permissions reconciliation first
   (highest value, highest confusion cost today), then the behavioural toggles.
4. **Never surface Tier C.** Where CLIde has its own equivalent, the CLIde
   control is the only one that should exist.
5. **Multi-provider:** this is Claude-specific surface (`claude-*.provider.ts`
   territory), so per CLAUDE.md it is exempt from the provider-agnostic
   requirement — but it must live *inside* the per-provider screen the IA revamp
   defines, not as a global tab, or Cursor/Codex/OpenCode users get a Claude-only
   entry in a shared surface. Codex has an analogous `config.toml`; Cursor and
   OpenCode have their own. The screen should be a per-provider slot with a
   Claude implementation, not a hardcoded Claude screen.

## Unresolved, tracked in TODO.md

1. Should CLIde write the user's `~/.claude/settings.json` at all, or confine
   itself to project/local files plus the `Options.settings` flag tier? Writing
   the global file is shared mutable state with the terminal CLI and every other
   session on the machine.
2. Permissions reconciliation: migrate `localStorage` allow/deny into
   `settings.json`, or keep them separate and render both? Migration is cleaner
   but is a one-way door for existing users and for upstream.
3. Does the settings cascade need to be per-project in the UI? `resolveSettings`
   takes a `cwd`, and project/local tiers differ per project — so the screen is
   arguably project-scoped, not global, which cuts against the IA revamp's
   root-level placement.
