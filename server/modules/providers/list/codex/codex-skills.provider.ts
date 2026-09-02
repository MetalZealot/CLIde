import os from 'node:os';
import path from 'node:path';

import { SkillsProvider } from '@/modules/providers/shared/skills/skills.provider.js';
import type { ProviderSkillSource } from '@/shared/types.js';
import {
  addUniqueProviderSkillSource,
  findDirectoriesToGitRoot,
} from '@/shared/utils.js';

export class CodexSkillsProvider extends SkillsProvider {
  constructor() {
    super('codex');
  }

  protected async getSkillSources(workspacePath?: string): Promise<ProviderSkillSource[]> {
    const sources: ProviderSkillSource[] = [];
    const seenRootDirs = new Set<string>();

    if (workspacePath) {
      const projectRoots = await findDirectoriesToGitRoot(workspacePath);
      for (const projectRoot of projectRoots) {
        // Same-name skills remain path-distinct throughout the active hierarchy.
        addUniqueProviderSkillSource(sources, seenRootDirs, {
          scope: 'repo',
          rootDir: path.join(projectRoot, '.agents', 'skills'),
          commandPrefix: '$',
        });
      }
    }

    addUniqueProviderSkillSource(sources, seenRootDirs, {
      scope: 'user',
      rootDir: path.join(os.homedir(), '.agents', 'skills'),
      commandPrefix: '$',
    });
    addUniqueProviderSkillSource(sources, seenRootDirs, {
      scope: 'user',
      rootDir: path.join(os.homedir(), '.codex', 'skills'),
      commandPrefix: '$',
    });
    addUniqueProviderSkillSource(sources, seenRootDirs, {
      scope: 'admin',
      rootDir: path.join('/etc', 'codex', 'skills'),
      commandPrefix: '$',
    });
    addUniqueProviderSkillSource(sources, seenRootDirs, {
      scope: 'system',
      rootDir: path.join(os.homedir(), '.codex', 'skills', '.system'),
      commandPrefix: '$',
    });

    return sources;
  }

  protected async getGlobalSkillSource(): Promise<ProviderSkillSource> {
    return {
      scope: 'user',
      rootDir: path.join(os.homedir(), '.agents', 'skills'),
      commandPrefix: '$',
    };
  }
}
