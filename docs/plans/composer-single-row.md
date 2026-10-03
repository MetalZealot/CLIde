# A single-row composer on mobile

- Status: not started
- Next: Phase 1 — probe page on the S20 for the row, badge styles and sheet height
- Context: [UI standards map](../maps/ui-standards.md) ("Placement around the
  composer"); [composer anchors](../maps/code-anchors.md);
  [permission default plan](claude-permission-default.md) for the badge baseline;
  [prompt stash plan](composer-prompt-stash.md) owns what the `+` menu holds

At rest the phone composer is one row: `+`, the input, the provider logo, then one
slot for mic, send or stop. The settings row under the input goes. Desktop keeps
today's two-row footer. Agreed with Grayson on 2026-10-02.

## Phases

- [ ] 1. Probe page in `dist/` with the row and the sheet, tried on the S20: three
  badge styles (dot, ring, tint), and two sheet heights. Agree the end state before building.
- [ ] 2. A mobile bottom sheet holds every next-message setting: provider (where
  switching is allowed), model, effort slider, fast mode, permission mode and plan
  mode. It reuses the menus' data and handlers, not their popover visuals, and the
  sheet pattern `SideQuestionSheet` already uses.
- [ ] 3. The row. The provider's logo opens the sheet and carries a badge when the
  permission or plan mode differs from the provider default. The placeholder is the
  short model and effort ("Opus 5.5 · High", plus "· Fast"); the no-project
  placeholder is unchanged. Mic shows when the input is empty, send when it is not,
  stop while a turn runs. The usage ring moves to the header. A newline or a wrapped
  line splits the row ChatGPT's way: the text slides up to its own full-width line
  with the buttons staying below. Deleting back to one line, or to nothing, keeps it
  split; it rejoins on send, or when the input loses focus empty. The slide is animated
  both ways; reduced motion switches instantly.
- [ ] 4. Live check on the installed PWA against 3001, keyboard open and closed.

## Done when

- On the phone, the composer at rest is one row and the conversation gains the
  height of the old settings row.
- The logo matches the session's provider; the empty input shows its model and
  effort; the badge appears only off the default mode.
- A change made in the sheet applies to the next send, and desktop is unchanged.

## Not doing

- Settings inside the `+` menu, or a full-page settings screen.
- Any desktop layout change.
