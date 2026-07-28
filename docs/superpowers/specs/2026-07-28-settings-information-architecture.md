# Settings information architecture and mobile-first restructure

- Date: 2026-07-28
- Status: Design reference; implementation not started
- Scope: Settings navigation model, category tree, per-screen layout, the
  Agents pane restructure, absorption of the QuickSettings panel, shared
  settings primitives, and a settings registry that also feeds the command
  palette
- Related TODO items:
  - "Mobile: Agents page in settings is buggy when scrolling"
  - "Mobile: in The Agents Page in Settings, the Connection Status panel has a
    small sliver of the bottom cut off"
  - "Quick settings button (right edge of convo window) is buggy on mobile …
    Fix or remove?"
  - "Voice Settings: the Base URL field in `VoiceSettingsTab` is dead"
  - "Typography overhaul" (reserves `--font-prose` for a future Settings font
    switcher)
- Related decisions:
  - [ADR 0001 — no backdrop-blur](../../decisions/0001-no-backdrop-blur.md)
  - [ADR 0005 — mobile bottom navbar as in-flow layout](../../decisions/0005-mobile-bottom-navbar.md)
  - [ADR 0009 — one shared context-menu overlay; touch belongs to `useLongPress`](../../decisions/0009-context-menu-overlay-touch-ownership.md)
  - [ADR 0010 — PWA-mode fixed-inset override](../../decisions/0010-pwa-mode-fixed-inset-override.md)

## Purpose

Settings has grown to ten top-level tabs, one of which (Agents) contains a
second two-dimensional tab system holding four subsystems across four
providers. On a phone the only way to move between the ten is a horizontally
scrolling pill bar that shows about three at a time, and the Agents pane
creates a scroll container nested inside the modal's own scroll container.

This document defines a replacement information architecture and navigation
model, mobile-first, with desktop rendering the same screens through a
two-pane layout. It also defines the shared primitives every settings screen
must use, so the three visual languages currently in the pane collapse to one.

## Executive summary

1. **Navigation becomes drill-down, not tabs.** The mobile root is a scrollable
   grouped list of destinations. Tapping one pushes a detail screen with a back
   affordance. This removes the horizontal scroller, gives an at-a-glance
   overview of everything Settings contains, creates room for a search field,
   and structurally eliminates nested scrolling because each screen owns
   exactly one scroll container.
2. **Desktop uses the same screens in a two-pane master/detail.** The root list
   becomes the left rail; the detail screen renders on the right. One set of
   screen components serves both form factors, differing only in how the shell
   presents them.
3. **Providers are promoted to the root list.** Claude, Cursor, Codex, and
   OpenCode each become a top-level destination. The provider × category grid
   inside the current Agents tab is replaced by a provider screen whose
   subsystems (Permissions, MCP, Skills) are navigation rows.
4. **The QuickSettings edge panel is removed.** Its exclusively-owned settings
   (tool display, input behavior) move into a new Chat screen; its duplicated
   settings (dark mode, language, voice enable) already have homes.
5. **A single declarative registry** describes groups, screens, and searchable
   settings. It drives the root list, the desktop rail, the command palette,
   search, and deep links — one source of truth instead of the two divergent
   arrays that exist today.

## Current state

### Shell

`Settings.tsx` renders a modal at `z-[9999]` — full-screen on mobile, a
`90vh` / `max-w-4xl` card on desktop. Header holds the title, a transient
"Saved" string, and a close button. Body is `SettingsSidebar` plus a single
scrolling `<main>` that renders whichever tab is active.

`SettingsSidebar.tsx` renders two navs from one `NAV_ITEMS` array: a `w-56`
vertical list at `md:` and up, and a horizontally scrolling `PillBar` of all
ten items below it.

### Contents

| Tab | Contents |
|---|---|
| Agents (default) | Provider pills × category tabs → up to 16 panes: Account (auth status, login, usage windows, Codex transport diagnostics), Permissions (skip-permissions, allow/deny tool lists, Cursor commands, Codex mode), MCP servers, Skills |
| Appearance | Dark mode, language, project sort order, code editor (word wrap, minimap, line numbers, font size) |
| Git | `user.name`, `user.email`, explicit Save button |
| API Tokens | CLIde API keys CRUD, GitHub credentials CRUD |
| Voice | Enable toggle, base URL, API key, STT model, TTS model, voice, format |
| Tasks | Task Master install detection, one enable toggle |
| Browser | Enable toggle, Playwright/Chromium runtime status, install button |
| Plugins | Installed plugins, recommendations, install/remove |
| Notifications | Web push or desktop push, sound plus test button, three event checkboxes |
| About | Version, GitHub/Discord/docs links, hosted CTA, Pro placeholders, license |

Separately, `QuickSettingsPanel` (an edge-drag panel over the chat view) holds
Appearance (dark mode, language), Tool Display (`showRawParameters`,
`showThinking`), and Input (`sendByCtrlEnter` or `enterToSend` depending on
pointer type, `voiceEnabled`).

### Problems

1. **Navigation does not scale on mobile.** Ten pills in a horizontal scroller
   means no overview, no search, and destinations that are only reachable by
   scrolling a strip sideways. This is the primary problem; the rest are
   secondary.

2. **Nested scroll containers.** `AgentsSettingsTab` negative-margins itself
   out of the parent's padding (`-mx-4 -mb-4 -mt-2 md:-mx-6 md:-mb-6`) and then
   `AgentCategoryContentSection` opens its own `overflow-y-auto` inside
   `<main>`'s `overflow-y-auto`, with two non-scrolling tab rows pinned above
   it. This is the structural cause of both reported Agents scrolling bugs,
   including the clipped Connection Status panel — the inner container's height
   is derived from a flex chain that does not account for the modal's safe-area
   padding.

3. **Three visual languages.** The `SettingsSection` / `SettingsCard` /
   `SettingsRow` / `SettingsToggle` primitives are sound but only Appearance,
   Tasks, Git, and Browser use them. Notifications, Permissions, and Account
   hand-roll divs with hardcoded `bg-blue-600`, `bg-red-100`,
   `border-orange-200` and similar, bypassing theme tokens. About is bespoke
   again.

4. **Three controls for one semantic.** `SettingsToggle` (a switch), raw
   `<input type="checkbox">` (notification events, skip-permissions), and
   `DarkModeToggle` all express boolean settings.

5. **Labels do not match contents.** "Appearance" holds language, project sort
   order, and code-editor preferences. Voice occupies a top-level slot for one
   toggle plus backend credentials.

6. **Split brain with QuickSettings.** Dark mode, language, and voice-enable
   exist in both surfaces. Tool-display and input preferences exist *only* in
   QuickSettings, so removing that panel currently orphans them.

7. **Inconsistent save model.** Everything autosaves except Git, which has an
   explicit Save button, while a global "Saved" indicator in the modal header
   is triggered by only some paths.

8. **Concrete defects and dead code found during the audit:**
   - `voice` is present in the `SettingsMainTab` union and in
     `SettingsSidebar`'s `NAV_ITEMS`, but missing from `SETTINGS_MAIN_TABS` in
     `constants/constants.ts` — so the command palette cannot reach Voice.
   - `src/components/settings/view/SettingsMainTabs.tsx` (58 lines) is imported
     nowhere.
   - `src/components/settings/view/tabs/api-settings/sections/VersionInfoSection.tsx`
     (161 lines) is imported nowhere.
   - `openSettings(tab = 'tools')` in `useProjectsState.ts` defaults to a tab id
     that no longer exists; it survives only via a compatibility branch in
     `normalizeMainTab`.

## Proposed information architecture

The root screen is a grouped list. Section headers are labels, not tappable.

**Agents**
- Claude — status pill (Connected / Signed out)
- Cursor
- Codex
- OpenCode

**App**
- Appearance — theme, language, editor
- Chat — messages, input, voice
- Notifications — push, sound, events
- Projects & Git — sorting, git identity

**Extensions**
- Plugins — *n* installed
- Browser — Playwright sessions
- Tasks — Task Master

**System**
- Credentials — API keys, GitHub tokens
- About — version, links, license

Four groups, thirteen rows, every row one tap from a focused screen. Promoting
providers to the root is what makes this a net *reduction* in depth: the
deepest and most-visited area loses a level rather than gaining one.

### Where every existing control lands

| Current location | New location |
|---|---|
| Agents › *provider* › Account | *Provider* screen, inline account card at top |
| Agents › *provider* › Permissions | *Provider* › Permissions |
| Agents › *provider* › MCP | *Provider* › MCP Servers |
| Agents › *provider* › Skills | *Provider* › Skills |
| Appearance › dark mode | Appearance › Theme |
| Appearance › language | Appearance › Language |
| Appearance › code editor (4 settings) | Appearance › Code Editor (sub-screen) |
| Appearance › project sort order | Projects & Git › Project list |
| Git › name, email | Projects & Git › Git identity |
| Voice tab (enable) | Chat › Voice |
| Voice tab (backend config) | Chat › Voice › Backend (sub-screen) |
| Notifications (all) | Notifications |
| API Tokens › API keys | Credentials › API keys |
| API Tokens › GitHub credentials | Credentials › GitHub |
| Tasks | Extensions › Tasks |
| Browser | Extensions › Browser |
| Plugins | Extensions › Plugins |
| About | System › About |
| QuickSettings › dark mode, language | Appearance (already exists there) |
| QuickSettings › `showRawParameters`, `showThinking` | Chat › Message display |
| QuickSettings › `sendByCtrlEnter`, `enterToSend` | Chat › Input |
| QuickSettings › `voiceEnabled` | Chat › Voice |

`sidebarVisible` in `useUiPreferences` is transient layout state, not a user
setting, and does not appear in Settings.

## Navigation model

### Mobile

A navigation **stack** inside the existing modal. Root list is depth 0; a
category screen is depth 1; a sub-screen (Code Editor, Voice Backend, a
provider's Permissions) is depth 2. Maximum depth is 2.

- The header is one element across all depths. At depth 0 it shows "Settings"
  and a close button. At depth ≥ 1 it shows a back chevron with the parent's
  name, the current screen title, and the close button.
- Transitions push and pop horizontally. They must be suppressed under
  `prefers-reduced-motion`. Per ADR 0001, no backdrop-filter anywhere.
- **The hardware/browser back button must pop one screen, not close Settings.**
  Each push adds a history entry; each pop consumes one. Closing Settings from
  depth 2 must unwind all entries so the browser history is not left with
  stale settings states. This matters most in the installed PWA, where the
  Android back gesture is the primary back affordance.
- Exactly one scroll container per screen, owned by the screen component.
  Nothing inside a screen may open its own `overflow-y-auto`. This is the rule
  that fixes the Agents scrolling bugs, and it should be enforced by review,
  not by convention alone.
- Bottom padding uses the existing `pb-safe-area-inset-bottom` treatment.

### Desktop

Two-pane master/detail, no back button and no navigation stack.

- The left rail renders the same registry as a grouped list, always visible.
- Selecting a provider **expands it in the rail** to disclose Permissions, MCP
  Servers, and Skills as indented child rows, so the right pane always renders
  a leaf screen. The provider's account card renders as the provider's own
  screen (selected when the parent row is clicked).
- The right pane is the detail screen, scrolling independently. Same components
  as mobile; only the shell differs.

### Deep links and the registry

A single registry module replaces both `NAV_ITEMS` and `SETTINGS_MAIN_TABS`:

```
SettingsNode =
  | { kind: 'group';  id; label }
  | { kind: 'screen'; id; label; icon; group; keywords; component; parent? }
```

It drives the root list, the desktop rail, the command palette entries, search,
and `openSettings(id)`. Screen ids are stable strings usable as deep links
(`'appearance'`, `'appearance.editor'`, `'agent.claude.permissions'`).

`normalizeMainTab` keeps its compatibility shim and gains mappings from the old
tab ids to new screen ids (`'tools'` and `'agents'` → root, `'api'` →
`'credentials'`, `'git'` → `'projects-git'`, `'voice'` → `'chat.voice'`). One
registry means the Voice-missing-from-the-command-palette class of bug cannot
recur.

## Screens

Each screen is a component receiving only what it needs, rendering
`SettingsScreen` + groups of rows. Sketches below list rows in order.

**Provider (Claude / Cursor / Codex / OpenCode).** Account card (logo, name,
connection state, sign-in or sign-out, usage windows, and for Codex the
transport diagnostics) — inline at top, because it is why the user opened the
screen. Then navigation rows: Permissions, MCP Servers (*n* configured), Skills
(*n*, hidden for OpenCode).

**Provider › Permissions.** Provider-specific, driven by the existing
capability shape: Claude gets skip-permissions plus allow/deny tool lists;
Cursor gets skip-permissions plus allow/deny command lists; Codex gets the
permission-mode selection. The dangerous skip-permissions control keeps its
warning treatment, but through a `tone="warning"` card rather than hardcoded
orange classes.

**Appearance.** Theme (a three-way Light / Dark / System segmented control —
see below), Language, and a Code Editor navigation row. The
Code Editor sub-screen holds word wrap, minimap, line numbers, and font size.
Reserve a Typography row here for the font-switcher the typography spec
anticipates.

`ThemeContext.jsx` currently exposes only `isDarkMode` / `toggleDarkMode`. It
*starts* by following `prefers-color-scheme`, but the moment the user toggles
once it writes `localStorage.theme` and the `matchMedia` listener stops
applying — permanently, with **no way back to system-following** short of
clearing the key by hand. Adding the segmented control therefore requires
widening the context to store `'light' | 'dark' | 'system'`, treating a missing
key as `'system'` (which preserves current first-run behavior), and keeping the
media listener live whenever the value is `'system'`. `DarkModeToggle` is used
outside Settings too, so it should keep working — a two-state toggle over a
three-state value flips between light and dark and simply moves off `'system'`.
This is the one place the restructure touches shared state rather than just
moving UI; it is small, but it is not a pure move.

**Chat.** Message display group (`showRawParameters`, `showThinking`), Input
group (`enterToSend` on touch-primary devices, `sendByCtrlEnter` otherwise —
same pointer-type gating as today, with the explanatory copy retained), and
Voice group (enable toggle plus a Backend navigation row shown only when voice
is enabled). The Voice Backend sub-screen holds API key, STT model, TTS model,
voice, and format. Per the existing TODO, the **base URL field must not ship as
an editable input** — the server hardcodes the outbound host from
`VOICE_API_BASE_URL` as an SSRF defense. Render it read-only from
`GET /api/voice/health` or omit it.

**Notifications.** Delivery group (web push on web, desktop bridge on the
desktop app — the existing either/or), Sound group (toggle plus test button),
Events group (action required, stop, error). All three event checkboxes become
`SettingsToggle` switches.

**Projects & Git.** Project list group (sort order), Git identity group (name,
email — see the save model below).

**Extensions › Plugins / Browser / Tasks.** Content is unchanged; each is
wrapped in `SettingsScreen` and its bespoke cards are re-expressed through the
shared primitives. Browser keeps its runtime status chips and install button.
Tasks keeps its not-installed guidance card at `tone="warning"`.

**Credentials.** API keys group and GitHub credentials group, both keeping
their existing create/list/toggle/delete flows and the newly-created-key
disclosure alert.

**About.** Largely as-is: version with update check, links, license. The Pro
placeholder cards are upstream's; keep them behind the existing `!IS_PLATFORM`
guard rather than removing them, to limit rebase surface.

## Shared primitives

One vocabulary, used by every screen. Existing primitives are extended rather
than replaced.

- `SettingsScreen` — title, optional description, the single scroll container,
  safe-area padding. Every screen's outermost element.
- `SettingsGroup` — section header plus a card. (Today's `SettingsSection` and
  `SettingsCard` collapse into this; the divided-card variant is a prop.)
- `SettingsRow` — label, optional description, trailing control slot.
- `SettingsNavRow` — icon, label, optional trailing value preview or badge,
  chevron. The drill-down affordance; new.
- Controls: `SettingsToggle` (the only switch in Settings), `SettingsSelect`,
  `SettingsTextField`, and a button row for actions.

Two rules that do the real work:

- **No raw `<input type="checkbox">` in Settings.** Booleans are
  `SettingsToggle`.
- **No hardcoded color classes in Settings.** Cards take
  `tone: 'default' | 'warning' | 'danger'`, which maps to theme tokens. This is
  what converts Notifications, Permissions, Account, and Tasks to the common
  language without redesigning each one individually.

## Save model

- Toggles, selects, and radio choices save immediately on change.
- Text fields save on blur, debounced, with an inline "Saved" confirmation on
  the row — not in the modal header.
- **The Git Save button is removed** in favor of save-on-blur, so the model is
  uniform. Git config writes go to real git config, so save-on-blur (not
  save-per-keystroke) is the required behavior, with validation before write.
- The global header "Saved" indicator is removed; confirmation is always local
  to the thing that changed.

## Search

A search field at the top of the mobile root list and the desktop rail. It
filters against screen labels and the registry's `keywords`, and — in a second
pass — against individual setting labels registered by each screen, so
"minimap" or "enter to send" resolves directly to the right screen.

Search is **phase 4**, but the registry must be shaped for it from phase 1;
retrofitting a flat setting index onto ad-hoc screens is the expensive
ordering.

## QuickSettings removal

1. Move `showRawParameters`, `showThinking`, `sendByCtrlEnter`, `enterToSend`
   into the Chat screen (`useUiPreferences` is unchanged — only the UI moves).
2. Delete `src/components/quick-settings-panel/` including the drag hook, the
   handle, and `HANDLE_POSITION_STORAGE_KEY` persistence.
3. Remove the handle's mount point from the chat view and any layout
   compensation it required.
4. Leave the stored `quickSettingsHandlePosition` localStorage key alone; it
   becomes inert and costs nothing.

Accepted cost, stated plainly: tool-display and input toggles go from a
one-swipe panel to Settings → Chat. If that proves too far in daily use, the
right response is a small chat-header overflow menu that links into Chat
settings — not resurrecting a second settings surface with its own state.

## Build sequence

1. **Pre-work cleanup.** Delete `SettingsMainTabs.tsx` and
   `VersionInfoSection.tsx`; fix `openSettings`'s `'tools'` default. Small,
   independent, safe to land first.
2. **Registry + shell + primitives.** The navigation stack, the two-pane
   desktop shell, `SettingsScreen` / `SettingsGroup` / `SettingsNavRow`, and the
   registry. Port one simple screen (Appearance) to prove the shape.
3. **Simple screens.** Chat, Notifications, Projects & Git, Extensions
   (Plugins / Browser / Tasks), Credentials, About. Each port converts raw divs
   and checkboxes to the primitives.
4. **Agents restructure.** Providers to root, provider screen with account card
   plus navigation rows, Permissions/MCP/Skills as their own screens. Verify
   the scroll bugs are gone on the installed PWA, not just at 5173.
5. **QuickSettings removal.**
6. **Search.**

Phases 2–4 are the substance; 1, 5, and 6 are each small.

## Verification

Client-only work throughout, so per the project's UI dev loop this is Tier 2:
`cloudcli-dev` on 5173 for the iterative build, then `npm run build:client` and
a refresh on 3001 for verification. No server changes are anticipated; if any
appear, they need `build:server` and an SSH restart.

Two things are **only** verifiable on the installed PWA against 3001, not at
5173:

- Safe-area padding at the bottom of every screen (the clipped Connection
  Status panel).
- Android back-gesture behavior against the navigation stack.

Both are acceptance criteria, so budget a PWA verification pass at the end of
phase 4.

## Non-goals

- No new settings are introduced. This is a reorganization of what exists.
- No server-side changes. Persistence (localStorage, `/api/settings/*`,
  `useUiPreferences`) is untouched; only the UI that reads and writes it moves.
- The typography overhaul is a separate spec; this one only reserves a row for
  its font switcher.
- Multi-provider compatibility is preserved by construction: the provider
  screen is generated per provider from existing capability data, and
  Permissions remains provider-branched exactly as it is today.

## Open questions

1. **Provider row status copy.** "Connected" vs "Signed in" vs a bare status
   dot. Interacts with the known Claude Layer-2 logout ambiguity, where an
   expired OAuth credential currently reports as logged out.
2. **Desktop rail with providers expanded** may run long enough to scroll.
   Acceptable, or should the Agents group collapse when another group is
   selected?

## Decisions worth an ADR when implemented

- Drill-down navigation with a history-backed stack, replacing tabs (and the
  one-scroll-container-per-screen rule that comes with it).
- Removal of the QuickSettings panel as a second settings surface.
