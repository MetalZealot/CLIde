# Typography

CLIde separates font family, primary-interface hierarchy, and chat reading
density so one can change without silently changing the others.

## Ownership

- `AppearancePreferencesContext` owns the device-local theme and
  `chatReadingSize`. It persists one versioned object under
  `appearancePreferences`, migrates the old `theme` key, and applies theme plus
  `data-chat-reading-size` to the document root. The inline bootstrap mirrors
  that read before first paint.
- `src/index.css` owns family, feature, tracking, weight, and reading-metric CSS
  variables. Tailwind routes `sans`, `prose`, and `mono` through those family
  variables. Existing interface sizes remain on their original Tailwind
  utilities; only chat reading metrics are customizable.
- Appearance Settings owns the Compact / Default / Large control. The preset
  changes normal user and assistant content immediately; it is not a general
  page zoom or interface-density control.

Chat reading uses `--chat-prose-size`, `--chat-prose-line-height`,
`--chat-paragraph-gap`, and `--chat-code-size`. Inline code remains relative to
prose; fenced code uses the explicit code size; table cells inherit prose.

## Boundaries

- The composer and its command/mention overlays stay matched at 16px/24px.
- Tool traces, reasoning metadata, system notices, the code editor, and xterm
  retain their own fixed metrics.
- `--font-ui`, `--font-prose`, and `--font-mono` are the future family-switching
  seam. A candidate still needs Typography Studio comparison, licensed assets,
  offline-cache handling, and installed-PWA acceptance before it becomes a
  selectable CLIde family.
