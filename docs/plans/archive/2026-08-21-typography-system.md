# Typography foundation and reading presets

- Status: complete
- Next: none — archived after live acceptance.
- Context: [typography map](../maps/typography.md),
  [ADR 0043](../decisions/0043-reading-size-is-content-scoped-and-device-local.md)

## Phases

- [x] 1. Reject the auditioned Miranda Sans / Monaspace Neon pairing without
      discarding the reusable UI, prose, and monospace routing.
- [x] 2. Keep primary-interface sizes on their established Tailwind utilities;
      customization is scoped to chat reading metrics.
- [x] 3. Move theme and chat reading size into one typed, device-local
      Appearance preference owner with legacy-theme migration.
- [x] 4. Ship Compact, Default, and Large reading presets for ordinary user and
      assistant content, including Markdown tables and code.
- [x] 5. Focused checks, the client build, and live phone verification confirm
      reflow and the chat/sidebar relationship.

## Done when

- Appearance changes reading size immediately and persists it per browser.
- Default is 15px/22px on phones and preserves 14px/24px at `sm` and above.
- Compact and Large coordinate prose, paragraph rhythm, tables, headings, and
  code without scaling the composer, tools, metadata, editor, or terminal.
- Switching presets retains the bottom anchor or the currently viewed message.
- No rejected audition font asset or family-specific rule ships.

## Not doing

- Font uploads, a family picker, advanced metric sliders, colour theming,
  editor scaling, or terminal font changes.
