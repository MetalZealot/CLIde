import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test, { describe } from 'node:test';

import {
  closeConnection,
  initializeDatabase,
  scheduledMessagesDb,
  sessionsDb,
  type ScheduledMessageRow,
} from '@/modules/database/index.js';
import {
  createScheduledMessageDispatcher,
  fireUsageResetMessages,
  hasPendingUsageResetMessages,
  setActiveScheduledMessageDispatcher,
} from '@/modules/scheduled-messages/index.js';

async function withIsolatedDatabase(runTest: () => void | Promise<void>): Promise<void> {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const tempDirectory = await mkdtemp(path.join(tmpdir(), 'scheduled-messages-'));

  closeConnection();
  process.env.DATABASE_PATH = path.join(tempDirectory, 'auth.db');
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
    await rm(tempDirectory, { recursive: true, force: true });
  }
}

function seedSession(sessionId: string): void {
  sessionsDb.createAppSession(sessionId, 'claude', '/workspace/demo-project');
}

/** A dispatcher whose clock and timers are ours, so nothing waits in real time. */
function createHarness(options: { sendResult?: () => Promise<{ ok: true } | { ok: false; reason: string }> } = {}) {
  const sent: ScheduledMessageRow[] = [];
  let currentTime = Date.parse('2026-07-18T10:00:00.000Z');
  const pending: { at: number; callback: () => void }[] = [];

  const dispatcher = createScheduledMessageDispatcher({
    send: async (row) => {
      sent.push(row);
      return options.sendResult ? await options.sendResult() : { ok: true };
    },
    now: () => currentTime,
    setTimeout: ((callback: () => void, delayMs: number) => {
      const timer = { at: currentTime + delayMs, callback };
      pending.push(timer);
      return timer as unknown as ReturnType<typeof setTimeout>;
    }) as never,
    clearTimeout: ((timer: unknown) => {
      const index = pending.indexOf(timer as { at: number; callback: () => void });
      if (index >= 0) pending.splice(index, 1);
    }) as never,
  });

  return {
    dispatcher,
    sent,
    /** Advances the clock and runs every timer that has come due. */
    async advanceTo(iso: string) {
      currentTime = Date.parse(iso);
      for (const timer of pending.filter((entry) => entry.at <= currentTime)) {
        const index = pending.indexOf(timer);
        if (index >= 0) pending.splice(index, 1);
        timer.callback();
      }
      await Promise.resolve();
    },
  };
}

describe('scheduled-messages', () => {
  test('a message scheduled for later is stored pending and not sent yet', async () => {
    await withIsolatedDatabase(async () => {
      seedSession('session-1');
      const harness = createHarness();

      const row = scheduledMessagesDb.create({
        sessionId: 'session-1',
        provider: 'claude',
        content: 'carry on',
        trigger: 'time',
        scheduledFor: '2026-07-18T11:00:00.000Z',
      });
      harness.dispatcher.schedule(row);

      assert.equal(scheduledMessagesDb.getById(row.id)?.state, 'pending');
      assert.equal(harness.sent.length, 0);
    });
  });

  test('a due message fires once and is recorded as sent', async () => {
    await withIsolatedDatabase(async () => {
      seedSession('session-2');
      const harness = createHarness();

      const row = scheduledMessagesDb.create({
        sessionId: 'session-2',
        provider: 'claude',
        content: 'carry on',
        trigger: 'time',
        scheduledFor: '2026-07-18T11:00:00.000Z',
      });
      harness.dispatcher.schedule(row);
      await harness.advanceTo('2026-07-18T11:00:00.000Z');

      assert.equal(harness.sent.length, 1);
      assert.equal(harness.sent[0]?.content, 'carry on');
      assert.equal(scheduledMessagesDb.getById(row.id)?.state, 'sent');
    });
  });

  // The row is the only durable record; timers do not survive a process.
  test('a message scheduled before a restart still fires after one', async () => {
    await withIsolatedDatabase(async () => {
      seedSession('session-3');
      const beforeRestart = createHarness();
      const row = scheduledMessagesDb.create({
        sessionId: 'session-3',
        provider: 'claude',
        content: 'still here',
        trigger: 'time',
        scheduledFor: '2026-07-18T11:00:00.000Z',
      });
      beforeRestart.dispatcher.schedule(row);
      beforeRestart.dispatcher.close();

      const afterRestart = createHarness();
      afterRestart.dispatcher.reconcile();
      await afterRestart.advanceTo('2026-07-18T11:00:00.000Z');

      assert.equal(afterRestart.sent.length, 1);
      assert.equal(scheduledMessagesDb.getById(row.id)?.state, 'sent');
    });
  });

  test('a message already overdue at startup fires on reconcile rather than waiting', async () => {
    await withIsolatedDatabase(async () => {
      seedSession('session-4');
      const harness = createHarness();
      const row = scheduledMessagesDb.create({
        sessionId: 'session-4',
        provider: 'claude',
        content: 'overdue',
        trigger: 'time',
        // The harness clock starts at 10:00, so this is already past.
        scheduledFor: '2026-07-18T09:00:00.000Z',
      });

      harness.dispatcher.reconcile();
      await Promise.resolve();

      assert.equal(harness.sent.length, 1);
      assert.equal(scheduledMessagesDb.getById(row.id)?.state, 'sent');
    });
  });

  test('two dispatchers racing the same row send it once', async () => {
    await withIsolatedDatabase(async () => {
      seedSession('session-5');
      const first = createHarness();
      const second = createHarness();
      const row = scheduledMessagesDb.create({
        sessionId: 'session-5',
        provider: 'claude',
        content: 'once only',
        trigger: 'time',
        scheduledFor: '2026-07-18T11:00:00.000Z',
      });

      first.dispatcher.schedule(row);
      second.dispatcher.schedule(row);
      await first.advanceTo('2026-07-18T11:00:00.000Z');
      await second.advanceTo('2026-07-18T11:00:00.000Z');

      assert.equal(first.sent.length + second.sent.length, 1);
    });
  });

  test('a cancelled message never fires', async () => {
    await withIsolatedDatabase(async () => {
      seedSession('session-6');
      const harness = createHarness();
      const row = scheduledMessagesDb.create({
        sessionId: 'session-6',
        provider: 'claude',
        content: 'never mind',
        trigger: 'time',
        scheduledFor: '2026-07-18T11:00:00.000Z',
      });
      harness.dispatcher.schedule(row);

      assert.equal(harness.dispatcher.cancel(row.id), true);
      await harness.advanceTo('2026-07-18T11:00:00.000Z');

      assert.equal(harness.sent.length, 0);
      assert.equal(scheduledMessagesDb.getById(row.id)?.state, 'cancelled');
      // Cancelling twice reports that there was nothing left to claim.
      assert.equal(harness.dispatcher.cancel(row.id), false);
    });
  });

  test('a refused send is recorded as failed with its reason, not as sent', async () => {
    await withIsolatedDatabase(async () => {
      seedSession('session-7');
      const harness = createHarness({
        sendResult: async () => ({ ok: false, reason: 'A run is already in progress for this session.' }),
      });
      const row = scheduledMessagesDb.create({
        sessionId: 'session-7',
        provider: 'claude',
        content: 'busy',
        trigger: 'time',
        scheduledFor: '2026-07-18T11:00:00.000Z',
      });
      harness.dispatcher.schedule(row);
      await harness.advanceTo('2026-07-18T11:00:00.000Z');

      const settled = scheduledMessagesDb.getById(row.id);
      assert.equal(settled?.state, 'failed');
      assert.match(settled?.failure_reason ?? '', /run is already in progress/);
    });
  });

  test('a usage-reset message waits for its provider and ignores the clock', async () => {
    await withIsolatedDatabase(async () => {
      seedSession('session-8');
      const harness = createHarness();
      const row = scheduledMessagesDb.create({
        sessionId: 'session-8',
        provider: 'claude',
        content: 'resume',
        trigger: 'usage-reset',
      });
      harness.dispatcher.schedule(row);

      await harness.advanceTo('2026-07-19T11:00:00.000Z');
      assert.equal(harness.sent.length, 0, 'time must not fire a usage-reset trigger');

      await harness.dispatcher.fireUsageReset('codex');
      assert.equal(harness.sent.length, 0, 'another provider must not fire it');

      await harness.dispatcher.fireUsageReset('claude');
      assert.equal(harness.sent.length, 1);
      assert.equal(scheduledMessagesDb.getById(row.id)?.state, 'sent');
    });
  });

  test('the runtime seam reports and fires only what a registered dispatcher can send', async () => {
    await withIsolatedDatabase(async () => {
      seedSession('session-10');
      const harness = createHarness();
      const row = scheduledMessagesDb.create({
        sessionId: 'session-10',
        provider: 'claude',
        content: 'carry on',
        trigger: 'usage-reset',
      });

      try {
        // Nothing can be sent without a dispatcher, so the reset monitor is
        // told there is nothing worth staying awake for.
        assert.equal(hasPendingUsageResetMessages('claude'), false);
        await fireUsageResetMessages('claude');
        assert.equal(scheduledMessagesDb.getById(row.id)?.state, 'pending');

        setActiveScheduledMessageDispatcher(harness.dispatcher);
        assert.equal(hasPendingUsageResetMessages('claude'), true);
        assert.equal(hasPendingUsageResetMessages('codex'), false);

        await fireUsageResetMessages('claude');
        assert.equal(harness.sent.length, 1);
        assert.equal(scheduledMessagesDb.getById(row.id)?.state, 'sent');
        // Settled rows stop keeping the monitor alive.
        assert.equal(hasPendingUsageResetMessages('claude'), false);
      } finally {
        setActiveScheduledMessageDispatcher(null);
      }
    });
  });

  test('deleting a session takes its scheduled messages with it', async () => {
    await withIsolatedDatabase(async () => {
      seedSession('session-9');
      const row = scheduledMessagesDb.create({
        sessionId: 'session-9',
        provider: 'claude',
        content: 'orphan',
        trigger: 'usage-reset',
      });

      sessionsDb.deleteSessionById('session-9');

      assert.equal(scheduledMessagesDb.getById(row.id), null);
    });
  });
});
