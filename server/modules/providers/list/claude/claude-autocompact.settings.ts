/**
 * Read and write Claude Code's auto-compact settings.
 *
 * `auto` is the ABSENCE of `autoCompactWindow`, never a sentinel — that is
 * what `/autocompact` writes, and the two surfaces must agree.
 *
 * `autoCompactWindow` caps the window; the runtime compacts below it. It is
 * global across every session, project and Shell.
 */

import {
  CLAUDE_MODEL_CONTEXT_SPECS,
  resetClaudeContextWindowCache,
} from '@/modules/providers/list/claude/claude-context-window.js';
import {
  readClaudeSettingsFileOrEmpty,
  updateClaudeSettingsFile,
} from '@/modules/providers/list/claude/claude-settings-file.js';

/** Claude Code's own picker steps in 100K increments; matching it avoids a value it would not have offered. */
const WINDOW_STEP = 100_000;

const readPositiveInteger = (value: unknown): number | undefined => {
  const parsed = typeof value === 'number' ? value : Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : undefined;
};

export type ClaudeAutoCompactSettings = {
  enabled: boolean;
  /** The configured cap, or null for `auto` — no cap. */
  window: number | null;
  /**
   * Set, this outranks the file and Claude Code refuses to let the setting take
   * effect, so the UI must present itself as read-only rather than lie.
   */
  envOverride: number | null;
  /** Largest window any known model has, so the picker cannot offer a useless cap. */
  maxWindow: number;
  /** Selectable caps, ascending. `auto` is the absence of one, not a member. */
  options: number[];
};

const largestKnownWindow = (): number => Math.max(
  ...Object.values(CLAUDE_MODEL_CONTEXT_SPECS)
    .map((spec) => spec.window ?? 0),
  WINDOW_STEP,
);

export const readClaudeAutoCompactSettings = async (
  settingsPath?: string,
): Promise<ClaudeAutoCompactSettings> => {
  const settings = await readClaudeSettingsFileOrEmpty(settingsPath);
  const maxWindow = largestKnownWindow();
  const options: number[] = [];
  for (let window = WINDOW_STEP; window <= maxWindow; window += WINDOW_STEP) {
    options.push(window);
  }

  return {
    // Claude Code treats a missing key as on.
    enabled: settings.autoCompactEnabled !== false,
    window: readPositiveInteger(settings.autoCompactWindow) ?? null,
    envOverride: readPositiveInteger(process.env.CLAUDE_CODE_AUTO_COMPACT_WINDOW) ?? null,
    maxWindow,
    options,
  };
};

export type ClaudeAutoCompactUpdate = {
  enabled?: boolean;
  /** `null` clears the cap back to `auto`; omitted leaves it alone. */
  window?: number | null;
};

export const writeClaudeAutoCompactSettings = async (
  update: ClaudeAutoCompactUpdate,
  settingsPath?: string,
): Promise<ClaudeAutoCompactSettings> => {
  await updateClaudeSettingsFile((settings) => {
    if (update.enabled !== undefined) {
      settings.autoCompactEnabled = update.enabled;
    }

    if (update.window !== undefined) {
      if (update.window === null) {
        delete settings.autoCompactWindow;
      } else {
        settings.autoCompactWindow = update.window;
      }
    }
  }, settingsPath);
  // The derived ceiling memoizes this file by mtime; a write in the same
  // millisecond would otherwise be served from the stale entry.
  resetClaudeContextWindowCache();

  return readClaudeAutoCompactSettings(settingsPath);
};
