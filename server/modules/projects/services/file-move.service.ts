import { promises as fs } from 'node:fs';
import path from 'node:path';

import { AppError } from '@/shared/utils.js';

/**
 * Batch file/directory move with a complete preflight.
 *
 * A move of N sources is not atomic on a filesystem, so the safety model is:
 * validate *everything* first, and only then start renaming. That turns every
 * predictable failure (a collision, a source that vanished, a destination
 * inside the selection) into a clean rejection that changed nothing on disk.
 * Reverse rollback exists only for the unpredictable rest — a rename that
 * fails halfway through for a reason no check could have foreseen (EACCES on
 * one entry, a racing external delete).
 *
 * The service is deliberately DB-free: the caller resolves `projectRoot` from
 * the database and passes it in, so tests can run against a temp directory.
 */

/** Upper bound on one batch; a selection larger than this is a mistake, not a workflow. */
export const MAX_MOVE_SOURCES = 500;

export type MoveEntryType = 'file' | 'directory';

export type MovedEntry = {
  oldPath: string;
  newPath: string;
  type: MoveEntryType;
};

export type SkippedEntry = {
  path: string;
  reason: 'already-in-destination';
};

export type MoveConflict = {
  sourcePath: string;
  targetPath: string;
};

export type MoveFilesResult = {
  moved: MovedEntry[];
  skipped: SkippedEntry[];
};

export type FileMoveDependencies = {
  /** Seam for tests that simulate a mid-execution rename failure. */
  rename: (oldPath: string, newPath: string) => Promise<void>;
};

const defaultDependencies: FileMoveDependencies = {
  rename: (oldPath, newPath) => fs.rename(oldPath, newPath),
};

type PreparedSource = {
  /** Path as the caller supplied it, echoed back in errors and mappings. */
  requestedPath: string;
  /** Fully resolved path with a real (symlink-free) parent directory. */
  realPath: string;
  type: MoveEntryType;
  /** Device id of the entry, used for the cross-filesystem check. */
  device: number;
};

const isUnder = (parent: string, candidate: string) =>
  candidate === parent || candidate.startsWith(parent + path.sep);

const badRequest = (message: string, code: string, details?: unknown) =>
  new AppError(message, { code, statusCode: 400, details });

/**
 * Removes duplicates and any source already covered by a selected ancestor
 * directory. Shallowest paths are considered first so an ancestor always wins
 * over its descendants regardless of the caller's ordering.
 *
 * Exported for direct testing — the client runs the same rule for its payloads
 * and previews, but this copy is the trust boundary.
 */
export function canonicalizeMoveSources<T extends { realPath: string; type: MoveEntryType }>(
  sources: T[],
): T[] {
  const byPath = new Map<string, T>();
  for (const source of sources) {
    if (!byPath.has(source.realPath)) {
      byPath.set(source.realPath, source);
    }
  }

  const ordered = [...byPath.values()].sort((a, b) => {
    const depthDelta = a.realPath.split(path.sep).length - b.realPath.split(path.sep).length;
    return depthDelta !== 0 ? depthDelta : a.realPath.localeCompare(b.realPath);
  });

  const kept: T[] = [];
  const keptDirectories: string[] = [];
  for (const source of ordered) {
    if (keptDirectories.some((dir) => source.realPath.startsWith(dir + path.sep))) {
      continue;
    }
    kept.push(source);
    if (source.type === 'directory') {
      keptDirectories.push(source.realPath);
    }
  }

  return kept;
}

/**
 * Accepts either the batch `sourcePaths` array or the original singular
 * `sourcePath`, so an older client (or a bookmarked request) keeps working.
 */
export function normalizeSourcePathsInput(body: {
  sourcePaths?: unknown;
  sourcePath?: unknown;
}): string[] {
  const raw = body.sourcePaths ?? (body.sourcePath === undefined ? undefined : [body.sourcePath]);

  if (raw === undefined || raw === null) {
    throw badRequest('sourcePaths is required', 'MOVE_INVALID_REQUEST');
  }
  if (!Array.isArray(raw)) {
    throw badRequest('sourcePaths must be an array', 'MOVE_INVALID_REQUEST');
  }
  if (raw.length === 0) {
    throw badRequest('sourcePaths must not be empty', 'MOVE_INVALID_REQUEST');
  }
  if (raw.length > MAX_MOVE_SOURCES) {
    throw badRequest(
      `Cannot move more than ${MAX_MOVE_SOURCES} items at once`,
      'MOVE_TOO_MANY_SOURCES',
    );
  }
  if (!raw.every((entry): entry is string => typeof entry === 'string' && entry.trim() !== '')) {
    throw badRequest('Every source path must be a non-empty string', 'MOVE_INVALID_REQUEST');
  }

  return raw;
}

async function resolveRealDirectory(candidate: string): Promise<string | null> {
  try {
    return await fs.realpath(candidate);
  } catch {
    return null;
  }
}

async function prepareSource(
  requestedPath: string,
  projectRootReal: string,
): Promise<PreparedSource> {
  const lexical = path.resolve(projectRootReal, requestedPath);

  // The project root itself is never movable, and nothing outside it is addressable.
  if (lexical === projectRootReal) {
    throw badRequest('Cannot move the project root', 'MOVE_ROOT_SOURCE', { sourcePath: requestedPath });
  }
  if (!isUnder(projectRootReal, lexical)) {
    throw new AppError('Path must be under project root', {
      code: 'MOVE_PATH_ESCAPE',
      statusCode: 403,
      details: { sourcePath: requestedPath },
    });
  }

  // Resolve the *parent* rather than the entry: a symlinked source should be
  // moved as the link it is, but a symlinked parent could still point outside
  // the project, so that part has to be made real before the check means
  // anything.
  const parentReal = await resolveRealDirectory(path.dirname(lexical));
  if (parentReal === null) {
    throw new AppError('File or directory not found', {
      code: 'MOVE_SOURCE_NOT_FOUND',
      statusCode: 404,
      details: { sourcePath: requestedPath },
    });
  }
  if (!isUnder(projectRootReal, parentReal)) {
    throw new AppError('Path must be under project root', {
      code: 'MOVE_PATH_ESCAPE',
      statusCode: 403,
      details: { sourcePath: requestedPath },
    });
  }

  const realPath = path.join(parentReal, path.basename(lexical));

  let stats;
  try {
    stats = await fs.lstat(realPath);
  } catch {
    throw new AppError('File or directory not found', {
      code: 'MOVE_SOURCE_NOT_FOUND',
      statusCode: 404,
      details: { sourcePath: requestedPath },
    });
  }

  return {
    requestedPath,
    realPath,
    // A symlink moves as a symlink; for planning purposes it behaves like a
    // file (it is never treated as a container of other sources).
    type: stats.isDirectory() ? 'directory' : 'file',
    device: stats.dev,
  };
}

async function prepareDestination(
  destinationPath: string,
  projectRootReal: string,
): Promise<{ realPath: string; device: number }> {
  const lexical =
    destinationPath === '' ? projectRootReal : path.resolve(projectRootReal, destinationPath);

  const real = await resolveRealDirectory(lexical);
  if (real === null) {
    throw new AppError('Destination directory not found', {
      code: 'MOVE_DESTINATION_NOT_FOUND',
      statusCode: 404,
      details: { destinationPath },
    });
  }

  // Checked *after* realpath so a symlinked destination cannot smuggle the
  // batch out of the project.
  if (!isUnder(projectRootReal, real)) {
    throw new AppError('Destination must be under project root', {
      code: 'MOVE_PATH_ESCAPE',
      statusCode: 403,
      details: { destinationPath },
    });
  }

  const stats = await fs.stat(real);
  if (!stats.isDirectory()) {
    throw badRequest('Destination is not a directory', 'MOVE_DESTINATION_NOT_DIRECTORY', {
      destinationPath,
    });
  }

  return { realPath: real, device: stats.dev };
}

type MovePlan = {
  entries: Array<{ source: PreparedSource; targetPath: string }>;
  skipped: SkippedEntry[];
};

async function buildMovePlan(
  sources: PreparedSource[],
  destination: { realPath: string; device: number },
): Promise<MovePlan> {
  // A destination equal to or inside any selected directory would move a
  // folder into itself; there is no partial version of that to salvage.
  for (const source of sources) {
    if (source.type === 'directory' && isUnder(source.realPath, destination.realPath)) {
      throw badRequest('Cannot move a directory into itself', 'MOVE_INTO_SELF', {
        sourcePath: source.requestedPath,
      });
    }
  }

  const entries: MovePlan['entries'] = [];
  const skipped: SkippedEntry[] = [];

  for (const source of sources) {
    if (path.dirname(source.realPath) === destination.realPath) {
      // Already where it is going: an explicit no-op, not a failure. This is
      // what lets a mixed selection move the rest instead of being rejected.
      skipped.push({ path: source.requestedPath, reason: 'already-in-destination' });
      continue;
    }
    entries.push({
      source,
      targetPath: path.join(destination.realPath, path.basename(source.realPath)),
    });
  }

  if (entries.length === 0) {
    throw badRequest('Every selected item is already in this folder', 'MOVE_NO_OP');
  }

  // Two sources from different parents can share a basename. Renaming them one
  // after another would silently overwrite; without a naming policy the only
  // honest answer is to reject and name both.
  const byTarget = new Map<string, string[]>();
  for (const entry of entries) {
    const existing = byTarget.get(entry.targetPath);
    if (existing) {
      existing.push(entry.source.requestedPath);
    } else {
      byTarget.set(entry.targetPath, [entry.source.requestedPath]);
    }
  }
  const duplicates: MoveConflict[] = [];
  for (const [targetPath, sourcePaths] of byTarget) {
    if (sourcePaths.length > 1) {
      for (const sourcePath of sourcePaths) {
        duplicates.push({ sourcePath, targetPath });
      }
    }
  }
  if (duplicates.length > 0) {
    throw badRequest(
      'Selected items share a name and cannot move into the same folder',
      'MOVE_DUPLICATE_NAMES',
      { conflicts: duplicates },
    );
  }

  const collisions: MoveConflict[] = [];
  for (const entry of entries) {
    try {
      await fs.lstat(entry.targetPath);
      collisions.push({ sourcePath: entry.source.requestedPath, targetPath: entry.targetPath });
    } catch {
      // Nothing there, which is what we want.
    }
  }
  if (collisions.length > 0) {
    throw badRequest('Destination contains conflicting names', 'MOVE_CONFLICT', {
      conflicts: collisions,
    });
  }

  // `rename` cannot cross devices. Catching it here keeps a doomed batch from
  // moving its first few entries and then failing.
  for (const entry of entries) {
    if (entry.source.device !== destination.device) {
      throw badRequest('Cannot move across different filesystems', 'MOVE_CROSS_DEVICE', {
        sourcePath: entry.source.requestedPath,
      });
    }
  }

  return { entries, skipped };
}

async function executeMovePlan(
  plan: MovePlan,
  dependencies: FileMoveDependencies,
): Promise<MovedEntry[]> {
  const completed: MovedEntry[] = [];

  for (const entry of plan.entries) {
    try {
      await dependencies.rename(entry.source.realPath, entry.targetPath);
      completed.push({
        oldPath: entry.source.realPath,
        newPath: entry.targetPath,
        type: entry.source.type,
      });
    } catch (error) {
      const failure = error as NodeJS.ErrnoException;
      const rollbackFailures: string[] = [];

      // Reverse order so a directory that was moved before its former sibling
      // is restored last-in-first-out.
      for (const done of [...completed].reverse()) {
        try {
          await dependencies.rename(done.newPath, done.oldPath);
        } catch (rollbackError) {
          const message = (rollbackError as Error).message;
          console.error(
            `[file-move] Rollback failed: ${done.newPath} -> ${done.oldPath}: ${message}`,
          );
          rollbackFailures.push(done.newPath);
        }
      }

      if (rollbackFailures.length > 0) {
        throw new AppError(
          'Move failed and could not be fully undone; some items may be in the destination',
          {
            code: 'MOVE_PARTIAL',
            statusCode: 500,
            details: {
              failedSourcePath: entry.source.requestedPath,
              reason: failure.message,
              unrestoredPaths: rollbackFailures,
            },
          },
        );
      }

      throw new AppError('Move failed; no items were moved', {
        code: 'MOVE_FAILED',
        statusCode: 500,
        details: {
          failedSourcePath: entry.source.requestedPath,
          reason: failure.message,
        },
      });
    }
  }

  return completed;
}

/**
 * Moves every source into `destinationPath` (`''` means the project root),
 * after a preflight that either passes completely or leaves the filesystem
 * untouched.
 *
 * Returns the old-to-new mappings the client needs to rebind an open editor,
 * plus the sources that were already in the destination and did nothing.
 */
export async function moveFilesIntoDirectory({
  projectRoot,
  sourcePaths,
  destinationPath,
  dependencies = defaultDependencies,
}: {
  projectRoot: string;
  sourcePaths: string[];
  destinationPath: string;
  dependencies?: FileMoveDependencies;
}): Promise<MoveFilesResult> {
  if (destinationPath === undefined || destinationPath === null) {
    throw badRequest('destinationPath is required', 'MOVE_INVALID_REQUEST');
  }

  const projectRootReal = await resolveRealDirectory(projectRoot);
  if (projectRootReal === null) {
    throw new AppError('Project directory not found', {
      code: 'MOVE_PROJECT_NOT_FOUND',
      statusCode: 404,
    });
  }

  const prepared: PreparedSource[] = [];
  for (const sourcePath of sourcePaths) {
    prepared.push(await prepareSource(sourcePath, projectRootReal));
  }

  const canonical = canonicalizeMoveSources(prepared);
  const destination = await prepareDestination(destinationPath, projectRootReal);
  const plan = await buildMovePlan(canonical, destination);
  const moved = await executeMovePlan(plan, dependencies);

  return { moved, skipped: plan.skipped };
}
