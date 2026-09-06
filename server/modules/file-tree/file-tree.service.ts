import os from 'node:os';
import path from 'node:path';

import ignore from 'ignore';

import { moveFilesIntoDirectory } from '@/modules/projects/index.js';
import type {
  FileTreeDirectoryEntry,
  FileTreeNode,
  FileTreeSearchResult,
  FileTreeServiceDependencies,
  FileTreeServices,
  FileTreeUploadedFile,
} from '@/shared/types.js';
import { AppError, FORBIDDEN_WORKSPACE_PATHS, normalizeProjectPath } from '@/shared/utils.js';

const IGNORED_DIRECTORY_NAMES = new Set([
  'node_modules', 'dist', 'build', '.next', '.nuxt', '.cache', '.parcel-cache',
  '.git', '.svn', '.hg',
  '__pycache__', '.pytest_cache', '.mypy_cache', '.tox', 'venv', '.venv',
  'target', 'vendor',
  '.gradle', '.idea', 'coverage', '.nyc_output',
]);

const COMMON_WORKSPACE_DIRECTORY_NAMES = [
  'Desktop',
  'Documents',
  'Projects',
  'Development',
  'Dev',
  'Code',
  'workspace',
];

const LEGACY_TREE_ENTRY_LIMIT = 10_000;
const SUBTREE_ENTRY_LIMIT = 10_000;
const SEARCH_VISIT_LIMIT = 250_000;
const SEARCH_YIELD_INTERVAL = 256;
const AMBIGUOUS_MATCH_LIMIT = 20;
const SEARCH_INDEX_TTL_MS = 2 * 60 * 1000;
const SEARCH_INDEX_PROJECT_LIMIT = 2;

type FileTreeEntryFilter = (entryPath: string, isDirectory: boolean) => boolean;

type FileTreeSearchIndex = {
  generation: number;
  sequence: number;
  generatedAt: number;
  results: FileTreeSearchResult[];
  searchKeys: string[];
  gitignoreIncluded: boolean[];
};

type FileTreeSearchIndexBuild = {
  controller: AbortController;
  generation: number;
  promise: Promise<FileTreeSearchIndex>;
  subscribers: number;
  warm: boolean;
};

function createFileTreeError(message: string, statusCode: number, code: string): AppError {
  return new AppError(message, { statusCode, code });
}

function readErrorCode(error: unknown): string | null {
  return typeof error === 'object' && error !== null && 'code' in error
    ? String(error.code)
    : null;
}

function readErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

function permissionBitsToRwx(permissionBits: number): string {
  const read = permissionBits & 4 ? 'r' : '-';
  const write = permissionBits & 2 ? 'w' : '-';
  const execute = permissionBits & 1 ? 'x' : '-';
  return read + write + execute;
}

function validateFilename(name: string): void {
  if (!name.trim()) {
    throw createFileTreeError('Filename cannot be empty', 400, 'INVALID_FILENAME');
  }

  if (/[<>:"/\\|?*\x00-\x1f]/.test(name)) {
    throw createFileTreeError('Filename contains invalid characters', 400, 'INVALID_FILENAME');
  }

  if (/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i.test(name)) {
    throw createFileTreeError('Filename is a reserved name', 400, 'INVALID_FILENAME');
  }

  if (/^\.+$/.test(name)) {
    throw createFileTreeError('Filename cannot be only dots', 400, 'INVALID_FILENAME');
  }
}

function isPathInside(rootPath: string, candidatePath: string): boolean {
  const relativePath = path.relative(rootPath, candidatePath);
  return relativePath === ''
    || (!relativePath.startsWith(`..${path.sep}`) && relativePath !== '..' && !path.isAbsolute(relativePath));
}

/** Project-relative when the target is inside the project, absolute when it is not. */
function toProjectRelativePath(projectRoot: string, targetPath: string): string {
  return isPathInside(projectRoot, targetPath)
    ? path.relative(projectRoot, targetPath).split(path.sep).join('/')
    : targetPath;
}

function resolvePathInsideProject(projectRoot: string, targetPath: string): string {
  const resolvedPath = path.isAbsolute(targetPath)
    ? path.resolve(targetPath)
    : path.resolve(projectRoot, targetPath);

  if (!isPathInside(path.resolve(projectRoot), resolvedPath)) {
    throw createFileTreeError('Path must be under project root', 403, 'PATH_OUTSIDE_PROJECT');
  }

  return resolvedPath;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return;
  throw new DOMException('File Tree request aborted', 'AbortError');
}

function compareEntryNames(
  left: Pick<FileTreeDirectoryEntry, 'name' | 'isDirectory'>,
  right: Pick<FileTreeDirectoryEntry, 'name' | 'isDirectory'>,
): number {
  const leftRank = left.isDirectory() ? 0 : 1;
  const rightRank = right.isDirectory() ? 0 : 1;
  if (leftRank !== rightRank) return leftRank - rightRank;
  const localeResult = left.name.localeCompare(right.name);
  return localeResult !== 0 ? localeResult : left.name < right.name ? -1 : left.name > right.name ? 1 : 0;
}

function insertBoundedDirectoryEntry(
  retained: FileTreeDirectoryEntry[],
  entry: FileTreeDirectoryEntry,
  maximumEntries: number,
): void {
  const lastEntry = retained.at(-1);
  if (retained.length >= maximumEntries && lastEntry && compareEntryNames(entry, lastEntry) >= 0) {
    return;
  }

  let low = 0;
  let high = retained.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (compareEntryNames(entry, retained[middle]) < 0) high = middle;
    else low = middle + 1;
  }
  retained.splice(low, 0, entry);
  if (retained.length > maximumEntries) retained.pop();
}

function compareSearchResults(left: FileTreeSearchResult, right: FileTreeSearchResult): number {
  const localeResult = left.relativePath.localeCompare(right.relativePath);
  return localeResult !== 0
    ? localeResult
    : left.relativePath < right.relativePath ? -1 : left.relativePath > right.relativePath ? 1 : 0;
}

function encodeCursor(value: Record<string, string | number>): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

function decodeCursor(cursor: string | null): Record<string, unknown> | null {
  if (!cursor) return null;
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as unknown;
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new Error('cursor must be an object');
    }
    return parsed as Record<string, unknown>;
  } catch {
    throw createFileTreeError('Invalid pagination cursor', 400, 'INVALID_FILE_TREE_CURSOR');
  }
}

function expandWorkspacePath(workspaceRoot: string, inputPath: string): string {
  if (inputPath === '~') {
    return workspaceRoot;
  }
  if (inputPath.startsWith('~/') || inputPath.startsWith('~\\')) {
    return path.join(workspaceRoot, inputPath.slice(2));
  }
  return inputPath;
}

function createConcurrencyLimiter(maximumConcurrency: number) {
  let activeOperations = 0;
  type PendingOperation = {
    resolve: () => void;
    reject: (error: unknown) => void;
    signal?: AbortSignal;
    onAbort?: () => void;
  };
  const pendingOperations: PendingOperation[] = [];

  async function acquire(signal?: AbortSignal): Promise<void> {
    throwIfAborted(signal);
    if (activeOperations < maximumConcurrency) {
      activeOperations += 1;
      return;
    }

    await new Promise<void>((resolve, reject) => {
      const pending: PendingOperation = { resolve, reject, signal };
      if (signal) {
        pending.onAbort = () => {
          const index = pendingOperations.indexOf(pending);
          if (index !== -1) pendingOperations.splice(index, 1);
          reject(new DOMException('File Tree request aborted', 'AbortError'));
        };
        signal.addEventListener('abort', pending.onAbort, { once: true });
      }
      pendingOperations.push(pending);
    });
  }

  function release(): void {
    while (pendingOperations.length > 0) {
      const nextOperation = pendingOperations.shift();
      if (!nextOperation) break;
      if (nextOperation.signal && nextOperation.onAbort) {
        nextOperation.signal.removeEventListener('abort', nextOperation.onAbort);
      }
      if (nextOperation.signal?.aborted) {
        nextOperation.reject(new DOMException('File Tree request aborted', 'AbortError'));
        continue;
      }
      nextOperation.resolve();
      return;
    }

    activeOperations = Math.max(0, activeOperations - 1);
  }

  return { acquire, release };
}

function mapFileSystemError(
  error: unknown,
  messages: Partial<Record<string, { message: string; statusCode: number }>>,
): never {
  const errorCode = readErrorCode(error);
  const mappedError = errorCode ? messages[errorCode] : undefined;
  if (mappedError) {
    throw createFileTreeError(mappedError.message, mappedError.statusCode, errorCode ?? 'FILE_TREE_ERROR');
  }

  throw error;
}

function createGitignoreEntryFilter(
  projectRoot: string,
  gitignoreContent: string,
): FileTreeEntryFilter {
  const gitignore = ignore().add(gitignoreContent);

  return (entryPath, isDirectory) => {
    const relativePath = path.relative(projectRoot, entryPath).split(path.sep).join('/');
    const matchPath = isDirectory ? `${relativePath}/` : relativePath;
    return !gitignore.ignores(matchPath);
  };
}

/**
 * Creates File Tree workflows for the module composition root and route tests.
 * Every filesystem, project, workspace, environment, and logging dependency is
 * required explicitly so this service has no machine-wide production defaults.
 */
export function createFileTreeService(dependencies: FileTreeServiceDependencies): FileTreeServices {
  const fileSystem = dependencies.fileSystem;
  const concurrencyLimit = Number.isFinite(dependencies.fileSystemConcurrency)
    && dependencies.fileSystemConcurrency > 0
    ? Math.floor(dependencies.fileSystemConcurrency)
    : 1;
  const { acquire, release } = createConcurrencyLimiter(concurrencyLimit);
  const searchIndexes = new Map<string, FileTreeSearchIndex>();
  const searchIndexBuilds = new Map<string, FileTreeSearchIndexBuild>();
  let searchIndexGeneration = 0;
  let searchIndexBuildSequence = 0;

  async function runFileSystemOperation<T>(
    operation: () => Promise<T>,
    signal?: AbortSignal,
  ): Promise<T> {
    await acquire(signal);
    try {
      throwIfAborted(signal);
      return await operation();
    } finally {
      release();
    }
  }

  // Roots a read may reach beyond the project: the workspace root and the OS
  // temp directory. Canonicalised once because macOS resolves /tmp elsewhere.
  let canonicalReadableRoots: string[] | null = null;

  async function resolveReadableRoots(signal?: AbortSignal): Promise<string[]> {
    if (canonicalReadableRoots) return canonicalReadableRoots;
    const roots: string[] = [];
    for (const rootPath of [dependencies.workspace.rootPath, os.tmpdir()]) {
      if (!rootPath) continue;
      try {
        roots.push(await runFileSystemOperation(() => fileSystem.realpath(rootPath), signal));
      } catch (error) {
        if (isAbortError(error)) throw error;
        roots.push(path.resolve(rootPath));
      }
    }
    canonicalReadableRoots = roots;
    return roots;
  }

  async function resolveProjectRoot(projectId: string): Promise<string> {
    const projectRoot = await dependencies.projects.getProjectPathById(projectId);
    if (!projectRoot) {
      throw createFileTreeError('Project not found', 404, 'PROJECT_NOT_FOUND');
    }
    return projectRoot;
  }

  async function resolveCanonicalProjectRoot(projectId: string, signal?: AbortSignal): Promise<string> {
    const projectRoot = await resolveProjectRoot(projectId);
    try {
      return await runFileSystemOperation(() => fileSystem.realpath(projectRoot), signal);
    } catch (error) {
      if (readErrorCode(error) === 'ENOENT') {
        throw createFileTreeError(`Project path not found: ${projectRoot}`, 404, 'PROJECT_PATH_NOT_FOUND');
      }
      throw error;
    }
  }

  async function resolveExistingPathInsideRoots(
    allowedRoots: readonly string[],
    baseDirectory: string,
    targetPath: string,
    boundaryMessage: string,
    signal?: AbortSignal,
  ): Promise<string> {
    const candidatePath = path.isAbsolute(targetPath)
      ? path.resolve(targetPath)
      : path.resolve(baseDirectory, targetPath);
    let realPath: string;
    try {
      realPath = await runFileSystemOperation(() => fileSystem.realpath(candidatePath), signal);
    } catch (error) {
      if (readErrorCode(error) === 'ENOENT') {
        throw createFileTreeError('File or directory not found', 404, 'FILE_TREE_ENTRY_NOT_FOUND');
      }
      throw error;
    }
    if (!allowedRoots.some((rootPath) => isPathInside(rootPath, realPath))) {
      throw createFileTreeError(boundaryMessage, 403, 'PATH_OUTSIDE_PROJECT');
    }
    return realPath;
  }

  async function resolveExistingPathInsideProject(
    canonicalProjectRoot: string,
    targetPath: string,
    signal?: AbortSignal,
  ): Promise<string> {
    return resolveExistingPathInsideRoots(
      [canonicalProjectRoot],
      canonicalProjectRoot,
      targetPath,
      'Path must be under project root',
      signal,
    );
  }

  /**
   * Resolution for read-only viewing, which may reach outside the project so a
   * chat link to a snapshot or another checkout opens instead of failing.
   * Never use for a mutation: writes stay inside the project root.
   */
  async function resolveExistingReadablePath(
    canonicalProjectRoot: string,
    targetPath: string,
    signal?: AbortSignal,
  ): Promise<string> {
    return resolveExistingPathInsideRoots(
      [canonicalProjectRoot, ...await resolveReadableRoots(signal)],
      canonicalProjectRoot,
      targetPath,
      'Path must be under the project, workspace, or temporary directory',
      signal,
    );
  }

  async function resolveExistingDirectoryInsideProject(
    canonicalProjectRoot: string,
    targetPath: string,
    signal?: AbortSignal,
  ): Promise<string> {
    const directoryPath = await resolveExistingPathInsideProject(canonicalProjectRoot, targetPath, signal);
    const stats = await runFileSystemOperation(() => fileSystem.stat(directoryPath), signal);
    if (!stats.isDirectory()) {
      throw createFileTreeError('Path is not a directory', 400, 'NOT_A_DIRECTORY');
    }
    return directoryPath;
  }

  async function resolveCreatablePathInsideProject(
    canonicalProjectRoot: string,
    targetPath: string,
    signal?: AbortSignal,
  ): Promise<string> {
    const candidatePath = resolvePathInsideProject(canonicalProjectRoot, targetPath);
    const missingSegments: string[] = [];
    let existingPath = candidatePath;

    while (true) {
      throwIfAborted(signal);
      try {
        const realPath = await runFileSystemOperation(() => fileSystem.realpath(existingPath), signal);
        if (!isPathInside(canonicalProjectRoot, realPath)) {
          throw createFileTreeError('Path must be under project root', 403, 'PATH_OUTSIDE_PROJECT');
        }
        return path.join(realPath, ...missingSegments);
      } catch (error) {
        if (error instanceof AppError || isAbortError(error)) throw error;
        if (readErrorCode(error) !== 'ENOENT') throw error;
        const parentPath = path.dirname(existingPath);
        if (parentPath === existingPath) {
          throw createFileTreeError('Parent directory not found', 404, 'PARENT_DIRECTORY_NOT_FOUND');
        }
        missingSegments.unshift(path.basename(existingPath));
        existingPath = parentPath;
      }
    }
  }

  async function resolveEntryPathInsideProject(
    canonicalProjectRoot: string,
    targetPath: string,
    signal?: AbortSignal,
  ): Promise<string> {
    const candidatePath = resolvePathInsideProject(canonicalProjectRoot, targetPath);
    const parentPath = await resolveExistingDirectoryInsideProject(
      canonicalProjectRoot,
      path.dirname(candidatePath),
      signal,
    );
    return path.join(parentPath, path.basename(candidatePath));
  }

  async function readGitignoreFilter(
    projectRoot: string,
    respectGitignore: boolean,
    signal?: AbortSignal,
  ): Promise<FileTreeEntryFilter> {
    if (!respectGitignore) return () => true;
    try {
      const gitignoreContent = await runFileSystemOperation(
        () => fileSystem.readTextFile(path.join(projectRoot, '.gitignore')),
        signal,
      );
      return createGitignoreEntryFilter(projectRoot, gitignoreContent);
    } catch (error) {
      if (isAbortError(error)) throw error;
      if (readErrorCode(error) !== 'ENOENT') {
        dependencies.logger.error(`Error reading .gitignore in "${projectRoot}"`, error);
      }
      return () => true;
    }
  }

  async function createTreeNode(
    directoryPath: string,
    entry: FileTreeDirectoryEntry,
    signal?: AbortSignal,
    failOnMetadataError = false,
  ): Promise<FileTreeNode> {
    const itemPath = path.join(directoryPath, entry.name);
    const item: FileTreeNode = {
      name: entry.name,
      path: itemPath,
      type: entry.isDirectory() ? 'directory' : 'file',
      size: 0,
      modified: null,
      permissions: '000',
      permissionsRwx: '---------',
    };

    try {
      const stats = await runFileSystemOperation(() => fileSystem.lstat(itemPath), signal);
      const ownerPermissions = (stats.mode >> 6) & 7;
      const groupPermissions = (stats.mode >> 3) & 7;
      const otherPermissions = stats.mode & 7;
      item.size = stats.size;
      item.modified = stats.mtime.toISOString();
      item.permissions = `${ownerPermissions}${groupPermissions}${otherPermissions}`;
      item.permissionsRwx = permissionBitsToRwx(ownerPermissions)
        + permissionBitsToRwx(groupPermissions)
        + permissionBitsToRwx(otherPermissions);
      if (stats.isSymbolicLink()) item.isSymlink = true;
    } catch (error) {
      if (isAbortError(error)) throw error;
      if (failOnMetadataError) {
        throw createFileTreeError(
          `Could not read metadata for "${itemPath}"`,
          409,
          'FILE_TREE_INCOMPLETE',
        );
      }
    }

    return item;
  }

  async function isEntryContained(
    canonicalProjectRoot: string,
    entryPath: string,
    entry: FileTreeDirectoryEntry,
    signal?: AbortSignal,
  ): Promise<boolean> {
    if (!entry.isSymbolicLink()) return true;
    try {
      const realPath = await runFileSystemOperation(() => fileSystem.realpath(entryPath), signal);
      return isPathInside(canonicalProjectRoot, realPath);
    } catch (error) {
      if (isAbortError(error)) throw error;
      return false;
    }
  }

  type TreeBuildState = { entryCount: number; maximumEntries: number };

  async function buildFileTree(
    directoryPath: string,
    maximumDepth: number,
    currentDepth = 0,
    includeEntry: FileTreeEntryFilter = () => true,
    signal?: AbortSignal,
    state: TreeBuildState = { entryCount: 0, maximumEntries: LEGACY_TREE_ENTRY_LIMIT },
    failOnUnreadable = false,
    canonicalProjectRoot?: string,
  ): Promise<FileTreeNode[]> {
    throwIfAborted(signal);
    if (canonicalProjectRoot) {
      await resolveExistingPathInsideProject(canonicalProjectRoot, directoryPath, signal);
    }

    let entries: FileTreeDirectoryEntry[];
    try {
      entries = await runFileSystemOperation(() => fileSystem.readdir(directoryPath), signal);
    } catch (error) {
      if (error instanceof AppError || isAbortError(error)) throw error;
      if (failOnUnreadable) {
        throw createFileTreeError(
          `Could not read directory "${directoryPath}"`,
          409,
          'FILE_TREE_INCOMPLETE',
        );
      }
      const errorCode = readErrorCode(error);
      if (errorCode !== 'EACCES' && errorCode !== 'EPERM') {
        dependencies.logger.error(`Error reading directory "${directoryPath}"`, error);
      }
      return [];
    }

    const visibleEntries = entries.filter((entry) => {
      const isDirectory = entry.isDirectory();
      if (isDirectory && IGNORED_DIRECTORY_NAMES.has(entry.name)) {
        return false;
      }
      return includeEntry(path.join(directoryPath, entry.name), isDirectory);
    });

    const items: FileTreeNode[] = [];
    const sortedEntries = visibleEntries.sort(compareEntryNames);
    const metadataBatchSize = Math.max(1, Math.min(8, concurrencyLimit));
    for (let batchStart = 0; batchStart < sortedEntries.length; batchStart += metadataBatchSize) {
      throwIfAborted(signal);
      const preparedEntries = await Promise.all(
        sortedEntries.slice(batchStart, batchStart + metadataBatchSize).map(async (entry) => {
          const itemPath = path.join(directoryPath, entry.name);
          if (canonicalProjectRoot
            && entry.isSymbolicLink()
            && !await isEntryContained(canonicalProjectRoot, itemPath, entry, signal)) {
            if (failOnUnreadable) {
              throw createFileTreeError(
                `Symlink escapes the project root: "${itemPath}"`,
                403,
                'PATH_OUTSIDE_PROJECT',
              );
            }
            return null;
          }
          state.entryCount += 1;
          if (state.entryCount > state.maximumEntries) {
            throw createFileTreeError(
              `File tree exceeds the ${state.maximumEntries.toLocaleString()}-entry safety limit`,
              413,
              'FILE_TREE_ENTRY_LIMIT_EXCEEDED',
            );
          }
          const item = await createTreeNode(directoryPath, entry, signal, failOnUnreadable);
          return { entry, item, itemPath };
        }),
      );

      for (const prepared of preparedEntries) {
        if (!prepared) continue;
        const { entry, item, itemPath } = prepared;
        // Pseudo-filesystems are never project roots, and walking /proc from a
        // broad root costs thousands of virtual entries plus a logged error per
        // mid-walk thread exit. Exact match, so a project's own `proc/` is safe.
        const isForbiddenSystemDir = FORBIDDEN_WORKSPACE_PATHS.includes(
          normalizeProjectPath(itemPath),
        );

        if (entry.isDirectory() && currentDepth < maximumDepth && !isForbiddenSystemDir) {
          item.children = await buildFileTree(
            itemPath,
            maximumDepth,
            currentDepth + 1,
            includeEntry,
            signal,
            state,
            failOnUnreadable,
            canonicalProjectRoot,
          );
        }
        items.push(item);
      }
    }

    return items;
  }

  async function readNextDirectoryEntry(
    handle: Awaited<ReturnType<FileTreeServiceDependencies['fileSystem']['openDirectory']>>,
    signal?: AbortSignal,
  ): Promise<FileTreeDirectoryEntry | null> {
    return runFileSystemOperation(() => handle.read(), signal);
  }

  async function closeDirectory(
    handle: Awaited<ReturnType<FileTreeServiceDependencies['fileSystem']['openDirectory']>>,
  ): Promise<void> {
    try {
      await runFileSystemOperation(() => handle.close());
    } catch (error) {
      if (readErrorCode(error) !== 'ERR_DIR_CLOSED') throw error;
    }
  }

  async function collectDirectoryPage(input: {
    canonicalProjectRoot: string;
    directoryPath: string;
    cursor: string | null;
    limit: number;
    includeEntry: FileTreeEntryFilter;
    signal?: AbortSignal;
  }): Promise<{ entries: FileTreeNode[]; nextCursor: string | null }> {
    const directoryStats = await runFileSystemOperation(
      () => fileSystem.stat(input.directoryPath),
      input.signal,
    );
    const version = directoryStats.mtime.toISOString();
    const decodedCursor = decodeCursor(input.cursor);
    const cursorVersion = decodedCursor?.version;
    const afterName = decodedCursor?.name;
    const afterType = decodedCursor?.type;
    if (decodedCursor && (
      typeof cursorVersion !== 'string'
      || typeof afterName !== 'string'
      || (afterType !== 'file' && afterType !== 'directory')
    )) {
      throw createFileTreeError('Invalid pagination cursor', 400, 'INVALID_FILE_TREE_CURSOR');
    }
    if (decodedCursor && cursorVersion !== version) {
      throw createFileTreeError(
        'Directory changed while it was being loaded',
        409,
        'FILE_TREE_DIRECTORY_CHANGED',
      );
    }

    const afterEntry: FileTreeDirectoryEntry | null = decodedCursor
      ? {
          name: afterName as string,
          isDirectory: () => afterType === 'directory',
          isSymbolicLink: () => false,
        }
      : null;
    const retained: FileTreeDirectoryEntry[] = [];
    const handle = await runFileSystemOperation(
      () => fileSystem.openDirectory(input.directoryPath),
      input.signal,
    );
    try {
      while (true) {
        throwIfAborted(input.signal);
        const entry = await readNextDirectoryEntry(handle, input.signal);
        if (!entry) break;
        const entryPath = path.join(input.directoryPath, entry.name);
        if (entry.isDirectory() && IGNORED_DIRECTORY_NAMES.has(entry.name)) continue;
        if (!input.includeEntry(entryPath, entry.isDirectory())) continue;
        if (entry.isSymbolicLink()
          && !await isEntryContained(input.canonicalProjectRoot, entryPath, entry, input.signal)) continue;
        if (afterEntry && compareEntryNames(entry, afterEntry) <= 0) continue;

        insertBoundedDirectoryEntry(retained, entry, input.limit + 1);
      }
    } finally {
      await closeDirectory(handle);
    }

    const hasMore = retained.length > input.limit;
    const pageEntries = retained.slice(0, input.limit);
    const entries: FileTreeNode[] = [];
    for (const entry of pageEntries) {
      throwIfAborted(input.signal);
      entries.push(await createTreeNode(input.directoryPath, entry, input.signal));
    }

    const lastEntry = pageEntries.at(-1);
    return {
      entries,
      nextCursor: hasMore && lastEntry
        ? encodeCursor({
            version,
            name: lastEntry.name,
            type: lastEntry.isDirectory() ? 'directory' : 'file',
          })
        : null,
    };
  }

  async function traverseProjectEntries(input: {
    canonicalProjectRoot: string;
    includeEntry: FileTreeEntryFilter;
    signal?: AbortSignal;
    onEntry: (result: FileTreeSearchResult) => void;
  }): Promise<void> {
    let pendingDirectories = [input.canonicalProjectRoot];
    const directoryConcurrency = Math.max(1, Math.min(8, concurrencyLimit));
    let visitedEntries = 0;

    while (pendingDirectories.length > 0) {
      throwIfAborted(input.signal);
      const currentDirectories = pendingDirectories;
      const nextDirectories: string[] = [];
      let nextDirectoryIndex = 0;

      const worker = async (): Promise<void> => {
        while (true) {
          throwIfAborted(input.signal);
          const directoryIndex = nextDirectoryIndex;
          nextDirectoryIndex += 1;
          if (directoryIndex >= currentDirectories.length) return;

          const directoryPath = currentDirectories[directoryIndex];
          let entries: FileTreeDirectoryEntry[];
          try {
            entries = await runFileSystemOperation(
              () => fileSystem.readdir(directoryPath),
              input.signal,
            );
          } catch (error) {
            if (isAbortError(error)) throw error;
            continue;
          }

          for (const entry of entries) {
            throwIfAborted(input.signal);
            visitedEntries += 1;
            if (visitedEntries % SEARCH_YIELD_INTERVAL === 0) {
              await new Promise<void>((resolve) => setImmediate(resolve));
              throwIfAborted(input.signal);
            }
            if (visitedEntries > SEARCH_VISIT_LIMIT) {
              throw createFileTreeError(
                `Project search exceeds the ${SEARCH_VISIT_LIMIT.toLocaleString()}-entry safety limit`,
                413,
                'FILE_TREE_SEARCH_LIMIT_EXCEEDED',
              );
            }

            const entryPath = path.join(directoryPath, entry.name);
            if (entry.isDirectory() && IGNORED_DIRECTORY_NAMES.has(entry.name)) continue;
            if (!input.includeEntry(entryPath, entry.isDirectory())) continue;
            const isSymbolicLink = entry.isSymbolicLink();
            if (isSymbolicLink
              && !await isEntryContained(input.canonicalProjectRoot, entryPath, entry, input.signal)) continue;

            const result: FileTreeSearchResult = {
              name: entry.name,
              path: entryPath,
              relativePath: path.relative(input.canonicalProjectRoot, entryPath).split(path.sep).join('/'),
              type: entry.isDirectory() ? 'directory' : 'file',
            };
            input.onEntry(result);

            const isForbiddenSystemDir = FORBIDDEN_WORKSPACE_PATHS.includes(
              normalizeProjectPath(entryPath),
            );
            // Only real descendants enter the queue; symlinked directories are never followed.
            if (entry.isDirectory() && !isSymbolicLink && !isForbiddenSystemDir) {
              nextDirectories.push(entryPath);
            }
          }
        }
      };

      await Promise.all(
        Array.from(
          { length: Math.min(directoryConcurrency, currentDirectories.length) },
          () => worker(),
        ),
      );
      pendingDirectories = nextDirectories;
    }
  }

  function readCachedSearchIndex(canonicalProjectRoot: string): FileTreeSearchIndex | null {
    const cachedIndex = searchIndexes.get(canonicalProjectRoot);
    if (!cachedIndex) return null;
    if (
      cachedIndex.generation !== searchIndexGeneration
      || Date.now() - cachedIndex.generatedAt > SEARCH_INDEX_TTL_MS
    ) {
      searchIndexes.delete(canonicalProjectRoot);
      return null;
    }

    searchIndexes.delete(canonicalProjectRoot);
    searchIndexes.set(canonicalProjectRoot, cachedIndex);
    return cachedIndex;
  }

  function storeSearchIndex(canonicalProjectRoot: string, index: FileTreeSearchIndex): void {
    if (index.generation !== searchIndexGeneration) return;
    const existingIndex = searchIndexes.get(canonicalProjectRoot);
    if (existingIndex?.generation === index.generation && existingIndex.sequence > index.sequence) {
      return;
    }
    searchIndexes.delete(canonicalProjectRoot);
    searchIndexes.set(canonicalProjectRoot, index);
    while (searchIndexes.size > SEARCH_INDEX_PROJECT_LIMIT) {
      const oldestProjectRoot = searchIndexes.keys().next().value as string | undefined;
      if (!oldestProjectRoot) break;
      searchIndexes.delete(oldestProjectRoot);
    }
  }

  async function buildSearchIndex(
    canonicalProjectRoot: string,
    generation: number,
    signal?: AbortSignal,
  ): Promise<FileTreeSearchIndex> {
    const sequence = searchIndexBuildSequence + 1;
    searchIndexBuildSequence = sequence;
    const results: FileTreeSearchResult[] = [];
    await traverseProjectEntries({
      canonicalProjectRoot,
      includeEntry: () => true,
      signal,
      onEntry: (result) => results.push(result),
    });
    results.sort(compareSearchResults);
    const includeGitignoredEntry = await readGitignoreFilter(
      canonicalProjectRoot,
      true,
      signal,
    );
    return {
      generation,
      sequence,
      generatedAt: Date.now(),
      results,
      searchKeys: results.map((result) => result.relativePath.toLowerCase()),
      gitignoreIncluded: results.map((result) => (
        includeGitignoredEntry(result.path, result.type === 'directory')
      )),
    };
  }

  async function waitForSearchIndex(
    promise: Promise<FileTreeSearchIndex>,
    signal?: AbortSignal,
  ): Promise<FileTreeSearchIndex> {
    throwIfAborted(signal);
    if (!signal) return promise;

    return new Promise<FileTreeSearchIndex>((resolve, reject) => {
      const onAbort = () => reject(new DOMException('File Tree request aborted', 'AbortError'));
      signal.addEventListener('abort', onAbort, { once: true });
      promise.then(
        (index) => {
          signal.removeEventListener('abort', onAbort);
          resolve(index);
        },
        (error: unknown) => {
          signal.removeEventListener('abort', onAbort);
          reject(error);
        },
      );
    });
  }

  function startSharedSearchIndexBuild(
    canonicalProjectRoot: string,
    warm = false,
  ): FileTreeSearchIndexBuild {
    const currentBuild = searchIndexBuilds.get(canonicalProjectRoot);
    if (currentBuild?.generation === searchIndexGeneration) {
      if (warm) currentBuild.warm = true;
      return currentBuild;
    }

    const generation = searchIndexGeneration;
    const controller = new AbortController();
    const build: FileTreeSearchIndexBuild = {
      controller,
      generation,
      promise: buildSearchIndex(canonicalProjectRoot, generation, controller.signal),
      subscribers: 0,
      warm,
    };
    searchIndexBuilds.set(canonicalProjectRoot, build);
    void build.promise.then(
      (index) => storeSearchIndex(canonicalProjectRoot, index),
      () => undefined,
    ).finally(() => {
      const latestBuild = searchIndexBuilds.get(canonicalProjectRoot);
      if (latestBuild === build) searchIndexBuilds.delete(canonicalProjectRoot);
    });
    return build;
  }

  async function subscribeToSearchIndexBuild(
    build: FileTreeSearchIndexBuild,
    signal?: AbortSignal,
  ): Promise<FileTreeSearchIndex> {
    build.subscribers += 1;
    try {
      return await waitForSearchIndex(build.promise, signal);
    } finally {
      build.subscribers = Math.max(0, build.subscribers - 1);
      if (build.subscribers === 0 && !build.warm) build.controller.abort();
    }
  }

  async function getSearchIndex(
    canonicalProjectRoot: string,
    signal?: AbortSignal,
    forceRefresh = false,
  ): Promise<FileTreeSearchIndex> {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      throwIfAborted(signal);
      const cachedIndex = forceRefresh ? null : readCachedSearchIndex(canonicalProjectRoot);
      if (cachedIndex) return cachedIndex;

      const generation = searchIndexGeneration;
      const index = forceRefresh
        ? await buildSearchIndex(canonicalProjectRoot, generation, signal)
        : await subscribeToSearchIndexBuild(
            startSharedSearchIndexBuild(canonicalProjectRoot),
            signal,
          );
      if (index.generation !== searchIndexGeneration) continue;
      storeSearchIndex(canonicalProjectRoot, index);
      return index;
    }

    throw createFileTreeError(
      'Project files changed repeatedly while the search index was loading',
      409,
      'FILE_TREE_INDEX_CHANGED',
    );
  }

  function warmSearchIndex(canonicalProjectRoot: string): void {
    if (readCachedSearchIndex(canonicalProjectRoot)) return;
    const build = startSharedSearchIndexBuild(canonicalProjectRoot, true);
    void build.promise.catch(() => undefined);
  }

  function invalidateSearchIndexes(): void {
    searchIndexGeneration += 1;
    searchIndexes.clear();
    for (const build of searchIndexBuilds.values()) {
      build.warm = false;
      if (build.subscribers === 0) build.controller.abort();
    }
  }

  async function findProjectMatches(input: {
    canonicalProjectRoot: string;
    target: string;
    signal?: AbortSignal;
  }): Promise<{ suffix: FileTreeSearchResult[]; basename: FileTreeSearchResult[] }> {
    const suffix: FileTreeSearchResult[] = [];
    const basename: FileTreeSearchResult[] = [];
    const target = input.target.replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+/, '');
    const targetBasename = target.split('/').pop() ?? target;
    const searchIndex = await getSearchIndex(input.canonicalProjectRoot, input.signal);
    for (const result of searchIndex.results) {
      throwIfAborted(input.signal);
      if (result.type !== 'file') continue;
      if (target.includes('/') && result.relativePath.endsWith(`/${target}`)) {
        if (suffix.length < AMBIGUOUS_MATCH_LIMIT) suffix.push(result);
      }
      if (result.name === targetBasename && basename.length < AMBIGUOUS_MATCH_LIMIT) {
        basename.push(result);
      }
    }
    return { suffix, basename };
  }

  async function cleanupTemporaryFiles(files: FileTreeUploadedFile[]): Promise<void> {
    await Promise.all(files.map(async (file) => {
      try {
        await fileSystem.unlink(file.temporaryPath);
      } catch {
        // A successfully moved file no longer has a temporary source to clean.
      }
    }));
  }

  return {
    async browseWorkspace(inputPath) {
      const requestedPath = inputPath
        ? expandWorkspacePath(dependencies.workspace.rootPath, inputPath)
        : dependencies.workspace.rootPath;
      const targetPath = path.resolve(requestedPath);
      const validation = await dependencies.workspace.validatePath(targetPath);
      if (!validation.valid) {
        throw createFileTreeError(validation.error ?? 'Path is outside the workspace root', 403, 'INVALID_WORKSPACE_PATH');
      }

      const resolvedPath = validation.resolvedPath || targetPath;
      try {
        await fileSystem.access(resolvedPath);
        const stats = await fileSystem.stat(resolvedPath);
        if (!stats.isDirectory()) {
          throw createFileTreeError('Path is not a directory', 400, 'NOT_A_DIRECTORY');
        }
      } catch (error) {
        if (error instanceof AppError) throw error;
        throw createFileTreeError('Directory not accessible', 404, 'DIRECTORY_NOT_ACCESSIBLE');
      }

      const fileTree = await buildFileTree(resolvedPath, 1);
      const directories = fileTree
        .filter((item) => item.type === 'directory')
        .map((item) => ({ path: item.path, name: item.name, type: 'directory' as const }))
        .sort((left, right) => {
          const leftHidden = left.name.startsWith('.');
          const rightHidden = right.name.startsWith('.');
          if (leftHidden && !rightHidden) return 1;
          if (!leftHidden && rightHidden) return -1;
          return left.name.localeCompare(right.name);
        });

      let resolvedWorkspaceRoot = dependencies.workspace.rootPath;
      try {
        resolvedWorkspaceRoot = await fileSystem.realpath(dependencies.workspace.rootPath);
      } catch {
        // The configured workspace root remains the comparison fallback.
      }

      const suggestions = resolvedPath === resolvedWorkspaceRoot
        ? [
            ...directories.filter((directory) => COMMON_WORKSPACE_DIRECTORY_NAMES.includes(directory.name)),
            ...directories.filter((directory) => !COMMON_WORKSPACE_DIRECTORY_NAMES.includes(directory.name)),
          ]
        : directories;

      return { path: resolvedPath, suggestions };
    },

    async createWorkspaceFolder(folderPath) {
      const expandedPath = expandWorkspacePath(dependencies.workspace.rootPath, folderPath);
      const resolvedInput = path.resolve(expandedPath);
      const validation = await dependencies.workspace.validatePath(resolvedInput);
      if (!validation.valid) {
        throw createFileTreeError(validation.error ?? 'Path is outside the workspace root', 403, 'INVALID_WORKSPACE_PATH');
      }

      const targetPath = validation.resolvedPath || resolvedInput;
      try {
        await fileSystem.access(path.dirname(targetPath));
      } catch {
        throw createFileTreeError('Parent directory does not exist', 404, 'PARENT_DIRECTORY_NOT_FOUND');
      }

      try {
        await fileSystem.access(targetPath);
        throw createFileTreeError('Folder already exists', 409, 'FOLDER_ALREADY_EXISTS');
      } catch (error) {
        if (error instanceof AppError) throw error;
      }

      try {
        await fileSystem.makeDirectory(targetPath, false);
      } catch (error) {
        mapFileSystemError(error, {
          EEXIST: { message: 'Folder already exists', statusCode: 409 },
        });
      }

      return { success: true, path: targetPath };
    },

    async readTextFile(projectId, filePath) {
      const projectRoot = await resolveCanonicalProjectRoot(projectId);
      const resolvedPath = await resolveExistingReadablePath(projectRoot, filePath);
      try {
        const content = await fileSystem.readTextFile(resolvedPath);
        return { content, path: resolvedPath };
      } catch (error) {
        mapFileSystemError(error, {
          ENOENT: { message: 'File not found', statusCode: 404 },
          EACCES: { message: 'Permission denied', statusCode: 403 },
        });
      }
    },

    async openFile(projectId, filePath) {
      const projectRoot = await resolveCanonicalProjectRoot(projectId);
      const resolvedPath = await resolveExistingReadablePath(projectRoot, filePath);
      try {
        await fileSystem.access(resolvedPath);
      } catch {
        throw createFileTreeError('File not found', 404, 'FILE_NOT_FOUND');
      }

      return {
        contentType: dependencies.resolveMimeType(resolvedPath),
        stream: fileSystem.createReadStream(resolvedPath),
      };
    },

    async saveTextFile(projectId, filePath, content) {
      const projectRoot = await resolveCanonicalProjectRoot(projectId);
      const resolvedPath = await resolveCreatablePathInsideProject(projectRoot, filePath);
      try {
        await fileSystem.writeTextFile(resolvedPath, content);
      } catch (error) {
        mapFileSystemError(error, {
          ENOENT: { message: 'File or directory not found', statusCode: 404 },
          EACCES: { message: 'Permission denied', statusCode: 403 },
        });
      }

      invalidateSearchIndexes();
      return { success: true, path: resolvedPath, message: 'File saved successfully' };
    },

    async listProjectFiles(projectId, options) {
      const projectRoot = await resolveCanonicalProjectRoot(projectId, options?.signal);
      const includeEntry = await readGitignoreFilter(
        projectRoot,
        options?.respectGitignore ?? false,
        options?.signal,
      );
      return buildFileTree(
        projectRoot,
        10,
        0,
        includeEntry,
        options?.signal,
        { entryCount: 0, maximumEntries: LEGACY_TREE_ENTRY_LIMIT },
        false,
        projectRoot,
      );
    },

    async listDirectory(input) {
      const projectRoot = await resolveCanonicalProjectRoot(input.projectId, input.signal);
      const requestedDirectory = input.directoryPath || projectRoot;
      const directoryPath = await resolveExistingDirectoryInsideProject(
        projectRoot,
        requestedDirectory,
        input.signal,
      );
      const includeEntry = await readGitignoreFilter(
        projectRoot,
        input.respectGitignore,
        input.signal,
      );
      const page = await collectDirectoryPage({
        canonicalProjectRoot: projectRoot,
        directoryPath,
        cursor: input.cursor,
        limit: input.limit,
        includeEntry,
        signal: input.signal,
      });
      if (directoryPath === projectRoot && !input.cursor) warmSearchIndex(projectRoot);
      return {
        directoryPath,
        relativePath: path.relative(projectRoot, directoryPath).split(path.sep).join('/'),
        ...page,
      };
    },

    async searchProjectFiles(input) {
      const query = input.query.trim().toLowerCase();
      if (!query) return { results: [], nextCursor: null };

      const decodedCursor = decodeCursor(input.cursor);
      const after = decodedCursor?.after;
      if (decodedCursor && (
        typeof after !== 'string'
        || decodedCursor.query !== query
        || decodedCursor.entryType !== input.entryType
        || decodedCursor.respectGitignore !== Number(input.respectGitignore)
      )) {
        throw createFileTreeError('Invalid pagination cursor', 400, 'INVALID_FILE_TREE_CURSOR');
      }

      const projectRoot = await resolveCanonicalProjectRoot(input.projectId, input.signal);
      const retained: FileTreeSearchResult[] = [];
      const searchIndex = await getSearchIndex(projectRoot, input.signal, input.refreshIndex);
      for (let index = 0; index < searchIndex.results.length; index += 1) {
        throwIfAborted(input.signal);
        const result = searchIndex.results[index];
        if (input.entryType === 'file' && result.type !== 'file') continue;
        if (!searchIndex.searchKeys[index].includes(query)) continue;
        if (input.respectGitignore && !searchIndex.gitignoreIncluded[index]) continue;
        if (typeof after === 'string') {
          const cursorResult = { ...result, relativePath: after };
          if (compareSearchResults(result, cursorResult) <= 0) continue;
        }
        retained.push(result);
        if (retained.length > input.limit) break;
      }

      const hasMore = retained.length > input.limit;
      const results = retained.slice(0, input.limit);
      const lastResult = results.at(-1);
      return {
        results,
        nextCursor: hasMore && lastResult
          ? encodeCursor({
              after: lastResult.relativePath,
              query,
              entryType: input.entryType,
              respectGitignore: Number(input.respectGitignore),
            })
          : null,
      };
    },

    async resolveProjectFile(input) {
      const fileReference = input.fileReference.trim();
      if (!fileReference) return { status: 'not-found', matches: [] };
      const projectRoot = await resolveCanonicalProjectRoot(input.projectId, input.signal);

      const exactCandidate = path.isAbsolute(fileReference)
        ? fileReference
        : path.resolve(projectRoot, fileReference.replace(/^\.\//, ''));
      try {
        const exactPath = await resolveExistingReadablePath(
          projectRoot,
          exactCandidate,
          input.signal,
        );
        const stats = await runFileSystemOperation(() => fileSystem.stat(exactPath), input.signal);
        if (!stats.isDirectory()) {
          return {
            status: 'resolved',
            match: {
              name: path.basename(exactPath),
              path: exactPath,
              relativePath: toProjectRelativePath(projectRoot, exactPath),
              type: 'file',
            },
          };
        }
      } catch (error) {
        if (isAbortError(error)) throw error;
        const isMissing = readErrorCode(error) === 'ENOENT'
          || (error instanceof AppError && error.statusCode === 404);
        if (!isMissing) throw error;
      }

      if (path.isAbsolute(fileReference)) {
        return { status: 'not-found', matches: [] };
      }

      const matches = await findProjectMatches({
        canonicalProjectRoot: projectRoot,
        target: fileReference,
        signal: input.signal,
      });
      const orderedMatches = matches.suffix.length > 0 ? matches.suffix : matches.basename;
      if (orderedMatches.length === 0) return { status: 'not-found', matches: [] };
      if (orderedMatches.length === 1) return { status: 'resolved', match: orderedMatches[0] };
      return { status: 'ambiguous', matches: orderedMatches };
    },

    async listProjectSubtree(input) {
      const projectRoot = await resolveCanonicalProjectRoot(input.projectId, input.signal);
      const directoryPath = await resolveExistingDirectoryInsideProject(
        projectRoot,
        input.directoryPath,
        input.signal,
      );
      return buildFileTree(
        directoryPath,
        Number.POSITIVE_INFINITY,
        0,
        () => true,
        input.signal,
        { entryCount: 0, maximumEntries: SUBTREE_ENTRY_LIMIT },
        true,
        projectRoot,
      );
    },

    async createEntry(input) {
      validateFilename(input.name);
      const projectRoot = await resolveCanonicalProjectRoot(input.projectId);
      const targetPath = input.parentPath
        ? path.join(input.parentPath, input.name)
        : input.name;
      const resolvedPath = await resolveEntryPathInsideProject(projectRoot, targetPath);

      try {
        await fileSystem.access(resolvedPath);
        throw createFileTreeError(
          `${input.type === 'file' ? 'File' : 'Directory'} already exists`,
          409,
          'FILE_TREE_ENTRY_EXISTS',
        );
      } catch (error) {
        if (error instanceof AppError) throw error;
      }

      try {
        if (input.type === 'directory') {
          await fileSystem.makeDirectory(resolvedPath, false);
        } else {
          const parentDirectory = path.dirname(resolvedPath);
          try {
            await fileSystem.access(parentDirectory);
          } catch {
            await fileSystem.makeDirectory(parentDirectory, true);
          }
          await fileSystem.writeTextFile(resolvedPath, '');
        }
      } catch (error) {
        mapFileSystemError(error, {
          EACCES: { message: 'Permission denied', statusCode: 403 },
          ENOENT: { message: 'Parent directory not found', statusCode: 404 },
        });
      }

      invalidateSearchIndexes();
      return {
        success: true,
        path: resolvedPath,
        name: input.name,
        type: input.type,
        message: `${input.type === 'file' ? 'File' : 'Directory'} created successfully`,
      };
    },

    async renameEntry(input) {
      validateFilename(input.newName);
      const projectRoot = await resolveCanonicalProjectRoot(input.projectId);
      const resolvedOldPath = await resolveEntryPathInsideProject(projectRoot, input.oldPath);

      try {
        await fileSystem.access(resolvedOldPath);
      } catch {
        throw createFileTreeError('File or directory not found', 404, 'FILE_TREE_ENTRY_NOT_FOUND');
      }

      const resolvedNewPath = await resolveEntryPathInsideProject(
        projectRoot,
        path.join(path.dirname(resolvedOldPath), input.newName),
      );
      try {
        await fileSystem.access(resolvedNewPath);
        throw createFileTreeError(
          'A file or directory with this name already exists',
          409,
          'FILE_TREE_ENTRY_EXISTS',
        );
      } catch (error) {
        if (error instanceof AppError) throw error;
      }

      try {
        await fileSystem.rename(resolvedOldPath, resolvedNewPath);
      } catch (error) {
        mapFileSystemError(error, {
          EACCES: { message: 'Permission denied', statusCode: 403 },
          ENOENT: { message: 'File or directory not found', statusCode: 404 },
          EXDEV: { message: 'Cannot move across different filesystems', statusCode: 400 },
        });
      }

      invalidateSearchIndexes();
      return {
        success: true,
        oldPath: resolvedOldPath,
        newPath: resolvedNewPath,
        newName: input.newName,
        message: 'Renamed successfully',
      };
    },

    async moveEntries(input) {
      const projectRoot = await resolveCanonicalProjectRoot(input.projectId);
      const result = await moveFilesIntoDirectory({
        projectRoot,
        sourcePaths: input.sourcePaths,
        destinationPath: input.destinationPath,
      });
      invalidateSearchIndexes();
      return result;
    },

    async deleteEntry(input) {
      const projectRoot = await resolveCanonicalProjectRoot(input.projectId);
      const resolvedPath = await resolveEntryPathInsideProject(projectRoot, input.targetPath);
      let stats;
      try {
        stats = await fileSystem.stat(resolvedPath);
      } catch {
        throw createFileTreeError('File or directory not found', 404, 'FILE_TREE_ENTRY_NOT_FOUND');
      }

      if (resolvedPath === path.resolve(projectRoot)) {
        throw createFileTreeError('Cannot delete project root directory', 403, 'PROJECT_ROOT_DELETE_FORBIDDEN');
      }

      try {
        if (stats.isDirectory()) {
          await fileSystem.removeDirectory(resolvedPath);
        } else {
          await fileSystem.unlink(resolvedPath);
        }
      } catch (error) {
        mapFileSystemError(error, {
          EACCES: { message: 'Permission denied', statusCode: 403 },
          ENOENT: { message: 'File or directory not found', statusCode: 404 },
          ENOTEMPTY: { message: 'Directory is not empty', statusCode: 400 },
        });
      }

      invalidateSearchIndexes();
      const entryType = stats.isDirectory() ? 'directory' as const : 'file' as const;
      return {
        success: true,
        path: resolvedPath,
        type: entryType,
        message: 'Deleted successfully',
      };
    },

    async storeUploadedFiles(input) {
      if (input.files.length === 0) {
        throw createFileTreeError('No files provided', 400, 'UPLOAD_FILES_REQUIRED');
      }

      try {
        const projectRoot = await resolveCanonicalProjectRoot(input.projectId);
        const resolvedTargetDirectory = !input.targetPath
          || input.targetPath === '.'
          || input.targetPath === './'
          ? path.resolve(projectRoot)
          : await resolveCreatablePathInsideProject(projectRoot, input.targetPath);

        try {
          await fileSystem.access(resolvedTargetDirectory);
        } catch {
          await fileSystem.makeDirectory(resolvedTargetDirectory, true);
        }

        const uploadedFiles: Array<{ name: string; path: string; size: number; mimeType: string }> = [];
        for (let fileIndex = 0; fileIndex < input.files.length; fileIndex += 1) {
          const file = input.files[fileIndex];
          const fileName = input.relativePaths[fileIndex] || file.originalName;
          const destinationPath = await resolveCreatablePathInsideProject(
            projectRoot,
            path.join(resolvedTargetDirectory, fileName),
          );

          const parentDirectory = path.dirname(destinationPath);
          try {
            await fileSystem.access(parentDirectory);
          } catch {
            await fileSystem.makeDirectory(parentDirectory, true);
          }

          await fileSystem.copyFile(file.temporaryPath, destinationPath);
          await fileSystem.unlink(file.temporaryPath);
          uploadedFiles.push({
            name: fileName,
            path: destinationPath,
            size: file.size,
            mimeType: file.mimeType,
          });
        }

        if (uploadedFiles.length > 0) invalidateSearchIndexes();
        return {
          success: true,
          files: uploadedFiles,
          uploadedCount: uploadedFiles.length,
          requestedFileCount: input.requestedFileCount,
          targetPath: resolvedTargetDirectory,
          message: `Uploaded ${uploadedFiles.length} ${uploadedFiles.length === 1 ? 'file' : 'files'} successfully`,
        };
      } catch (error) {
        await cleanupTemporaryFiles(input.files);
        if (readErrorCode(error) === 'EACCES') {
          throw createFileTreeError('Permission denied', 403, 'EACCES');
        }
        if (error instanceof AppError) throw error;
        dependencies.logger.error(`Error uploading files: ${readErrorMessage(error)}`, error);
        throw error;
      }
    },
  };
}
