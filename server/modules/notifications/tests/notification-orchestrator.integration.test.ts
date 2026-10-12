import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  closeConnection,
  initializeDatabase,
  sessionsDb,
} from '@/modules/database/index.js';

import {
  buildNotificationPayload,
} from '../services/notification-orchestrator.service.js';

async function withIsolatedDatabase(runTest: () => void | Promise<void>): Promise<void> {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const temporaryDirectory = await mkdtemp(path.join(tmpdir(), 'notification-orchestrator-'));
  const databasePath = path.join(temporaryDirectory, 'auth.db');

  closeConnection();
  process.env.DATABASE_PATH = databasePath;
  await initializeDatabase();

  try {
    await runTest();
  } finally {
    closeConnection();
    if (previousDatabasePath === undefined) {
      delete process.env.DATABASE_PATH;
    } else {
      process.env.DATABASE_PATH = previousDatabasePath;
    }
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

test('notification payload uses the app session id for a provider session id', async () => {
  await withIsolatedDatabase(() => {
    sessionsDb.createAppSession('app-session-1', 'claude', '/workspace/demo');
    sessionsDb.assignProviderSessionId('app-session-1', 'claude-native-1');

    const payload = buildNotificationPayload({
      provider: 'claude',
      sessionId: 'claude-native-1',
      kind: 'stop',
      code: 'run.stopped',
      meta: { stopReason: 'completed' },
    });

    assert.equal(payload.data.sessionId, 'app-session-1');
    assert.equal(payload.body, 'Claude: Finished');

    const approval = buildNotificationPayload({
      provider: 'claude',
      sessionId: 'claude-native-1',
      kind: 'action_required',
      code: 'permission.required',
    });
    // Same tag, so the phone replaces the session's notification instead of stacking.
    assert.equal(approval.data.tag, payload.data.tag);
    // Only a finished run may land quietly, and only while CLIde is on screen.
    assert.equal(payload.data.quietWhenOpen, true);
    assert.equal(approval.data.quietWhenOpen, false);
  });
});

test('usage reset payload keeps grouped labels and the dashboard route', () => {
  const payload = buildNotificationPayload({
    provider: 'claude',
    sessionId: null,
    kind: 'usage_reset',
    code: 'usage.reset',
    meta: { windowLabels: ['5-hour limit', 'Weekly limit'] },
    urlPath: '/usage',
  });

  assert.match(payload.body, /5-hour limit, Weekly limit/);
  assert.equal(payload.data.urlPath, '/usage');
});
