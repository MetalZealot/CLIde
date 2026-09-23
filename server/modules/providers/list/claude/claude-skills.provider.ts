import os from 'node:os';
import path from 'node:path';

import {
  listClaudePluginInstalls,
  listClaudePluginSkills,
} from '@/modules/providers/list/claude/claude-plugins.js';
import { SkillsProvider } from '@/modules/providers/shared/skills/skills.provider.js';
import type {
  ProviderSkill,
  ProviderSkillListOptions,
  ProviderSkillSource,
} from '@/shared/types.js';
import { addUniqueProviderSkillSource } from '@/shared/utils.js';

const getClaudeHomePath = (): string => path.join(os.homedir(), '.claude');

export class ClaudeSkillsProvider extends SkillsProvider {
  constructor() {
    super('claude');
  }

  async listSkills(options?: ProviderSkillListOptions): Promise<ProviderSkill[]> {
    return [
      ...(await super.listSkills(options)),
      ...(await this.listPluginSkills(options?.workspacePath)),
    ];
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
    // claude.ai-synced skills sit one account folder below `synced` and
    // answer to the namespace Claude Code gives them.
    addUniqueProviderSkillSource(sources, seenRootDirs, {
      scope: 'synced',
      rootDir: path.join(claudeHomePath, 'skills', 'synced'),
      recursive: true,
      commandForSkill: (skillName) => `/anthropic-skills:${skillName}`,
    });

    if (workspacePath) {
      addUniqueProviderSkillSource(sources, seenRootDirs, {
        scope: 'project',
        rootDir: path.join(workspacePath, '.claude', 'skills'),
        commandPrefix: '/',
      });
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

  private async listPluginSkills(workspacePath?: string): Promise<ProviderSkill[]> {
    const installs = await listClaudePluginInstalls(
      getClaudeHomePath(),
      workspacePath ? path.resolve(workspacePath) : undefined,
    );
    const skills: ProviderSkill[] = [];
    for (const install of installs.filter((candidate) => candidate.enabled)) {
      skills.push(...(await listClaudePluginSkills(this.provider, install)));
    }
    return skills;
  }
}
