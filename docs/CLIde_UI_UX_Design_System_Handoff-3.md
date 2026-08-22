# CLIde UI/UX Design-System Handoff

## Purpose

This note summarizes the current discussion about CLIde's UI/UX direction, the follow-up review of the current repository, and later design exploration around Session-card hierarchy and icon usage.

The goal is not to redesign CLIde from scratch. It is to formalize the design principles CLIde is already converging on so future UI work does not optimize one screen or device in isolation and gradually accumulate inconsistent "slop."

Use this as a starting point for a Codex/Claude session to review the current codebase and draft a concise `UI_DESIGN_GUIDELINES.md`.

---

## Core concern

Recent CLIde work has focused heavily on mobile, while also borrowing patterns from:

- Desktop IDEs and agentic coding tools such as Cursor, Codex, Antigravity, T3 Code, VS Code, etc.
- Desktop applications such as Claude.
- Mobile applications such as ChatGPT and Claude.
- Mobile/web agent interfaces such as CloudCLI / T3 Code.

These environments do not all follow the same interaction model.

The recurring risk has been:

1. A UI change is evaluated only in the viewport currently being worked on.
2. It looks locally better.
3. Another control or feature is added around it.
4. Mobile improves while desktop gets awkward, or vice versa.
5. Controls are shuffled again to make room.
6. The interface slowly loses a coherent hierarchy.

The desired future workflow is therefore:

> A UI change is not considered good merely because it improves the current viewport. It should be evaluated against CLIde's layout, interaction, hierarchy, and accessibility rules across relevant window sizes and input methods.

---

# Key distinction: there is no single "industry standard"

What gets called an industry UI/UX standard is really several layers.

## 1. Usability and accessibility constraints

Examples:

- Adequate touch targets.
- Keyboard accessibility.
- Focus visibility.
- Contrast.
- Clear state communication.
- Reduced-motion handling.
- Avoiding inaccessible hover-only controls.

These are relatively objective.

## 2. Platform conventions

Examples:

- Touch ergonomics on phones/tablets.
- Hover, context menus and modified clicks on desktop.
- Browser Back behavior.
- Native-feeling sheets/popovers.
- Mobile safe areas and virtual-keyboard behavior.

These are strong conventions, but contextual.

## 3. CLIde's product design system

Examples:

- Spacing scale.
- Typography.
- Sidebar density.
- Border radius.
- Which metadata is always visible.
- Iconography and when icons should replace, accompany, or defer to text.
- Which actions belong in menus.
- How mobile and desktop expose equivalent capabilities.

These are product decisions and should be codified rather than repeatedly improvised.

---

# Important conceptual change: layout is not the same as device type

Do not think only in terms of:

- mobile
- tablet
- desktop

Prefer thinking in terms of **available window space** and **input capability**.

A desktop browser can be narrow.
A tablet can be wide.
A touch-capable device can be desktop-width.
A desktop user can resize CLIde to phone-like dimensions.

Conceptually, CLIde should distinguish things similar to:

```text
window:
  compact | medium | expanded

pointer:
  coarse | fine

hover:
  available | unavailable

shell:
  browser | standalone-PWA
```

This does not need to become the literal implementation immediately.

The important design rule is:

> Layout capability and input capability are independent.

---

# Current repo findings

The repository audit showed that CLIde is already more disciplined than expected.

The UI is not simply arbitrary styling. Several design-system ideas already exist, especially in the sidebar.

## Sidebar surface tiers

`docs/maps/sidebar-surface.md` already defines three UI placement tiers:

### Tier 1 — Permanent

Consumes resting screen space.

Used for things users must see without acting:

- hierarchy
- status
- search
- identity
- the highest-frequency actions

### Tier 2 — Anchored

Costs no resting space.

Used for contextual actions in:

- long-press menus
- kebabs
- right-click menus
- row-specific popovers

### Tier 3 — Contained

Complex or infrequent destinations:

- Settings
- Archive
- Worktree Manager
- confirmations
- version information

This is a strong model and should become part of the formal UI guidelines.

### Important follow-up

The repo TODO already proposes adopting a **Tier-1 budget**.

That should probably become a real rule:

> New functionality defaults to Tier 2 or Tier 3. Adding permanent Tier-1 UI should require explicit justification because every permanent control consumes scarce attention and space.

This directly prevents the pattern of continually asking "where can this new button fit?"

---

# Recent UI changes are generally moving in a good direction

Recent commits show consolidation rather than uncontrolled feature accumulation.

Examples:

## Activity and Pinned

Activity stopped being another duplicate list of sessions and moved toward status attached to the actual repository/session.

Pinned sessions remain part of the session hierarchy rather than becoming another visually identical global section.

This reduces redundant navigation and makes status and structure distinct.

## Projects / Sessions / Archive

These became destinations within one browsing model instead of separate permanent controls competing for space.

Search remains high-frequency and visible.
Sort/filter became contextual to the currently active list.

This is stronger information architecture.

## Checkout naming

Recent work distinguishes:

- **place** — checkout/worktree folder
- **state** — branch or detached state

Where space permits, both are shown.
Where only one visible value fits, the other survives through tooltip/accessibility metadata where appropriate.

This is a good example of hierarchy and progressive disclosure.

## Data-driven menus

Data-driven popovers are capped so they do not grow to viewport height.
Known fixed action menus are deliberately not capped.

This is a good contextual rule rather than a universal arbitrary max-height.

## Settings Back behavior

Mobile Settings now owns browser/PWA Back navigation appropriately instead of allowing Back at the root to exit the application.

This is the kind of platform-specific interaction behavior that should remain explicitly documented.

## Usage dashboard

The new Usage page uses progressive disclosure:

- primary usage windows are visible
- secondary/model-specific information lives under Details
- stale/error states are surfaced
- content width is constrained instead of blindly filling the screen

This is a sensible baseline, although expanded desktop layouts should still be evaluated rather than assumed correct just because the page scales.

---

# Mobile implementation already contains good platform-specific work

Several current implementation choices should be preserved as established principles.

## Safe areas

CLIde accounts for `env(safe-area-inset-*)` and has explicit ownership of top/bottom insets.

## Virtual keyboard

The app shell uses `VisualViewport` behavior for iOS where the virtual keyboard can overlay the layout viewport.

## Hover behavior

Tailwind is configured to avoid sticky hover behavior on touch-only environments.

## Reduced motion

`prefers-reduced-motion` is already handled globally.

## Alternate interaction paths

The sidebar supports combinations such as:

- long-press on touch
- kebab on pointer
- right-click on desktop

This supports a useful principle:

> Feature parity does not mean presentation parity.

Mobile and desktop may expose the same capability differently.
Missing capability, however, should be treated as a bug unless the divergence is explicitly intentional.

---

# Current architectural weakness: `isMobile` is too broad

`useDeviceSettings` currently effectively treats:

```text
window.innerWidth < 768
```

as the major mobile/desktop decision.

That conflates:

- window width
- touch capability
- pointer precision
- hover support
- physical device type

The sidebar map itself already records one resulting edge case:

> A touch device at desktop width gets the desktop tree.

The current code compensates with touch-specific visibility rules and a Samsung Browser fallback, but the broader design model should eventually stop treating width as a proxy for all device behavior.

This is probably the most important architectural addition to the UI guidelines.

---

# Spacing and density need formalization

Semantic color tokens, safe-area variables, radius tokens and app-bar height already exist.

Spacing is much less systematic.

A recent sidebar adjustment changed row margins from a Tailwind scale value to:

```text
my-[3px]
```

because it looked more proportionate.

That specific result may be correct.

The concern is the process: repeated isolated optical adjustments can eventually produce an unofficial scale of 2px / 3px / 5px / 7px / 11px / etc.

Recommended rule:

## Base spatial rhythm

Prefer a consistent 4px-derived scale:

```text
4
8
12
16
24
32
48
```

Tailwind's existing spacing scale can remain the implementation mechanism.

Arbitrary values are allowed when there is a genuine optical or technical reason, but should be treated as exceptions rather than creating new informal spacing conventions.

The purpose is not mathematical purity.

The purpose is to make UI decisions semantic:

- micro/internal spacing
- compact relationship
- normal component spacing
- section spacing
- structural separation

rather than "try another couple pixels."

---

# Visual size and interaction size must be separate

CLIde already does this well in the sidebar utility row:

- visible controls are around 32px
- their interaction area effectively fills a ~44px row

That pattern should become systemic.

Current TODO/code still contains smaller shared/mobile controls around 28x28px in some places.

Recommended principle:

> Compact visual controls are allowed. Compact touch targets are not automatically acceptable.

A 16px icon can remain visually small while its clickable/tappable area is larger.

Touch/coarse-pointer layouts should generally aim for comfortable ~44px interaction regions unless a specific exception is justified.

Pointer-focused desktop layouts may legitimately be denser.

---

# Desktop should not merely be "mobile, but wider"

Some parts of CLIde already meaningfully adapt on desktop:

- persistent sidebar
- collapsed rail
- real anchor links
- modified-click behavior
- context menus
- hover actions
- different New Session placement
- right-click access

That is good.

However, every new surface should still ask:

> At larger widths, should the extra space enlarge content, reveal more information, or change structure?

Do not automatically stretch compact layouts across the desktop.

Also do not force multi-column layouts just because room exists.

The design review should explicitly decide which behavior is appropriate.

---

# Information hierarchy should remain stable across layouts

For any component, classify visible information as:

- **Primary**
- **Secondary**
- **Contextual**
- **Action**

Example for a session:

### Primary
Session name.

### Secondary
Running / awaiting action / unread state.

### Contextual
Project, worktree, branch, provider, model, timestamps, token information.

### Action
Stop, rename, archive, move, delete, open menu, etc.

The hierarchy should stay conceptually stable across layouts.

What changes is how much contextual information is exposed.

Compact UI should use progressive disclosure rather than squeezing every desktop datum into the same row.

---

# Iconography needs a semantic grammar

Recent Session-card exploration exposed a useful design-system gap: CLIde has guidance for hierarchy and density, but not yet for deciding when an icon actually earns space.

Icons should not be added merely because a matching Lucide glyph or provider mark exists. They should perform a clear semantic job.

A useful classification is:

- **Identity** — provider/agent marks such as Claude or Codex.
- **Category** — identifies what an adjacent value represents, such as branch/worktree context.
- **State** — pinned, running, awaiting approval, unread, error, warning, etc.
- **Action** — pin/unpin, archive, close, menu, stop, and other controls.
- **Decorative/redundant** — icons that repeat information already made obvious by text, position, typography, or formatting. Avoid these.

Recommended rule:

> An icon should remain only when removing it makes the information slower to classify, harder to distinguish, or removes important identity/state/action meaning.

## Prefer layout and typography before another icon

Stable spatial placement is itself a form of communication. If a component consistently establishes where Project, Session, and Git context appear, every row does not also need a glyph restating that hierarchy.

For example, a Project name in a stable Project position may not need a permanent project/folder icon. A worktree or branch string benefits more from a Git icon because the raw text is otherwise comparatively ambiguous.

Similarly, a duration such as `13m` generally does not need a clock icon; the suffix already communicates the value type.

This leads to a useful question:

> "Does this icon communicate something the UI does not already communicate?" comes before "Which icon should I use?"

## Icon + text vs icon-only vs text-only

Use:

- **Icon only** when meaning is highly conventional, repeatedly learned, and still accessible through labels/tooltips/ARIA where needed.
- **Icon + text** when the icon materially improves classification or identity.
- **Text only** when the text and its placement are already self-explanatory.
- **No persistent icon** when hierarchy, typography, or progressive disclosure communicates the same information more quietly.

Provider logos deserve slightly different treatment from generic utility icons. They function as identity badges, so they may legitimately carry more visual weight. Generic metadata icons should generally be more subdued so every glyph does not become an equal attention anchor.

Size a state icon beside metadata relative to that text, so browser text scaling preserves their visual proportion across input and viewport modes.

## Iconography may adapt across layouts

Feature parity does not require an icon or label to survive unchanged at every width.

Depending on space and input capability:

- an icon may replace a text label in compact UI
- expanded UI may restore text and make the icon redundant
- metadata icons may disappear when their information moves into progressive disclosure
- touch may keep an action visibly reachable while pointer layouts reveal the same action on hover/context menu

The semantic role should survive even when its presentation changes.

## Session-card layout direction from the current exploration

The mockups suggest treating Session cards as two deliberate density modes rather than forcing one arrangement across every viewport.

### Normal / comfortable

Keep a clear three-level hierarchy:

1. Project
2. Session
3. Git/worktree context

The current preferred direction is the variant where the provider mark sits directly with the Session title, because the mark identifies the session/provider rather than the Project or Git metadata.

Project can rely primarily on stable position and typography instead of automatically receiving another permanent icon. Git/worktree context can retain a subdued category icon because it improves classification.

### Compact / narrow

A denser variant may collapse contextual information into fewer rows, for example keeping provider + Session as the primary row and combining Project/Git context below it.

This should be treated as an intentional responsive transformation:

> same information hierarchy, less contextual exposure

rather than a desktop card squeezed until it fits.

The accepted Session-card implementation now provides a concrete test case for the broader iconography and hierarchy rules.

---

# Design-system debt found in the repo

## Hardcoded palette utilities

The theming TODO records roughly 2,335 hardcoded palette classes across 118 files.

That means existing styling should not automatically be treated as design precedent.

The future guidelines should distinguish:

- established semantic design tokens
- transitional/legacy styling
- deliberate component-specific exceptions

Otherwise agents may copy technical debt simply because it already exists.

## Typography is transitional

The current source still uses Encode Sans while there is a planned typography overhaul.

Any guideline should clearly mark which typography decisions are authoritative and which are pending.

## `transition: all`

Global interactive CSS currently applies broad `transition: all` behavior in places.

Recommended future rule:

> Animate intentionally. Prefer color, opacity and transform. Avoid accidental layout animation caused by broad `transition: all`.

Not urgent, but useful design-system cleanup.

---

# Existing TODO items that directly support this design-system effort

The repo already records several UX inconsistencies worth using as test cases for the guidelines:

- Adopt or reject a Tier-1 permanent-chrome budget.
- Repository row taps behave differently at different breakpoints without a documented reason.
- Version information is unreachable on mobile when no update banner is present.
- Session count formatting differs between mobile and desktop.
- Shared Archive actions remain 28px on mobile.
- Safe-area ownership still has historical/dead-path cleanup.
- Some mobile popup/menu content can still be cut off.
- Desktop row kebab can overlap timestamp/provider metadata.
- Tool-call copy placement is heavy on mobile.
- Touch-at-desktop-width behavior remains an architectural edge case.

The guidelines should make these kinds of inconsistencies easier to classify rather than fixing them through isolated taste judgments.

---

# Proposed CLIde UI/UX principles

A concise `UI_DESIGN_GUIDELINES.md` should probably encode at least these rules.

## 1. Design for window capability, not device labels

Compact/medium/expanded space governs layout.
Pointer/hover capability governs interaction behavior.

Do not treat `isMobile` as the answer to every responsive question.

## 2. Feature parity does not require presentation parity

The same capability may use:

- long-press on touch
- kebab on pointer
- right-click on desktop
- full-screen route on compact layouts
- persistent pane on expanded layouts

But capability should not silently disappear.

Any intentional divergence should be documented.

## 3. Tier 1 is scarce

Permanent UI consumes attention and space.

New functionality should default to anchored or contained surfaces unless permanent visibility is essential.

## 4. Hierarchy survives every layout

Primary information remains primary.
Secondary/contextual information may move, collapse, or disclose progressively.

Do not solve compact layouts by merely squeezing everything.

## 5. Use a spatial system

Prefer the established spacing scale.

Arbitrary spacing values require a reason.

Do not repeatedly eyeball local pixel adjustments without considering the wider spatial rhythm.

## 6. Visual size and hit-target size are independent

Small icons are fine.
Touch targets should remain comfortably operable.

Input capability matters independently of width.

## 7. Expanded space must earn a layout response

When more width becomes available, decide whether to:

- reveal more information
- reflow
- add panes
- increase breathing room
- leave content constrained

Do not automatically stretch or automatically add columns.

## 8. Use semantic tokens, not accidental precedent

Known hardcoded colors, temporary typography and legacy component styles are not automatically standards.

Agents should prefer authoritative design tokens and documented component patterns.

## 9. Icons must earn their visual weight

Use icons for identity, category, state, or action when they improve recognition.

Do not add icons merely to decorate or repeat meaning already supplied by text, position, typography, or formatting.

Prefer stable spatial hierarchy before adding another permanent glyph.

Provider identity marks may be visually stronger; generic metadata icons should generally remain subordinate.

## 10. Every UI change gets a cross-layout review

Before considering UI work complete, review the relevant states for:

- compact/touch
- medium/resized
- expanded/pointer
- keyboard interaction
- browser vs standalone PWA where relevant

The review should ask:

- What disappears?
- What moves?
- What becomes contextual?
- What becomes easier to reach?
- Is that divergence deliberate?
- Does the component still fit the same information hierarchy?

---

# Recommended review rubric for future UI work

For any significant UI change, evaluate:

## Hierarchy
Is the most important information dominant?

## Density
Is visible information appropriate for the available space?

## Iconography
Does each visible icon improve identity, classification, state recognition, or action discoverability? Would position or text communicate the same thing with less noise?

## Ergonomics
Are controls suitable for the actual input method?

## Responsiveness
What happens in compact, medium and expanded windows?

## Progressive disclosure
Is secondary information hidden intelligently rather than deleted or squeezed?

## Consistency
Does the change use established CLIde patterns and tokens?

## Platform behavior
Does Back, hover, long-press, context menu, focus, safe area, keyboard behavior, etc. feel appropriate?

## Accessibility
Are focus, contrast, target size, semantic state and keyboard operation preserved?

## Discoverability
Can users reasonably find important actions?

## Necessity
Does this information/control deserve permanent UI space at all?

A particularly useful question:

> "Should this always be visible?" comes before "Where can I fit this?"

For iconography specifically:

> "Does this icon communicate something the UI does not already communicate?" comes before "Which icon should I use?"

---

# Suggested next Codex/Claude task

Review the current repository specifically to turn the above into a short authoritative design-system document.

Do **not** immediately refactor the UI.

Recommended sequence:

1. Re-read:
   - `docs/maps/sidebar-surface.md`
   - UI-related ADRs, especially recent sidebar/navigation decisions
   - `docs/TODO.md` UI/mobile/sidebar/theming sections
   - `src/hooks/useDeviceSettings.ts`
   - `src/index.css`
   - `tailwind.config.js`
   - representative shared UI primitives

2. Identify which existing behaviors are:
   - established convention
   - intentional exception
   - technical debt
   - unresolved design decision

3. Draft `UI_DESIGN_GUIDELINES.md` around the principles above.

4. Keep it concise enough that agents can realistically consult it before UI work.

5. Decide where it should live and whether `AGENTS.md` should contain a short instruction such as:
   - UI changes must consult the design guidelines.
   - Significant UI changes must be checked at compact and expanded widths.
   - Width and input capability must not be treated as interchangeable.

6. Do not invent a huge new component library or token architecture unless the audit proves it is necessary.

7. After the document is accepted, use current TODO inconsistencies as practical tests of whether the rules are useful.

---

# Desired outcome

The objective is not to eliminate personal taste.

CLIde can and should retain its own visual identity.

The objective is to prevent personal taste—or an AI agent optimizing the immediate task—from overriding:

- interaction ergonomics
- hierarchy
- responsive behavior
- accessibility
- information density
- iconographic clarity
- platform conventions
- established CLIde design decisions

The UI should become easier to evolve because future decisions are made against a stable system instead of re-deriving the rules from whichever component happens to be open.
