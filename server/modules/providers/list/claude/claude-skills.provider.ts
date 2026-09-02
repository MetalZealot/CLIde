import { readFile, readdir, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { SkillsProvider } from '@/modules/providers/shared/skills/skills.provider.js';
import { parseFrontMatter } from '@/shared/frontmatter.js';
import type {
  ProviderSkill,
  ProviderSkillListOptions,
  ProviderSkillSource,
} from '@/shared/types.js';
import {
  addUniqueProviderSkillSource,
  findDirectoriesToGitRoot,
  findProviderSkillMarkdownFiles,
  readJsonConfig,
  readObjectRecord,
  readOptionalString,
  readProviderSkillMarkdownDefinition,
} from '@/shared/utils.js';

const getClaudeHomePath = (): string => path.join(os.homedir(), '.claude');

const getClaudePluginName = (pluginId: string): string | null => {
  const normalizedPluginId = pluginId.trim();
  if (!normalizedPluginId || normalizedPluginId === '@') {
    return null;
  }

  const [pluginName] = normalizedPluginId.split('@');
  return readOptionalString(pluginName) ?? null;
};

const stripMarkdownExtension = (filename: string): string =>
  filename.replace(/\.md$/i, '');

const normalizeClaudeSkillCollisionName = (value: string): string => (
  value.normalize('NFKC').replace(/[\s\p{Cf}]+/gu, '').toLocaleLowerCase()
);

const pathExistsAsDirectory = async (directoryPath: string): Promise<boolean> => {
  try {
    const directoryStats = await stat(directoryPath);
    return directoryStats.isDirectory();
  } catch {
    return false;
  }
};

const readClaudePluginName = async (
  installPath: string,
  pluginId: string,
): Promise<string | null> => {
  try {
    const pluginConfig = await readJsonConfig(
      path.join(installPath, '.claude-plugin', 'plugin.json'),
    );

    // Older or partial plugin installs may not have plugin.json yet. Falling
    // back keeps discovery useful without inventing a separate namespace.
    return readOptionalString(pluginConfig.name) ?? getClaudePluginName(pluginId);
  } catch {
    return getClaudePluginName(pluginId);
  }
};

export class ClaudeSkillsProvider extends SkillsProvider {
  constructor() {
    super('claude');
  }

  async listSkills(options?: ProviderSkillListOptions): Promise<ProviderSkill[]> {
    const claudeHomePath = getClaudeHomePath();
    const skills = [
      ...(await super.listSkills(options)),
      ...(await this.listPluginSkills(claudeHomePath)),
    ];

    return this.resolveSkillSourcePrecedence(skills, claudeHomePath);
  }

  protected async getSkillSources(workspacePath?: string): Promise<ProviderSkillSource[]> {
    const claudeHomePath = getClaudeHomePath();
    const sources: ProviderSkillSource[] = [];
    const seenRootDirs = new Set<string>();

    addUniqueProviderSkillSource(sources, seenRootDirs, {
      scope: 'user',
      rootDir: path.join(claudeHomePath, 'skills'),
      commandPrefix: '/',
    });
    // The direct personal scan cannot see skills nested below `synced`.
    addUniqueProviderSkillSource(sources, seenRootDirs, {
      scope: 'user',
      rootDir: path.join(claudeHomePath, 'skills', 'synced'),
      commandPrefix: '/',
    });

    if (workspacePath) {
      const projectRoots = await findDirectoriesToGitRoot(workspacePath);
      for (const projectRoot of projectRoots) {
        addUniqueProviderSkillSource(sources, seenRootDirs, {
          scope: 'project',
          rootDir: path.join(projectRoot, '.claude', 'skills'),
          commandPrefix: '/',
        });
      }
    }

    return sources;
  }

  protected async getGlobalSkillSource(): Promise<ProviderSkillSource> {
    return {
      scope: 'user',
      rootDir: path.join(getClaudeHomePath(), 'skills'),
      commandPrefix: '/',
    };
  }

  private async listPluginSkills(claudeHomePath: string): Promise<ProviderSkill[]> {
    const settings = await readJsonConfig(path.join(claudeHomePath, 'settings.json'));
    const enabledPlugins = readObjectRecord(settings.enabledPlugins);
    if (!enabledPlugins) {
      return [];
    }

    const installedConfig = await readJsonConfig(
      path.join(claudeHomePath, 'plugins', 'installed_plugins.json'),
    );
    const installedPlugins = readObjectRecord(installedConfig.plugins);
    if (!installedPlugins) {
      return [];
    }

    const skills: ProviderSkill[] = [];
    const visitedPluginFolders = new Set<string>();
    const pluginEntries = Object.entries(enabledPlugins)
      .sort(([left], [right]) => left.localeCompare(right));
    for (const [pluginId, enabled] of pluginEntries) {
      if (enabled !== true) {
        continue;
      }

      const installs = installedPlugins[pluginId];
      if (!Array.isArray(installs)) {
        continue;
      }

      for (const install of installs) {
        const installRecord = readObjectRecord(install);
        const installPath = readOptionalString(installRecord?.installPath);
        if (!installPath) {
          continue;
        }

        const pluginFolderKey = `${pluginId}:${path.resolve(installPath)}`;
        if (visitedPluginFolders.has(pluginFolderKey)) {
          continue;
        }
        visitedPluginFolders.add(pluginFolderKey);

        const pluginName = await readClaudePluginName(installPath, pluginId);
        if (!pluginName) {
          continue;
        }

        const skillsPath = path.join(installPath, 'skills');
        const pluginSkills = await pathExistsAsDirectory(skillsPath)
          ? await this.listPluginSkillMarkdowns(installPath, pluginId, pluginName)
          : [];
        const commandsPath = path.join(installPath, 'commands');
        const pluginCommands = await pathExistsAsDirectory(commandsPath)
          ? await this.listPluginCommandSkills(commandsPath, pluginId, pluginName)
          : [];
        const skillCommands = new Set(pluginSkills.map((skill) => skill.command));

        skills.push(...pluginSkills);
        skills.push(...pluginCommands.filter((skill) => !skillCommands.has(skill.command)));
      }
    }

    return skills;
  }

  private resolveSkillSourcePrecedence(
    skills: ProviderSkill[],
    claudeHomePath: string,
  ): ProviderSkill[] {
    const syncedRoot = `${path.resolve(claudeHomePath, 'skills', 'synced')}${path.sep}`;
    const rankByName = new Map<string, number>();

    const getSourceRank = (skill: ProviderSkill): number => {
      if (skill.scope === 'user' && path.resolve(skill.sourcePath).startsWith(syncedRoot)) {
        return 1;
      }
      if (skill.scope === 'project') {
        return 2;
      }
      return 3;
    };

    for (const skill of skills) {
      if (skill.scope === 'plugin') {
        continue;
      }
      const collisionName = normalizeClaudeSkillCollisionName(skill.name);
      rankByName.set(
        collisionName,
        Math.max(rankByName.get(collisionName) ?? 0, getSourceRank(skill)),
      );
    }

    return skills.filter((skill) => {
      if (skill.scope === 'plugin') {
        return true;
      }
      const collisionName = normalizeClaudeSkillCollisionName(skill.name);
      return getSourceRank(skill) === rankByName.get(collisionName);
    });
  }

  private async listPluginCommandSkills(
    commandsPath: string,
    pluginId: string,
    pluginName: string,
  ): Promise<ProviderSkill[]> {
    const skills: ProviderSkill[] = [];

    try {
      const entries = await readdir(commandsPath, { withFileTypes: true });
      const commandFiles = entries
        .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.md'))
        .sort((left, right) => left.name.localeCompare(right.name));

      for (const commandFile of commandFiles) {
        const sourcePath = path.join(commandsPath, commandFile.name);
        try {
          const definition = await this.readPluginCommandDefinition(sourcePath);
          skills.push({
            provider: this.provider,
            name: definition.name,
            description: definition.description,
            command: `/${pluginName}:${definition.name}`,
            scope: 'plugin',
            sourcePath,
            pluginName,
            pluginId,
          });
        } catch {
          // Malformed command markdown should not block sibling plugin commands.
        }
      }
    } catch {
      // Missing or unreadable command folders are treated as empty plugin command sets.
    }

    return skills;
  }

  private async readPluginCommandDefinition(
    commandPath: string,
  ): Promise<{ name: string; description: string }> {
    const content = await readFile(commandPath, 'utf8');
    const parsed = parseFrontMatter(content);
    const data = readObjectRecord(parsed.data) ?? {};

    return {
      name: stripMarkdownExtension(path.basename(commandPath)),
      description: readOptionalString(data.description) ?? '',
    };
  }

  private async listPluginSkillMarkdowns(
    installPath: string,
    pluginId: string,
    pluginName: string,
  ): Promise<ProviderSkill[]> {
    const skillFiles = await findProviderSkillMarkdownFiles(path.join(installPath, 'skills'), {
      recursive: true,
    });
    const skills: ProviderSkill[] = [];

    for (const skillPath of skillFiles) {
      try {
        const definition = await readProviderSkillMarkdownDefinition(skillPath);
        skills.push({
          provider: this.provider,
          name: definition.name,
          description: definition.description,
          command: `/${pluginName}:${definition.name}`,
          scope: 'plugin',
          sourcePath: skillPath,
          pluginName,
          pluginId,
        });
      } catch {
        // A bad plugin skill file should not block other installed plugin skills.
      }
    }

    return skills;
  }
}
