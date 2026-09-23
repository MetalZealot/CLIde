import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';

import { parseFrontMatter } from '@/shared/frontmatter.js';
import type { LLMProvider, ProviderSkill } from '@/shared/types.js';
import {
  findProviderSkillMarkdownFiles,
  readJsonConfig,
  readObjectRecord,
  readOptionalString,
  readProviderSkillMarkdownDefinition,
} from '@/shared/utils.js';

/** Marketplace id Claude Code gives plugins synced from the claude.ai account. */
export const CLAUDE_SYNCED_MARKETPLACE = 'synced';

export type ClaudePluginInstall = {
  pluginId: string;
  pluginName: string;
  marketplace: string;
  installPath: string;
  enabled: boolean;
  version?: string;
  description: string;
};

const isDirectory = async (directoryPath: string): Promise<boolean> => {
  try {
    return (await stat(directoryPath)).isDirectory();
  } catch {
    return false;
  }
};

const readJsonOrEmpty = async (filePath: string): Promise<Record<string, unknown>> => {
  try {
    return await readJsonConfig(filePath);
  } catch {
    return {};
  }
};

const nameFromPluginId = (pluginId: string): string | null => {
  const [pluginName] = pluginId.trim().split('@');
  return readOptionalString(pluginName) ?? null;
};

const marketplaceFromPluginId = (pluginId: string): string => {
  const separatorIndex = pluginId.lastIndexOf('@');
  return separatorIndex >= 0 ? pluginId.slice(separatorIndex + 1) : '';
};

/**
 * `enabledPlugins` layered user → project → local, later files winning, as
 * Claude Code layers settings for a working directory.
 */
const readEnabledPlugins = async (
  claudeHomePath: string,
  workspacePath?: string,
): Promise<Record<string, unknown>> => {
  const layers = [path.join(claudeHomePath, 'settings.json')];
  if (workspacePath) {
    layers.push(
      path.join(workspacePath, '.claude', 'settings.json'),
      path.join(workspacePath, '.claude', 'settings.local.json'),
    );
  }

  const merged: Record<string, unknown> = {};
  for (const layer of layers) {
    Object.assign(merged, readObjectRecord((await readJsonOrEmpty(layer)).enabledPlugins) ?? {});
  }
  return merged;
};

const readPluginManifest = async (installPath: string): Promise<Record<string, unknown>> =>
  readJsonOrEmpty(path.join(installPath, '.claude-plugin', 'plugin.json'));

const listMarketplaceInstalls = async (
  claudeHomePath: string,
  enabledPlugins: Record<string, unknown>,
): Promise<ClaudePluginInstall[]> => {
  const installedConfig = await readJsonOrEmpty(
    path.join(claudeHomePath, 'plugins', 'installed_plugins.json'),
  );
  const installedPlugins = readObjectRecord(installedConfig.plugins) ?? {};
  const installs: ClaudePluginInstall[] = [];
  const seen = new Set<string>();

  for (const [pluginId, records] of Object.entries(installedPlugins).sort(([a], [b]) => a.localeCompare(b))) {
    if (!Array.isArray(records)) {
      continue;
    }

    for (const record of records) {
      const installRecord = readObjectRecord(record);
      const installPath = readOptionalString(installRecord?.installPath);
      if (!installPath) {
        continue;
      }

      const key = `${pluginId}:${path.resolve(installPath)}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);

      const manifest = await readPluginManifest(installPath);
      // Older or partial installs may lack plugin.json; the id still names the plugin.
      const pluginName = readOptionalString(manifest.name) ?? nameFromPluginId(pluginId);
      if (!pluginName) {
        continue;
      }

      installs.push({
        pluginId,
        pluginName,
        marketplace: marketplaceFromPluginId(pluginId),
        installPath,
        enabled: enabledPlugins[pluginId] === true,
        version: readOptionalString(installRecord?.version) ?? readOptionalString(manifest.version),
        description: readOptionalString(manifest.description) ?? '',
      });
    }
  }

  return installs;
};

/**
 * claude.ai-synced plugins live outside `installed_plugins.json`, one folder per
 * account under `plugins/synced/`, listed by that folder's `manifest.json`.
 * They are on unless `enabledPlugins` sets `<name>@synced` to false.
 */
const listSyncedInstalls = async (
  claudeHomePath: string,
  enabledPlugins: Record<string, unknown>,
): Promise<ClaudePluginInstall[]> => {
  const syncedRoot = path.join(claudeHomePath, 'plugins', CLAUDE_SYNCED_MARKETPLACE);
  let accountFolders: string[];
  try {
    accountFolders = (await readdir(syncedRoot, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
      .map((entry) => path.join(syncedRoot, entry.name))
      .sort();
  } catch {
    return [];
  }

  const installs: ClaudePluginInstall[] = [];
  for (const accountFolder of accountFolders) {
    const manifest = await readJsonOrEmpty(path.join(accountFolder, 'manifest.json'));
    const plugins = Array.isArray(manifest.plugins) ? manifest.plugins : [];

    for (const entry of plugins) {
      const record = readObjectRecord(entry);
      const pluginName = readOptionalString(record?.name);
      if (!pluginName || pluginName.includes('/') || pluginName.startsWith('.')) {
        continue;
      }

      const installPath = path.join(accountFolder, pluginName);
      if (!(await isDirectory(installPath))) {
        continue;
      }

      const pluginId = `${pluginName}@${CLAUDE_SYNCED_MARKETPLACE}`;
      installs.push({
        pluginId,
        pluginName,
        marketplace: CLAUDE_SYNCED_MARKETPLACE,
        installPath,
        enabled: enabledPlugins[pluginId] !== false,
        version: readOptionalString(record?.version),
        description: readOptionalString(record?.description) ?? '',
      });
    }
  }

  return installs;
};

/** Every installed plugin, enabled or not, as Claude Code resolves it for the workspace. */
export const listClaudePluginInstalls = async (
  claudeHomePath: string,
  workspacePath?: string,
): Promise<ClaudePluginInstall[]> => {
  const enabledPlugins = await readEnabledPlugins(claudeHomePath, workspacePath);
  return [
    ...(await listMarketplaceInstalls(claudeHomePath, enabledPlugins)),
    ...(await listSyncedInstalls(claudeHomePath, enabledPlugins)),
  ];
};

const listPluginSkillFiles = async (
  provider: LLMProvider,
  install: ClaudePluginInstall,
): Promise<ProviderSkill[]> => {
  const skillsPath = path.join(install.installPath, 'skills');
  if (!(await isDirectory(skillsPath))) {
    return [];
  }

  const skills: ProviderSkill[] = [];
  for (const skillPath of await findProviderSkillMarkdownFiles(skillsPath, { recursive: true })) {
    try {
      const definition = await readProviderSkillMarkdownDefinition(skillPath);
      skills.push({
        provider,
        name: definition.name,
        description: definition.description,
        command: `/${install.pluginName}:${definition.name}`,
        scope: 'plugin',
        sourcePath: skillPath,
        pluginName: install.pluginName,
        pluginId: install.pluginId,
      });
    } catch {
      // A bad plugin skill file should not block other installed plugin skills.
    }
  }
  return skills;
};

const listPluginCommandFiles = async (
  provider: LLMProvider,
  install: ClaudePluginInstall,
): Promise<ProviderSkill[]> => {
  const commandsPath = path.join(install.installPath, 'commands');
  const skills: ProviderSkill[] = [];

  try {
    const commandFiles = (await readdir(commandsPath, { withFileTypes: true }))
      .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.md'))
      .sort((left, right) => left.name.localeCompare(right.name));

    for (const commandFile of commandFiles) {
      const sourcePath = path.join(commandsPath, commandFile.name);
      try {
        const data = readObjectRecord(parseFrontMatter(await readFile(sourcePath, 'utf8')).data) ?? {};
        const name = commandFile.name.replace(/\.md$/i, '');
        skills.push({
          provider,
          name,
          description: readOptionalString(data.description) ?? '',
          command: `/${install.pluginName}:${name}`,
          scope: 'plugin',
          sourcePath,
          pluginName: install.pluginName,
          pluginId: install.pluginId,
        });
      } catch {
        // Malformed command markdown should not block sibling plugin commands.
      }
    }
  } catch {
    // Missing or unreadable command folders are treated as empty plugin command sets.
  }

  return skills;
};

/** A plugin's `skills/` plus legacy `commands/`; a skill wins a same-name command. */
export const listClaudePluginSkills = async (
  provider: LLMProvider,
  install: ClaudePluginInstall,
): Promise<ProviderSkill[]> => {
  const skills = await listPluginSkillFiles(provider, install);
  const skillCommands = new Set(skills.map((skill) => skill.command));
  const commands = await listPluginCommandFiles(provider, install);
  return [...skills, ...commands.filter((command) => !skillCommands.has(command.command))];
};

/** MCP server names a plugin declares in `.mcp.json` or inline in `plugin.json`. */
export const listClaudePluginServerNames = async (install: ClaudePluginInstall): Promise<string[]> => {
  const names = new Set<string>();
  const mcpFile = await readJsonOrEmpty(path.join(install.installPath, '.mcp.json'));
  const fileServers = readObjectRecord(mcpFile.mcpServers) ?? mcpFile;
  Object.keys(fileServers).forEach((name) => names.add(name));

  const inlineServers = readObjectRecord((await readPluginManifest(install.installPath)).mcpServers);
  Object.keys(inlineServers ?? {}).forEach((name) => names.add(name));

  return [...names];
};
