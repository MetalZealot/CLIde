import os from 'node:os';
import path from 'node:path';

import { SkillsProvider } from '@/modules/providers/shared/skills/skills.provider.js';
import type { ProviderSkillSource } from '@/shared/types.js';
import {
  addUniqueProviderSkillSource,
  findDirectoriesToGitRoot,
} from '@/shared/utils.js';

const CURSOR_PROJECT_SKILL_DIRS = [
  ['.agents', 'skills'],
  ['.cursor', 'skills'],
  ['.claude', 'skills'],
  ['.codex', 'skills'],
];

const CURSOR_USER_SKILL_DIRS = [
  ['.agents', 'skills'],
  ['.cursor', 'skills'],
  ['.claude', 'skills'],
  ['.codex', 'skills'],
];

export class CursorSkillsProvider extends SkillsProvider {
  constructor() {
    super('cursor');
  }

  protected async getSkillSources(workspacePath?: string): Promise<ProviderSkillSource[]> {
    const sources: ProviderSkillSource[] = [];
    const seenRootDirs = new Set<string>();

    if (workspacePath) {
      const projectRoots = await findDirectoriesToGitRoot(workspacePath);
      for (const projectRoot of projectRoots) {
        for (const skillDir of CURSOR_PROJECT_SKILL_DIRS) {
          addUniqueProviderSkillSource(sources, seenRootDirs, {
            scope: 'project',
            rootDir: path.join(projectRoot, ...skillDir),
            commandPrefix: '/',
            recursive: true,
          });
        }
      }
    }

    for (const skillDir of CURSOR_USER_SKILL_DIRS) {
      addUniqueProviderSkillSource(sources, seenRootDirs, {
        scope: 'user',
        rootDir: path.join(os.homedir(), ...skillDir),
        commandPrefix: '/',
        recursive: true,
      });
    }

    return sources;
  }

  protected async getGlobalSkillSource(): Promise<ProviderSkillSource> {
    return {
      scope: 'user',
      rootDir: path.join(os.homedir(), '.cursor', 'skills'),
      commandPrefix: '/',
    };
  }
}
