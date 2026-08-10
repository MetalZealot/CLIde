/**
 * The fixed palette a project's sidebar highlight can be set to.
 *
 * Tokens, not hex values, and deliberately so. A user-picked colour survives
 * exactly one theme: what reads clearly on the light background disappears on
 * the dark one, and vice versa. Storing a token lets each theme supply its own
 * pair of values, and lets the accent-colour picker in `docs/TODO.md` reuse
 * these names later without a data migration.
 *
 * The client mirrors this list in `src/components/sidebar/utils/accentColors.ts`,
 * where each token is bound to its CSS variables. The two must stay in step;
 * this file is the validating half, so an unknown token never reaches the
 * database.
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

/**
 * Narrow an untrusted request value to a palette token.
 *
 * Null is a legitimate value — it is how the UI clears a highlight — so an
 * absent or empty value resolves to null rather than an error. Anything else
 * unrecognised is rejected, because silently storing it would leave a row the
 * sidebar cannot render.
 */
export function parseProjectAccentColor(value: unknown): ProjectAccentColor | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  if (typeof value === 'string' && (PROJECT_ACCENT_COLORS as readonly string[]).includes(value)) {
    return value as ProjectAccentColor;
  }

  throw new Error(`Unknown project accent colour: ${String(value)}`);
}
