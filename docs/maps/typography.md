# Typography

CLIde separates font family, primary-interface hierarchy, and chat reading
density so one can change without silently changing the others.

## Ownership

- `AppearancePreferencesContext` owns the device-local theme, `fontFamily`,
  `chatReadingSize`, and `chatLineSpacing`. It persists one versioned object under
  `appearancePreferences`, migrates older values, and applies theme plus
  `data-font-family`, `data-chat-reading-size`, and `data-chat-line-spacing` to
  the document root. The inline bootstrap mirrors that read before first paint.
- `src/index.css` owns family, feature, tracking, weight, and reading-metric CSS
  variables. Tailwind routes `sans`, `prose`, and `mono` through those family
  variables. Existing interface sizes remain on their original Tailwind
  utilities; only chat reading metrics are customizable.
- Appearance Settings owns the CLIde / System family choice and Smallest /
  Small / Default / Large reading-size control, plus Condensed / Standard /
  Relaxed / Spacious line spacing. A live sample uses the same chat variables;
  popover values report the active breakpoint's font size and resulting line
  height. CLIde uses Encode Sans for the interface and Merriweather for prose;
  System uses the device interface font for both. Reading changes normal user
  and assistant content immediately; they are not general page zoom or
  interface-density controls.

Phone prose steps through 14px/21px, 15px/22px, 16px/24px, and 17px/26px.
At `sm` and above the same presets step through 13px/21px, 14px/24px,
15px/24px, and 16px/26px.

Line spacing subtracts 2px at Condensed, retains the selected size's base line
height at Standard, then adds 2px or 4px. It affects ordinary message prose,
lists, blockquotes, and table cells; paragraph gaps, headings, code, tools, the
composer, editor, and terminal keep their existing metrics.

`SettingsChoicePopover` is the shared select-only control for reading size,
line spacing, and language. It keeps DOM focus on its trigger while its listbox
is open, supports arrows, Home/End, type-ahead, Escape, outside dismissal, and
immediate save. Theme and typeface remain segmented because their short choices
benefit from staying visible.

Chat reading uses `--chat-prose-size`, `--chat-prose-line-height`,
`--chat-paragraph-gap`, and `--chat-code-size`. Inline code remains relative to
prose; fenced code uses the explicit code size; table cells inherit prose.

## Boundaries

- The composer and its command/mention overlays stay matched at 16px/24px.
- Tool traces, reasoning metadata, system notices, the code editor, and xterm
  retain their own fixed metrics.
- `--font-ui`, `--font-prose`, and `--font-mono` are the family-switching seam.
  System changes UI and prose only; code retains the system-backed monospace
  stack, and xterm keeps its fixed Menlo stack. A new bundled family still needs
  Typography Studio comparison, licensed assets, offline-cache handling, and
  installed-PWA acceptance before it becomes selectable.
