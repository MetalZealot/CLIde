/**
 * Read and write Claude Code's auto-compact settings.
 *
 * The only file CLIde writes in `~/.claude/`. Two rules follow from that:
 * unknown keys are preserved verbatim, and `auto` is the ABSENCE of
 * `autoCompactWindow`, never a sentinel — that is what `/autocompact` writes,
 * and the two surfaces must agree.
 *
 * `autoCompactWindow` caps the window; the runtime compacts below it. It is
 * global across every session, project and Shell.
 */

import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  CLAUDE_MODEL_CONTEXT_SPECS,
  resetClaudeContextWindowCache,
} from '@/modules/providers/list/claude/claude-context-window.js';

/** Claude Code's own picker steps in 100K increments; matching it avoids a value it would not have offered. */
const WINDOW_STEP = 100_000;

const settingsFilePath = (settingsPath?: string): string => (
  settingsPath ?? path.join(os.homedir(), '.claude', 'settings.json')
);

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

const readSettingsFile = async (settingsPath?: string): Promise<Record<string, unknown>> => {
  try {
    const parsed: unknown = JSON.parse(await fs.readFile(settingsFilePath(settingsPath), 'utf8'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    // Missing or malformed: treated as "nothing configured", never overwritten
    // blind — a write reads again and fails loudly if it still cannot parse.
    return {};
  }
};

export const readClaudeAutoCompactSettings = async (
  settingsPath?: string,
): Promise<ClaudeAutoCompactSettings> => {
  const settings = await readSettingsFile(settingsPath);
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
  const filePath = settingsFilePath(settingsPath);
  const settings = await readSettingsFile(settingsPath);

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

  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(settings, null, 2)}\n`, 'utf8');
  // The derived ceiling memoizes this file by mtime; a write in the same
  // millisecond would otherwise be served from the stale entry.
  resetClaudeContextWindowCache();

  return readClaudeAutoCompactSettings(settingsPath);
};
