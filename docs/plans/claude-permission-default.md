# New Claude sessions start in Claude Code's own default permission mode

- Status: not started
- Next: Phase 1 — read `permissions.defaultMode` into Claude's capability default; a live session's mode is read from [the agent runtime rebuild](agent-runtime-rebuild.md)'s phase 5
- Context: [provider capabilities §4.3](../providers.md#43-access-policy-and-interaction);
  the settings writer from [the Claude settings plan](claude-settings-surface.md)

CLIde sends the composer's mode to the SDK explicitly, which is correct and stays.
What changes is the mode a new session starts in: today a hardcoded `default` (Ask)
plus whatever was last picked for the provider; afterwards the same mode the CLI
would start in. Agreed with Grayson on 2026-10-02.

## Phases

- [ ] 1. Claude's `defaultPermissionMode` in the capability matrix comes from
  `permissions.defaultMode` in `~/.claude/settings.json`, falling back to `default`
  when the key is missing or names a mode the provider does not offer (for example
  `auto` under `disableAutoMode`). Server test for each case.
- [ ] 2. Every new session starts in its provider's default mode; a mode changed
  mid-session stays with that session only, like Shift+Tab in the CLI. The
  `permissionMode-last-<provider>` carry-over goes, except for its one real job:
  holding a mode picked in a brand-new chat until the first send gives it a session
  id. Applies to all providers, so a one-off Bypass never becomes the next session's
  start. ADR in the same commit, since "it forgets my last mode" reads as a bug.
- [ ] 3. Agents › Claude gets a Default permission mode control that writes
  `permissions.defaultMode` through the shared settings writer, so the usual mode is
  set in one place without a terminal.
- [ ] 4. Live check on 3001: with `defaultMode: "auto"`, a new chat opens in Auto;
  switch it to Bypass, start another, and it opens in Auto again.

## Done when

- A new Claude session's composer shows the mode `permissions.defaultMode` names,
  and that is the mode the SDK receives.
- Changing the mode in one session never changes where the next one starts.
- The composer redesign's badge has a baseline: "differs from the provider default".

## Not doing

- Project or local `defaultMode` overrides; the user file only.
- Reading a default from Codex, Cursor or OpenCode config — their default stays `default`.
- Auto-Continue's missing mode, which is its own TODO item.
