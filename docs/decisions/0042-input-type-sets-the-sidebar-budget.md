# 0042 — Input type sets the row budget; hover is a reveal channel, not a licence

- Date: 2026-08-18
- Status: Accepted

## Decision

A pointer has hover, which is a **free reveal channel**: a control can exist,
cost nothing at rest, and still be found. Touch has no equivalent, so every
touch affordance is either permanent or behind a gesture. That asymmetry, not
"minimal versus dense" or "chat versus developer", is what decides where a
control goes.

Three rules follow, and they bound tier 1 of the
[sidebar surface map](../maps/sidebar-surface.md):

1. **Per row, touch gets at most one permanent trailing control; a pointer gets
   at most one permanent plus any number revealed on hover or focus.** Anything
   beyond that goes to the row's action menu, which both input types already
   reach through one definition and three anchors (long-press, kebab,
   right-click).
2. **Identity leads, state trails.** Pin and accent strip sit with the name
   because they describe what the row *is*; status, age, actions and the expand
   chevron sit at the end because they describe what is true *now*.
3. **Input sets the hit target, density sets the visual.** Touch: 44px hit area,
   around 32px of visible control, reconciled by `.sidebar-utility-hit-target`.
   Pointer: 24–28px, hit area equal to the visual.

The budget is the point. Without a number every proposal only has to clear "is
this useful?", which it always does, so tier 1 accretes one defensible control
at a time.

## Rejected

- **Copying either phone convention wholesale.** The mobile browser builds of
  ChatGPT and Claude.ai make every affordance permanent, which is why they read
  as plastered; the native apps put everything behind gestures, which stays
  clean but cannot carry developer density. CLIde takes the third path its own
  row menus already enable.
- **Matching the two breakpoints control for control.** Parity in *reach* is
  required; parity in *presentation* is not, and demanding it would drag the
  desktop down to what touch can afford permanently.
- **Governing marks as well as controls.** The rules bound things you can press.
  Non-interactive trailing marks — relative age, provider logo — are left
  unbudgeted for now, which the adoption audit records as the known gap.
