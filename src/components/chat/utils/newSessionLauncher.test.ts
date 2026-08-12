import assert from 'node:assert/strict';
import test from 'node:test';

import type { Project } from '../../../types/app';
import { buildRepositoryEntries } from '../../sidebar/utils/utils';

import {
  getLauncherCheckoutLabel,
  resolveLauncherCheckoutSelection,
  resolvePrimaryCheckout,
} from './newSessionLauncher';

const REPOSITORY_ID = '/workspace/example/.git';
const mainCheckout: Project = {
  projectId: 'main-project',
  displayName: 'example',
  fullPath: '/workspace/example',
  repositoryId: REPOSITORY_ID,
  branch: 'master',
};
const worktree: Project = {
  projectId: 'feature-project',
  displayName: 'example-feature',
  fullPath: '/workspace/example-feature',
  repositoryId: REPOSITORY_ID,
  branch: 'feature/launcher',
};

test('primary checkout wins even when its branch is not literally main', () => {
  const [entry] = buildRepositoryEntries([worktree, mainCheckout]);

  assert.equal(resolvePrimaryCheckout(entry).projectId, 'main-project');
  assert.equal(getLauncherCheckoutLabel(mainCheckout), 'Main — master');
  assert.equal(getLauncherCheckoutLabel(worktree), 'feature/launcher');
});

test('main does not repeat the checkout and branch name', () => {
  assert.equal(getLauncherCheckoutLabel({ ...mainCheckout, branch: 'main' }), 'Main');
});

test('repositories without a registered main checkout retain the lead fallback', () => {
  const secondWorktree: Project = {
    ...worktree,
    projectId: 'second-feature',
    fullPath: '/workspace/example-second',
    branch: 'feature/second',
  };
  const [entry] = buildRepositoryEntries([worktree, secondWorktree]);

  assert.equal(resolvePrimaryCheckout(entry).projectId, 'feature-project');
});

test('non-Git projects are labelled as the project root', () => {
  const plainFolder: Project = {
    projectId: 'plain-project',
    displayName: 'notes',
    fullPath: '/workspace/notes',
    repositoryId: null,
  };

  assert.equal(getLauncherCheckoutLabel(plainFolder), 'Project root');
});

test('registered worktrees remain valid session targets without adoption', async () => {
  let adoptionCalls = 0;
  const selected = await resolveLauncherCheckoutSelection(worktree, async () => {
    adoptionCalls += 1;
    return null;
  });

  assert.equal(selected, worktree);
  assert.equal(adoptionCalls, 0);
});

test('discovered worktrees are adopted before they become session targets', async () => {
  const discovered: Project = {
    ...worktree,
    projectId: 'discovered:/workspace/example-feature',
    isDiscovered: true,
  };
  const registered: Project = {
    ...worktree,
    projectId: 'registered-feature',
  };
  let adoptedPath = '';

  const selected = await resolveLauncherCheckoutSelection(discovered, async (checkoutPath) => {
    adoptedPath = checkoutPath;
    return registered;
  });

  assert.equal(adoptedPath, discovered.fullPath);
  assert.equal(selected, registered);
});
