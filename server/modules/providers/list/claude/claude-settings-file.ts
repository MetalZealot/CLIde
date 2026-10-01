/**
 * The one reader and writer of Claude Code's user `settings.json` in CLIde.
 *
 * The file is shared with the terminal CLI and every other session, and CLIde
 * cannot lock it against them. So a write re-reads immediately before
 * replacing, changes only what its caller touches, and never replaces a file
 * it could not parse.
 */

import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export type ClaudeSettingsObject = Record<string, unknown>;

/** Where the CLI reads user settings: `$CLAUDE_CONFIG_DIR`, else `~/.claude`. */
export const claudeUserSettingsPath = (): string => path.join(
  process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'),
  'settings.json',
);

/** Missing reads as empty; malformed or non-object throws. */
export const readClaudeSettingsFile = async (filePath = claudeUserSettingsPath()): Promise<ClaudeSettingsObject> => {
  let text: string;
  try {
    text = await fs.readFile(filePath, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {};
    throw error;
  }
  if (text.trim() === '') return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`${filePath} is not valid JSON; not overwriting it`);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${filePath} is not a JSON object; not overwriting it`);
  }
  return parsed as ClaudeSettingsObject;
};

/** For display paths: an unreadable file reads as nothing configured. */
export const readClaudeSettingsFileOrEmpty = async (filePath?: string): Promise<ClaudeSettingsObject> => {
  try {
    return await readClaudeSettingsFile(filePath);
  } catch {
    return {};
  }
};

/** The file a write lands in: a symlink's target, so dotfile links survive. */
const resolveWriteTarget = async (filePath: string): Promise<string> => {
  try {
    return await fs.realpath(filePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return filePath;
    throw error;
  }
};

// Serialises CLIde's own writers per file, so two requests cannot interleave a
// read and a write. The CLI is outside this; the re-read narrows that window.
const queues = new Map<string, Promise<unknown>>();

/**
 * Reads the file, lets `mutate` edit the object in place, and atomically
 * replaces the file if anything changed. Returns the object as written.
 */
export const updateClaudeSettingsFile = async (
  mutate: (settings: ClaudeSettingsObject) => void,
  filePath = claudeUserSettingsPath(),
): Promise<ClaudeSettingsObject> => {
  const run = async (): Promise<ClaudeSettingsObject> => {
    const target = await resolveWriteTarget(filePath);
    const settings = await readClaudeSettingsFile(target);
    const before = JSON.stringify(settings);
    mutate(settings);
    if (JSON.stringify(settings) === before) return settings;

    await fs.mkdir(path.dirname(target), { recursive: true });
    const mode = await fs.stat(target).then((stat) => stat.mode & 0o777, () => 0o644);
    const temp = path.join(path.dirname(target), `.${path.basename(target)}.${randomUUID()}.tmp`);
    try {
      await fs.writeFile(temp, `${JSON.stringify(settings, null, 2)}\n`, 'utf8');
      await fs.chmod(temp, mode);
      await fs.rename(temp, target);
    } catch (error) {
      await fs.rm(temp, { force: true });
      throw error;
    }
    return settings;
  };

  const previous = queues.get(filePath) ?? Promise.resolve();
  const next = previous.then(run, run);
  queues.set(filePath, next);
  try {
    return await next;
  } finally {
    if (queues.get(filePath) === next) queues.delete(filePath);
  }
};
