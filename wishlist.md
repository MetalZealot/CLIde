# Grayson's Wishlist

Conventions: `- [ ]` open, `- [x]` done (move to Done at the bottom once verified).
Size guesses: **S** = small/frontend-only, **M** = medium, **L** = large/needs design, **?** = unknown until investigated.
Screenshots for many of these live in `UI Visual References/` (repo root, untracked).

## Bugs

- [ ] Sidebar: top "Projects" and "Conversations" tabs do nothing when selected. (see screenshots) **?**
- [ ] Convo window: clicking the mode selector on desktop shifts the UI and buttons in the message box. **S**
- [ ] File Editor: long lines don't wrap — they push the left edge into the conversation box and squish it narrower. (sometimes?) Should wrap by default. **S/M**
- [ ] Convo window: loading messages in a long convo lags and is glitchy — screen jitters when scrolling up while it loads. (Blocks/informs the "map" sidebar feature below.) **M/?**
- [ ] Sidebar session names sometimes don't match the names shown in the terminal under `claude /resume`. **?**
- [ ] Quick settings button (right edge of convo window) is buggy on mobile — repositioning it is finicky, and its usefulness is questionable. Fix or remove? **S**
- [ ] Shell view: bottom quick-access toolbar (clipboard, Esc, arrows…) sits on top of the CLI, hiding info like the selected mode and any list options rendered there. **M**
- [ ] Shell view: no touch-drag scrolling — view is pinned to the bottom, can't scroll up through output. **M**

## Mobile UX polish

- [ ] Sidebar: long-press (or side button) on a convo → popup menu with Rename / Archive / Delete.
  Covers two problems at once: Archive is currently buried inside the "Delete" menu (unintuitive — took real hunting to find), and there's currently *no way at all* to rename a convo on mobile. **M**
- [ ] "Thinking" text box attached to the message box looks awkward as it resizes with the changing thinking text. Just remove it. **S**
- [ ] Two "Stop" buttons can be present at once — one across from the Thinking text, one in the message box. Redundant; keep only the one in the message box. **S**
- [ ] Top bar: plugin buttons cramp the conversation title when multiple plugins are present. Options: remove the convo title? move the plugin toolbar underneath? consolidate plugins into a single menu button?
  Constraint: Shell and Files are too important to hide in a plugin menu next to stats/session-tracker plugins. Maybe: Convo, Files, and Shell in a bottom navbar, single plugin button/dropdown at top? **M — needs a design decision first**
- [ ] Mode selector (Auto, Accept, Bypass, Plan): modes are distinguished only by colour on mobile. Consider unicode characters/icons, and/or a long-press flyout listing all modes. **S**
- [ ] General condensing/shrinking of UI elements and popup menus on mobile — some assets/text get cut off due to size. **M — grab-bag, itemize as found**
- [ ] When Claude reads a skill, the skill's entire text is dumped into the convo as a user message, making long convos painful to scroll. Collapse/fold these in the transcript view. **M**

## Model picker follow-ups (from 2026-07-13 code review of the picker fixes)

- [ ] **#1 — PRIORITY: stale popup pick still force-overrides the session model on resume.** `resolveResumeModel` (server/modules/providers/services/provider-models.service.ts) injects the cached popup pick on every resumed turn with no recency check — only the display layer (getCurrentActiveModel) got one. If you pick Opus in the popup, then later switch to Sonnet via Shell /model, the next CloudCLI message silently snaps the session back to Opus. Fix: apply the same pick-vs-transcript recency rule (see pickSupersedesTranscript in claude-models.provider.ts) inside resolveResumeModel, or invalidate the cache entry when the transcript shows a newer divergent model. Behavior-changing — design first. (Start a fresh session for this one.) **M**
- [ ] #2 — Shell /model stdout regex over-captures: picking "Default" in the Shell makes the ACTIVE MODEL box show the raw sentence "Default (recommended)" (no card highlight) until the next turn. The `(.+?)\.?$` capture in claude-models.provider.ts grabs the whole trailing sentence; 'fable'/'opus' only resolve by substring luck. Fix: anchor/tighten the capture. **S**
- [ ] #3 — 1M-context picks via Shell map to the non-1M alias: resolveClaudeModelAlias only recognizes the literal '[1m]' token, so "Sonnet 4.5 (1M context)" highlights plain Sonnet until the next turn. Fix: also recognize "(1M context)" phrasing. **S**
- [ ] #4 — getCurrentActiveModel reads+parses the entire session JSONL (4.5MB for a long session) on every /models open, even when a fresh pick wins anyway. Fix: stat the file and skip the read when the pick's updatedAt is newer than file mtime, or read only the tail. **S/M**

## Theming

- [ ] Color picker for accent colour; maybe an option for a slight hue shift on the background. Light/dark variants. **M**
- [ ] Optional presets matching model-provider branding (Anthropic, OpenAI, Google). **S once the picker exists**

## Features (bigger ideas)

- [ ] **True session syncing?** Using Claude Code directly does not list CloudCLI conversations. **? — needs investigation first: where does each store sessions?**
- [ ] `!` shell mode in the conversation window (like the CLI). **M**
- [ ] Conversation "map" sidebar: a minimap showing where user/Claude messages sit in the convo (like doc editors/IDEs); tapping scrolls there. Depends on fixing the long-convo scroll jitter bug above. **L**
- [ ] Double-tap Esc to stop a message mid-send and immediately begin editing it. **M**
- [ ] `/rewind` command — and audit what other Claude Code CLI commands are missing from CloudCLI, integrate them. **L**
- [ ] Rewind via the transcript: scroll back to a specific message and hit an "edit" button to rewind there. Big QoL — most major tools offer some form of undo/rewind. **L**
- [ ] Modern IDE-style features: "@"-ing files, highlighting text in the editor to reference it in chat, "following" Claude's edits in realtime. **L**
- [ ] More IDE-like desktop layout: more split panels (convo, files, and editor open at the same time). **L**
- [ ] Landing page on entry. Currently just a blank page saying to tap the menu button for the sidebar. A list of recent convos would make sense — last-messaged time, token count, project, model… **M**
- [ ] **Scheduled messages.** When you run out of usage, you often want Claude to pick up where it left off the moment usage resets, especially mid-task. A "schedule send" option in the message box: set a time for the message to send. Also useful for follow-ups/checkups in threads later on. **M/L**

## Done

- [x] Message box: removed the command-count badge from the commands button — the total now shows in a header inside the menu (`ad5ce24`). Same commit: tapping the button on mobile no longer pops the keyboard (textarea only refocuses on non-touch devices), and selecting any command now inserts it into the message box instead of executing built-ins immediately (hitting Send executes it, as when typed by hand). *Not yet verified live — needs restart from SSH, then on mobile: tap commands button (no keyboard), tap a command (fills input), send.*
- [x] Sidebar: condensed the bottom 3 buttons (Report, Join Community, Settings) into one row of icon-only buttons on mobile (`0fa5544`), freeing ~2 rows for the convo list. Labels moved to aria-label/title; desktop footer unchanged. Verified in UI 2026-07-14.
- [x] Figure out how sessions are archived — found it: nested in the "Delete" menu. (Spawned the context-menu item under Mobile UX polish.)
- [x] Model selector said "Sonnet 4.6 is default" (outdated) — fixed by commits `87b7177` + `7159ef4`; the label now resolves the real configured default dynamically. Verified in UI 2026-07-13 (popup shows "currently claude-fable-5[1m], from your Claude settings").
- [x] Mid-session model picks in the /models popup now also persist as the per-browser new-session default (`f0fada7`), matching CLI `/model` behavior. *Not yet verified live — needs rebuild + restart from SSH, then: pick in popup → new session's picker shows it.*
- [x] /models popup showed a stale "default" as ACTIVE MODEL while the session actually ran Opus (changed via fast mode / Shell `/model`, which bypass the popup cache) — fixed by reconciling the cached pick against the transcript by recency (`36f48cc`). *Not yet verified live — same rebuild caveat; after restart the ACTIVE MODEL box should show the real running model.* Display-only; the resume-behavior half of this is open item #1 above.
