# Typography: Figtree + Commit Mono, self-hosted

- Status: not started
- Next: step 1 — strip the Google Fonts links and preconnects from `index.html`
  and add the two font preloads.
- Context: the Figtree rationale (why it beat Manrope) is in
  [the archived study](../specs/archive/2026-07-20-typography-study.md) — read it
  only if that choice is being questioned. Its mono conclusion is superseded by
  the Commit Mono bullet below.

Nothing here is implemented: as of 2026-08-06 there is no Figtree or webfont mono
anywhere in `src/` or `public/`.

## Settled — do not reopen

- **Figtree** for UI and chat prose, **Commit Mono** for code. Two families, no
  serif.
- **Commit Mono, not Iosevka.** Measured 2026-08-13: Iosevka's Fontsource latin
  subset is 984 KB against Commit Mono's 48 KB, and rendered side by side at
  13px/390px Iosevka sits visibly lighter and smaller on the body. The width
  advantage that originally chose it is real but smaller than the study claimed —
  ~51 characters per line against Commit Mono's ~45, not the 20% asserted. Paying
  20× the bytes for six characters is the wrong trade.
- **Merriweather goes**, deliberately — a carry-over from the CloudCLI origins,
  not a choice being kept. A Settings font switcher may come later; the
  CSS-variable routing below makes that a variable swap, not a redesign. Shipping
  a *menu* of families is what re-imposes a payload budget and lazy `@font-face`
  loading, so treat it as its own item, not a free extension of this one.
- **Self-hosted, no Google Fonts CDN.** Better for the PWA (offline and tailnet
  use, service-worker cacheable) and drops a third-party dependency.
- **Shell (xterm) is out of scope.** `TERMINAL_OPTIONS.fontFamily`
  (`src/components/shell/constants/constants.ts`) keeps its Menlo stack, which
  dodges the glyph-measurement trap — xterm measures cell width at init, so a
  late-swapping webfont misaligns the grid. Putting Commit Mono in the terminal is
  its own item: update the JS constant and await `document.fonts.load()` before
  constructing the Terminal. Commit Mono's ligatures are off by default behind
  `calt`, so no separate terminal variant is needed.
- **Keep current code-block wrapping.** `src/index.css` (`.chat-message pre/code`
  → `pre-wrap` + `break-all`) stays; it prevents horizontal scroll of the chat
  stream on mobile. Commit Mono's normal ~0.6em advance means wrapped code lines
  break sooner than they would have under Iosevka — expected, not a regression.

## Phases

Every touched file is upstream-tracked, so this is a rebase-conflict surface —
do it as one tidy commit, ideally not adjacent to a rebase.

- [ ] 1. `index.html` — remove the Google Fonts `<link>`s and both preconnects;
      add `<link rel="preload" as="font" type="font/woff2" crossorigin>` for
      Figtree 400 and Commit Mono 400.
- [ ] 2. `public/fonts/` — add 7 woff2 files: Figtree 400 / 400-italic / 600 /
      700, Commit Mono 400 / 400-italic / 700. Both families ship pre-subset
      latin on Fontsource (`@fontsource/figtree`, `@fontsource/commit-mono`), so
      there is **no `pyftsubset` step**. Measured per-face: Figtree ~11 KB,
      Commit Mono ~48 KB — the seven files land near 190 KB, which nearly
      consumes the ~200 KB budget. Adding an eighth face needs a reason.
- [ ] 3. `src/index.css` — `@font-face` rules (all `font-display: swap`), the
      three `--font-*` variables, and `body` font-family to `var(--font-ui)`.
      Stable unhashed URLs are deliberate: they let `index.html` preload and
      `sw.js` cache. Fonts effectively never change; bump the filename (`-v2`)
      if one does.
- [ ] 4. `tailwind.config.js` — `sans: ['var(--font-ui)', ...fallbacks]`, add
      `prose: ['var(--font-prose)']`, add `mono: ['var(--font-mono)',
      ...fallbacks]` overriding Tailwind's default mono stack, delete `serif`.
      The ~71 existing `font-mono` call sites pick up Commit Mono from this step
      alone — no per-component edits.
- [ ] 5. Replace every `font-serif` with `font-prose`. Sites as of 2026-07-20
      were `MessageComponent.tsx` (×5), `AuthScreenLayout.tsx`,
      `GitConfigurationStep.tsx`, `AgentConnectionsStep.tsx` — **grep at
      implementation time, don't trust that list.**
- [ ] 6. Tune the scale live on the dev server, then `npm run build:client`.

## Tune the scale live, don't pre-commit it

The family swap and the size bump are separable. Do the swap first, then judge
sizes on the actual phone via the dev server on 5173. These are targets to
evaluate, not commitments:

| Role | Current | Target | Notes |
|---|---|---|---|
| Chat prose | 14px (`prose-sm`) | 15–16px, lh 1.5 | biggest density change — judge on device |
| Code blocks | highlighter default | 13px, lh 1.6 | floor 12.5px |
| Inline code | — | 0.9em of surrounding | |
| Composer input | 14px (`text-sm`) | 16px | see below |
| Meta/timestamps | various `text-xs` | 11–12px, weight 500, muted | 11px is the floor |
| Buttons/chips | 13–14px | unchanged, weight 500–600 | already fine |

Markdown `**bold**` maps to weight 600; go to 700 only if 600 tests weak on
device. `*italic*` needs the real italic file loaded — never let the browser
synthesise an oblique.

**The 16px composer rule is not fixing a live bug.** `index.html` ships
`user-scalable=no, maximum-scale=1.0`, so iOS focus-zoom is globally disabled
already. 16px is a *prerequisite* for removing `user-scalable=no` later, which is
an accessibility question — pinch-zoom currently does not work at all. Decide
that in the UI overhaul, not here.

## Done when

The app renders Figtree and Commit Mono with no network request to Google, no
`font-serif` class remains, code and file paths pick up Commit Mono everywhere,
and total font transfer is under ~200 KB. Judge the scale on the installed PWA at
3001, not on the 5173 dev tab.
