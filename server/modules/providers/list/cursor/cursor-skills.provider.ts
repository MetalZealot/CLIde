import os from 'node:os';
import path from 'node:path';

import { SkillsProvider } from '@/modules/providers/shared/skills/skills.provider.js';
import type { ProviderSkillSource } from '@/shared/types.js';
import { addUniqueProviderSkillSource } from '@/shared/utils.js';

// Only Cursor's own root and the shared `.agents` root are documented. Claude
// and Codex roots are deliberately absent: Cursor does not document reading
// them, and listing them here would advertise skills Cursor may never run.
const CURSOR_PROJECT_SKILL_DIRS = [
  ['.agents', 'skills'],
  ['.cursor', 'skills'],
];

export class CursorSkillsProvider extends SkillsProvider {
  constructor() {
    super('cursor');
  }

  protected async getSkillSources(workspacePath?: string): Promise<ProviderSkillSource[]> {
    const sources: ProviderSkillSource[] = [];
    const seenRootDirs = new Set<string>();

    if (workspacePath) {
      for (const skillDir of CURSOR_PROJECT_SKILL_DIRS) {
        addUniqueProviderSkillSource(sources, seenRootDirs, {
          scope: 'project',
          rootDir: path.join(workspacePath, ...skillDir),
          commandPrefix: '/',
        });
      }
    }

    addUniqueProviderSkillSource(sources, seenRootDirs, {
      scope: 'user',
      rootDir: path.join(os.homedir(), '.cursor', 'skills'),
      commandPrefix: '/',
    });

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
