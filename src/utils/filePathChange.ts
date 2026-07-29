import type { FilePathChange } from '../types/app';

/**
 * Helpers for rebinding a stored absolute path after the Files tab moved or
 * renamed something. Shared so the editor, previews, and any future
 * path-holding surface all interpret a `FilePathChange` the same way.
 */

const isSeparator = (character: string) => character === '/' || character === '\\';

/** True when `candidate` is `ancestor` itself or sits underneath it. */
const isSameOrUnder = (ancestor: string, candidate: string) =>
  candidate === ancestor ||
  (candidate.startsWith(ancestor) && isSeparator(candidate.charAt(ancestor.length)));

/**
 * Returns the path `currentPath` now lives at, or `null` when none of the
 * changes touched it.
 *
 * A directory change rewrites the prefix of everything beneath it, which is
 * what keeps an open file bound when one of its parent folders is the thing
 * that actually moved.
 */
export function remapChangedPath(
  currentPath: string,
  changes: readonly FilePathChange[],
): string | null {
  let result = currentPath;
  let changed = false;

  for (const change of changes) {
    if (result === change.oldPath) {
      result = change.newPath;
      changed = true;
      continue;
    }

    if (change.type === 'directory' && isSameOrUnder(change.oldPath, result)) {
      result = change.newPath + result.slice(change.oldPath.length);
      changed = true;
    }
  }

  return changed ? result : null;
}

/** Basename of an absolute path, tolerating either separator. */
export function fileNameFromPath(filePath: string): string {
  const normalized = filePath.replace(/\\/g, '/');
  return normalized.slice(normalized.lastIndexOf('/') + 1) || filePath;
}
