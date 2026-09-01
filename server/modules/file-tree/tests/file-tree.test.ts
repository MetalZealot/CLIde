import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { Readable } from 'node:stream';
import test, { describe } from 'node:test';

import express, { type RequestHandler } from 'express';

import { createFileTreeRouter } from '@/modules/file-tree/file-tree.routes.js';
import { createFileTreeService } from '@/modules/file-tree/file-tree.service.js';
import type {
  FileTreeDirectoryEntry,
  FileTreeFileSystem,
  FileTreeServiceDependencies,
  FileTreeServices,
  FileTreeStats,
} from '@/shared/types.js';
import { AppError } from '@/shared/utils.js';

describe('file-tree.service', () => {
  function createDirectoryEntry(
    name: string,
    directory: boolean,
    symbolicLink = false,
  ): FileTreeDirectoryEntry {
    return {
      name,
      isDirectory: () => directory,
      isSymbolicLink: () => symbolicLink,
    };
  }

  function createStats(directory: boolean, mode: number): FileTreeStats {
    return {
      size: directory ? 0 : 24,
      mtime: new Date('2026-01-02T03:04:05.000Z'),
      mode,
      isDirectory: () => directory,
      isSymbolicLink: () => false,
    };
  }

  function createFakeFileSystem(
    overrides: Partial<FileTreeFileSystem> = {},
  ): FileTreeFileSystem {
    const unexpectedOperation = async (): Promise<never> => {
      throw new Error('Unexpected File Tree filesystem operation');
    };

    const readDirectory = overrides.readdir ?? unexpectedOperation;
    const openDirectory = overrides.openDirectory ?? (async (directoryPath: string) => {
      const entries = await readDirectory(directoryPath);
      let index = 0;
      return {
        read: async () => entries[index++] ?? null,
        close: async () => undefined,
      };
    });

    return {
      access: unexpectedOperation,
      stat: unexpectedOperation,
      lstat: unexpectedOperation,
      readdir: readDirectory,
      openDirectory,
      realpath: async (candidatePath) => candidatePath,
      readTextFile: unexpectedOperation,
      writeTextFile: unexpectedOperation,
      makeDirectory: unexpectedOperation,
      rename: unexpectedOperation,
      removeDirectory: unexpectedOperation,
      unlink: unexpectedOperation,
      copyFile: unexpectedOperation,
      createReadStream: () => Readable.from([]),
      ...overrides,
    };
  }

  function createDependencies(
    fileSystem: FileTreeFileSystem,
    projectRoot: string,
  ): FileTreeServiceDependencies {
    return {
      fileSystem,
      projects: {
        getProjectPathById: async () => projectRoot,
      },
      workspace: {
        rootPath: projectRoot,
        validatePath: async (candidatePath) => ({ valid: true, resolvedPath: candidatePath }),
      },
      resolveMimeType: () => 'text/plain',
      fileSystemConcurrency: 4,
      logger: { error: () => undefined },
    };
  }

  test('listProjectFiles builds a sorted tree and skips generated directories', async () => {
    const projectRoot = path.resolve('file-tree-test-project');
    const sourceDirectory = path.join(projectRoot, 'src');
    const fileSystem = createFakeFileSystem({
      access: async () => undefined,
      readdir: async (directoryPath) => {
        if (directoryPath === projectRoot) {
          return [
            createDirectoryEntry('node_modules', true),
            createDirectoryEntry('README.md', false),
            createDirectoryEntry('src', true),
          ];
        }
        if (directoryPath === sourceDirectory) {
          return [createDirectoryEntry('index.ts', false)];
        }
        return [];
      },
      lstat: async (candidatePath) => createStats(candidatePath === sourceDirectory, 0o754),
    });
    const service = createFileTreeService(createDependencies(fileSystem, projectRoot));

    const tree = await service.listProjectFiles('project-1');

    assert.deepEqual(tree.map((entry) => entry.name), ['src', 'README.md']);
    const sourceEntry = tree[0];
    assert.ok(sourceEntry);
    assert.equal(sourceEntry.type, 'directory');
    assert.equal(sourceEntry.permissions, '754');
    assert.equal(sourceEntry.permissionsRwx, 'rwxr-xr--');
    assert.deepEqual(sourceEntry.children?.map((entry) => entry.name), ['index.ts']);
  });

  test('listProjectFiles excludes gitignored entries only when requested', async () => {
    const projectRoot = path.resolve('file-tree-test-project');
    const cacheDirectory = path.join(projectRoot, 'cache');
    const sourceDirectory = path.join(projectRoot, 'src');
    const readDirectories: string[] = [];
    const fileSystem = createFakeFileSystem({
      access: async () => undefined,
      readTextFile: async (filePath) => {
        assert.equal(filePath, path.join(projectRoot, '.gitignore'));
        return ['*.log', '!keep.log', 'cache/', 'src/generated.ts'].join('\n');
      },
      readdir: async (directoryPath) => {
        readDirectories.push(directoryPath);
        if (directoryPath === projectRoot) {
          return [
            createDirectoryEntry('.gitignore', false),
            createDirectoryEntry('cache', true),
            createDirectoryEntry('ignored.log', false),
            createDirectoryEntry('keep.log', false),
            createDirectoryEntry('src', true),
          ];
        }
        if (directoryPath === cacheDirectory) {
          return [createDirectoryEntry('cached.txt', false)];
        }
        if (directoryPath === sourceDirectory) {
          return [
            createDirectoryEntry('generated.ts', false),
            createDirectoryEntry('index.ts', false),
          ];
        }
        return [];
      },
      lstat: async (candidatePath) => createStats(
        candidatePath === cacheDirectory || candidatePath === sourceDirectory,
        0o644,
      ),
    });
    const service = createFileTreeService(createDependencies(fileSystem, projectRoot));

    const tree = await service.listProjectFiles('project-1', { respectGitignore: true });

    assert.deepEqual(tree.map((entry) => entry.name), ['src', '.gitignore', 'keep.log']);
    assert.deepEqual(tree[0]?.children?.map((entry) => entry.name), ['index.ts']);
    assert.equal(readDirectories.includes(cacheDirectory), false);
  });

  test('listProjectFiles returns the normal tree when no gitignore exists', async () => {
    const projectRoot = path.resolve('file-tree-test-project');
    const fileSystem = createFakeFileSystem({
      access: async () => undefined,
      readTextFile: async () => {
        throw Object.assign(new Error('missing'), { code: 'ENOENT' });
      },
      readdir: async (directoryPath) => directoryPath === projectRoot
        ? [createDirectoryEntry('debug.log', false)]
        : [],
      lstat: async () => createStats(false, 0o644),
    });
    const service = createFileTreeService(createDependencies(fileSystem, projectRoot));

    const tree = await service.listProjectFiles('project-1', { respectGitignore: true });

    assert.deepEqual(tree.map((entry) => entry.name), ['debug.log']);
  });

  test('readTextFile rejects traversal before invoking the filesystem adapter', async () => {
    const projectRoot = path.resolve('file-tree-test-project');
    const readPaths: string[] = [];
    const fileSystem = createFakeFileSystem({
      readTextFile: async (filePath) => {
        readPaths.push(filePath);
        return 'should not be read';
      },
    });
    const service = createFileTreeService(createDependencies(fileSystem, projectRoot));

    await assert.rejects(
      service.readTextFile('project-1', '../secret.txt'),
      (error: unknown) => error instanceof AppError
        && error.code === 'PATH_OUTSIDE_PROJECT'
        && error.statusCode === 403,
    );
    assert.deepEqual(readPaths, []);
  });

  test('createEntry performs filesystem mutation only through the injected adapter', async () => {
    const projectRoot = path.resolve('file-tree-test-project');
    const targetPath = path.join(projectRoot, 'notes.txt');
    const writtenFiles: Array<{ filePath: string; content: string }> = [];
    const fileSystem = createFakeFileSystem({
      stat: async () => createStats(true, 0o755),
      access: async (candidatePath) => {
        if (candidatePath === targetPath) {
          throw Object.assign(new Error('missing'), { code: 'ENOENT' });
        }
      },
      writeTextFile: async (filePath, content) => {
        writtenFiles.push({ filePath, content });
      },
    });
    const service = createFileTreeService(createDependencies(fileSystem, projectRoot));

    const result = await service.createEntry({
      projectId: 'project-1',
      parentPath: projectRoot,
      type: 'file',
      name: 'notes.txt',
    });

    assert.equal(result.path, targetPath);
    assert.deepEqual(writtenFiles, [{ filePath: targetPath, content: '' }]);
  });

  test('listProjectFiles does not recurse into system directories, but does into a project\'s own proc/', async () => {
    const readDirectories: string[] = [];
    const makeFileSystem = (projectRoot: string, procPath: string) =>
      createFakeFileSystem({
        access: async () => undefined,
        readdir: async (directoryPath) => {
          readDirectories.push(directoryPath);
          if (directoryPath === projectRoot) {
            return [createDirectoryEntry('proc', true)];
          }
          if (directoryPath === procPath) {
            return [createDirectoryEntry('inside.txt', false)];
          }
          return [];
        },
        lstat: async (candidatePath) => createStats(candidatePath === procPath, 0o755),
      });

    const systemProc = path.join('/', 'proc');
    const systemService = createFileTreeService(
      createDependencies(makeFileSystem('/', systemProc), '/'),
    );
    const systemTree = await systemService.listProjectFiles('project-root');

    assert.deepEqual(systemTree.map((entry) => entry.name), ['proc']);
    assert.equal(systemTree[0]?.children, undefined);
    assert.equal(readDirectories.includes(systemProc), false);

    readDirectories.length = 0;
    const projectRoot = path.resolve('file-tree-test-project');
    const projectProc = path.join(projectRoot, 'proc');
    const projectService = createFileTreeService(
      createDependencies(makeFileSystem(projectRoot, projectProc), projectRoot),
    );
    const projectTree = await projectService.listProjectFiles('project-1');

    assert.equal(readDirectories.includes(projectProc), true);
    assert.deepEqual(projectTree[0]?.children?.map((entry) => entry.name), ['inside.txt']);
  });

  test('listDirectory paginates one shallow directory with a stable bounded response', async () => {
    const projectRoot = path.resolve('file-tree-test-project');
    const entries = Array.from({ length: 205 }, (_, index) =>
      createDirectoryEntry(`file-${String(index).padStart(3, '0')}.txt`, false));
    let metadataReads = 0;
    const fileSystem = createFakeFileSystem({
      stat: async () => createStats(true, 0o755),
      readdir: async () => entries,
      lstat: async () => {
        metadataReads += 1;
        return createStats(false, 0o644);
      },
    });
    const service = createFileTreeService(createDependencies(fileSystem, projectRoot));

    const first = await service.listDirectory({
      projectId: 'project-1',
      directoryPath: '',
      cursor: null,
      limit: 200,
      respectGitignore: false,
    });
    assert.equal(first.entries.length, 200);
    assert.ok(first.nextCursor);
    assert.equal(metadataReads, 200);

    const second = await service.listDirectory({
      projectId: 'project-1',
      directoryPath: '',
      cursor: first.nextCursor,
      limit: 200,
      respectGitignore: false,
    });
    assert.equal(second.entries.length, 5);
    assert.equal(second.nextCursor, null);
    assert.equal(metadataReads, 205);
  });

  test('listDirectory keeps a bounded page without re-sorting it for every entry', async () => {
    const projectRoot = path.resolve('file-tree-test-project');
    let typeChecks = 0;
    const entries = Array.from({ length: 5_000 }, (_, index) => ({
      name: `file-${String(index).padStart(5, '0')}.txt`,
      isDirectory: () => {
        typeChecks += 1;
        return false;
      },
      isSymbolicLink: () => false,
    }));
    const fileSystem = createFakeFileSystem({
      stat: async () => createStats(true, 0o755),
      readdir: async () => entries,
      lstat: async () => createStats(false, 0o644),
    });
    const service = createFileTreeService(createDependencies(fileSystem, projectRoot));

    const page = await service.listDirectory({
      projectId: 'project-1',
      directoryPath: '',
      cursor: null,
      limit: 200,
      respectGitignore: false,
    });

    assert.equal(page.entries.length, 200);
    assert.ok(page.nextCursor);
    assert.ok(typeChecks < 100_000, `directory ordering performed ${typeChecks} type checks`);
  });

  test('listDirectory rejects a symlinked directory whose real path escapes the project', async () => {
    const projectRoot = path.resolve('file-tree-test-project');
    const linkedDirectory = path.join(projectRoot, 'outside-link');
    let opened = false;
    const fileSystem = createFakeFileSystem({
      realpath: async (candidatePath) => candidatePath === linkedDirectory
        ? path.resolve('outside-project')
        : candidatePath,
      stat: async () => createStats(true, 0o755),
      openDirectory: async () => {
        opened = true;
        throw new Error('escaped directory must not be opened');
      },
    });
    const service = createFileTreeService(createDependencies(fileSystem, projectRoot));

    await assert.rejects(
      service.listDirectory({
        projectId: 'project-1',
        directoryPath: linkedDirectory,
        cursor: null,
        limit: 200,
        respectGitignore: false,
      }),
      (error: unknown) => error instanceof AppError && error.code === 'PATH_OUTSIDE_PROJECT',
    );
    assert.equal(opened, false);
  });

  test('project search returns absolute and project-relative paths with entry types', async () => {
    const projectRoot = path.resolve('file-tree-test-project');
    const sourceDirectory = path.join(projectRoot, 'src');
    const fileSystem = createFakeFileSystem({
      stat: async () => createStats(true, 0o755),
      readdir: async (directoryPath) => directoryPath === projectRoot
        ? [createDirectoryEntry('src', true), createDirectoryEntry('README.md', false)]
        : directoryPath === sourceDirectory
          ? [createDirectoryEntry('index.ts', false)]
          : [],
    });
    const service = createFileTreeService(createDependencies(fileSystem, projectRoot));

    const page = await service.searchProjectFiles({
      projectId: 'project-1',
      query: 'index',
      cursor: null,
      limit: 100,
      entryType: 'all',
      respectGitignore: false,
    });

    assert.deepEqual(page.results, [{
      name: 'index.ts',
      path: path.join(sourceDirectory, 'index.ts'),
      relativePath: 'src/index.ts',
      type: 'file',
    }]);
  });

  test('project search reuses lowercase paths and gitignore verdicts from the shared index', async () => {
    const projectRoot = path.resolve('file-tree-test-project');
    let gitignoreReads = 0;
    const fileSystem = createFakeFileSystem({
      readdir: async () => [
        createDirectoryEntry('README.md', false),
        createDirectoryEntry('ignored.txt', false),
      ],
      readTextFile: async (candidatePath) => {
        assert.equal(candidatePath, path.join(projectRoot, '.gitignore'));
        gitignoreReads += 1;
        return 'ignored.txt\n';
      },
    });
    const service = createFileTreeService(createDependencies(fileSystem, projectRoot));

    const first = await service.searchProjectFiles({
      projectId: 'project-1',
      query: 'readme',
      cursor: null,
      limit: 100,
      entryType: 'file',
      respectGitignore: true,
    });
    const second = await service.searchProjectFiles({
      projectId: 'project-1',
      query: 'ignored',
      cursor: null,
      limit: 100,
      entryType: 'file',
      respectGitignore: true,
    });

    assert.equal(first.results[0]?.relativePath, 'README.md');
    assert.deepEqual(second.results, []);
    assert.equal(gitignoreReads, 1);
  });

  test('concurrent search callers share one build while cancellation stays request-scoped', async () => {
    const projectRoot = path.resolve('file-tree-test-project');
    let releaseRead: (() => void) | undefined;
    const readBarrier = new Promise<void>((resolve) => { releaseRead = resolve; });
    let indexReads = 0;
    const fileSystem = createFakeFileSystem({
      readdir: async () => {
        indexReads += 1;
        await readBarrier;
        return [createDirectoryEntry('README.md', false)];
      },
    });
    const service = createFileTreeService(createDependencies(fileSystem, projectRoot));
    const firstController = new AbortController();
    const secondController = new AbortController();
    const searchInput = {
      projectId: 'project-1',
      query: 'readme',
      entryType: 'file' as const,
      cursor: null,
      limit: 100,
      respectGitignore: false,
    };

    const firstSearch = service.searchProjectFiles({
      ...searchInput,
      signal: firstController.signal,
    });
    const secondSearch = service.searchProjectFiles({
      ...searchInput,
      signal: secondController.signal,
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    firstController.abort();
    releaseRead?.();

    await assert.rejects(
      firstSearch,
      (error: unknown) => error instanceof Error && error.name === 'AbortError',
    );
    const secondPage = await secondSearch;
    assert.equal(indexReads, 1);
    assert.equal(secondPage.results[0]?.relativePath, 'README.md');
  });

  test('search yields so cancellation can interrupt one very wide directory', async () => {
    const projectRoot = path.resolve('file-tree-test-project');
    const controller = new AbortController();
    const fileSystem = createFakeFileSystem({
      readdir: async () => Array.from(
        { length: 10_000 },
        (_, index) => createDirectoryEntry(`file-${index}.txt`, false),
      ),
    });
    const service = createFileTreeService(createDependencies(fileSystem, projectRoot));

    const search = service.searchProjectFiles({
      projectId: 'project-1',
      query: 'file',
      entryType: 'file',
      cursor: null,
      limit: 100,
      respectGitignore: false,
      signal: controller.signal,
    });
    setImmediate(() => controller.abort());

    await assert.rejects(
      search,
      (error: unknown) => error instanceof Error && error.name === 'AbortError',
    );
  });

  test('continuous mutations bound one search request to two index attempts', async () => {
    const projectRoot = path.resolve('file-tree-test-project');
    let indexReads = 0;
    let service: FileTreeServices;
    const fileSystem = createFakeFileSystem({
      readdir: async () => {
        indexReads += 1;
        await service.saveTextFile('project-1', 'README.md', `revision ${indexReads}`);
        return [createDirectoryEntry('README.md', false)];
      },
      writeTextFile: async () => undefined,
    });
    service = createFileTreeService(createDependencies(fileSystem, projectRoot));

    await assert.rejects(
      service.searchProjectFiles({
        projectId: 'project-1',
        query: 'readme',
        entryType: 'file',
        cursor: null,
        limit: 100,
        respectGitignore: false,
      }),
      (error: unknown) => error instanceof AppError && error.code === 'FILE_TREE_INDEX_CHANGED',
    );
    assert.equal(indexReads, 2);
  });

  test('read and save use the canonical root returned by directory browsing', async () => {
    const storedProjectRoot = path.resolve('file-tree-linked-project');
    const canonicalProjectRoot = path.resolve('file-tree-canonical-project');
    const canonicalFilePath = path.join(canonicalProjectRoot, 'README.md');
    const writes: Array<{ path: string; content: string }> = [];
    const fileSystem = createFakeFileSystem({
      realpath: async (candidatePath) => candidatePath === storedProjectRoot
        ? canonicalProjectRoot
        : candidatePath,
      readTextFile: async (candidatePath) => {
        assert.equal(candidatePath, canonicalFilePath);
        return 'hello';
      },
      writeTextFile: async (candidatePath, content) => {
        writes.push({ path: candidatePath, content });
      },
    });
    const service = createFileTreeService(createDependencies(fileSystem, storedProjectRoot));

    const read = await service.readTextFile('project-1', canonicalFilePath);
    const saved = await service.saveTextFile('project-1', canonicalFilePath, 'updated');

    assert.equal(read.path, canonicalFilePath);
    assert.equal(read.content, 'hello');
    assert.equal(saved.path, canonicalFilePath);
    assert.deepEqual(writes, [{ path: canonicalFilePath, content: 'updated' }]);
  });

  test('save rejects a missing file beneath a symlink that escapes the project', async () => {
    const projectRoot = path.resolve('file-tree-test-project');
    const linkedDirectory = path.join(projectRoot, 'outside-link');
    const candidateFile = path.join(linkedDirectory, 'new.txt');
    let wroteFile = false;
    const fileSystem = createFakeFileSystem({
      realpath: async (candidatePath) => {
        if (candidatePath === candidateFile) {
          throw Object.assign(new Error('missing'), { code: 'ENOENT' });
        }
        if (candidatePath === linkedDirectory) return path.resolve('outside-project');
        return candidatePath;
      },
      writeTextFile: async () => { wroteFile = true; },
    });
    const service = createFileTreeService(createDependencies(fileSystem, projectRoot));

    await assert.rejects(
      service.saveTextFile('project-1', candidateFile, 'unsafe'),
      (error: unknown) => error instanceof AppError && error.code === 'PATH_OUTSIDE_PROJECT',
    );
    assert.equal(wroteFile, false);
  });

  test('root loading warms one search index and file mutations invalidate it', async () => {
    const projectRoot = path.resolve('file-tree-test-project');
    let indexReads = 0;
    let created = false;
    const missingError = Object.assign(new Error('missing'), { code: 'ENOENT' });
    const fileSystem = createFakeFileSystem({
      access: async () => { throw missingError; },
      stat: async () => createStats(true, 0o755),
      lstat: async () => createStats(false, 0o644),
      openDirectory: async () => {
        const entries = [createDirectoryEntry('README.md', false)];
        let index = 0;
        return {
          read: async () => entries[index++] ?? null,
          close: async () => undefined,
        };
      },
      readdir: async () => {
        indexReads += 1;
        return [
          createDirectoryEntry('README.md', false),
          ...(created ? [createDirectoryEntry('new-file.txt', false)] : []),
        ];
      },
      writeTextFile: async () => { created = true; },
      makeDirectory: async () => undefined,
    });
    const service = createFileTreeService(createDependencies(fileSystem, projectRoot));

    await service.listDirectory({
      projectId: 'project-1',
      directoryPath: '',
      cursor: null,
      limit: 200,
      respectGitignore: false,
    });
    await service.searchProjectFiles({
      projectId: 'project-1',
      query: 'readme',
      entryType: 'file',
      cursor: null,
      limit: 100,
      respectGitignore: false,
    });
    await service.searchProjectFiles({
      projectId: 'project-1',
      query: 'readme',
      entryType: 'file',
      cursor: null,
      limit: 100,
      respectGitignore: false,
    });
    assert.equal(indexReads, 1);

    await service.createEntry({
      projectId: 'project-1',
      parentPath: projectRoot,
      name: 'new-file.txt',
      type: 'file',
    });
    const refreshed = await service.searchProjectFiles({
      projectId: 'project-1',
      query: 'new-file',
      entryType: 'file',
      cursor: null,
      limit: 100,
      respectGitignore: false,
    });
    assert.equal(indexReads, 2);
    assert.equal(refreshed.results[0]?.relativePath, 'new-file.txt');
  });

  test('an explicit search refresh sees files created outside CLIde', async () => {
    const projectRoot = path.resolve('file-tree-test-project');
    let externalFileExists = false;
    let indexReads = 0;
    const fileSystem = createFakeFileSystem({
      readdir: async () => {
        indexReads += 1;
        return [
          createDirectoryEntry('README.md', false),
          ...(externalFileExists ? [createDirectoryEntry('external.txt', false)] : []),
        ];
      },
    });
    const service = createFileTreeService(createDependencies(fileSystem, projectRoot));
    const search = (refreshIndex = false) => service.searchProjectFiles({
      projectId: 'project-1',
      query: 'external',
      entryType: 'file',
      cursor: null,
      limit: 100,
      respectGitignore: false,
      refreshIndex,
    });

    assert.deepEqual((await search()).results, []);
    externalFileExists = true;
    assert.deepEqual((await search()).results, []);
    const refreshed = await search(true);

    assert.equal(refreshed.results[0]?.relativePath, 'external.txt');
    assert.equal(indexReads, 2);
  });

  test('file resolution reports duplicate suffixes as ambiguous', async () => {
    const projectRoot = path.resolve('file-tree-test-project');
    const firstDirectory = path.join(projectRoot, 'first');
    const secondDirectory = path.join(projectRoot, 'second');
    const fileSystem = createFakeFileSystem({
      realpath: async (candidatePath) => {
        if (candidatePath === path.join(projectRoot, 'Button.tsx')) {
          throw Object.assign(new Error('missing'), { code: 'ENOENT' });
        }
        return candidatePath;
      },
      stat: async () => createStats(true, 0o755),
      readdir: async (directoryPath) => directoryPath === projectRoot
        ? [createDirectoryEntry('first', true), createDirectoryEntry('second', true)]
        : directoryPath === firstDirectory || directoryPath === secondDirectory
          ? [createDirectoryEntry('Button.tsx', false)]
          : [],
    });
    const service = createFileTreeService(createDependencies(fileSystem, projectRoot));

    const result = await service.resolveProjectFile({
      projectId: 'project-1',
      fileReference: 'Button.tsx',
    });

    assert.equal(result.status, 'ambiguous');
    if (result.status === 'ambiguous') {
      assert.deepEqual(result.matches.map((match) => match.relativePath), [
        'first/Button.tsx',
        'second/Button.tsx',
      ]);
    }
  });

  test('directory traversal stops when its AbortSignal is canceled', async () => {
    const projectRoot = path.resolve('file-tree-test-project');
    const controller = new AbortController();
    let reads = 0;
    const fileSystem = createFakeFileSystem({
      stat: async () => createStats(true, 0o755),
      openDirectory: async () => ({
        read: async () => {
          reads += 1;
          controller.abort();
          return createDirectoryEntry('first.txt', false);
        },
        close: async () => undefined,
      }),
    });
    const service = createFileTreeService(createDependencies(fileSystem, projectRoot));

    await assert.rejects(
      service.listDirectory({
        projectId: 'project-1',
        directoryPath: '',
        cursor: null,
        limit: 200,
        respectGitignore: false,
        signal: controller.signal,
      }),
      (error: unknown) => error instanceof Error && error.name === 'AbortError',
    );
    assert.equal(reads, 1);
  });

  test('complete subtree export reads file metadata with bounded concurrency', async () => {
    const projectRoot = path.resolve('file-tree-test-project');
    let activeReads = 0;
    let maximumActiveReads = 0;
    const fileSystem = createFakeFileSystem({
      stat: async () => createStats(true, 0o755),
      readdir: async (directoryPath) => directoryPath === projectRoot
        ? Array.from({ length: 16 }, (_, index) => createDirectoryEntry(`file-${index}.txt`, false))
        : [],
      lstat: async () => {
        activeReads += 1;
        maximumActiveReads = Math.max(maximumActiveReads, activeReads);
        await new Promise<void>((resolve) => setTimeout(resolve, 2));
        activeReads -= 1;
        return createStats(false, 0o644);
      },
    });
    const service = createFileTreeService(createDependencies(fileSystem, projectRoot));

    const tree = await service.listProjectSubtree({
      projectId: 'project-1',
      directoryPath: projectRoot,
    });

    assert.equal(tree.length, 16);
    assert.ok(maximumActiveReads > 1, `metadata remained serial at ${maximumActiveReads}`);
    assert.ok(maximumActiveReads <= 4, `metadata exceeded the filesystem limit at ${maximumActiveReads}`);
  });

  test('complete subtree export fails rather than returning an unreadable partial tree', async () => {
    const projectRoot = path.resolve('file-tree-test-project');
    const blockedDirectory = path.join(projectRoot, 'blocked');
    const fileSystem = createFakeFileSystem({
      stat: async () => createStats(true, 0o755),
      readdir: async (directoryPath) => {
        if (directoryPath === projectRoot) return [createDirectoryEntry('blocked', true)];
        if (directoryPath === blockedDirectory) {
          throw Object.assign(new Error('denied'), { code: 'EACCES' });
        }
        return [];
      },
      lstat: async () => createStats(true, 0o755),
    });
    const service = createFileTreeService(createDependencies(fileSystem, projectRoot));

    await assert.rejects(
      service.listProjectSubtree({ projectId: 'project-1', directoryPath: projectRoot }),
      (error: unknown) => error instanceof AppError && error.code === 'FILE_TREE_INCOMPLETE',
    );
  });
});

describe('file-tree.routes', () => {
  function createFakeServices(overrides: Partial<FileTreeServices> = {}): FileTreeServices {
    const unexpectedOperation = async (): Promise<never> => {
      throw new Error('Unexpected File Tree service call');
    };

    return {
      browseWorkspace: unexpectedOperation,
      createWorkspaceFolder: unexpectedOperation,
      readTextFile: unexpectedOperation,
      openFile: unexpectedOperation,
      saveTextFile: unexpectedOperation,
      listProjectFiles: unexpectedOperation,
      listDirectory: unexpectedOperation,
      searchProjectFiles: unexpectedOperation,
      resolveProjectFile: unexpectedOperation,
      listProjectSubtree: unexpectedOperation,
      createEntry: unexpectedOperation,
      renameEntry: unexpectedOperation,
      deleteEntry: unexpectedOperation,
      moveEntries: unexpectedOperation,
      storeUploadedFiles: unexpectedOperation,
      ...overrides,
    };
  }

  const passUploadRequest: RequestHandler = (_request, _response, next) => next();

  async function withFileTreeServer(
    services: FileTreeServices,
    run: (baseUrl: string) => Promise<void>,
  ): Promise<void> {
    const app = express();
    app.use(express.json());
    app.use('/api/file-tree', createFileTreeRouter(
      services,
      passUploadRequest,
      { maximumFileSizeMegabytes: 200, maximumFileCount: 20 },
      { error: () => undefined },
    ));

    const server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');

    try {
      const address = server.address() as AddressInfo;
      await run(`http://127.0.0.1:${address.port}`);
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
      });
    }
  }

  test('project files route uses the File Tree API namespace and forwards the project id', async () => {
    const inputs: Parameters<FileTreeServices['listProjectFiles']>[] = [];
    const services = createFakeServices({
      listProjectFiles: async (...input) => {
        inputs.push(input);
        return [];
      },
    });

    await withFileTreeServer(services, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/file-tree/projects/project-1/files`);

      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), []);
    });

    assert.equal(inputs.length, 1);
    assert.equal(inputs[0]?.[0], 'project-1');
    assert.equal(inputs[0]?.[1]?.respectGitignore, false);
    assert.ok(inputs[0]?.[1]?.signal instanceof AbortSignal);
  });

  test('project files route requests gitignore filtering when explicitly enabled', async () => {
    const inputs: Parameters<FileTreeServices['listProjectFiles']>[] = [];
    const services = createFakeServices({
      listProjectFiles: async (...input) => {
        inputs.push(input);
        return [];
      },
    });

    await withFileTreeServer(services, async (baseUrl) => {
      const response = await fetch(
        `${baseUrl}/api/file-tree/projects/project-1/files?respectGitignore=true`,
      );

      assert.equal(response.status, 200);
    });

    assert.equal(inputs.length, 1);
    assert.equal(inputs[0]?.[0], 'project-1');
    assert.equal(inputs[0]?.[1]?.respectGitignore, true);
    assert.ok(inputs[0]?.[1]?.signal instanceof AbortSignal);
  });

  test('directory route caps page size and forwards an abort signal', async () => {
    const inputs: Parameters<FileTreeServices['listDirectory']>[0][] = [];
    const services = createFakeServices({
      listDirectory: async (input) => {
        inputs.push(input);
        return {
          directoryPath: '/workspace/project/src',
          relativePath: 'src',
          entries: [],
          nextCursor: null,
        };
      },
    });

    await withFileTreeServer(services, async (baseUrl) => {
      const response = await fetch(
        `${baseUrl}/api/file-tree/projects/project-1/directory?path=src&limit=999`,
      );
      assert.equal(response.status, 200);
    });

    assert.equal(inputs.length, 1);
    assert.equal(inputs[0]?.directoryPath, 'src');
    assert.equal(inputs[0]?.limit, 200);
    assert.ok(inputs[0]?.signal instanceof AbortSignal);
  });

  test('search route parses file-only gitignored search requests', async () => {
    const inputs: Parameters<FileTreeServices['searchProjectFiles']>[0][] = [];
    const services = createFakeServices({
      searchProjectFiles: async (input) => {
        inputs.push(input);
        return { results: [], nextCursor: null };
      },
    });

    await withFileTreeServer(services, async (baseUrl) => {
      const response = await fetch(
        `${baseUrl}/api/file-tree/projects/project-1/search?q=readme&entryType=file&respectGitignore=true&refresh=true&limit=500`,
      );
      assert.equal(response.status, 200);
    });

    assert.equal(inputs.length, 1);
    assert.equal(inputs[0]?.query, 'readme');
    assert.equal(inputs[0]?.entryType, 'file');
    assert.equal(inputs[0]?.respectGitignore, true);
    assert.equal(inputs[0]?.refreshIndex, true);
    assert.equal(inputs[0]?.limit, 100);
    assert.ok(inputs[0]?.signal instanceof AbortSignal);
  });

  test('create route parses the transport payload before invoking the service', async () => {
    const inputs: Parameters<FileTreeServices['createEntry']>[0][] = [];
    const services = createFakeServices({
      createEntry: async (input) => {
        inputs.push(input);
        return {
          success: true,
          path: '/workspace/project/src/example.ts',
          name: input.name,
          type: input.type,
          message: 'File created successfully',
        };
      },
    });

    await withFileTreeServer(services, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/file-tree/projects/project-1/files/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          path: '/workspace/project/src',
          type: 'file',
          name: 'example.ts',
        }),
      });

      assert.equal(response.status, 200);
    });

    assert.deepEqual(inputs, [{
      projectId: 'project-1',
      parentPath: '/workspace/project/src',
      type: 'file',
      name: 'example.ts',
    }]);
  });

  test('create route rejects invalid entry types without calling the service', async () => {
    let createCalled = false;
    const services = createFakeServices({
      createEntry: async () => {
        createCalled = true;
        throw new Error('createEntry should not run for invalid input');
      },
    });

    await withFileTreeServer(services, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/file-tree/projects/project-1/files/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ type: 'link', name: 'example' }),
      });
      const payload = await response.json() as { error: string };

      assert.equal(response.status, 400);
      assert.equal(payload.error, 'Type must be "file" or "directory"');
    });

    assert.equal(createCalled, false);
  });
});
