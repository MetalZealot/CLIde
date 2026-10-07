# Design system: every screen built from one small set of named values

- Status: draft
- Plan: [One design system](../plans/design-system.md)
- Context: [design system reference](../design-system.md),
  [architecture](../../ARCHITECTURE.md) quality goals, ADRs 0001 and 0062

This design fixes where CLIde's screens get their look: colour, corners, depth,
stacking, text size, motion, the shared components, and the layouts built from
them. When the plan closes, every screen draws from one named set, a check stops
new raw values at commit, and the app can be rethemed. Spacing values, the Shell
and code highlighting stay as they are.

Labels: **measured** = counted with grep over `src/**/*.{ts,tsx}` on 2026-10-07;
**source** = read in code.

## Starting point

- **Colour bypasses the tokens.** 1,504 raw palette classes across 112 files:
  gray 567, red 239, blue 237, green 110, amber 99, the rest under 70 each; plus
  94 hex literals in 11 files (measured). The token layer itself is sound:
  `src/index.css` variables wired into Tailwind as shadcn-style roles plus
  `status-attention/unread/running` (source).
- **Corners: 7 sizes over 646 uses** — `rounded` 197, `-lg` 192, `-md` 149,
  `-xl` 78, `-2xl` 17, `-sm` 10, `-3xl` 3 (measured). `--radius` drives only
  `lg/md/sm` (source).
- **Stacking order is ad hoc.** 10 z-index values (measured). Dialogs sit at 50
  (`Dialog`), 60, 70 (`FolderBrowserModal`), 9999 (`ContextMenuOverlay`, the code
  editor) and 10000 (`McpServerFormModal`) (source), so which overlay wins
  depends on who picked the bigger number.
- **Shadows: 7 sizes plus 4 one-off values** (measured); on the dark theme they
  barely show.
- **Type is mostly settled** ([reference](../design-system.md#typography)), but
  134 arbitrary sizes across 9 values remain, 107 of them 10px or 11px — below
  Tailwind's smallest step, 12px (measured).
- **Motion: 7 durations**, 56 of 68 uses at 150 or 200 ms (measured).
- **Shared components live in `src/shared/view/ui/`** (24 files, source), and
  nothing stops a screen building its own look-alike.
- **Nothing enforces any of it** — no lint rule or check reads class names
  (source).

## Settled with Grayson

- 2026-08-13: monochrome, single-accent and full-colour are one feature: a hue
  plus a chroma dial over the same token set. Monochrome is chroma 0.
- 2026-08-13: dark variants are derived by inverting lightness while holding hue
  and chroma, never hand-authored. That is why the tokens move to OKLCH: in HSL,
  holding lightness while sweeping hue makes yellow glare and blue go muddy.
- 2026-08-13: provider colours are accent-only — a session-row stripe or avatar,
  never app chrome, because colour already carries state here.
- 2026-08-13: no "detect device" corner radius, since the browser cannot read
  one; four presets instead: square, min, medium, large.
- 2026-08-13: `rounded-full` stays literal; pills and avatars do not follow the
  radius setting.
- 2026-10-07: the design system is one design and one plan; the colour theming
  plan folds in. The reference doc gains a section as each area lands.

## Design positions

Technical calls, each with its reason and the alternative it rejects.
Overturnable until this design is agreed.

- **Components use only role tokens.** Raw values live in `src/index.css` and
  nowhere else; a raw class is a screen no theme can reach. Rejects
  per-component tokens (`--button-bg`): too many names for one maintainer.
- **A ratchet, not a ban.** `npm run check:design` counts each banned pattern
  and fails when a count rises above its recorded baseline; each phase takes its
  baseline to zero, after which the pattern is banned outright. Rejects an eslint
  rule on staged files: mid-migration, a one-line edit to an unmigrated file
  would block its commit. It lands first, so new raw values stop on day one.
- **Role names say the job, not the size.** `rounded-control`, `shadow-overlay`,
  `z-dialog`: the right choice for a new button is obvious without the doc.
  Rejects keeping `sm/md/lg`, which is how seven sizes built up — nothing says
  which one a card takes. Colour keeps its shadcn names (`card`,
  `muted-foreground`), which already name jobs and are shared with upstream.
- **The role set is closed.** A new role needs a job on at least two screens and
  a change to this design. Otherwise the same mess returns as a token per screen.
- **Depth comes from surface lightness in dark, shadow in light.** Three
  surfaces — `background`, `card`, `popover` — step lighter in dark, because
  shadows on near-black do not read. Material does the same.
- **Status keeps its hue in every theme, and never relies on hue alone.**
  Monochrome removes hue from chrome, not from attention, unread, running,
  destructive or warning; each also carries an icon, shape or text cue
  (WCAG 1.4.1, level A). Rejects the colour plan's "monochrome shows no hue
  anywhere", which would leave state unreadable.
- **Every preset passes contrast before it ships.** A script checks each preset
  in light and dark: text on every surface 4.5:1, icons and borders 3:1
  (WCAG 1.4.3, 1.4.11). Derived dark is a formula, a formula can fail for some
  hues, and nobody inspects every combination by eye.
- **One text step below `text-xs`.** `text-2xs` (11px) takes the 10px and 11px
  labels rather than pushing 107 dense labels up to 12px; the 9px and 8px uses go
  to it too. Nothing smaller.
- **Appearance stays device-local**, in `AppearancePreferencesContext`'s
  versioned object beside reading size, applied before first paint by the same
  bootstrap. An unknown stored preset falls back to the built-in one, and the
  PWA's `theme-color` follows the active theme. Rejects account sync: no other
  appearance setting syncs, and a phone may want a different theme from a desk.
- **Tokens stay CSS variables that Tailwind reads**, so a move from Tailwind 3
  (`^3.4.0`, source) to 4, which is CSS-first and OKLCH-native, changes config,
  not screens.
- **`src/shared/view/ui/` is the only home for a shared look.** A screen-local
  copy of a button, menu, dialog or row folds in rather than being restyled.
- **A pattern names a live screen to copy**, not a description. Spacing is
  settled per pattern ("settings row: `px-4 py-3`") rather than as tokens:
  Tailwind's 4px scale already is one, and only 30 arbitrary spacing values exist
  (measured).

## Target design

### Tiers

Primitives (OKLCH values, `src/index.css` only) → roles (CSS variables exposed
as Tailwind utilities) → components and screens. A theme sets hue and chroma on
the primitives; roles point at primitives; dark is derived. Nothing below the
role tier names a primitive.

### The sets

Exact values are settled in each phase with a look in the app; the names and
counts are fixed here.

| Area | Target |
|---|---|
| Colour | The existing roles plus whatever the colour mapping table proves on two or more screens — likely `success`, given 170 green and emerald uses |
| Radius | `rounded-chip`, `rounded-control`, `rounded-panel`, scaled by the radius preset; `rounded-full` literal |
| Elevation | Surfaces `background` < `card` < `popover`; `shadow-raised`, `shadow-overlay`, `shadow-dialog` |
| Stacking | `z-sticky` < `z-dropdown` < `z-overlay` (sheets, scrims) < `z-dialog` < `z-toast`; a dialog opened from a dialog shares its layer and wins by portal order |
| Type | Tailwind `xs`–`3xl`, `text-2xs`, and the chat roles (ADR 0062) |
| Motion | `duration-fast` 150 ms (hover, press), `duration-base` 200 ms (open, close); named animations such as the activity indicator are exempt; reduced motion honoured |

### Enforcement

- `check:design` runs in the pre-commit hook beside lint-staged and holds one
  baseline per pattern: raw palette class, hex outside token files, arbitrary
  font size, arbitrary z-index, radius, shadow or duration outside its set.
  Upstream work arriving with raw classes fails it, and is mapped on the way in.
- The contrast script runs whenever a primitive or preset changes.

### A phase's lifecycle

Settle the set (a change here if it moves) → migrate screen by screen, each
looked at in the app → baseline to zero, then banned → that reference section
written in the same commit. Colour mapping is meant to change nothing visible;
radius, elevation, type and motion consolidation changes some screens slightly,
and each is reviewed on the phone. Light and dark are both checked on the
installed PWA, where the remaining defects show up in the status bar and safe
area.

## What Grayson gives up

- The colour migration is the longest phase and shows nothing: about 1,500
  replacements meant to look identical.
- No one-off values. A screen that wants a fourth radius or a 13px label needs a
  change to this design first.
- Dark colours cannot be hand-tuned per theme.
- Radius, shadow and small-text consolidation moves some screens by a pixel or
  two.
- A theme chosen on the phone does not follow you to the desktop.

## Not doing

- **The Shell.** xterm carries its own theme object and measures its grid at
  init.
- **Syntax highlighting and the code editor**, which ship their own colour sets.
- **User-authored themes.** Presets are a dial over a fixed role set, not a
  per-token editor.
- **Spacing tokens** — see the pattern position.
- **A component gallery.** The reference doc points at live screens; a gallery
  is a second thing to keep current.
- **Custom project icons** — a separate TODO item, not colour.
