import { promises as fs } from 'node:fs';
import path from 'node:path';

import { projectsDb, sessionsDb } from '@/modules/database/index.js';
import { AppError } from '@/shared/utils.js';

function uniqueJsonlPathsFromSessions(
  sessions: Array<{ jsonl_path: string | null }>,
): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const row of sessions) {
    const raw = row.jsonl_path?.trim();
    if (!raw) {
      continue;
    }
    const absolute = path.isAbsolute(raw) ? path.normalize(raw) : path.resolve(raw);
    if (seen.has(absolute)) {
      continue;
    }
    seen.add(absolute);
    result.push(absolute);
  }

  return result;
}

async function unlinkJsonlIfExists(filePath: string): Promise<void> {
  try {
    await fs.unlink(filePath);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      return;
    }
    console.warn(`[project-delete] Failed to remove ${filePath}:`, (error as Error).message);
  }
}

/**
 * Removes a directory only when it is already empty. Non-recursive `rmdir` throws
 * `ENOTEMPTY` if anything remains (e.g. nested subagent transcripts), so this never
 * deletes data — it just clears the empty `~/.claude/projects/<slug>/` shell left behind
 * once every session jsonl is gone.
 */
async function rmdirIfEmpty(dirPath: string): Promise<void> {
  try {
    await fs.rmdir(dirPath);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT' || code === 'ENOTEMPTY') {
      return;
    }
    console.warn(`[project-delete] Failed to remove empty dir ${dirPath}:`, (error as Error).message);
  }
}

/**
 * Removes each jsonl file, then prunes any now-empty parent directory (the per-project
 * `~/.claude/projects/<slug>/` folder). Exported for testing without the DB seam.
 */
export async function removeJsonlFilesAndPruneEmptyDirs(paths: string[]): Promise<void> {
  const parentDirs = new Set<string>();
  for (const filePath of paths) {
    await unlinkJsonlIfExists(filePath);
    parentDirs.add(path.dirname(filePath));
  }

  for (const dirPath of parentDirs) {
    await rmdirIfEmpty(dirPath);
  }
}

/**
 * Loads all session rows for the project path and removes each distinct `jsonl_path` file on disk,
 * then prunes any now-empty parent directory (the per-project `~/.claude/projects/<slug>/` folder).
 */
export async function deleteSessionJsonlFilesForProjectPath(projectPath: string): Promise<void> {
  const sessions = sessionsDb.getSessionsByProjectPathIncludingArchived(projectPath);
  const paths = uniqueJsonlPathsFromSessions(sessions);
  await removeJsonlFilesAndPruneEmptyDirs(paths);
}

/**
 * - **Soft delete** (`force` false): set `isArchived` on the `projects` row (hide from the active list; DB only).
 * - **Force** (`force` true): for each session row for that `project_path`, delete the file at `jsonl_path`
 *   (when set), then remove session rows and the `projects` row.
 */
export async function deleteOrArchiveProject(projectId: string, force: boolean): Promise<void> {
  const row = projectsDb.getProjectById(projectId);
  if (!row) {
    throw new AppError(`Unknown projectId: ${projectId}`, {
      code: 'PROJECT_NOT_FOUND',
      statusCode: 404,
    });
  }

  if (!force) {
    projectsDb.updateProjectIsArchivedById(projectId, true);
    return;
  }

  await deleteSessionJsonlFilesForProjectPath(row.project_path);
  sessionsDb.deleteSessionsByProjectPath(row.project_path);
  projectsDb.deleteProjectById(projectId);
}

/**
 * Restores one archived project row back into the active project list.
 */
export function restoreArchivedProject(projectId: string): void {
  const row = projectsDb.getProjectById(projectId);
  if (!row) {
    throw new AppError(`Unknown projectId: ${projectId}`, {
      code: 'PROJECT_NOT_FOUND',
      statusCode: 404,
    });
  }

  projectsDb.updateProjectIsArchivedById(projectId, false);
}
