# One Tools page per provider: skills, plugins, and MCP

- Status: 3/4
- Next: Phase 4 — restart `cloudcli`, then Grayson checks Engineering and GitHub on the phone
- Context: [provider skills contract](../../server/modules/providers/README.md),
  [context-correct skills](skills-settings-discovery-scope.md),
  [Settings navigation](../decisions/0018-settings-drill-down-one-scroll-container.md),
  [UI standards](../maps/ui-standards.md),
  [Claude's unified directory](https://support.claude.com/en/articles/14328846-browse-skills-connectors-and-plugins-in-one-directory),
  [Codex plugins](https://help.openai.com/en/articles/20001256-plugins-in-chatgpt-and-codex)

Agreed with Grayson 2026-09-23. Each provider's Skills and MCP rows merge into
one **Tools** row: tabs All · Skills · Plugins · MCP under one search box, one
row per item with a status dot, a Global/project picker on top. A skill row
names its plugin, a connector row names its plugin and sign-in state, and a
plugin opens a sheet listing its own skills and connectors. **Read-only** for
plugins and connectors; adding skills and your own MCP servers keeps working.

Truth comes from each provider's own tooling, never a re-implementation of its
resolution rules:

- Claude: plugins read from the files `claude plugin list --json` reads,
  checked equal to its output on 2026-09-23 (no subprocess per page), and `claude mcp list`
  run in the chosen checkout (per-project connector state; ~6 s measured).
  `claude mcp list` has no JSON mode, so its status words are parsed with a
  fixture per state and unknown text falls through to "Unknown", never hidden.
- Codex: app-server `plugin/list` (marketplaces with plugins, enabled,
  installed) and `mcpServerStatus/list` (`authStatus`, `runtimeStatus`).
- Cursor, OpenCode: no plugin inventory; the tab shows only what they have.

UI buckets: **external** — tabs are a real tablist with keyboard arrows, the
sheet traps focus and closes on Escape, status is text plus dot, never colour
alone. **House** — `SettingsScreen` single scroll container, `SettingsChoicePopover`
for the picker, solid scrim (ADR 0001). **Taste** — one page per provider, not
mixed; no CLIs tab; status words "Connected / Needs sign-in / Can't sign in
here / Off for this project / Not set up".

## Phases

- [x] 1. **Claude data is complete.** Plugin skills come from the plugin
      files the CLI reads, so claude.ai-synced plugins (Engineering, Design…) appear; synced
      standalone skills one folder deeper appear; a new optional provider
      member serves plugins (with their skills and connectors) and connector
      status for one workspace. Cursor and OpenCode report `supported: false`.
- [x] 2. **Codex data is complete.** Same member from the app-server, plus
      skills that Codex plugins bundle (carried on each plugin, since the
      Codex skills list is file-based and must not wait on the app-server).
      Installed plugins only; account apps are its connectors.
- [x] 3. **The Tools page replaces Skills and MCP rows.** Tabs, search, rows,
      plugin sheet, refresh for connector status; existing add-skill and
      add-MCP flows reachable from their tabs. Checked on a branch-test slot
      at 320/390/900 px; enabled plugins sort first, a checkout's skills lead.
- [ ] 4. **Accepted live** on 3001 on the phone: Engineering visible with its
      skills and connectors, GitHub shown as "Can't sign in here".

## Done when

- Every plugin `claude plugin list --json` reports appears, with its skills.
- Every connector `claude mcp list` reports appears with the same state.
- Codex shows `sites` and `visualize` under OpenAI bundled.

## Not doing

- Turning plugins or connectors on or off, installing, or signing in.
- A CLIs tab, or a combined cross-provider list.
- Marking which skills two providers share.
