# 0064 — Claude's bypass is the picker's mode only, never a standing toggle

- Date: 2026-10-01
- Status: Accepted

Settings › Claude › Permissions no longer has "Skip permission prompts"; Bypass Permissions in the composer's mode picker is the only way a Claude chat skips prompts.
The toggle overrode every non-Plan mode server-side while the picker kept showing the mode the user chose, so a chat could read "Ask Before Tools" and bypass anyway.
The Claude runtime ignores a stored `skipPermissions` flag, so browsers that saved it on stop bypassing without a migration.
Upstream still ships the toggle; do not restore it when taking upstream permissions work. Cursor's equivalent is unchanged.
Hiding Bypass from the picker belongs to Claude Code's own `permissions.disableBypassPermissionsMode`, written once the shared settings writer exists (plan: claude-settings-surface, Phase 5).
