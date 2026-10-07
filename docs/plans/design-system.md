# One design system: every screen draws from a small set of named values

- Status: not started
- Next: Phase 0 — Grayson agrees the design
- Context: [design system reference](../design-system.md); per-repo accents in
  `src/components/sidebar/utils/accentColors.ts`; no `backdrop-filter`
  (ADR 0001); chat text roles (ADR 0062)
- Design: [Design system](../designs/design-system.md), binding every phase

Each token phase runs the loop in the design: settle the set, migrate `src/`
screen by screen with each looked at in the app before the next, take the
ratchet's baseline to zero, and write that section of
[the reference](../design-system.md) in the same commit — never a repo-wide
find-and-replace. Re-measure before a phase starts; the design's counts are a
2026-10-07 snapshot.

## Phases

- [ ] 0. Grayson agrees the design.
- [ ] 1. `npm run check:design` ratchets every banned pattern at today's count
      and runs on commit, so new raw values stop before migration starts.
- [ ] 2. Every colour resolves through a role. The raw classes collapse to
      roughly 25 mappings, and each `text-gray-500 dark:text-gray-400` pair
      becomes one `text-muted-foreground`. A role the table needs but the design
      lacks goes to Grayson first. Hex literals outside the token files go too.
- [ ] 3. Corners use the three radius roles.
- [ ] 4. Depth uses the surface steps and three shadows, and every overlay sits
      on a named stacking layer.
- [ ] 5. No font size sits outside the scale: arbitrary sizes move to
      `text-2xs` or a scale step, and the older tool panels (to-do and task
      lists, plans, question forms) adopt the chat text roles.
- [ ] 6. Motion uses the two named durations.
- [ ] 7. The shared components are listed in the reference with their
      variants, sizes and states, and look-alike copies fold into
      `src/shared/view/ui/`.
- [ ] 8. Patterns are written into the reference, each naming a live screen to
      copy, with spacing settled per pattern.
- [ ] 9. Tokens are OKLCH: the ~40 definitions in `src/index.css` change format
      and Tailwind's `hsl(var(--x))` wrappers become `oklch(var(--x))`, matching
      today's colours exactly.
- [ ] 10. Theme presets and their Settings picker — monochrome, single-accent,
      full-colour — with dark derived, the contrast script passing every preset,
      and `theme-color` following the theme.
- [ ] 11. The radius preset (square, min, medium, large) scales the three radius
      roles.
- [ ] 12. Provider accent presets (Anthropic, Codex, Cursor, OpenCode, DeepSeek,
      Antigravity) on the per-repo accent mechanism.

## Done when

- `npm run check:design` reports zero for every pattern, and each is banned
  outright.
- The reference has sections for colour, radius, elevation, type, motion,
  components and patterns.
- Switching theme repaints every screen with no grey-and-blue islands;
  monochrome shows hue only on status; each radius preset changes every corner
  except `rounded-full`.
- Find's match highlight is obvious on every bubble, including your own
  messages; today it tints with `--primary`, the user bubble's own colour.
- Light and dark both verified on the installed PWA.
- The next new screen built from the reference ships without a round of styling
  corrections.

## Not doing

- Everything in [the design's list](../designs/design-system.md#not-doing).
