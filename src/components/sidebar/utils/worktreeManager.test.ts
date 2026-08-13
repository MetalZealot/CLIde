import assert from 'node:assert/strict';
import test from 'node:test';

import type { Project } from '../../../types/app';

import {
  compactHomePath,
  getBatchSelectableWorktrees,
  getWorktreeSessionCount,
  shouldShowWorktreePath,
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

test('a path the name already gives away does not get its own line', () => {
  const lead = '/home/g/Projects/cloudcli';
  const beside = (fullPath: string, displayName: string): Project => ({
    ...registered,
    displayName,
    fullPath,
  });

  assert.equal(shouldShowWorktreePath(beside(lead, 'cloudcli'), lead), false);
  assert.equal(
    shouldShowWorktreePath(beside('/home/g/Projects/cloudcli-wt-tts', 'cloudcli-wt-tts'), lead),
    false,
  );
  // Renamed in CLIde, so the directory is no longer recoverable from the row.
  assert.equal(shouldShowWorktreePath(beside('/home/g/Projects/cloudcli-wt-tts', 'Voice'), lead), true);
  // Not beside the repository.
  assert.equal(shouldShowWorktreePath(beside('/mnt/external/cloudcli-wt-tts', 'cloudcli-wt-tts'), lead), true);
});

test('home paths keep their useful suffix without assuming a username', () => {
  assert.equal(compactHomePath('/home/grayson/Projects/cloudcli'), '~/Projects/cloudcli');
  assert.equal(compactHomePath('/srv/cloudcli'), '/srv/cloudcli');
});
