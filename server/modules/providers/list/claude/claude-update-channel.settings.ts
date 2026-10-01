/**
 * Read and write Claude Code's release channel (`autoUpdatesChannel`).
 *
 * `minimumVersion` follows `/config`'s "stay on the current version" choice:
 * switching to stable sets the installed build as a floor so the switch never
 * downgrades, and switching back to latest clears it.
 */

import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export type ClaudeUpdateChannel = 'latest' | 'stable';

export type ClaudeUpdateChannelSettings = {
  channel: ClaudeUpdateChannel;
  /** Set in managed settings, which outrank the user file, so the UI must be read-only. */
  managed: boolean;
};

export type ClaudeSettingsPaths = { user?: string; managed?: string };

const MANAGED_SETTINGS_PATH = '/etc/claude-code/managed-settings.json';

const userSettingsPath = (): string => path.join(
  process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'),
  'settings.json',
);

/** Missing reads as empty; malformed throws, so a write never replaces a file it could not parse. */
const readJsonObject = async (filePath: string): Promise<Record<string, unknown>> => {
  let text: string;
  try {
    text = await fs.readFile(filePath, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {};
    throw error;
  }
  const parsed: unknown = JSON.parse(text);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${filePath} is not a JSON object.`);
  }
  return parsed as Record<string, unknown>;
};

const channelOf = (value: unknown): ClaudeUpdateChannel | null => (
  value === 'stable' || value === 'latest' ? value : null
);

export const readClaudeUpdateChannel = async (
  paths: ClaudeSettingsPaths = {},
): Promise<ClaudeUpdateChannelSettings> => {
  const managed = channelOf((await readJsonObject(paths.managed ?? MANAGED_SETTINGS_PATH)).autoUpdatesChannel);
  if (managed) return { channel: managed, managed: true };
  const user = await readJsonObject(paths.user ?? userSettingsPath());
  // Claude Code treats a missing key as latest.
  return { channel: channelOf(user.autoUpdatesChannel) ?? 'latest', managed: false };
};

export const writeClaudeUpdateChannel = async (
  channel: ClaudeUpdateChannel,
  installedVersion: string,
  paths: ClaudeSettingsPaths = {},
): Promise<ClaudeUpdateChannelSettings> => {
  if ((await readClaudeUpdateChannel(paths)).managed) {
    throw new Error('The update channel is set by managed settings.');
  }
  const filePath = paths.user ?? userSettingsPath();
  const settings = await readJsonObject(filePath);

  settings.autoUpdatesChannel = channel;
  if (channel === 'stable') {
    settings.minimumVersion = installedVersion;
  } else {
    delete settings.minimumVersion;
  }

  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(settings, null, 2)}\n`, 'utf8');
  return readClaudeUpdateChannel(paths);
};
