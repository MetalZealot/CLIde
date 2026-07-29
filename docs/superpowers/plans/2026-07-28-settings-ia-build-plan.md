# Settings IA — build plan and session handoff

- Date: 2026-07-28
- Branch: `feat/settings-ia` (worktree `cloudcli-wt-settings-ia`)
- Design: [the IA spec](../specs/2026-07-28-settings-information-architecture.md) — **read it first**; this
  file says *how and in what order*, never *what*. Where the two disagree, the
  spec wins on design and this file wins on sequencing.

## How to use this file

One packet per session. Read the spec, read your packet's brief, read the
standing rules, do the work, commit, tick the packet's status in the table
below in the same commit. Do not start a packet whose dependency is unticked.

**Sessions are sequential — never run two packets in parallel.** P2 creates the
registry and the shared primitives that every later packet imports; concurrent
sessions collide inside those files, and no claim board helps when the conflict
is one module deep.

## Standing rules for every packet

1. **One scroll container per screen**, owned by the screen component. Nothing
   inside a screen opens its own `overflow-y-auto`. This is the rule that fixes
   the Agents bugs; it is load-bearing, not stylistic. ~~One known exception,
   granted in P3c~~ — no exception was needed; see decision 4.
2. **No raw `<input type="checkbox">` in Settings.** Booleans are `SettingsToggle`.
3. **No hardcoded colour classes in Settings.** No `bg-blue-600`, `bg-red-100`,
   `border-orange-200`. Use the card `tone` prop → theme tokens.
4. **No `backdrop-filter` anywhere** ([ADR 0001](../../decisions/0001-no-backdrop-blur.md)). Use `bg-black/50` scrims.
5. **i18n: add `en` keys only.** `src/i18n/config.js:205` sets `fallbackLng: 'en'`,
   so the other nine locales degrade to English rather than showing raw keys.
   Do not edit non-`en` locale files. Do not delete existing keys mid-restructure —
   a dead-key sweep happens once, in P6.
6. **Ports are faithful.** Moving a control does not redesign it. If a port
   tempts you into a behaviour change, stop and note it for the user instead.
7. **Verification** — there is no frontend test runner (see the decisions log).
   Every packet ends with `npm run typecheck` and `npm run lint` clean, plus
   the packet's own click-through on `cloudcli-dev` (5173). Pure-logic modules
   get `node:test` tests in the `server/` style.
8. **Commits** — one packet, one or a few focused commits, `type(scope): subject`.
   Tick this file's status table in the same commit.

## Decisions log

| # | Decision | Status |
|---|---|---|
| 1 | **i18n: `en`-only additions**, other locales fall back. | Assumed; confirm |
| 2 | **Desktop rail may scroll** when providers are expanded; no group-collapse behaviour. Resolves spec open question 2. | Assumed; confirm |
| 3 | **Provider status copy**: status dot + "Signed in" / "Signed out". Spec open question 1 hedged on the Claude Layer-2 logout ambiguity; that was resolved in `1e13431`, so the constraint is gone. | Decide in P4 |
| 4 | ~~**Plugins gets an explicit carve-out** from rule 1~~ — **no carve-out needed.** The premise was wrong: `PluginTabContent.tsx`'s `h-full w-full overflow-auto` mounts in `MainContent`'s plugin tab, not in Settings. The Settings Plugins screen never rendered it, and the ported screen opens no scroller of its own (asserted in the browser: exactly one scroller on all four P3c screens, desktop and mobile). Rule 1 stands unqualified. | Decided in P3c |
| 5 | **No component-test infrastructure** (Vitest/jsdom). jsdom has no layout engine, so it would catch none of the scroll/safe-area/gesture bugs that motivated this work. Pure-logic modules get `node:test` tests instead — same runner as `server/`'s 40 test files. Playwright-based layout testing revisited separately, after this lands. | Decided |
| 6 | **This restructure is fork-only** and not an upstream candidate; it is a large, deliberate divergence in an upstream-heavy subtree. Note it in `docs/upstream-candidates.md` so future rebases have context. | Do in P6 |

## Packets

| # | Packet | Depends on | Size | Status |
|---|---|---|---|---|
| P0 | Pre-work cleanup | — | S | ✅ done |
| P1 | `ThemeContext` → light/dark/system | — | S | ✅ done |
| P2 | Registry + shell + primitives + Appearance | P0 | L | ✅ done |
| P3a | Chat + Notifications screens | P2 | M | ✅ done |
| P5 | QuickSettings removal | P3a | S | ✅ done |
| P3b | Projects & Git + Credentials screens | P2 | M | ✅ done |
| P3c | Extensions (Plugins / Browser / Tasks) + About | P2 | M | ✅ done |
| P4 | Agents restructure + PWA verification | P2 | L | ☐ |
| P6 | Search + cleanup sweep | P2, all screens | M | ☐ |

Two deliberate deviations from the spec's phase numbering:

- **P5 runs right after P3a, not after P4.** QuickSettings only depends on the
  Chat screen existing. Removing it early avoids maintaining two settings
  surfaces through the largest packet.
- **P1 is split out and landed first.** It is the one change touching shared
  state outside Settings, so it should not be tangled into a screen port.

### P0 — pre-work cleanup ✅

Delete `src/components/settings/view/SettingsMainTabs.tsx` and
`src/components/settings/view/tabs/api-settings/sections/VersionInfoSection.tsx`
(both imported nowhere). Delete the dead `AGENT_PROVIDERS` and `AGENT_CATEGORIES`
constants — the audit expected only a missing `'skills'` entry in the latter, but
both are unreferenced; `AgentsSettingsTab` computes its own lists inline. Fix
`openSettings(tab = 'tools')` in `src/hooks/useProjectsState.ts:668` to default
to `'agents'`.

Not fixed here: `voice` missing from `SETTINGS_MAIN_TABS`. P2's registry deletes
that array outright, so patching it is throwaway work.

### P1 — ThemeContext light/dark/system ✅

`src/contexts/ThemeContext.jsx` stores `'light' | 'dark' | 'system'` under
`localStorage.theme`; **a missing key means `'system'`**, and the `matchMedia`
listener stays live whenever the value is `'system'`.

The audit understated the bug: the DOM effect wrote `localStorage.theme` on
*every* run including first mount, so system-following died on first page load,
before the user touched anything. Writes are now explicit-only.

Context keeps `isDarkMode` (resolved boolean) and `toggleDarkMode` so all ~12
existing consumers are untouched, and adds `theme` + `setTheme`. `toggleDarkMode`
flips the resolved value and moves off `'system'`, as the spec describes.

**Also touches `index.html`** — the pre-first-paint inline script (lines 41–62)
mirrors the resolution logic and had to learn `'system'`, or system users get a
flash of the wrong theme before hydration. The spec did not anticipate this file.
Keep the two in sync; the comment there says so.

The three-way segmented control that consumes this is P2's job, in Appearance.

### P2 — registry, shell, primitives, Appearance ✅

**The keystone. Everything downstream copies its shape.** Read
`AppearanceScreen.tsx` before writing any new screen; it is the reference port.

Four decisions taken during the build that later packets inherit:

1. **The registry holds no components.** The IA spec put a `component` field on
   each node; instead `registry.ts` is pure data (icons are *names*, resolved by
   `SettingsIcons.tsx`, exhaustive by type) and `Settings.tsx` switches on the
   screen id. That keeps the registry unit-testable under `node:test` with no
   renderer, and keeps the data out of an import cycle with the views.
2. **The root list is not yet the spec's root list.** `agents`, `voice` and
   `git` are interim single screens so that nothing became unreachable mid-port;
   P4/P3a/P3b replace them. Reshaping the registry is each packet's job.
3. **The header "Saved" indicator stays for now.** The spec's save model removes
   it in favour of per-row confirmation, but it is currently the only feedback
   for provider login and the permissions/notifications autosave. It goes when
   P3a and P4 give those screens local confirmation — removing it earlier would
   have dropped the feedback with nothing in its place.
4. **`openSettings()` with no argument now opens the root list**, rather than
   defaulting to a tab. `settingsInitialTab` is `string | undefined` throughout.

New shared vocabulary lives in `view/primitives/`: `SettingsScreen`,
`SettingsGroup` (with `tone`), `SettingsNavRow`, `SettingsSelect`,
`SettingsSegmentedControl`, plus the existing `SettingsRow` (which gained a
`stacked` prop for wide controls) and `SettingsToggle`. **A `--warning` theme
token was added** to `index.css` and `tailwind.config.js` so `tone="warning"`
maps to a token rather than hardcoded orange — P3c and P4 need it.

`SettingsSidebar.tsx` and `SETTINGS_MAIN_TABS` are gone; the command palette now
renders from `SETTINGS_SCREENS`, so Voice is reachable from it for the first
time.

Build the registry (`SettingsNode`, stable dotted ids), the mobile navigation
stack, the desktop two-pane shell, and `SettingsScreen` / `SettingsGroup` /
`SettingsRow` / `SettingsNavRow` / the `tone` prop. Replace both `NAV_ITEMS` and
`SETTINGS_MAIN_TABS`. Extend `normalizeMainTab` with the old→new id mappings.

Highest-risk piece is history integration: each push adds a history entry, each
pop consumes one, closing from depth 2 unwinds all of them, and the Android back
gesture must pop rather than close. Get this right before porting any screen.

Then port **Appearance** and **Appearance › Code Editor** as the reference
implementation, including the light/dark/system segmented control over P1.

Add `node:test` coverage for the pure-logic parts — the id mappings, the nav
stack reducer as a pure function, and registry invariants (ids unique, every
`parent` resolves, max depth 2, every group non-empty). The missing-Voice defect
was exactly a registry invariant nobody checked. `src/` has no test tsconfig
wired yet; that plumbing is part of this packet.

### P3a — Chat + Notifications ✅

New Chat screen: message display (`showRawParameters`, `showThinking`), input
(`enterToSend` on touch-primary, `sendByCtrlEnter` otherwise — same pointer-type
gating and explanatory copy as today), voice enable + a Backend sub-screen shown
only when voice is on. `useUiPreferences` is unchanged; only the UI moves.
Registry-wise, the interim `voice` screen is gone: `chat` takes its root slot
and `chat.voice` (parent `chat`) is the Backend sub-screen; `LEGACY_SCREEN_IDS`
maps the old `voice` tab id straight to `chat.voice`.

**Correction to this packet's brief: the Voice base URL field is not dead.**
The brief's premise — "the server hardcodes the outbound host as an SSRF
defence and never sends a client value" — is true only of the server-proxied
path. `src/lib/voiceApi.ts` has a second, already-working path: when
`baseUrl` is non-blank, it fetches the STT/TTS backend directly from the
browser, bypassing the server proxy entirely — a legitimate bring-your-own-
backend feature, already documented in the `voiceSettings.note` i18n string.
Confirmed with the user before building; the field ships editable in
`ChatVoiceBackendScreen.tsx`, unchanged from `VoiceSettingsTab`. The TODO.md
entry this brief was drawn from should be corrected or closed as
not-actually-dead rather than acted on literally.

Added `SettingsTextField` to the primitives (the spec named it in P2 but no
packet had needed a text input yet); used for all six Backend fields.

Notifications: ported to `NotificationsScreen.tsx` with the three event
checkboxes converted to `SettingsToggle` and the hand-rolled push/desktop
cards converted to `SettingsGroup`/`SettingsRow`. The enable/disable actions
stayed as buttons (a permission-request flow, not a toggleable preference);
their hardcoded `bg-blue-600`/`bg-red-100` classes became the `Button`
component's existing `default`/`destructive` variants, and status/error text
moved from literal `text-green-600`/`text-red-600` to the `text-primary`/
`text-destructive` tokens. Per P2 decision 3, the header "Saved" indicator is
untouched here — Notifications still autosaves through it; it only goes once
P4 gives Agents/Permissions local confirmation too.

Verified via the throwaway harness (`npx vite --port 5174` on this worktree)
and the `cloudcli-browser` MCP tool: desktop rail selection, the Chat →
Backend nav row appearing only when voice is enabled, and all three ported
screens rendering correctly light-mode.

### P5 — QuickSettings removal ✅

`src/components/quick-settings-panel/` deleted entirely (ten files), along
with its import and `<QuickSettingsPanel />` mount in `ChatInterface.tsx`.
No layout compensation to unwind — the panel was `fixed`-positioned, so it
never occupied flow space in the chat view. The inert `quickSettingsHandlePosition`
localStorage key was left alone, as directed.

One cleanup beyond the literal file list: `LanguageSelector`'s `compact` prop
existed only for this panel's chrome (confirmed via grep — no other caller);
removed along with the branch that used it, rather than leaving a dead prop
on a shared component. The `quickSettings.*` i18n keys were **not** touched —
`ChatScreen.tsx` (P3a) still uses them, and rule 5's dead-key sweep is P6's
job, not this one's.

Verification was code-level only: `npm run typecheck` and `npm run lint`
clean (0 errors, same pre-existing warning baseline), plus a grep sweep
confirming zero remaining references to the panel, its export, or its
storage key. A live click-through was attempted via `cloudcli-branch-test`
on this worktree, but the chat view sits behind login and no test
credentials were available in this session — noted as a gap rather than
skipped silently. The change is a pure deletion of a self-contained
`fixed`-positioned component, which is what makes code-level verification
adequate here. See [ADR 0019](../../decisions/0019-quicksettings-removal.md).

### P3b — Projects & Git + Credentials ✅

New `ProjectsGitScreen.tsx`: the project sort-order select (moved off
Appearance, which now shows only Theme/Language/Code Editor) plus a git
identity group (name, email). **Removes the Git Save button** in favour of
save-on-blur: each field's `onBlur` schedules a 300ms-debounced write so
tabbing Name→Email coalesces into a single request rather than firing twice,
and a local inline success/error line replaces the old button-adjacent text.
Git writes hit real `git config --global`, so this is blur-triggered, never
per-keystroke. The registry's interim `git` screen is gone; `projects-git`
takes its slot and `LEGACY_SCREEN_IDS.git` maps to it so old deep links still
resolve.

**Correction to this packet's brief: the global header "Saved" indicator was
not removed.** The brief's literal text conflated two different things — the
header indicator (`SettingsHeader.tsx`, driven by `useSettingsController`'s
`saveStatus` for provider login and the Permissions/Notifications autosave)
and Git's own old inline "Saved successfully" text next to its Save button
in `GitSettingsTab.tsx`, which lived locally in that tab, not the header. The
save-on-blur confirmation added to `ProjectsGitScreen.tsx` is that same kind
of local, per-screen feedback — it does not touch `SettingsHeader.tsx` or
`useSettingsController.ts` at all. Per P2 decision 3 and P3a's identical
correction, the header indicator stays until P4 gives Agents/Permissions
local confirmation too.

New `CredentialsScreen.tsx` composes the existing `ApiKeysSection`,
`GithubCredentialsSection` and `NewApiKeyAlert` — all three ported to the
primitives rather than rewritten, so the create/delete/toggle/copy flows and
the newly-created-key disclosure are unchanged. `CredentialsSettingsTab.tsx`
and `GitSettingsTab.tsx` are deleted (confirmed via grep: no other
consumers).

Two primitive additions this packet needed, now available to later packets:
- `SettingsGroup` gained an `action` prop — a trailing header control (e.g.
  "New API Key" next to a group title), used by both Credentials sections
  instead of a hand-rolled title-row-with-button.
- `SettingsTextField` gained `type="email"`, `disabled`, and `onBlur`, needed
  for the git identity fields.

`NewApiKeyAlert`'s hardcoded `border-yellow-500/20 bg-yellow-500/10` /
`text-yellow-500` became `<SettingsGroup tone="warning">` + `text-warning`,
per rule 3.

Verified via a throwaway Playwright script driving the harness on
`localhost:5174` directly to a screenshot file, rather than through the
`cloudcli-browser` MCP tool — that tool's `browser_navigate`/`browser_snapshot`
return the full base64 screenshot inline in the tool result, which overloaded
context mid-session. See the environment-traps note in "Verification
reference" below. Confirmed: Appearance shows only Theme/Language/Code
Editor (project sorting gone), Projects & Git renders both groups with
working save-on-blur (a deliberately-broken write showed the inline error
line, as expected with no auth token in the harness), and Credentials renders
both sections with their new `action` buttons and opens the "New API Key"
disclosure form correctly. `npm run typecheck` and `npm run lint` are clean
(0 errors; same pre-existing warning baseline, none in touched files), and
all 28 registry `node:test` cases still pass.

### P3c — Extensions + About ✅

Four new screens — `ExtensionsPluginsScreen`, `ExtensionsBrowserScreen`,
`ExtensionsTasksScreen`, `AboutScreen` — replacing `PluginSettingsTab`,
`BrowserUseSettingsTab`, `TasksSettingsTab` and `AboutTab`, all four of which
are deleted. Registry untouched: `plugins` / `browser` / `tasks` / `about`
were already the spec's final ids in the right groups, so P3c is a pure view
port. All fetch/install/toggle logic moved verbatim; only the chrome changed.
`Settings.tsx` no longer wraps anything in a bare `<SettingsScreen>` except
Agents, which is P4's.

**Decision 4 is settled the other way: there is no plugin carve-out.** The
`h-full w-full overflow-auto` the brief pointed at lives in
`PluginTabContent.tsx`, which `MainContent` mounts for a plugin's *tab* — it
was never part of the Settings Plugins screen, so rule 1 was never in tension
with it. The note now lives as a docstring on `ExtensionsPluginsScreen` so the
next reader who greps `overflow-auto` in the plugins tree does not re-open it.

Two judgement calls worth knowing about:

- **`RecommendationSection` is deliberately not a `SettingsGroup`.** Each
  plugin card carries its own border, and nesting them inside a group's card
  doubles the chrome. It keeps a plain `<section>` and only its heading was
  changed, to `SettingsGroup`'s exact type scale, so the screen still reads as
  one system. Same reasoning would apply to any future card-list screen.
- **Green/blue/amber semantics mapped onto existing tokens** rather than a new
  one. Enabled plugin, running-server dot and official recommendations →
  `primary` (following P3a, which took `text-green-600` → `text-primary`);
  unofficial recommendations → `warning`; every red → `destructive`. No
  `--success` token was added; if a later packet finds `primary` genuinely
  ambiguous for "healthy", that is the moment to add one, not now.

The remaining screen-level headings were dropped where the shell already shows
them: Tasks' `mainTabs.tasks` section title and Plugins' `pluginSettings.title`
h3 both duplicated the header/rail label. Plugins' description moved to
`SettingsScreen`'s `description` slot.

**Not done, deliberately:** Browser and About still hold hardcoded English
strings (they always did — neither had i18n). Adding `en` keys is allowed by
rule 5 but is not a port, so it is left for P6's sweep, which is already
touching the i18n files. Likewise `AppearanceSettingsTab.tsx` is now the only
remaining consumer of `SettingsSection`/`SettingsCard` and is itself imported
nowhere — dead since P2, and P6's to delete along with those two primitives.

Verified with the throwaway harness described below, extended with a
`window.fetch` stub so the screens render *populated*: an enabled plugin with a
running server plus a disabled one, Task Master both installed and missing, and
a Browser runtime with Chromium absent. Screenshotted light and dark at desktop
and 390px, and the Playwright pass asserted **exactly one scroll container per
screen** on all eight combinations, with no console or page errors.
`npm run typecheck` and `npm run lint` clean (0 errors, unchanged warning
baseline), 28 registry `node:test` cases still pass.

### P4 — Agents restructure

Providers to root. Provider screen = inline account card (why the user opened
it) then nav rows for Permissions, MCP Servers (*n*), Skills (*n*, hidden for
OpenCode). Permissions stays provider-branched exactly as today; the
skip-permissions warning becomes `tone="warning"` instead of hardcoded orange.

MCP (`McpServers`, 320 lines) and Skills (`ProviderSkills`, 751 lines) are
mostly *re-parenting*, not rewriting — neither opens a scroll container in its
pane body. The `overflow-y-auto` in `ProviderSkills.tsx:611` is inside its own
add-skill dialog and is fine.

Ends with **the PWA verification pass**: `npm run build:client`, refresh the
installed PWA on 3001, and check safe-area padding at the bottom of every screen
plus Android back-gesture behaviour against the nav stack. Both are acceptance
criteria and **neither is verifiable at 5173**.

### P6 — search and sweep

Search field over screen labels, registry keywords, and per-screen setting
labels. Then the dead-i18n-key sweep held back by rule 5, and the
`docs/upstream-candidates.md` note from decision 6.

## Verification reference

Client-only throughout — Tier 2 of the project's UI dev loop.

```
npm run typecheck      # tsc, client + server
npm run lint           # eslint src/ server/
npm run build:client   # then refresh 3001 — no restart needed for src/ changes
```

If a packet turns out to need server changes (none are anticipated), it needs
`npm run build:server` and a restart **from SSH, never from inside a CLIde
session**.

⚠️ **`cloudcli-dev.service` on 5173 serves `~/Projects/cloudcli`, not this
worktree.** Starting it and pointing a browser at 5173 silently tests `main`.
P1 lost a test run to this. From this worktree, run your own instance:

```
npx vite --port 5174 --strictPort
```

**Driving the real app needs a login, and Settings sits behind it.** P2 worked
around this with a throwaway harness — a `settings-harness.tmp.html` +
`.tmp.jsx` pair at the repo root that mounts `<Settings isOpen>` inside a
`ThemeProvider` with i18n imported, reading `?screen=` for the initial screen.
Vite serves any root-level HTML, so no config change is needed. The API calls
401 harmlessly. Recreate it when a packet needs browser verification and delete
it before committing; it is ~30 lines and rots faster than it would earn its
keep in-tree.

P3c added ~40 lines to it worth repeating: a `window.fetch` stub that answers a
small fixture table by path and 401s everything else. `authenticatedFetch`
(`src/utils/api.js`) goes through global `fetch`, so stubbing it is enough to
render *populated* states — an installed-and-running plugin, a missing Task
Master, a half-installed browser runtime — instead of only the empty/error
branches a bare 401 gives you. P4 needs the same trick for provider auth
states.

Playwright is worth using for behaviour that is awkward to eyeball: P1 asserted
theme resolution across seven load cases, and P2 asserted the whole history
contract (each push adds one entry, back pops one screen without closing,
closing from depth 2 returns to the pre-Settings entry, deep links still have a
back path, desktop selection touches no history) plus one-scroll-container-per-
screen. **Reuse `history.state?.__clideSettingsDepth` to assert unwinding —
`history.length` does not shrink on `go(-n)` and will mislead you.**

Two environment traps, both hit during P2. The worktree's `node_modules` is a
**symlink to `~/Projects/cloudcli/node_modules`**, and `playwright` gets pruned
from it periodically. Do **not** run `npm install` there to fix it — that tree
backs the live service on 3001. Install to a scratch prefix instead:

```
npm install --prefix /tmp/pw-runtime playwright
NODE_PATH=/tmp/pw-runtime/node_modules node your-script.mjs
```

The Chromium binary itself lives in `~/.cache/ms-playwright` and survives;
`npx playwright install chromium` restores it if it does not. Real-browser tests
still cannot reach the installed-PWA acceptance criteria in P4 — those need the
phone.

**Third trap, hit in P3b: don't drive verification through the `cloudcli-browser`
MCP tool.** `browser_navigate` and `browser_snapshot` return the full base64
screenshot data URL inline in the tool result — no save-to-file option — and it
overloaded context mid-session. Use a small Playwright script instead (the
project's own `~/Projects/cloudcli/node_modules/playwright` works — run the
script from inside a checkout that has `node_modules`, since ESM module
resolution walks up from the script's own path, not `cwd`) that navigates and
calls `page.screenshot({ path })` directly to a file, then `Read` the file.
Also: starting a second Vite instance on 5174 for the harness is fine, but do
**not** symlink another `node_modules` into the worktree root to work around
missing `playwright` there — this worktree already has its own real
`node_modules`, and a stray extra symlink at the worktree root gets picked up
by Vite's own file watcher on top of the real one, doubling every watch and
hitting the OS file-descriptor limit (`ENOSPC`), which crashes the dev
server. If `node_modules/playwright` really is missing, use the scratch-prefix
approach above instead of a top-level symlink.
