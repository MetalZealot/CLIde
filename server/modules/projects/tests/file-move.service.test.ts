import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  canonicalizeMoveSources,
  moveFilesIntoDirectory,
  normalizeSourcePathsInput,
  type FileMoveDependencies,
} from '@/modules/projects/services/file-move.service.js';
import { AppError } from '@/shared/utils.js';

/**
 * Every test builds a throwaway project in a temp directory; nothing here
 * touches a real project or the user database.
 */
async function makeProject(
  layout: Record<string, string | null>,
): Promise<{ root: string; cleanup: () => Promise<void> }> {
  const created = await fs.mkdtemp(path.join(os.tmpdir(), 'clide-move-test-'));
  // Temp roots can themselves be symlinks (notably on macOS), and the service
  // reports real paths, so tests compare against the real root.
  const root = await fs.realpath(created);

  for (const [relativePath, contents] of Object.entries(layout)) {
    const absolute = path.join(root, relativePath);
    if (contents === null) {
      await fs.mkdir(absolute, { recursive: true });
    } else {
      await fs.mkdir(path.dirname(absolute), { recursive: true });
      await fs.writeFile(absolute, contents, 'utf8');
    }
  }

  return { root, cleanup: () => fs.rm(created, { recursive: true, force: true }) };
}

const exists = async (target: string) => {
  try {
    await fs.lstat(target);
    return true;
  } catch {
    return false;
  }
};

async function expectAppError(
  run: () => Promise<unknown>,
  expected: { code: string; statusCode?: number },
): Promise<AppError> {
  const error = await run().then(
    () => null,
    (caught: unknown) => caught,
  );

  assert.ok(error instanceof AppError, `expected an AppError, got ${String(error)}`);
  assert.equal(error.code, expected.code);
  if (expected.statusCode !== undefined) {
    assert.equal(error.statusCode, expected.statusCode);
  }
  return error;
}

test('normalizeSourcePathsInput accepts the legacy singular sourcePath', () => {
  assert.deepEqual(normalizeSourcePathsInput({ sourcePath: '/project/a.ts' }), ['/project/a.ts']);
  assert.deepEqual(normalizeSourcePathsInput({ sourcePaths: ['/project/a.ts', '/project/b.ts'] }), [
    '/project/a.ts',
    '/project/b.ts',
  ]);
});

test('normalizeSourcePathsInput rejects missing, empty, oversized, and non-string input', () => {
  assert.throws(() => normalizeSourcePathsInput({}), /sourcePaths is required/);
  assert.throws(() => normalizeSourcePathsInput({ sourcePaths: [] }), /must not be empty/);
  assert.throws(() => normalizeSourcePathsInput({ sourcePaths: '/project/a' }), /must be an array/);
  assert.throws(() => normalizeSourcePathsInput({ sourcePaths: [''] }), /non-empty string/);
  assert.throws(
    () => normalizeSourcePathsInput({ sourcePaths: Array.from({ length: 501 }, () => '/a') }),
    /more than 500/,
  );
});

test('canonicalizeMoveSources drops duplicates and descendants of a selected directory', () => {
  const canonical = canonicalizeMoveSources([
    { realPath: '/p/docs/design.md', type: 'file' as const },
    { realPath: '/p/docs', type: 'directory' as const },
    { realPath: '/p/src/app.ts', type: 'file' as const },
    { realPath: '/p/docs', type: 'directory' as const },
    { realPath: '/p/docs/deep/nested.md', type: 'file' as const },
  ]);

  assert.deepEqual(
    canonical.map((entry) => entry.realPath),
    ['/p/docs', '/p/src/app.ts'],
  );
});

test('canonicalizeMoveSources keeps a sibling whose path merely shares a prefix', () => {
  const canonical = canonicalizeMoveSources([
    { realPath: '/p/docs', type: 'directory' as const },
    { realPath: '/p/docs-archive/old.md', type: 'file' as const },
  ]);

  assert.deepEqual(
    canonical.map((entry) => entry.realPath),
    ['/p/docs', '/p/docs-archive/old.md'],
  );
});

test('moves one file (single-source compatibility path)', async () => {
  const { root, cleanup } = await makeProject({ 'src/a.ts': 'a', 'archive': null });
  try {
    const result = await moveFilesIntoDirectory({
      projectRoot: root,
      sourcePaths: [path.join(root, 'src/a.ts')],
      destinationPath: path.join(root, 'archive'),
    });

    assert.deepEqual(result.skipped, []);
    assert.deepEqual(result.moved, [
      {
        oldPath: path.join(root, 'src/a.ts'),
        newPath: path.join(root, 'archive/a.ts'),
        type: 'file',
      },
    ]);
    assert.equal(await exists(path.join(root, 'archive/a.ts')), true);
    assert.equal(await exists(path.join(root, 'src/a.ts')), false);
  } finally {
    await cleanup();
  }
});

test('moves several files from one parent', async () => {
  const { root, cleanup } = await makeProject({
    'src/a.ts': 'a',
    'src/b.ts': 'b',
    'src/c.ts': 'c',
    'archive': null,
  });
  try {
    const result = await moveFilesIntoDirectory({
      projectRoot: root,
      sourcePaths: [path.join(root, 'src/a.ts'), path.join(root, 'src/b.ts')],
      destinationPath: path.join(root, 'archive'),
    });

    assert.equal(result.moved.length, 2);
    assert.equal(await exists(path.join(root, 'archive/a.ts')), true);
    assert.equal(await exists(path.join(root, 'archive/b.ts')), true);
    assert.equal(await exists(path.join(root, 'src/c.ts')), true);
  } finally {
    await cleanup();
  }
});

test('moves a mixture of files and directories from different parents', async () => {
  const { root, cleanup } = await makeProject({
    'src/a.ts': 'a',
    'docs/design.md': 'd',
    'notes.txt': 'n',
    'archive': null,
  });
  try {
    const result = await moveFilesIntoDirectory({
      projectRoot: root,
      sourcePaths: [
        path.join(root, 'src/a.ts'),
        path.join(root, 'docs'),
        path.join(root, 'notes.txt'),
      ],
      destinationPath: path.join(root, 'archive'),
    });

    assert.equal(result.moved.length, 3);
    assert.deepEqual(
      result.moved.filter((entry) => entry.type === 'directory').map((entry) => entry.newPath),
      [path.join(root, 'archive/docs')],
    );
    // The directory moved with its contents intact.
    assert.equal(await exists(path.join(root, 'archive/docs/design.md')), true);
    assert.equal(await exists(path.join(root, 'archive/a.ts')), true);
    assert.equal(await exists(path.join(root, 'archive/notes.txt')), true);
  } finally {
    await cleanup();
  }
});

test('moves only the ancestor when a directory and its descendant are both selected', async () => {
  const { root, cleanup } = await makeProject({ 'docs/design.md': 'd', 'archive': null });
  try {
    const result = await moveFilesIntoDirectory({
      projectRoot: root,
      sourcePaths: [path.join(root, 'docs/design.md'), path.join(root, 'docs')],
      destinationPath: path.join(root, 'archive'),
    });

    assert.deepEqual(result.moved, [
      {
        oldPath: path.join(root, 'docs'),
        newPath: path.join(root, 'archive/docs'),
        type: 'directory',
      },
    ]);
    assert.equal(await exists(path.join(root, 'archive/docs/design.md')), true);
  } finally {
    await cleanup();
  }
});

test('skips sources already in the destination and moves the rest', async () => {
  const { root, cleanup } = await makeProject({
    'archive/already.ts': 'x',
    'src/a.ts': 'a',
  });
  try {
    const result = await moveFilesIntoDirectory({
      projectRoot: root,
      sourcePaths: [path.join(root, 'archive/already.ts'), path.join(root, 'src/a.ts')],
      destinationPath: path.join(root, 'archive'),
    });

    assert.deepEqual(result.skipped, [
      { path: path.join(root, 'archive/already.ts'), reason: 'already-in-destination' },
    ]);
    assert.equal(result.moved.length, 1);
    assert.equal(await exists(path.join(root, 'archive/already.ts')), true);
    assert.equal(await exists(path.join(root, 'archive/a.ts')), true);
  } finally {
    await cleanup();
  }
});

test('rejects the batch when every source is already in the destination', async () => {
  const { root, cleanup } = await makeProject({ 'archive/a.ts': 'a', 'archive/b.ts': 'b' });
  try {
    await expectAppError(
      () =>
        moveFilesIntoDirectory({
          projectRoot: root,
          sourcePaths: [path.join(root, 'archive/a.ts'), path.join(root, 'archive/b.ts')],
          destinationPath: path.join(root, 'archive'),
        }),
      { code: 'MOVE_NO_OP', statusCode: 400 },
    );
  } finally {
    await cleanup();
  }
});

test('moves top-level items to the project root via an empty destination', async () => {
  const { root, cleanup } = await makeProject({ 'src/a.ts': 'a' });
  try {
    const result = await moveFilesIntoDirectory({
      projectRoot: root,
      sourcePaths: [path.join(root, 'src/a.ts')],
      destinationPath: '',
    });

    assert.equal(result.moved[0]?.newPath, path.join(root, 'a.ts'));
    assert.equal(await exists(path.join(root, 'a.ts')), true);
  } finally {
    await cleanup();
  }
});

test('rejects a missing source before moving anything', async () => {
  const { root, cleanup } = await makeProject({ 'src/a.ts': 'a', 'archive': null });
  try {
    await expectAppError(
      () =>
        moveFilesIntoDirectory({
          projectRoot: root,
          sourcePaths: [path.join(root, 'src/a.ts'), path.join(root, 'src/gone.ts')],
          destinationPath: path.join(root, 'archive'),
        }),
      { code: 'MOVE_SOURCE_NOT_FOUND', statusCode: 404 },
    );

    // The valid source in the same batch must not have moved.
    assert.equal(await exists(path.join(root, 'src/a.ts')), true);
    assert.equal(await exists(path.join(root, 'archive/a.ts')), false);
  } finally {
    await cleanup();
  }
});

test('rejects a destination that does not exist', async () => {
  const { root, cleanup } = await makeProject({ 'src/a.ts': 'a' });
  try {
    await expectAppError(
      () =>
        moveFilesIntoDirectory({
          projectRoot: root,
          sourcePaths: [path.join(root, 'src/a.ts')],
          destinationPath: path.join(root, 'nowhere'),
        }),
      { code: 'MOVE_DESTINATION_NOT_FOUND', statusCode: 404 },
    );
  } finally {
    await cleanup();
  }
});

test('rejects a destination that is a file', async () => {
  const { root, cleanup } = await makeProject({ 'src/a.ts': 'a', 'notes.txt': 'n' });
  try {
    await expectAppError(
      () =>
        moveFilesIntoDirectory({
          projectRoot: root,
          sourcePaths: [path.join(root, 'src/a.ts')],
          destinationPath: path.join(root, 'notes.txt'),
        }),
      { code: 'MOVE_DESTINATION_NOT_DIRECTORY', statusCode: 400 },
    );
  } finally {
    await cleanup();
  }
});

test('rejects a destination inside a selected directory', async () => {
  const { root, cleanup } = await makeProject({ 'docs/nested': null, 'src/a.ts': 'a' });
  try {
    await expectAppError(
      () =>
        moveFilesIntoDirectory({
          projectRoot: root,
          sourcePaths: [path.join(root, 'docs'), path.join(root, 'src/a.ts')],
          destinationPath: path.join(root, 'docs/nested'),
        }),
      { code: 'MOVE_INTO_SELF', statusCode: 400 },
    );

    assert.equal(await exists(path.join(root, 'src/a.ts')), true);
  } finally {
    await cleanup();
  }
});

test('rejects duplicate basenames within one batch and names both sources', async () => {
  const { root, cleanup } = await makeProject({
    'one/readme.md': '1',
    'two/readme.md': '2',
    'archive': null,
  });
  try {
    const error = await expectAppError(
      () =>
        moveFilesIntoDirectory({
          projectRoot: root,
          sourcePaths: [path.join(root, 'one/readme.md'), path.join(root, 'two/readme.md')],
          destinationPath: path.join(root, 'archive'),
        }),
      { code: 'MOVE_DUPLICATE_NAMES', statusCode: 400 },
    );

    const { conflicts } = error.details as { conflicts: Array<{ sourcePath: string }> };
    assert.deepEqual(conflicts.map((conflict) => conflict.sourcePath).sort(), [
      path.join(root, 'one/readme.md'),
      path.join(root, 'two/readme.md'),
    ]);
    // Neither file moved.
    assert.equal(await exists(path.join(root, 'one/readme.md')), true);
    assert.equal(await exists(path.join(root, 'two/readme.md')), true);
  } finally {
    await cleanup();
  }
});

test('rejects a collision with an existing destination entry and moves nothing', async () => {
  const { root, cleanup } = await makeProject({
    'src/a.ts': 'a',
    'src/b.ts': 'b',
    'archive/b.ts': 'existing',
  });
  try {
    const error = await expectAppError(
      () =>
        moveFilesIntoDirectory({
          projectRoot: root,
          sourcePaths: [path.join(root, 'src/a.ts'), path.join(root, 'src/b.ts')],
          destinationPath: path.join(root, 'archive'),
        }),
      { code: 'MOVE_CONFLICT', statusCode: 400 },
    );

    const { conflicts } = error.details as { conflicts: Array<{ targetPath: string }> };
    assert.deepEqual(conflicts, [
      { sourcePath: path.join(root, 'src/b.ts'), targetPath: path.join(root, 'archive/b.ts') },
    ]);
    assert.equal(await exists(path.join(root, 'src/a.ts')), true);
    assert.equal(await fs.readFile(path.join(root, 'archive/b.ts'), 'utf8'), 'existing');
  } finally {
    await cleanup();
  }
});

test('rejects the project root as a source', async () => {
  const { root, cleanup } = await makeProject({ 'archive': null });
  try {
    await expectAppError(
      () =>
        moveFilesIntoDirectory({
          projectRoot: root,
          sourcePaths: [root],
          destinationPath: path.join(root, 'archive'),
        }),
      { code: 'MOVE_ROOT_SOURCE', statusCode: 400 },
    );
  } finally {
    await cleanup();
  }
});

test('rejects a source that escapes the project root', async () => {
  const { root, cleanup } = await makeProject({ 'archive': null });
  const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'clide-move-outside-'));
  try {
    await fs.writeFile(path.join(outside, 'secret.txt'), 's', 'utf8');

    await expectAppError(
      () =>
        moveFilesIntoDirectory({
          projectRoot: root,
          sourcePaths: [path.join(outside, 'secret.txt')],
          destinationPath: path.join(root, 'archive'),
        }),
      { code: 'MOVE_PATH_ESCAPE', statusCode: 403 },
    );

    await expectAppError(
      () =>
        moveFilesIntoDirectory({
          projectRoot: root,
          sourcePaths: [path.join(root, '../../etc/passwd')],
          destinationPath: path.join(root, 'archive'),
        }),
      { code: 'MOVE_PATH_ESCAPE', statusCode: 403 },
    );
  } finally {
    await cleanup();
    await fs.rm(outside, { recursive: true, force: true });
  }
});

test('rejects a symlinked destination that points outside the project root', async () => {
  const { root, cleanup } = await makeProject({ 'src/a.ts': 'a' });
  const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'clide-move-outside-'));
  try {
    await fs.symlink(outside, path.join(root, 'escape-hatch'), 'dir');

    await expectAppError(
      () =>
        moveFilesIntoDirectory({
          projectRoot: root,
          sourcePaths: [path.join(root, 'src/a.ts')],
          destinationPath: path.join(root, 'escape-hatch'),
        }),
      { code: 'MOVE_PATH_ESCAPE', statusCode: 403 },
    );

    assert.equal(await exists(path.join(root, 'src/a.ts')), true);
    assert.equal(await exists(path.join(outside, 'a.ts')), false);
  } finally {
    await cleanup();
    await fs.rm(outside, { recursive: true, force: true });
  }
});

test('rejects a source reached through a symlinked parent that leaves the project', async () => {
  const { root, cleanup } = await makeProject({ 'archive': null });
  const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'clide-move-outside-'));
  try {
    await fs.writeFile(path.join(outside, 'secret.txt'), 's', 'utf8');
    await fs.symlink(outside, path.join(root, 'linked'), 'dir');

    await expectAppError(
      () =>
        moveFilesIntoDirectory({
          projectRoot: root,
          sourcePaths: [path.join(root, 'linked/secret.txt')],
          destinationPath: path.join(root, 'archive'),
        }),
      { code: 'MOVE_PATH_ESCAPE', statusCode: 403 },
    );
  } finally {
    await cleanup();
    await fs.rm(outside, { recursive: true, force: true });
  }
});

test('rolls back completed renames in reverse when one fails mid-execution', async () => {
  const { root, cleanup } = await makeProject({
    'src/a.ts': 'a',
    'src/b.ts': 'b',
    'src/c.ts': 'c',
    'archive': null,
  });
  try {
    let attempts = 0;
    const dependencies: FileMoveDependencies = {
      rename: async (oldPath, newPath) => {
        attempts += 1;
        // Fail the third rename: two are already done and must come back.
        if (attempts === 3) {
          throw Object.assign(new Error('simulated EACCES'), { code: 'EACCES' });
        }
        await fs.rename(oldPath, newPath);
      },
    };

    const error = await expectAppError(
      () =>
        moveFilesIntoDirectory({
          projectRoot: root,
          sourcePaths: [
            path.join(root, 'src/a.ts'),
            path.join(root, 'src/b.ts'),
            path.join(root, 'src/c.ts'),
          ],
          destinationPath: path.join(root, 'archive'),
          dependencies,
        }),
      { code: 'MOVE_FAILED', statusCode: 500 },
    );

    assert.match((error.details as { reason: string }).reason, /simulated EACCES/);

    // Clean rollback: every source is back and the destination is untouched.
    assert.equal(await exists(path.join(root, 'src/a.ts')), true);
    assert.equal(await exists(path.join(root, 'src/b.ts')), true);
    assert.equal(await exists(path.join(root, 'src/c.ts')), true);
    assert.deepEqual(await fs.readdir(path.join(root, 'archive')), []);
  } finally {
    await cleanup();
  }
});

test('reports a possibly partial result when rollback itself fails', async () => {
  const { root, cleanup } = await makeProject({
    'src/a.ts': 'a',
    'src/b.ts': 'b',
    'archive': null,
  });
  try {
    let attempts = 0;
    const dependencies: FileMoveDependencies = {
      rename: async (oldPath, newPath) => {
        attempts += 1;
        if (attempts === 2) {
          throw Object.assign(new Error('simulated EACCES'), { code: 'EACCES' });
        }
        if (attempts === 3) {
          // The rollback of the first move also fails.
          throw Object.assign(new Error('simulated rollback failure'), { code: 'EACCES' });
        }
        await fs.rename(oldPath, newPath);
      },
    };

    const error = await expectAppError(
      () =>
        moveFilesIntoDirectory({
          projectRoot: root,
          sourcePaths: [path.join(root, 'src/a.ts'), path.join(root, 'src/b.ts')],
          destinationPath: path.join(root, 'archive'),
          dependencies,
        }),
      { code: 'MOVE_PARTIAL', statusCode: 500 },
    );

    assert.deepEqual((error.details as { unrestoredPaths: string[] }).unrestoredPaths, [
      path.join(root, 'archive/a.ts'),
    ]);
    // The first move really did stick — which is exactly what the caller is
    // being warned about.
    assert.equal(await exists(path.join(root, 'archive/a.ts')), true);
    assert.equal(await exists(path.join(root, 'src/b.ts')), true);
  } finally {
    await cleanup();
  }
});
