import os from 'node:os';
import path from 'node:path';

import { SkillsProvider } from '@/modules/providers/shared/skills/skills.provider.js';
import type { ProviderSkillSource } from '@/shared/types.js';
import {
  addUniqueProviderSkillSource,
  findDirectoriesToGitRoot,
} from '@/shared/utils.js';

const OPENCODE_PROJECT_SKILL_DIRS = [
  ['.opencode', 'skills'],
  ['.claude', 'skills'],
  ['.agents', 'skills'],
];

const OPENCODE_USER_SKILL_DIRS = [
  ['.config', 'opencode', 'skills'],
  ['.claude', 'skills'],
  ['.agents', 'skills'],
];

export class OpenCodeSkillsProvider extends SkillsProvider {
  constructor() {
    super('opencode');
  }

  protected async getSkillSources(workspacePath?: string): Promise<ProviderSkillSource[]> {
    const sources: ProviderSkillSource[] = [];
    const seenRootDirs = new Set<string>();

    if (workspacePath) {
      const projectRoots = await findDirectoriesToGitRoot(workspacePath);
      for (const projectRoot of projectRoots) {
        for (const skillDir of OPENCODE_PROJECT_SKILL_DIRS) {
          // OpenCode reads compatible Claude and Agents skill folders too.
          addUniqueProviderSkillSource(sources, seenRootDirs, {
            scope: 'project',
            rootDir: path.join(projectRoot, ...skillDir),
            commandPrefix: '/',
          });
        }
      }
    }

    for (const skillDir of OPENCODE_USER_SKILL_DIRS) {
      addUniqueProviderSkillSource(sources, seenRootDirs, {
        scope: 'user',
        rootDir: path.join(os.homedir(), ...skillDir),
        commandPrefix: '/',
      });
    }

    return sources;
  }
}
