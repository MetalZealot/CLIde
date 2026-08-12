import assert from 'node:assert/strict';
import test from 'node:test';

import type { Project } from '../../../types/app';

import {
  compactHomePath,
  getBatchSelectableWorktrees,
  getWorktreeSessionCount,
} from './worktreeManager';

const registered: Project = {
  projectId: 'registered',
  displayName: 'Registered',
  fullPath: '/workspace/registered',
  sessions: [{ id: 'loaded-session' }],
  sessionMeta: { total: 12, hasMore: true },
};

test('worktree session count uses the server total beyond the loaded page', () => {
  assert.equal(getWorktreeSessionCount(registered), 12);
  assert.equal(getWorktreeSessionCount({ ...registered, sessionMeta: undefined }), 1);
});

test('batch selection excludes discovered checkouts with synthetic ids', () => {
  const discovered: Project = {
    ...registered,
    projectId: 'discovered:/workspace/discovered',
    fullPath: '/workspace/discovered',
    isDiscovered: true,
    sessions: [],
    sessionMeta: { total: 0, hasMore: false },
  };

  assert.deepEqual(getBatchSelectableWorktrees([registered, discovered]), [registered]);
});

test('home paths keep their useful suffix without assuming a username', () => {
  assert.equal(compactHomePath('/home/grayson/Projects/cloudcli'), '~/Projects/cloudcli');
  assert.equal(compactHomePath('/srv/cloudcli'), '/srv/cloudcli');
});
