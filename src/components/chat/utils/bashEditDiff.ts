/**
 * Reads the `bashEditDiff` Claude Code records on a Bash result: the files a shell
 * command changed, diffed around the run. The value is untrusted JSON from the
 * transcript or the live frame, so anything off-shape is dropped, not drawn.
 */

export interface BashEditDiffFile {
  path: string;
  created: boolean;
  deleted: boolean;
  /** Unified-diff lines, each prefixed ' ', '-', '+' or '\'. Hunks are separated by `null`. */
  lines: Array<string | null>;
}

export interface BashEditDiff {
  files: BashEditDiffFile[];
  /** Changed paths the CLI counted but did not diff. */
  undiffedPaths: string[];
  /** Changed files beyond `undiffedPaths`, counted but not named. */
  unnamedCount: number;
  /** The CLI could not diff all or part of the change. */
  unavailable: boolean;
  /** Another command changed the repository during this one, so either may own a change. */
  shared: boolean;
  /** A tree-rewriting git command (checkout, stash, reset…) the CLI does not diff. */
  skipped: boolean;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const readCount = (value: unknown): number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;

function readFile(value: unknown): BashEditDiffFile | null {
  if (!isRecord(value) || typeof value.filePath !== 'string' || !value.filePath || !Array.isArray(value.hunks)) {
    return null;
  }
  const lines: Array<string | null> = [];
  for (const hunk of value.hunks) {
    if (!isRecord(hunk) || !Array.isArray(hunk.lines)) continue;
    if (lines.length > 0) lines.push(null);
    lines.push(...hunk.lines.filter((line): line is string => typeof line === 'string'));
  }
  return { path: value.filePath, created: value.created === true, deleted: value.deleted === true, lines };
}

export function readBashEditDiff(toolUseResult: unknown): BashEditDiff | null {
  const diff = isRecord(toolUseResult) ? toolUseResult.bashEditDiff : null;
  if (!isRecord(diff)) return null;
  if (diff.skipped === true) {
    return { files: [], undiffedPaths: [], unnamedCount: 0, unavailable: false, shared: false, skipped: true };
  }

  const files = (Array.isArray(diff.files) ? diff.files : [])
    .map(readFile)
    .filter((file): file is BashEditDiffFile => file !== null);
  // The CLI keeps naming paths up to a limit but keeps counting in `moreFiles`.
  const moreFiles = readCount(diff.moreFiles);
  const diffed = new Set(files.map((file) => file.path));
  const undiffedPaths = moreFiles > 0 && Array.isArray(diff.changedFiles)
    ? [...new Set(diff.changedFiles.filter((path): path is string => typeof path === 'string' && !!path && !diffed.has(path)))]
      .slice(0, moreFiles)
    : [];
  const unavailable = diff.unavailable === true;
  const shared = diff.shared === true;
  if (files.length === 0 && moreFiles === 0 && !unavailable && !shared) return null;

  return { files, undiffedPaths, unnamedCount: moreFiles - undiffedPaths.length, unavailable, shared, skipped: false };
}

export function countBashEditDiff(diff: BashEditDiff | null): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const file of diff?.files ?? []) {
    for (const line of file.lines) {
      if (line?.startsWith('+')) added += 1;
      else if (line?.startsWith('-')) removed += 1;
    }
  }
  return { added, removed };
}
