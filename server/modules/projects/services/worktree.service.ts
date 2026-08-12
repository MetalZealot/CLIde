import path from 'node:path';

import crossSpawn from 'cross-spawn';

import { AppError, validateWorkspacePath } from '@/shared/utils.js';

/**
 * Creating a linked worktree of an existing repository, so the sidebar can add
 * one to a repository row without dropping the user into a terminal (ADR 0016).
 * "Worktree" is git's own noun; the sidebar's older `checkout` identifiers mean
 * the same thing.
 */

type GitInvocation = {
  stdout: string;
  stderr: string;
  ok: boolean;
};

type WorktreeDependencies = {
  runGit: (workingDirectory: string, args: string[]) => Promise<GitInvocation>;
  validatePath: (candidatePath: string) => Promise<{ valid: boolean; error?: string }>;
};

export type CreateWorktreeInput = {
  /** Any registered worktree of the repository; git resolves the rest itself. */
  repositoryProjectPath: string;
  /** Branch to create and check out in the new worktree. */
  branch: string;
  /** Absolute directory for the new worktree. Derived when omitted. */
  worktreePath?: string | null;
  /** Commit-ish the new branch starts from. Defaults to the current HEAD. */
  baseRef?: string | null;
};

export type CreateWorktreeResult = {
  worktreePath: string;
  branch: string;
};

function runGitProcess(workingDirectory: string, args: string[]): Promise<GitInvocation> {
  return new Promise((resolve) => {
    const child = crossSpawn('git', args, { cwd: workingDirectory, shell: false });

    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    // Unlike repository identity, git's own message is the useful part of a
    // failure here ("branch already checked out at ...") and is shown.
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    child.on('error', (error: Error) => resolve({ stdout: '', stderr: error.message, ok: false }));
    child.on('close', (code) => resolve({ stdout, stderr, ok: code === 0 }));
  });
}

const defaultDependencies: WorktreeDependencies = {
  runGit: runGitProcess,
  validatePath: validateWorkspacePath,
};

/**
 * The subset of `git check-ref-format --branch` worth enforcing before spawning
 * anything. Arguments never reach a shell, so this is about rejecting a name git
 * would refuse anyway, with a message the user can act on.
 */
const INVALID_BRANCH_PATTERN = /[\x00-\x20~^:?*[\\]|^[-/.]|[/.]$|\.\.|@\{|\.lock(\/|$)|\/\//;

export function assertValidBranchName(branch: string): void {
  if (!branch || INVALID_BRANCH_PATTERN.test(branch)) {
    throw new AppError('Invalid branch name', {
      code: 'INVALID_BRANCH_NAME',
      statusCode: 400,
      details: `git will not accept "${branch}" as a branch name`,
    });
  }
}

/**
 * A base ref is a commit-ish, not a branch name, so `assertValidBranchName` is
 * the wrong check: `main^`, `HEAD~2` and `HEAD@{1}` are valid starting points
 * that the branch rules reject on `^`, `~` and `@{`.
 *
 * Arguments never reach a shell, so the only hazard worth catching is a value
 * git would read as an option. Whether the ref resolves is git's question.
 */
const INVALID_BASE_REF_PATTERN = /[\x00-\x20\x7f?*[\\]|^-/;

export function assertValidBaseRef(baseRef: string): void {
  if (!baseRef || INVALID_BASE_REF_PATTERN.test(baseRef)) {
    throw new AppError('Invalid base ref', {
      code: 'INVALID_BASE_REF',
      statusCode: 400,
      details: `git will not accept "${baseRef}" as a starting point`,
    });
  }
}

/**
 * Where a new worktree goes when the user does not say: beside the repository,
 * named for it and the branch.
 *
 * Nesting a worktree *inside* its repository is the obvious alternative and is
 * a trap — it lands the tree in the repository's own working directory, where
 * it shows up as untracked files in every status call.
 */
export function deriveWorktreePath(repositoryRoot: string, branch: string): string {
  const slug = branch.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'worktree';
  return path.join(path.dirname(repositoryRoot), `${path.basename(repositoryRoot)}-wt-${slug}`);
}

/**
 * Root of the repository's main worktree.
 *
 * A linked worktree's shared git directory is the main worktree's `.git`, so
 * stripping that suffix names its directory — the same derivation the sidebar
 * uses to pick a row's lead. Falls back to the calling project's own root for
 * layouts where that does not hold (bare, `--separate-git-dir`).
 */
async function resolveRepositoryRoot(
  projectPath: string,
  dependencies: WorktreeDependencies,
): Promise<string> {
  const revParse = await dependencies.runGit(projectPath, [
    'rev-parse',
    '--path-format=absolute',
    '--git-common-dir',
    '--show-toplevel',
  ]);

  if (!revParse.ok) {
    throw new AppError('Not a git repository', {
      code: 'NOT_A_REPOSITORY',
      statusCode: 400,
      details: `${projectPath} is not inside a git repository`,
    });
  }

  const [commonDir, topLevel] = revParse.stdout.split('\n').map((line) => line.trim());
  const mainRoot = commonDir.replace(/\/\.git\/?$/, '');

  return mainRoot === commonDir ? path.resolve(topLevel) : path.resolve(mainRoot);
}

/**
 * Runs `git worktree add`, creating the branch along with the tree.
 *
 * Registering the result as a project is left to the caller: the directory
 * exists either way, and a failed registration must not look like a failed
 * worktree.
 *
 * The destination is validated against the workspace root *before* git runs —
 * the one registration failure worth preventing rather than reporting.
 * Otherwise a repository outside the workspace root creates its worktree
 * successfully, cannot be registered, and leaves a directory nothing names.
 */
export async function createRepositoryWorktree(
  input: CreateWorktreeInput,
  dependencies: WorktreeDependencies = defaultDependencies,
): Promise<CreateWorktreeResult> {
  const branch = input.branch.trim();
  assertValidBranchName(branch);

  const repositoryRoot = await resolveRepositoryRoot(input.repositoryProjectPath, dependencies);
  const requestedPath = typeof input.worktreePath === 'string' ? input.worktreePath.trim() : '';
  const worktreePath = requestedPath
    ? path.resolve(requestedPath)
    : deriveWorktreePath(repositoryRoot, branch);

  const pathValidation = await dependencies.validatePath(worktreePath);
  if (!pathValidation.valid) {
    throw new AppError('Invalid worktree path', {
      code: 'INVALID_WORKTREE_PATH',
      statusCode: 400,
      details: pathValidation.error ?? `${worktreePath} is not an allowed workspace location`,
    });
  }

  const baseRef = typeof input.baseRef === 'string' ? input.baseRef.trim() : '';
  const addArguments = ['worktree', 'add', '-b', branch, worktreePath];
  if (baseRef) {
    assertValidBaseRef(baseRef);
    addArguments.push(baseRef);
  }

  const added = await dependencies.runGit(repositoryRoot, addArguments);
  if (!added.ok) {
    throw new AppError('Failed to create worktree', {
      code: 'WORKTREE_ADD_FAILED',
      statusCode: 400,
      // git's own message names the cause: branch exists, path taken, or branch
      // already checked out in another worktree.
      details: added.stderr.trim() || `git worktree add failed for ${worktreePath}`,
    });
  }

  return { worktreePath, branch };
}
