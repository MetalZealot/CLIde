# Colour theming: OKLCH tokens, theme presets, and a radius dial

- Status: not started
- Next: Phase 0 — derive the palette-class → token mapping table, then migrate
  `src/` screen by screen.
- Context: the token layer is `src/index.css` (`:root` / `.dark`) wired into
  `tailwind.config.js` `theme.extend.colors`. Per-repo accent colours already
  exist (`src/components/sidebar/utils/accentColors.ts`,
  `SidebarAccentColorMenu.tsx`) and Phase 4 extends that, not a parallel system.
  No `backdrop-filter` (ADR 0001). Sibling plan:
  [typography](typography-system.md) — it touches `src/index.css` and
  `tailwind.config.js` too, so do not run both at once.

The architecture is already right and roughly half the app ignores it. Measured
2026-08-13: **2,335 hardcoded palette-class occurrences** (`text-gray-400`,
`bg-blue-900`, `border-gray-700`) across **118 of 263** component files, all
bypassing the tokens. Ship a theme today and half the UI stays grey-and-blue.
That migration is Phase 0, and it is the cost of this entire plan — every other
phase is small once it lands and impossible before it.

## Settled — do not reopen

- **Monochrome, single-accent and full-colour are one feature**, not three: a
  hue plus a chroma dial over the same token set. Monochrome is chroma 0. This
  also subsumes the older "colour picker for accent colour" TODO item.
- **Dark variants are derived by inverting lightness while holding hue and
  chroma — never hand-authored.** N themes authored twice is 2N palettes to
  maintain forever. This is the actual reason for OKLCH; in HSL, holding
  lightness while sweeping hue makes yellow glare and blue go muddy, so every
  accent needs hand-tuning.
- **Provider colours are accent-only** — a session-row stripe or avatar, never
  app chrome. Colour already carries state here (`--status-attention`,
  `--status-unread`, `--status-running`); vendor identity in the chrome competes
  with that signal and the state colours lose. Novelty themes also age badly in
  a tool used daily.
- **No "detect device" corner radius.** The browser cannot read an OS corner
  radius, so it would be a guess, and a wrong guess reads worse than a neutral
  default. Four presets instead: square, min, medium, large.
- **`rounded-full` stays literal.** Pills and avatars are intent, not styling,
  and must not follow the radius dial.

## Phases

- [ ] 0. Every colour in `src/` resolves through a token. The 2,335 occurrences
      collapse to roughly 25 distinct mappings, and each
      `text-gray-500 dark:text-gray-400` pair becomes a single
      `text-muted-foreground` — the diff removes more than it adds. Where no
      existing token fits, add a semantic one rather than reaching for a raw
      palette value. **Screen by screen, each looked at in the app before the
      next; never a repo-wide find-and-replace.** No visual change is intended,
      so any difference you can see is a mapping bug.
- [ ] 1. Tokens are OKLCH. The ~40 definitions in `src/index.css` change format
      and the `hsl(var(--x))` wrappers in `tailwind.config.js` become
      `oklch(var(--x))`. Match the existing colours; this phase is a format
      change, not a redesign.
- [ ] 2. Theme presets and their Settings picker. A theme is hue + chroma over
      the token set, with light/dark derived per the rule above. Ships
      monochrome, single-accent, and the full-colour set.
- [ ] 3. Radius dial. `--radius` already drives `rounded-lg/md/sm` (376 uses),
      so those follow for free. Remap `rounded-xl`, `rounded-2xl` and bare
      `rounded` (~190 uses) onto derived steps.
- [ ] 4. Provider accent presets (Anthropic, Codex, Cursor, OpenCode, DeepSeek,
      Antigravity) on the existing per-repo accent mechanism.

## Done when

- Switching theme in Settings repaints every screen with no grey-and-blue
  islands left behind, and a palette-class grep over `src/` returns only
  documented exceptions.
- Monochrome shows no hue anywhere in the UI; each radius preset changes every
  corner except `rounded-full`.
- Both light and dark verified on the **installed PWA at 3001**, not only the
  5173 dev tab — this is exactly the kind of change whose remaining defects are
  status-bar and safe-area coloured.

## Not doing

- **The Shell.** xterm carries its own theme object
  (`src/components/shell/constants/constants.ts`) and measures its grid at init.
  Its own item.
- **Syntax highlighting.** `react-syntax-highlighter` and the code editor ship
  independent colour sets; retheming those is separate work.
- **Typography** — [its own plan](typography-system.md).
- **User-authored themes.** Phase 2 ships a dial over a fixed token set, not an
  arbitrary per-token editor.
- **Custom project icons** — a separate TODO item, unrelated to colour.
