/**
 * Client half of the project highlight palette.
 *
 * The tokens must match `server/shared/project-accent-colors.ts`, which is the
 * validating half — the server rejects anything not in its list, so a token
 * added here alone would fail to save. There is no shared TypeScript package
 * between `src/` and `server/` (the root `shared/` folder holds one JS file),
 * so the list is duplicated deliberately rather than reached across the
 * tsconfig boundary.
 *
 * Values resolve through CSS variables defined per theme in `index.css`, which
 * is what keeps a project's colour legible in both light and dark. Read them
 * through the helpers below rather than interpolating a token into a class
 * name — Tailwind cannot see a dynamically built class, and it would be purged.
 */
export const PROJECT_ACCENT_COLORS = [
  'rose',
  'amber',
  'lime',
  'emerald',
  'cyan',
  'blue',
  'violet',
  'magenta',
] as const;

export type ProjectAccentColor = (typeof PROJECT_ACCENT_COLORS)[number];

export const isProjectAccentColor = (value: unknown): value is ProjectAccentColor =>
  typeof value === 'string' && (PROJECT_ACCENT_COLORS as readonly string[]).includes(value);

/**
 * Normalise whatever the projects API returned. Anything unrecognised — an
 * older client reading a token added later, say — degrades to "no highlight"
 * rather than rendering a broken swatch.
 */
export const readProjectAccentColor = (value: unknown): ProjectAccentColor | null =>
  isProjectAccentColor(value) ? value : null;

/** The CSS colour for a token, ready for a `style` value. */
export const projectAccentColorValue = (accentColor: ProjectAccentColor): string =>
  `hsl(var(--project-accent-${accentColor}))`;

/** As above, with alpha — used for the tinted row background behind the strip. */
export const projectAccentColorValueWithAlpha = (
  accentColor: ProjectAccentColor,
  alpha: number,
): string => `hsl(var(--project-accent-${accentColor}) / ${alpha})`;
