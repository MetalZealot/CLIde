import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import test, { describe } from 'node:test';

import { projectsDb } from '@/modules/database/index.js';
import { startCloneProject } from '@/modules/projects/services/project-clone.service.js';
import { removeJsonlFilesAndPruneEmptyDirs } from '@/modules/projects/services/project-delete.service.js';
import { createProject } from '@/modules/projects/services/project-management.service.js';
import { applyLegacyStarredProjectIds, toggleProjectStar } from '@/modules/projects/services/project-star.service.js';
import { getProjectTaskMaster, getProjectTaskMasterById } from '@/modules/projects/services/projects-has-taskmaster.service.js';
import { AppError } from '@/shared/utils.js';

describe('project-management.service', () => {
  const projectRow = {
    project_id: 'project-1',
    project_path: '/workspace/my-project',
    custom_project_name: 'my-project',
    isStarred: 0,
    isArchived: 0,
    accent_color: null,
  };

  test('createProject throws when project path is missing', async () => {
    await assert.rejects(
      async () => createProject({ projectPath: '' }),
      (error: unknown) => {
        assert.ok(error instanceof AppError);
        assert.equal(error.code, 'PROJECT_PATH_REQUIRED');
        assert.equal(error.statusCode, 400);
        return true;
      },
    );
  });

  test('createProject throws when path validation fails', async () => {
    await assert.rejects(
      async () =>
        createProject(
          { projectPath: '/invalid/path' },
          {
            validatePath: async () => ({ valid: false, error: 'blocked path' }),
            ensureWorkspaceDirectory: async () => undefined,
            persistProjectPath: () => ({ outcome: 'created', project: projectRow }),
            getProjectByPath: () => projectRow,
          },
        ),
      (error: unknown) => {
        assert.ok(error instanceof AppError);
        assert.equal(error.code, 'INVALID_PROJECT_PATH');
        assert.equal(error.statusCode, 400);
        assert.equal(error.details, 'blocked path');
        return true;
      },
    );
  });

  test('createProject throws conflict when active project path already exists', async () => {
    await assert.rejects(
      async () =>
        createProject(
          { projectPath: '/workspace/my-project' },
          {
            validatePath: async () => ({ valid: true, resolvedPath: '/workspace/my-project' }),
            ensureWorkspaceDirectory: async () => undefined,
            persistProjectPath: () => ({ outcome: 'active_conflict', project: projectRow }),
            getProjectByPath: () => projectRow,
          },
        ),
      (error: unknown) => {
        assert.ok(error instanceof AppError);
        assert.equal(error.code, 'PROJECT_ALREADY_EXISTS');
        assert.equal(error.statusCode, 409);
        assert.equal(error.details, 'Project path already exists: /workspace/my-project');
        return true;
      },
    );
  });

  test('createProject falls back to directory name when custom name is not provided', async () => {
    let capturedCustomName: string | null = null;

    const result = await createProject(
      { projectPath: '/workspace/my-project', customName: '' },
      {
        validatePath: async () => ({ valid: true, resolvedPath: '/workspace/my-project' }),
        ensureWorkspaceDirectory: async () => undefined,
        persistProjectPath: (_projectPath, customName) => {
          capturedCustomName = customName;
          return {
            outcome: 'created',
            project: {
              ...projectRow,
              custom_project_name: customName,
            },
          };
        },
        getProjectByPath: () => projectRow,
      },
    );

    assert.equal(capturedCustomName, 'my-project');
    assert.equal(result.outcome, 'created');
    assert.equal(result.project.displayName, 'my-project');
  });

  test('createProject returns archived reuse outcome when archived row is reused', async () => {
    const result = await createProject(
      { projectPath: '/workspace/my-project' },
      {
        validatePath: async () => ({ valid: true, resolvedPath: '/workspace/my-project' }),
        ensureWorkspaceDirectory: async () => undefined,
        persistProjectPath: () => ({
          outcome: 'reactivated_archived',
          project: {
            ...projectRow,
            isArchived: 1,
          },
        }),
        getProjectByPath: () => projectRow,
      },
    );

    assert.equal(result.outcome, 'reactivated_archived');
    assert.equal(result.project.isArchived, true);
  });
});

describe('project-clone.service', () => {
  type TestDependencies = Parameters<typeof startCloneProject>[2];

  function buildDependencies(overrides: Partial<NonNullable<TestDependencies>> = {}): NonNullable<TestDependencies> {
    return {
      validatePath: async () => ({ valid: true, resolvedPath: '/workspace/root' }),
      ensureDirectory: async () => undefined,
      pathExists: async () => false,
      removePath: async () => undefined,
      getGithubTokenById: async () => ({ github_token: 'token-value' }),
      spawnGitClone: () => {
        throw new Error('spawnGitClone should be overridden in this test');
      },
      registerProject: async () => ({ project: { projectId: 'project-1' } }),
      logError: () => undefined,
      ...overrides,
    };
  }

  function createMockGitProcess() {
    const emitter = new EventEmitter() as EventEmitter & {
      stdout: PassThrough;
      stderr: PassThrough;
      kill: () => void;
    };

    emitter.stdout = new PassThrough();
    emitter.stderr = new PassThrough();
    emitter.kill = () => {
      emitter.emit('close', null);
    };

    return emitter;
  }

  test('startCloneProject rejects when workspace path is missing', async () => {
    await assert.rejects(
      async () =>
        startCloneProject(
          {
            workspacePath: '',
            githubUrl: 'https://github.com/example/repo',
            userId: 1,
          },
          {
            onProgress: () => undefined,
            onComplete: () => undefined,
          },
          buildDependencies(),
        ),
      (error: unknown) => {
        assert.ok(error instanceof AppError);
        assert.equal(error.code, 'WORKSPACE_PATH_REQUIRED');
        return true;
      },
    );
  });

  test('startCloneProject rejects when github URL is missing', async () => {
    await assert.rejects(
      async () =>
        startCloneProject(
          {
            workspacePath: '/workspace/root',
            githubUrl: '',
            userId: 1,
          },
          {
            onProgress: () => undefined,
            onComplete: () => undefined,
          },
          buildDependencies(),
        ),
      (error: unknown) => {
        assert.ok(error instanceof AppError);
        assert.equal(error.code, 'GITHUB_URL_REQUIRED');
        return true;
      },
    );
  });

  test('startCloneProject rejects github URL values that begin with option prefixes', async () => {
    await assert.rejects(
      async () =>
        startCloneProject(
          {
            workspacePath: '/workspace/root',
            githubUrl: '--upload-pack=malicious',
            userId: 1,
          },
          {
            onProgress: () => undefined,
            onComplete: () => undefined,
          },
          buildDependencies(),
        ),
      (error: unknown) => {
        assert.ok(error instanceof AppError);
        assert.equal(error.code, 'INVALID_GITHUB_URL');
        return true;
      },
    );
  });

  test('startCloneProject rejects when selected github token does not exist', async () => {
    await assert.rejects(
      async () =>
        startCloneProject(
          {
            workspacePath: '/workspace/root',
            githubUrl: 'https://github.com/example/repo',
            githubTokenId: 12,
            userId: 1,
          },
          {
            onProgress: () => undefined,
            onComplete: () => undefined,
          },
          buildDependencies({
            getGithubTokenById: async () => null,
          }),
        ),
      (error: unknown) => {
        assert.ok(error instanceof AppError);
        assert.equal(error.code, 'GITHUB_TOKEN_NOT_FOUND');
        return true;
      },
    );
  });

  test('startCloneProject completes and emits complete payload when git exits successfully', async () => {
    const gitProcess = createMockGitProcess();
    const progressMessages: string[] = [];
    let completePayload: { project: Record<string, unknown>; message: string } | null = null;
    let capturedProjectPath = '';
    let capturedCustomName = '';

    const operation = await startCloneProject(
      {
        workspacePath: '/workspace/root',
        githubUrl: 'https://github.com/example/repo.git',
        userId: 1,
      },
      {
        onProgress: (message) => {
          progressMessages.push(message);
        },
        onComplete: (payload: { project: Record<string, unknown>; message: string }) => {
          completePayload = payload;
        },
      },
      buildDependencies({
        spawnGitClone: () => gitProcess as any,
        registerProject: async (projectPath, customName) => {
          capturedProjectPath = projectPath;
          capturedCustomName = customName;
          return { project: { projectId: 'project-1', path: projectPath } };
        },
      }),
    );

    gitProcess.emit('close', 0);
    await operation.waitForCompletion;

    assert.ok(progressMessages.some((message) => message.includes("Cloning into 'repo'")));
    assert.equal(capturedCustomName, 'repo');
    assert.equal(path.basename(capturedProjectPath), 'repo');
    assert.notEqual(completePayload, null);
    const resolvedCompletePayload = completePayload as unknown as {
      project: Record<string, unknown>;
      message: string;
    };
    assert.equal(resolvedCompletePayload.message, 'Repository cloned successfully');
    assert.equal((resolvedCompletePayload.project.projectId as string) || '', 'project-1');
  });
});

describe('project-delete.service', () => {
  async function makeTempProjectDir(): Promise<string> {
    return fs.mkdtemp(path.join(os.tmpdir(), 'clide-project-delete-'));
  }

  test('removeJsonlFilesAndPruneEmptyDirs deletes jsonl files and prunes the now-empty dir', async () => {
    const root = await makeTempProjectDir();
    try {
      const slugDir = path.join(root, '-tmp-probe');
      await fs.mkdir(slugDir, { recursive: true });
      const jsonlA = path.join(slugDir, 'a.jsonl');
      const jsonlB = path.join(slugDir, 'b.jsonl');
      await fs.writeFile(jsonlA, '{}');
      await fs.writeFile(jsonlB, '{}');

      await removeJsonlFilesAndPruneEmptyDirs([jsonlA, jsonlB]);

      await assert.rejects(fs.access(jsonlA));
      await assert.rejects(fs.access(jsonlB));
      // The per-project directory should be gone once it holds nothing.
      await assert.rejects(fs.access(slugDir));
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  test('removeJsonlFilesAndPruneEmptyDirs leaves a dir that still has other files (e.g. subagent transcripts)', async () => {
    const root = await makeTempProjectDir();
    try {
      const slugDir = path.join(root, '-tmp-probe');
      const subagentDir = path.join(slugDir, 'session-1', 'subagents');
      await fs.mkdir(subagentDir, { recursive: true });
      const jsonl = path.join(slugDir, 'session-1.jsonl');
      await fs.writeFile(jsonl, '{}');
      await fs.writeFile(path.join(subagentDir, 'agent-1.jsonl'), '{}');

      await removeJsonlFilesAndPruneEmptyDirs([jsonl]);

      await assert.rejects(fs.access(jsonl));
      // Non-recursive rmdir must not touch a dir that still contains nested transcripts.
      await fs.access(slugDir);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  test('removeJsonlFilesAndPruneEmptyDirs tolerates already-missing files', async () => {
    const root = await makeTempProjectDir();
    try {
      const missing = path.join(root, 'gone', 'never.jsonl');
      await assert.doesNotReject(removeJsonlFilesAndPruneEmptyDirs([missing]));
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});

describe('project-star.service', () => {
  type ProjectRow = {
    project_id: string;
    project_path: string;
    custom_project_name: string | null;
    isStarred: number;
    isArchived: number;
    accent_color: string | null;
  };

  test('toggleProjectStar throws when projectId is missing', () => {
    assert.throws(
      () => toggleProjectStar('   '),
      (error: unknown) =>
        error instanceof AppError
        && error.code === 'PROJECT_ID_REQUIRED'
        && error.statusCode === 400,
    );
  });

  test('toggleProjectStar throws when project does not exist', () => {
    const originalGetProjectById = projectsDb.getProjectById;
    try {
      projectsDb.getProjectById = () => null;
      assert.throws(
        () => toggleProjectStar('project-1'),
        (error: unknown) =>
          error instanceof AppError
          && error.code === 'PROJECT_NOT_FOUND'
          && error.statusCode === 404,
      );
    } finally {
      projectsDb.getProjectById = originalGetProjectById;
    }
  });

  test('toggleProjectStar flips star state and persists it', () => {
    const originalGetProjectById = projectsDb.getProjectById;
    const originalUpdateProjectIsStarredById = projectsDb.updateProjectIsStarredById;

    let capturedProjectId = '';
    let capturedState = false;

    try {
      projectsDb.getProjectById = () =>
        ({
          project_id: 'project-1',
          project_path: '/workspace/project-1',
          custom_project_name: 'project-1',
          isStarred: 0,
          isArchived: 0,
          accent_color: null,
        }) as ProjectRow;
      projectsDb.updateProjectIsStarredById = (projectId: string, isStarred: boolean) => {
        capturedProjectId = projectId;
        capturedState = isStarred;
      };

      const result = toggleProjectStar('project-1');

      assert.equal(result.isStarred, true);
      assert.equal(capturedProjectId, 'project-1');
      assert.equal(capturedState, true);
    } finally {
      projectsDb.getProjectById = originalGetProjectById;
      projectsDb.updateProjectIsStarredById = originalUpdateProjectIsStarredById;
    }
  });

  test('applyLegacyStarredProjectIds stars only valid, unstarred projects', () => {
    const originalGetProjectById = projectsDb.getProjectById;
    const originalUpdateProjectIsStarredById = projectsDb.updateProjectIsStarredById;

    const updatedProjectIds: string[] = [];

    try {
      projectsDb.getProjectById = (projectId: string) => {
        if (projectId === 'project-a') {
          return {
            project_id: 'project-a',
            project_path: '/workspace/project-a',
            custom_project_name: 'A',
            isStarred: 0,
            isArchived: 0,
          } as ProjectRow;
        }

        if (projectId === 'project-b') {
          return {
            project_id: 'project-b',
            project_path: '/workspace/project-b',
            custom_project_name: 'B',
            isStarred: 1,
            isArchived: 0,
          } as ProjectRow;
        }

        return null;
      };
      projectsDb.updateProjectIsStarredById = (projectId: string) => {
        updatedProjectIds.push(projectId);
      };

      const result = applyLegacyStarredProjectIds([
        'project-a',
        'project-b',
        'missing-project',
        'project-a',
        '',
        '   ',
      ]);

      assert.equal(result.updated, 1);
      assert.deepEqual(updatedProjectIds, ['project-a']);
    } finally {
      projectsDb.getProjectById = originalGetProjectById;
      projectsDb.updateProjectIsStarredById = originalUpdateProjectIsStarredById;
    }
  });
});

describe('projects-has-taskmaster.service', () => {
  test('getProjectTaskMasterById returns null when project path is missing', async () => {
    const result = await getProjectTaskMasterById('project-1', {
      resolveProjectPathById: () => null,
      detectTaskMasterFolder: async () => {
        throw new Error('detectTaskMasterFolder should not be called when path is missing');
      },
    });

    assert.equal(result, null);
  });

  test('getProjectTaskMasterById returns configured status when taskmaster exists with essential files', async () => {
    const result = await getProjectTaskMasterById('project-1', {
      resolveProjectPathById: () => '/workspace/project-1',
      detectTaskMasterFolder: async () => ({
        hasTaskmaster: true,
        hasEssentialFiles: true,
        metadata: {
          taskCount: 3,
          subtaskCount: 0,
          completed: 1,
          pending: 2,
          inProgress: 0,
          review: 0,
          completionPercentage: 33,
          lastModified: '2026-01-01T00:00:00.000Z',
        },
      }),
    });

    assert.ok(result);
    assert.equal(result.projectId, 'project-1');
    assert.equal(result.projectPath, '/workspace/project-1');
    assert.equal(result.taskmaster.hasTaskmaster, true);
    assert.equal(result.taskmaster.hasEssentialFiles, true);
    assert.equal(result.taskmaster.status, 'configured');
    assert.deepEqual(result.taskmaster.metadata, {
      taskCount: 3,
      subtaskCount: 0,
      completed: 1,
      pending: 2,
      inProgress: 0,
      review: 0,
      completionPercentage: 33,
      lastModified: '2026-01-01T00:00:00.000Z',
    });
  });

  test('getProjectTaskMasterById returns not-configured status when taskmaster is missing', async () => {
    const result = await getProjectTaskMasterById('project-1', {
      resolveProjectPathById: () => '/workspace/project-1',
      detectTaskMasterFolder: async () => ({
        hasTaskmaster: false,
      }),
    });

    assert.ok(result);
    assert.equal(result.taskmaster.hasTaskmaster, false);
    assert.equal(result.taskmaster.hasEssentialFiles, false);
    assert.equal(result.taskmaster.status, 'not-configured');
    assert.equal(result.taskmaster.metadata, null);
  });

  test('getProjectTaskMaster throws when project id is missing', async () => {
    await assert.rejects(
      async () =>
        getProjectTaskMaster('', async () => ({
          projectId: 'project-1',
          projectPath: '/workspace/project-1',
          taskmaster: {
            hasTaskmaster: true,
            hasEssentialFiles: true,
            metadata: null,
            status: 'configured',
          },
        })),
      (error: unknown) => {
        assert.ok(error instanceof AppError);
        assert.equal(error.code, 'PROJECT_ID_REQUIRED');
        assert.equal(error.statusCode, 400);
        return true;
      },
    );
  });

  test('getProjectTaskMaster throws when project does not exist', async () => {
    await assert.rejects(
      async () => getProjectTaskMaster('project-that-does-not-exist', async () => null),
      (error: unknown) => {
        assert.ok(error instanceof AppError);
        assert.equal(error.code, 'PROJECT_NOT_FOUND');
        assert.equal(error.statusCode, 404);
        return true;
      },
    );
  });
});
