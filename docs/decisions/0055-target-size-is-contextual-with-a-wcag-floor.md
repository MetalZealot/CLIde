# 0055 — Target size is contextual, with a WCAG floor

- Date: 2026-09-10
- Status: Accepted
- Refines: [0044 — Input capability sets targets; row shortcuts stay bounded](0044-input-capability-sets-targets-row-shortcuts-stay-bounded.md)

## Decision

CLIde controls meet [WCAG 2.2 SC 2.5.8](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum)'s 24×24 CSS-pixel target or a documented spacing/equivalent-control exception. Apple’s 44pt and [Android’s 48dp](https://developer.android.com/guide/topics/ui/accessibility/apps) figures are comfort recommendations, not a universal web floor: preserve CLIde’s established density and choose larger hit areas from context, including spacing, adjacency, frequency, consequence, input method, and real-device evidence. The row-shortcut and identity/state decisions in ADR 0044 remain unchanged.

## Rejected

A blanket 44px target made compact menus and groupings feel oversized; treating the WCAG minimum as the preferred size would ignore touch comfort in places that benefit from more room.

## Why

[Apple distinguishes a 44×44pt default from a 28×28pt minimum](https://developer.apple.com/design/human-interface-guidelines/accessibility), while WCAG permits 24×24 CSS pixels or sufficient spacing. The Better Interface guidance likewise preserves an established density system and aims larger only where density permits.
