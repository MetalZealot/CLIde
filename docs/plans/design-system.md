# One design system: every screen draws from a small set of named values

- Status: not started
- Next: Phase 1 — the colour plan's Phase 0, screen by screen onto tokens
- Context: [design system](../design-system.md),
  [colour theming plan](colour-theming-system.md), shared components in
  `src/shared/view/ui/`, [ADR 0062](../decisions/0062-chat-metadata-scales-with-reading-size.md)

Each phase runs one loop: decide the allowed values and the job each does,
migrate `src/` onto them screen by screen, add a lint check that rejects
anything else, and write that section of [the design system](../design-system.md)
in the same commit. Token phases intend no visual change, so a difference you
can see is a mapping bug. Counts are over `src/**/*.{ts,tsx}`, measured
2026-10-07; re-measure before starting a phase.

## Phases

- [ ] 1. Every colour resolves through a semantic token: the
      [colour plan's Phase 0](colour-theming-system.md#phases). Its lint check
      rejects raw palette classes and hex literals outside the token files.
- [ ] 2. Corners come from about three radius tokens, each named for a job
      (chip, control, panel); `rounded-full` stays literal. Today 7 sizes over
      646 uses: `rounded` 197, `-lg` 192, `-md` 149, `-xl` 78, `-2xl` 17,
      `-sm` 10, `-3xl` 3. The colour plan's radius dial (its Phase 3) builds
      on this.
- [ ] 3. Elevation is three shadow levels and a named stacking order (base,
      sticky, dropdown, overlay, toast). Today 7 shadow sizes plus 4 arbitrary
      ones, and 10 z-index values from `z-10` to `z-[10000]`.
- [ ] 4. No font size sits outside the type scale. 134 arbitrary sizes across
      9 values (`text-[11px]` 59, `text-[10px]` 48, `text-[13px]` 14, …) map onto
      the scale or a named role, and the older tool panels adopt the chat text
      roles from ADR 0062.
- [ ] 5. The shared components are inventoried — variants, sizes, states
      (hover, focus, pressed, disabled, loading) and when to use which — and
      look-alike copies elsewhere in `src/` fold into them.
- [ ] 6. Recurring layouts are patterns, each naming a live screen to copy:
      list row, settings row, empty/error/loading state, confirmation, which
      overlay for which job, panel layout on phone and desktop. Spacing is
      settled here as which step goes where, not as new tokens.
- [ ] 7. Motion uses two or three named durations. Today 7, mostly
      `duration-150` and `duration-200` (28 uses each).

## Done when

- The design system has a section for colour, radius, elevation, type,
  components, patterns and motion, and each token section names the check that
  enforces it.
- Lint fails on a raw palette class, hex colour, off-scale font size, arbitrary
  z-index, or radius outside the token set.
- The next new screen built from the doc ships without a round of styling
  corrections.

## Not doing

- Theme presets, OKLCH and provider accents: they stay in
  [the colour plan](colour-theming-system.md).
- Spacing tokens. Tailwind's 4px scale already is one; only 30 arbitrary
  spacing values exist.
- The Shell and the code editor, which keep their own themes and metrics.
