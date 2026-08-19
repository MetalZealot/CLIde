# Auto-compact is visible and its numbers are honest

- Status: complete
- Next: nothing — archive once the settings screen is verified on device
- Context: [code anchors](../maps/code-anchors.md), [Claude Code settings surface audit](../maps/2026-07-28-claude-code-settings-surface-audit.md)

The ring has two sources for its ceiling and silently swaps between them. The
SDK reading carries a window and a compact point together; the derived fallback
in `claude-context-window.ts` has only a window and no threshold. The popover
renders whichever it has as one bare number, so the two are indistinguishable.

That cost the maintainer 800,000 tokens of context without a visible symptom.
`autoCompactWindow` caps the *window*, and Opus 5's is 1,000,000, so
`/autocompact 200000` silently cut the session to a fifth of the model — and the
ring then displayed the capped 200,000 as though it were the model's own window.
Showing the cap and the model's window as two numbers is what makes that legible.

## Phases

- [x] 1. Streaming frames stop regressing to the derived ceiling. The stream
      resolves per frame through `getClaudeContextCeiling` (memory only), so a
      restarted server streams the fallback until a fresh mid-turn capture lands
      — while a valid reading sits on disk. Warm it once per run with
      `loadClaudeContextCeiling`.
- [x] 2. The popover says where its number came from. Retire the `· Auto` tag:
      it reports only that auto-compact is *enabled*, while `/autocompact` uses
      "auto" for "no user setting" — so it read as "Claude's auto value" with a
      user override in force. Carry Claude Code's own source instead (`from
      settings`, `default for this model`, `auto`) — derived locally, since a
      cap collapses both `maxTokens` and `rawMaxTokens` and no response field
      reveals it (measured, see `scripts/verify-context-usage-sdk.ts`) — show
      the compact point and
      the window together, and give the fallback a label too, since today it
      emits nothing exactly when the user most needs telling. Also reconcile the
      derived fallback, which returns window − 33,000 and calls it the window —
      the same number the SDK calls the threshold.
- [x] 3. Auto-compact is settable in Settings → Agent: an on/off toggle and the
      window cap, written to `~/.claude/settings.json` — the same keys and file
      `/autocompact` writes, so Shell and CLIde stay in sync. The cap must be
      shown against the model's own window, never alone, or it reproduces the
      defect above. CLIde's first write to that file; one slice of the broader
      settings-surface item in `TODO.md`.

## Done when

- With the service freshly restarted, opening a session with a persisted reading
  and sending one message shows `· Auto` on the first frame, not after a second.
- The popover states the compact point and the window at the same time, and says
  when auto-compact is off or unknown rather than showing an unlabelled number.
- Settings → Agent shows the values from `~/.claude/settings.json`, and changing
  that file (or running `/autocompact` in Shell) is reflected on the next read.

## Not doing

- A per-session or per-provider auto-compact threshold. Claude owns the number,
  and the settings file it reads is global across every session, project and
  Shell. Phase 3 surfaces that global value; it does not scope it.
