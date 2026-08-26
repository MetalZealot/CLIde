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
  function createDirectoryEntry(name: string, directory: boolean): FileTreeDirectoryEntry {
    return {
      name,
      isDirectory: () => directory,
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

    return {
      access: unexpectedOperation,
      stat: unexpectedOperation,
      lstat: unexpectedOperation,
      readdir: unexpectedOperation,
      realpath: unexpectedOperation,
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

    assert.deepEqual(inputs, [['project-1', { respectGitignore: false }]]);
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

    assert.deepEqual(inputs, [['project-1', { respectGitignore: true }]]);
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
