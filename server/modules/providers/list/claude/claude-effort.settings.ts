/**
 * Read and write the effort Claude Code runs each model at when a session
 * names none: `modelSettings.<model>.effortLevel` in `~/.claude/settings.json`,
 * the same key the CLI's own effort slider saves.
 *
 * Unknown keys are preserved verbatim. `max` is never written: Claude Code
 * treats it as session-only and leaves it out of the persisted setting.
 */

import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** Levels Claude Code will persist; `max` is session-only. */
export const CLAUDE_PERSISTABLE_EFFORT_LEVELS = ['low', 'medium', 'high', 'xhigh'] as const;

/** What the API runs when no effort is sent and the model ships no default of its own. */
const CLAUDE_API_DEFAULT_EFFORT = 'high';

/**
 * `default_effort` per model in the CLI's model registry, decoded from the
 * `claude` binary 2026-09-30 (2.1.286). A model absent here ships no default.
 * `claude-context.test.ts` diffs this against the installed registry.
 */
export const CLAUDE_BUILTIN_DEFAULT_EFFORT: Readonly<Record<string, string>> = Object.freeze({
  'claude-sonnet-5': 'high',
  'claude-sonnet-5-5': 'medium',
  'claude-opus-4-7': 'xhigh',
  'claude-opus-4-8': 'high',
  'claude-opus-5': 'high',
  'claude-opus-5-5': 'medium',
  'claude-fable-5': 'high',
  'claude-fable-5-1': 'high',
  'claude-mythos-5-1': 'high',
});

const settingsFilePath = (settingsPath?: string): string => (
  settingsPath ?? path.join(os.homedir(), '.claude', 'settings.json')
);

const isEffortLevel = (value: unknown): value is string => (
  typeof value === 'string' && (CLAUDE_PERSISTABLE_EFFORT_LEVELS as readonly string[]).includes(value)
);

/** The key Claude Code files a model's settings under: no `[1m]`, no date stamp. */
export const canonicalClaudeModelId = (model: string): string => (
  model.trim().toLowerCase().replace(/\[1m\]/g, '').replace(/-\d{8}$/, '')
);

export type ClaudeEffortSettings = {
  /** Saved per-model levels, keyed by canonical model id. */
  byModel: Record<string, string>;
  /** Top-level `effortLevel`; the CLI applies it only to models without a built-in default. */
  legacy: string | null;
  /** `CLAUDE_CODE_EFFORT_LEVEL`, which outranks every file. */
  envOverride: string | null;
};

const readSettingsObject = async (settingsPath?: string): Promise<Record<string, unknown> | null> => {
  try {
    const parsed: unknown = JSON.parse(await fs.readFile(settingsFilePath(settingsPath), 'utf8'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') {
      return {};
    }
    return null;
  }
};

export const readClaudeEffortSettings = async (settingsPath?: string): Promise<ClaudeEffortSettings> => {
  const settings = await readSettingsObject(settingsPath) ?? {};
  const byModel: Record<string, string> = {};
  const modelSettings = settings.modelSettings;
  if (modelSettings && typeof modelSettings === 'object' && !Array.isArray(modelSettings)) {
    for (const [model, entry] of Object.entries(modelSettings as Record<string, unknown>)) {
      const level = (entry as { effortLevel?: unknown } | null)?.effortLevel;
      if (isEffortLevel(level)) {
        byModel[canonicalClaudeModelId(model)] = level;
      }
    }
  }

  const envLevel = process.env.CLAUDE_CODE_EFFORT_LEVEL?.trim().toLowerCase();
  return {
    byModel,
    legacy: isEffortLevel(settings.effortLevel) ? settings.effortLevel : null,
    envOverride: envLevel && (isEffortLevel(envLevel) || envLevel === 'max') ? envLevel : null,
  };
};

/**
 * The level a session on `model` runs at when CLIde sends no effort, clamped to
 * what the model offers — the CLI downgrades an unsupported level the same way.
 */
export const resolveClaudeDefaultEffort = (
  model: string,
  settings: ClaudeEffortSettings,
  supportedLevels: readonly string[],
): string | null => {
  if (supportedLevels.length === 0) {
    return null;
  }
  const canonical = canonicalClaudeModelId(model);
  const builtIn = CLAUDE_BUILTIN_DEFAULT_EFFORT[canonical];
  const level = settings.envOverride
    ?? settings.byModel[canonical]
    ?? (builtIn ? null : settings.legacy)
    ?? builtIn
    ?? CLAUDE_API_DEFAULT_EFFORT;

  if (supportedLevels.includes(level)) {
    return level;
  }
  return supportedLevels.includes(CLAUDE_API_DEFAULT_EFFORT)
    ? CLAUDE_API_DEFAULT_EFFORT
    : supportedLevels[supportedLevels.length - 1];
};

/** Saves `level` as the model's default. Refuses to overwrite a file it cannot parse. */
export const writeClaudeModelEffort = async (
  model: string,
  level: string,
  settingsPath?: string,
): Promise<void> => {
  if (!isEffortLevel(level)) {
    throw new Error(`effort must be one of ${CLAUDE_PERSISTABLE_EFFORT_LEVELS.join(', ')}`);
  }
  const filePath = settingsFilePath(settingsPath);
  const settings = await readSettingsObject(settingsPath);
  if (!settings) {
    throw new Error(`${filePath} is not valid JSON; not overwriting it`);
  }

  const canonical = canonicalClaudeModelId(model);
  const modelSettings = settings.modelSettings && typeof settings.modelSettings === 'object'
    && !Array.isArray(settings.modelSettings)
    ? settings.modelSettings as Record<string, unknown>
    : {};
  const entry = modelSettings[canonical];
  settings.modelSettings = {
    ...modelSettings,
    [canonical]: {
      ...(entry && typeof entry === 'object' && !Array.isArray(entry) ? entry : {}),
      effortLevel: level,
    },
  };

  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(settings, null, 2)}\n`, 'utf8');
};
