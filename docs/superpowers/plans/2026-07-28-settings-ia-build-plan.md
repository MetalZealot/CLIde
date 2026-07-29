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
   the Agents bugs; it is load-bearing, not stylistic. One known exception,
   granted in P3c — see the decisions log.
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
| 4 | **Plugins gets an explicit carve-out** from rule 1: `PluginTabContent.tsx:143` mounts third-party plugin code into `h-full w-full overflow-auto` and needs a bounded height by design. Document the exception rather than reworking plugin mounting. | Decide in P3c |
| 5 | **No component-test infrastructure** (Vitest/jsdom). jsdom has no layout engine, so it would catch none of the scroll/safe-area/gesture bugs that motivated this work. Pure-logic modules get `node:test` tests instead — same runner as `server/`'s 40 test files. Playwright-based layout testing revisited separately, after this lands. | Decided |
| 6 | **This restructure is fork-only** and not an upstream candidate; it is a large, deliberate divergence in an upstream-heavy subtree. Note it in `docs/upstream-candidates.md` so future rebases have context. | Do in P6 |

## Packets

| # | Packet | Depends on | Size | Status |
|---|---|---|---|---|
| P0 | Pre-work cleanup | — | S | ✅ done |
| P1 | `ThemeContext` → light/dark/system | — | S | ✅ done |
| P2 | Registry + shell + primitives + Appearance | P0 | L | ☐ |
| P3a | Chat + Notifications screens | P2 | M | ☐ |
| P5 | QuickSettings removal | P3a | S | ☐ |
| P3b | Projects & Git + Credentials screens | P2 | M | ☐ |
| P3c | Extensions (Plugins / Browser / Tasks) + About | P2 | M | ☐ |
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

### P2 — registry, shell, primitives, Appearance

**The keystone. Everything downstream copies its shape, so budget a full session.**

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

### P3a — Chat + Notifications

New Chat screen: message display (`showRawParameters`, `showThinking`), input
(`enterToSend` on touch-primary, `sendByCtrlEnter` otherwise — same pointer-type
gating and explanatory copy as today), voice enable + a Backend sub-screen shown
only when voice is on. `useUiPreferences` is unchanged; only the UI moves.

**The Voice base URL must not ship as an editable input** — the server hardcodes
the outbound host from `VOICE_API_BASE_URL` as an SSRF defence and never sends a
client value. Render it read-only from `GET /api/voice/health`, or omit it.

Notifications: port as-is, converting the three event checkboxes to
`SettingsToggle` and the hand-rolled cards to `tone`.

### P5 — QuickSettings removal

Only after Chat exists. Delete `src/components/quick-settings-panel/` entirely,
remove the handle's mount point from `ChatInterface.tsx` and any layout
compensation, leave the inert `quickSettingsHandlePosition` localStorage key
alone. Write the ADR for removing the panel as a second settings surface.

### P3b — Projects & Git + Credentials

Projects & Git: project sort order plus git identity. **Removes the Git Save
button** in favour of save-on-blur (debounced, inline per-row confirmation) and
removes the global header "Saved" indicator. Git writes hit real git config, so
save-on-blur with validation before write — never per-keystroke.

Credentials: API keys and GitHub credentials, existing flows and the
newly-created-key disclosure alert preserved.

### P3c — Extensions + About

Plugins, Browser, Tasks, About wrapped in `SettingsScreen` with bespoke cards
re-expressed through the primitives. Tasks' not-installed guidance becomes
`tone="warning"`. About keeps upstream's Pro placeholders behind the existing
`!IS_PLATFORM` guard, to limit rebase surface. Settle decision 4 here and
document the plugin carve-out inline where the exception lives.

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

Playwright with Chromium is available and worth using for behaviour that is
awkward to eyeball — P1 used it to assert theme resolution across seven load
cases, and **P2 should use it for the navigation stack's history behaviour**
(push adds an entry, pop consumes one, close from depth 2 unwinds all). Note
that `npm install` prunes the Chromium binary; restore it with
`npx playwright install chromium`. Real-browser tests still cannot reach the
installed-PWA acceptance criteria in P4 — those need the phone.
