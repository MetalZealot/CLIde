/**
 * Read and write Claude Code's release channel (`autoUpdatesChannel`).
 *
 * `minimumVersion` follows `/config`'s "stay on the current version" choice:
 * switching to stable sets the installed build as a floor so the switch never
 * downgrades, and switching back to latest clears it.
 */

import {
  claudeUserSettingsPath,
  readClaudeSettingsFile,
  updateClaudeSettingsFile,
} from '@/modules/providers/list/claude/claude-settings-file.js';

export type ClaudeUpdateChannel = 'latest' | 'stable';

export type ClaudeUpdateChannelSettings = {
  channel: ClaudeUpdateChannel;
  /** Set in managed settings, which outrank the user file, so the UI must be read-only. */
  managed: boolean;
};

export type ClaudeSettingsPaths = { user?: string; managed?: string };

const MANAGED_SETTINGS_PATH = '/etc/claude-code/managed-settings.json';

const channelOf = (value: unknown): ClaudeUpdateChannel | null => (
  value === 'stable' || value === 'latest' ? value : null
);

export const readClaudeUpdateChannel = async (
  paths: ClaudeSettingsPaths = {},
): Promise<ClaudeUpdateChannelSettings> => {
  const managed = channelOf((await readClaudeSettingsFile(paths.managed ?? MANAGED_SETTINGS_PATH)).autoUpdatesChannel);
  if (managed) return { channel: managed, managed: true };
  const user = await readClaudeSettingsFile(paths.user ?? claudeUserSettingsPath());
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
  await updateClaudeSettingsFile((settings) => {
    settings.autoUpdatesChannel = channel;
    if (channel === 'stable') {
      settings.minimumVersion = installedVersion;
    } else {
      delete settings.minimumVersion;
    }
  }, paths.user);
  return readClaudeUpdateChannel(paths);
};
