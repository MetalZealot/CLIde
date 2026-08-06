# CLIde Typography System — implementation plan

**Status:** settled, not yet implemented. Part of the larger UI overhaul; the typeface
decisions are locked here so the overhaul doesn't have to relitigate them.
Supersedes `clide-typography-handoff.md` (repo root — the claude.ai typeface study),
which was written without codebase context. This version reconciles it with the actual
app. The handoff doc's decision log (Manrope/JetBrains Mono rejections, field survey)
still stands — read it for the *why* behind the family choices; read this for the *how*.

## Decisions already made (don't reopen)

- **Figtree** for UI + chat prose, **Iosevka** for code. Two families, no serif.
- **Merriweather is being removed deliberately.** It's a carry-over from the
  CloudCLI/Claude-Code-CLI origins, not a choice we're keeping. A font-switching
  option in Settings may come later — the CSS-variable routing below is designed so
  that's a variable swap, not a redesign.
- **Self-hosted fonts**, no Google Fonts CDN. Better for the PWA (offline/tailnet use,
  service-worker cacheable), removes the third-party dependency and preconnect.
- **Shell view (xterm) is out of scope.** `TERMINAL_OPTIONS.fontFamily`
  (`src/components/shell/constants/constants.ts`) keeps its Menlo stack. This dodges
  the xterm glyph-measurement trap entirely (xterm measures cell width at init; a
  late-swapping webfont misaligns the grid). If Iosevka ever goes into the terminal,
  that's its own item: update the JS constant, await `document.fonts.load()` before
  constructing the Terminal, and use Iosevka **Term** there, not default Iosevka.
- **Keep the current code-block wrapping behavior.** `src/index.css` (`.chat-message
  pre/code` → `pre-wrap` + `break-all`) stays; it prevents horizontal scroll of the
  chat stream on mobile, which beats the handoff doc's scroll-instead-of-wrap rule
  for this app. Consequence: Iosevka's narrowness buys more characters *per wrapped
  line*, not a scroll-avoidance guarantee.

## Font stacks

```css
:root {
  --font-ui: "Figtree", -apple-system, BlinkMacSystemFont, "Segoe UI",
             Roboto, "Noto Sans", sans-serif;
  --font-prose: var(--font-ui); /* chat messages; future Settings font option repoints this */
  --font-mono: "Iosevka Web", ui-monospace, "SF Mono", Menlo, Consolas,
               "Liberation Mono", monospace;
}
```

`--font-prose` exists *now*, aliased to the UI stack, so chat prose is addressable
separately from chrome from day one. The future Settings font-switcher (e.g. bring
back a serif, or OpenDyslexic) only ever touches this one variable.

The app must render fully on the fallback stacks alone — first paint never blocks on
webfont delivery from the Pi.

## Files & loading

- **Faces to ship (woff2 only, Latin subset):** Figtree 400 / 400-italic / 600 / 700;
  Iosevka 400 / 400-italic / 700. Nothing below 400, nothing else without a concrete need.
- **Sourcing:** Figtree woff2 from the `@fontsource/figtree` npm package or
  google-webfonts-helper (already subset). Iosevka's official release webfont zips have
  full glyph coverage — the woff2s are large; subset to Latin with `pyftsubset` before
  shipping. Total transfer target: well under ~200 KB; if it's over, subsetting was
  skipped or done wrong.
- **Serving:** vendor the files into `public/fonts/` with hand-written `@font-face`
  rules in `src/index.css` (all `font-display: swap`). Stable (unhashed) URLs are
  deliberate: they let `index.html` preload the two critical files and let `sw.js`
  cache them; fonts effectively never change, so bump the filename (`-v2`) if one does.
- **Preload** Figtree 400 and Iosevka 400 in `index.html`:
  `<link rel="preload" as="font" type="font/woff2" crossorigin>`.
- Optional polish, not v1: `size-adjust`/`ascent-override` on the fallbacks to cut
  swap-time layout shift.

## Implementation steps

All touched files are upstream-tracked (rebase-conflict surface — do this as one tidy
commit, ideally not adjacent to a rebase):

1. `index.html` — remove the Google Fonts `<link>`s and both preconnects; add the two
   font preloads.
2. `public/fonts/` — add the 7 woff2 files.
3. `src/index.css` — add `@font-face` rules and the three `--font-*` variables; change
   the `body` font-family to `var(--font-ui)`.
4. `tailwind.config.js` — `sans: ['var(--font-ui)', ...fallbacks]`; add
   `prose: ['var(--font-prose)']`; add `mono: ['var(--font-mono)', ...fallbacks]`
   (overriding Tailwind's default mono stack so `font-mono` everywhere picks up
   Iosevka); delete the `serif` entry.
5. Replace every `font-serif` class with `font-prose` — sites as of 2026-07-20:
   `MessageComponent.tsx` (×5), `AuthScreenLayout.tsx`, `GitConfigurationStep.tsx`,
   `AgentConnectionsStep.tsx` — but **grep `font-serif` at implementation time**, don't
   trust this list.
6. Dev-server pass (see below), then `npm run build:client`.

The ~71 existing `font-mono` call sites (file paths, diffs, counters, code) get Iosevka
automatically via step 4 — no per-component edits.

## Type scale — tune live, don't pre-commit

The handoff doc's scale (body 15–16px, code 13–13.5px/1.55–1.6) is **larger** than
what the app renders today (chat prose is `prose-sm`/`text-sm` = 14px). The family
swap and the size bump are separable; do the swap first, then judge sizes on the
actual phone via the dev server (`systemctl --user start cloudcli-dev`, port 5173).

Targets to evaluate there, not commitments:

| Role | Current | Handoff target | Notes |
|---|---|---|---|
| Chat prose | 14px (`prose-sm`) | 15–16px, lh 1.5 | biggest density change — judge on device |
| Code blocks | highlighter default | 13–13.5px, lh 1.55–1.6 | Iosevka runs narrow; floor 12.5px |
| Inline code | — | 0.9em of surrounding | |
| Composer input | 14px (`text-sm`) | 16px | see viewport note below |
| Meta/timestamps | various `text-xs` | 11–12px, weight 500, muted | 11px is the absolute floor |
| Buttons/chips | 13–14px | 13–14px, weight 500–600 | already fine |

**Viewport note:** `index.html` ships `user-scalable=no, maximum-scale=1.0`, which is
why the 14px composer doesn't trigger iOS focus-zoom today — the zoom is globally
disabled. So the 16px input rule isn't fixing a live bug; it's a prerequisite for
*removing* `user-scalable=no` later (accessibility — pinch-zoom currently doesn't work
at all). Decide that in the UI overhaul, not here.

## Rules carried over from the study (still apply)

- De-emphasis = muted color, never weights below 400.
- Markdown `**bold**` → 600 (Figtree's 400→500 step is too subtle at 15px); `*italic*`
  → true italic — the 400-italic file must ship or the browser fakes an oblique.
- Live counters (token count, context %) must not jitter: render them in Iosevka
  (`font-mono` — inherently tabular). Only fall back to Figtree +
  `font-variant-numeric: tabular-nums` if the tnum test passes (render `1111111` vs
  `0000000` at meta size; equal width = pass).
- Mono strictly scoped: code, terminal, file paths, inline code, counters. Never
  buttons, chrome, or prose.
- Sizes in rem; WCAG AA 4.5:1 incl. muted text in both themes; `overflow-wrap:
  anywhere` on message containers for long paths/hashes (already largely handled by
  the existing `.chat-message` rules).

## Verification checklist (before calling it done)

1. Fallback render: block `public/fonts/*` in devtools → app must be fully usable on
   system fonts, no layout depending on Figtree/Iosevka metrics.
2. On-device check on the actual phone, both themes: Figtree at 11–12px, Iosevka at
   13px, italic + bold in a real markdown-heavy Claude reply.
3. tnum test (above) if any counter ends up in Figtree.
4. Payload: sum the woff2 transfer in devtools — under ~200 KB.
5. A few days of real use for Iosevka density; if cramped, try 13.5px/1.6 before
   considering Iosevka Extended (which surrenders the width advantage).
6. Confirm the PWA still works offline with fonts (sw.js caching of `/fonts/*`).
