# Auto-compact is visible and its numbers are honest

- Status: 1/3
- Next: phase 2 — the popover names both the compact point and the window
- Context: [code anchors](../maps/code-anchors.md), [Claude Code settings surface audit](../maps/2026-07-28-claude-code-settings-surface-audit.md)

The ring has two sources for its ceiling and silently swaps between them. The
SDK reading says `maxTokens 200000, autoCompactThreshold 167000, enabled` and
renders `x / 167,000 · Auto`; the derived fallback in `claude-context-window.ts`
reports a window and no threshold, rendering `x / 200,000` with no label. A user
who set `/autocompact 200000` reads the second as their setting taking effect.
It is not: `autoCompactWindow` caps the *window*, and Opus 5's window is already
200,000, so the setting is a no-op there.

## Phases

- [x] 1. Streaming frames stop regressing to the derived ceiling. The stream
      resolves per frame through `getClaudeContextCeiling` (memory only), so a
      restarted server streams the fallback until a fresh mid-turn capture lands
      — while a valid reading sits on disk. Warm it once per run with
      `loadClaudeContextCeiling`.
- [ ] 2. The popover names both numbers. Show the compact point and the window
      together, and label which one is the cliff, so the pair stops looking like
      one number changing its mind. Covers the fallback case too: today
      `autoCompactStatus` emits nothing at all when no threshold is known, which
      is exactly when the user most needs to be told.
- [ ] 3. Claude's auto-compact settings are **readable** in Settings → Agent:
      `autoCompactEnabled` and `autoCompactWindow` as CLIde already parses them,
      with the window shown as the cap it is. Read-only. One slice of the
      broader settings-surface item in `TODO.md`.

## Done when

- With the service freshly restarted, opening a session with a persisted reading
  and sending one message shows `· Auto` on the first frame, not after a second.
- The popover states the compact point and the window at the same time, and says
  when auto-compact is off or unknown rather than showing an unlabelled number.
- Settings → Agent shows the values from `~/.claude/settings.json`, and changing
  that file (or running `/autocompact` in Shell) is reflected on the next read.

## Not doing

- Writing `~/.claude/settings.json`. CLIde has never written it; every touch
  point is a read. That setting is global across every session, project and
  Shell, and making it writable from a per-session surface is its own decision.
- A per-session or per-provider auto-compact threshold. Claude owns the number.
