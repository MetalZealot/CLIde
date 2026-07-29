# 0019 — QuickSettings panel removed; no second settings surface

- Date: 2026-07-29
- Status: Accepted

## Decision

`src/components/quick-settings-panel/` is deleted outright, along with its
mount point in `ChatInterface.tsx`. Its four exclusively-owned preferences
(`showRawParameters`, `showThinking`, `sendByCtrlEnter`, `enterToSend`) moved
to the new Settings → Chat screen in P3a; `useUiPreferences` was untouched, so
only the UI moved. The panel's other three rows (dark mode, language,
voice-enable) already duplicated Settings → Appearance/Chat and needed no new
home. `LanguageSelector`'s `compact` prop was removed as part of the same
change — it existed solely for this panel's chrome and had no other caller.

The stored `quickSettingsHandlePosition` localStorage key is left alone; it
becomes inert and costs nothing to leave behind.

## Rejected

- **Keeping the panel as a fast path alongside Settings.** This was the thing
  being fixed, not a variant to preserve: a second surface with its own state
  for a subset of the same preferences is exactly the split-brain the IA
  restructure (ADR 0018) exists to remove.
- **A chat-header overflow menu as a replacement fast path**, built now. Noted
  as the fallback if losing the one-swipe panel proves painful in daily use,
  but not built speculatively — it would be a second settings surface again,
  just smaller, and nothing has demonstrated the need yet.

## Why

The panel was mobile-buggy (finicky edge-drag repositioning) and, more
fundamentally, an IA problem: four preferences reachable only through a
one-swipe gesture that most users never discover, sitting alongside three more
that already existed in the real Settings pane under different UI. Deciding
in TODO.md on 2026-07-28 to remove it rather than fix its positioning bugs
avoided fixing a surface that was going away.

Verification for this packet was code-level only (`npm run typecheck`,
`npm run lint`, and a grep sweep confirming no remaining references), not a
live click-through — the chat view sits behind login, and no test credentials
were available for the `cloudcli-branch-test` harness in this session. The
change is a pure deletion of a self-contained `fixed`-positioned component
with no layout compensation elsewhere to unwind, which is what makes
code-level verification sufficient here.
