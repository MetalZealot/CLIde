# Handoff Spec: CLIde Typography System

## Overview

CLIde is a mobile-first web UI for driving Claude Code sessions (chat stream interleaving prose, code blocks, terminal output, file paths, and token/usage counters). Primary viewport: ~360–430px phones. This spec defines the complete type system: families, fallback stacks, loading strategy, scale, and usage rules.

**Scope:** typography only. Colors, spacing, and component layout are out of scope except where they interact with type (e.g., de-emphasis via color).

**Assumptions (flag if wrong):**
- Web app (HTML/CSS/JS), not native. Sizes in `rem` with `1rem = 16px` root.
- Fonts self-hosted (served alongside the app from nuthallpi), not loaded from Google Fonts CDN.
- Dark and light themes both possible; nothing here is theme-dependent.

---

## Typefaces

| Role | Family | License | Why |
|---|---|---|---|
| UI + prose (chat messages, buttons, labels, headers) | **Figtree** (static weights, not the variable file) | OFL | Designed for UI; large x-height; **true italics in all weights** (required for markdown emphasis and placeholder text); open-source, self-hostable |
| Code, terminal, file paths, counters | **Iosevka** | OFL | Narrowest mainstream mono (0.5em advance width) → ~20% more characters per line than JetBrains Mono on a phone viewport, which is the binding constraint for code in a mobile chat stream; true italics; strong i/l/1/O/0 differentiation |

**No third family.** No serif, no display face. Two families total keeps font payload and vertical-rhythm complexity down on mobile.

### Iosevka variant selection

- **Code blocks (markdown-rendered):** default Iosevka. Programming ligatures permitted here.
- **Terminal pane / raw CLI output:** **Iosevka Term** (or Fixed). Ligatures and quasi-proportional glyphs in default Iosevka can break column alignment in TUI output. `font-variant-ligatures: none` in the terminal pane regardless.
- If default Iosevka feels too cramped after real use, the fallback position is Iosevka Extended — but that surrenders the width advantage, so treat it as a last resort, not a tuning knob.

---

## Font stacks (use verbatim)

```css
:root {
  --font-ui: "Figtree", -apple-system, BlinkMacSystemFont, "Segoe UI",
             Roboto, "Noto Sans", sans-serif;
  --font-mono: "Iosevka Web", ui-monospace, "SF Mono", Menlo, Consolas,
               "Liberation Mono", monospace;
}
```

Rationale: the app must be fully readable on system fonts alone. First paint on a cold cache should never block on webfont delivery from the Pi (Tailscale/home upload bandwidth). System stacks here mirror what T3Chat ships as its *entire* strategy; we use it as the safety net.

---

## Font loading

1. **Format:** woff2 only. Latin subset only (subset with `pyftsubset` or use pre-subset webfont packages). Full Iosevka has enormous glyph coverage — never ship stock TTFs.
2. **Files to load (keep this list minimal):**
   - Figtree: 400, 400 italic, 600, 700
   - Iosevka: 400, 400 italic, 700 (700 covers ANSI bold in terminal output)
   - Nothing else unless a concrete need appears. No weights below 400 anywhere.
3. **`@font-face`:** `font-display: swap` on every face.
4. **Preload** the two most critical files (Figtree 400, Iosevka 400) via `<link rel="preload" as="font" type="font/woff2" crossorigin>`.
5. Optional polish, not required for v1: `size-adjust`/`ascent-override` on the fallback stacks to reduce layout shift at swap.

---

## Type scale

Base: body text 16px = 1rem. All sizes below in px for readability; implement as rem tokens.

| Token | Role | Size | Weight | Line-height | Letter-spacing | Family |
|---|---|---|---|---|---|---|
| `text-body` | Chat/message prose | 15–16px | 400 | 1.5 | 0 | ui |
| `text-input` | Message input field | **16px (hard floor — see rule 1)** | 400 | 1.5 | 0 | ui |
| `text-code` | Code blocks, terminal | 13–13.5px | 400 | 1.55–1.6 | 0 | mono |
| `text-code-inline` | Inline code in prose | 0.9em of surrounding text | 400 | inherit | 0 | mono |
| `text-title` | App/screen title | 17–18px | 600 | 1.3 | −0.01em | ui |
| `text-subtitle` | Header metadata (e.g., "Raspberry Pi 4 · metalzealot.com") | 12px | 400 + muted color | 1.3 | 0 | ui |
| `text-meta` | Timestamps, token counts | 11–12px | 500 + muted color | 1.3 | +0.01em | ui or mono (see rule 5) |
| `text-label` | Uppercase section labels (if used) | 11px | 600 | 1.2 | +0.05em | ui |
| `text-button` | Buttons, chips, model selector | 13–14px | 500–600 | 1.2 | 0 | ui |

Iosevka note baked into the scale: it runs narrow, so code sits at 13–13.5px with 1.55–1.6 line-height — roughly a half-point larger and slightly looser than would be right for a wider mono like JetBrains Mono. Do not shrink code below 12.5px.

---

## Rules (with rationale)

1. **Input field is 16px minimum, non-negotiable.** iOS Safari auto-zooms on focus of any input below 16px, which wrecks the layout. Android doesn't care; 16px is correct anyway.
2. **11px is the floor for anything informational or interactive.** Nothing below it, ever.
3. **De-emphasis is done with muted color, never with weights below 400.** Light weights disintegrate at mobile sizes and on low-DPI screens.
4. **Emphasis in Figtree is weight 600, not 500.** The 400→500 step is too subtle to read as emphasis at 15px. Markdown `**bold**` → 600 (or 700 if 600 tests too weak on device); markdown `*italic*` → true italic (Figtree has one — never allow browser faux-oblique via a missing italic file).
5. **Live numeric counters (token count, context %, cost) must not jitter as digits change.** Preferred implementation: render counters in Iosevka (mono = inherently tabular). Alternative: Figtree + `font-variant-numeric: tabular-nums` **only if** the tnum verification below passes.
6. **Mono is strictly scoped** to: code blocks, terminal output, file paths, inline code, and numeric counters. Never for UI chrome, buttons, or prose. The Figtree/Iosevka contrast (round vs. narrow-rigid) is intentional and functional — code should visibly *be* code — but it only works if the boundary is disciplined.
7. **Use rem (and respect OS/browser font scaling).** No hard-coded px sizes in components; the ADE audience over-indexes on people who customize accessibility settings.
8. **Text contrast meets WCAG AA:** 4.5:1 for body-size text, including the muted meta color in both themes.
9. **Line length:** prose takes care of itself on mobile (~40–45ch at 16px/380px viewport). Code blocks scroll horizontally (`overflow-x: auto; -webkit-overflow-scrolling: touch`) rather than wrapping, except terminal output, which wraps per terminal semantics.

---

## Edge cases

- **Fonts fail to load / slow first load:** app renders fully on the fallback stacks (this is the point of the stacks + `swap`). Verify nothing depends on Figtree/Iosevka metrics for layout correctness.
- **Long unbroken strings** (file paths, URLs, hashes) in prose context: `overflow-wrap: anywhere` on the message container so they can't force horizontal scroll of the chat stream.
- **User font-scaling at 130%+:** layout must reflow, not clip — this falls out of rule 7 if followed.
- **Streaming output:** code blocks growing during streaming shouldn't reflow surrounding prose (fixed-size mono + horizontal scroll handles this).

## Accessibility notes

- Honor `prefers-reduced-motion` for any type-related animation (streaming cursor, etc.).
- Semantic HTML for headings/labels so sizes in the scale aren't doing semantic work alone.
- If an accessibility font mode is ever added (claude.ai ships OpenDyslexic as an option), the token system above makes it a family-swap, not a redesign — a reason to route every `font-family` through the two CSS variables and never inline a family name.

---

## Verification checklist (do these before treating the system as final)

1. **Figtree tnum test:** render `1111111` vs `0000000` at `text-meta` size with `font-variant-numeric: tabular-nums` — equal width ⇒ tnum exists; unequal ⇒ counters go to Iosevka permanently (rule 5).
2. **On-device small-size render check:** Figtree at 11–12px and Iosevka at 13px on the actual target phone, both themes. Variable-font hinting is generally weak at small sizes — this spec calls for static weight files partly for that reason.
3. **Iosevka density check:** a week of real use reading actual Claude Code output. If it reads cramped, first try 13.5px/1.6 before considering Extended.
4. **Payload check:** total font transfer for the file list above should land well under ~200KB; if it doesn't, the subsetting step was skipped or done wrong.

## Decision log (for future reference)

- **Manrope was considered and rejected:** no italic exists (deliberate designer choice), and the designer's own guidance notes the variable version renders inconsistently at small sizes. Both are disqualifying for a mobile chat UI that renders markdown.
- **JetBrains Mono was considered and rejected for mobile:** excellent face, but 0.6em advance width costs ~20% characters per line vs. Iosevka at the viewport sizes that matter here. It remains the fallback candidate if Iosevka's narrowness fails the density check.
- **Field survey (July 2026):** ChatGPT uses a bespoke OpenAI Sans (previously licensed Söhne); Claude self-hosts Anthropic Sans/Serif/Mono (Styrene/Tiempos-derived) — every family with a true italic; T3Chat's public pages ship pure system stacks. CLIde's lane is distinctive open-source (the Vercel/Geist strategy): identity without licensing cost, self-hostable.
