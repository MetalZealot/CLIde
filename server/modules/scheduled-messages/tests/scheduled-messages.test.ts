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
  AUTO_CONTINUE_MAX_CONSECUTIVE,
  DEFAULT_AUTO_CONTINUE_MESSAGE,
  armAutoContinueAfterLimitStop,
  cancelScheduledMessage,
  createScheduledMessage,
  createScheduledMessageDispatcher,
  createScheduledMessageSender,
  fireUsageResetMessages,
  hasPendingUsageResetMessages,
  pauseScheduledMessage,
  listScheduledMessagesForSession,
  readAutoContinueMessage,
  readScheduledMessageAttachments,
  resumeScheduledMessage,
  sendScheduledMessageNow,
  setScheduledMessageRuntime,
  writeAutoContinueMessage,
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
      let pendingChangedCount = 0;
      const row = scheduledMessagesDb.create({
        sessionId: 'session-10',
        provider: 'claude',
        content: 'carry on',
        trigger: 'usage-reset',
      });

      try {
        // Nothing can be sent without a runtime, so the reset monitor is told
        // there is nothing worth staying awake for.
        assert.equal(hasPendingUsageResetMessages('claude'), false);
        await fireUsageResetMessages('claude');
        assert.equal(scheduledMessagesDb.getById(row.id)?.state, 'pending');

        setScheduledMessageRuntime({
          dispatcher: harness.dispatcher,
          onPendingChanged: () => { pendingChangedCount += 1; },
          isSessionBusy: () => false,
        });
        assert.equal(hasPendingUsageResetMessages('claude'), true);
        assert.equal(hasPendingUsageResetMessages('codex'), false);

        await fireUsageResetMessages('claude');
        assert.equal(harness.sent.length, 1);
        assert.equal(scheduledMessagesDb.getById(row.id)?.state, 'sent');
        // Settled rows stop keeping the monitor alive, and the monitor is told
        // so it can stop polling a provider nothing is waiting on.
        assert.equal(hasPendingUsageResetMessages('claude'), false);
        assert.equal(pendingChangedCount, 1);
      } finally {
        setScheduledMessageRuntime(null);
      }
    });
  });

  test('creating and cancelling through the service arms, reconciles, and settles', async () => {
    await withIsolatedDatabase(async () => {
      seedSession('session-11');
      const harness = createHarness();
      let pendingChangedCount = 0;

      try {
        setScheduledMessageRuntime({
          dispatcher: harness.dispatcher,
          onPendingChanged: () => { pendingChangedCount += 1; },
          isSessionBusy: () => false,
        });

        const row = createScheduledMessage({
          sessionId: 'session-11',
          provider: 'claude',
          content: 'later',
          trigger: 'time',
          scheduledFor: '2026-07-18T12:00:00.000Z',
        });
        assert.equal(pendingChangedCount, 1);
        assert.deepEqual(
          listScheduledMessagesForSession('session-11').map((entry) => entry.id),
          [row.id],
        );

        // The path a composer actually takes: created while running, armed by
        // that call alone, with no reconcile in between.
        const armed = createScheduledMessage({
          sessionId: 'session-11',
          provider: 'claude',
          content: 'fires without a restart',
          trigger: 'time',
          scheduledFor: '2026-07-18T10:15:00.000Z',
        });
        await harness.advanceTo('2026-07-18T10:15:00.000Z');
        assert.equal(harness.sent.length, 1);
        assert.equal(scheduledMessagesDb.getById(armed.id)?.state, 'sent');
        assert.deepEqual(
          listScheduledMessagesForSession('session-11').map((entry) => entry.id),
          [armed.id, row.id],
          'newest first, even when both were written within one second',
        );

        assert.equal(cancelScheduledMessage(row.id), true);
        assert.equal(scheduledMessagesDb.getById(row.id)?.state, 'cancelled');
        assert.equal(pendingChangedCount, 3);

        // Cancelling twice is not an error the caller can act on, and the
        // second one must not fire the reconcile again.
        assert.equal(cancelScheduledMessage(row.id), false);
        assert.equal(pendingChangedCount, 3);

        // The cancelled row's timer went with it; only the armed one ever sent.
        await harness.advanceTo('2026-07-18T13:00:00.000Z');
        assert.equal(harness.sent.length, 1);
      } finally {
        setScheduledMessageRuntime(null);
      }
    });
  });

  test('a fired message is written to whoever is listening, not to a dead socket', async () => {
    await withIsolatedDatabase(async () => {
      seedSession('session-12');
      const delivered: unknown[] = [];
      const row = scheduledMessagesDb.create({
        sessionId: 'session-12',
        provider: 'claude',
        content: 'say something',
        trigger: 'usage-reset',
      });

      // Nobody sent this turn, so no client is subscribed to it. A connection
      // that reports closed silently discards the whole run.
      const send = createScheduledMessageSender<{ id: string }>({
        connection: { readyState: 1, send: (data) => { delivered.push(data); } },
        startRun: (input) => {
          input.connection.send('frame-for-open-clients');
          return { id: input.appSessionId };
        },
        runTurn: async () => {},
      });

      const result = await send(row);
      assert.deepEqual(result, { ok: true });
      assert.deepEqual(delivered, ['frame-for-open-clients']);
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
  test('a paused message never fires, however long the editor is away', async () => {
    await withIsolatedDatabase(async () => {
      seedSession('session-13');
      const harness = createHarness();

      const row = scheduledMessagesDb.create({
        sessionId: 'session-13',
        provider: 'claude',
        content: 'being edited',
        trigger: 'time',
        scheduledFor: '2026-07-18T10:30:00.000Z',
      });
      harness.dispatcher.schedule(row);
      assert.equal(scheduledMessagesDb.pause(row.id), true);
      harness.dispatcher.schedule(scheduledMessagesDb.getById(row.id) as ScheduledMessageRow);

      await harness.advanceTo('2026-07-18T18:00:00.000Z');
      assert.equal(harness.sent.length, 0, 'a paused message must not send on its own');
      assert.equal(scheduledMessagesDb.getById(row.id)?.state, 'paused');
      // It still reads as waiting, so the sidebar clock and the offer both count it.
      assert.equal(scheduledMessagesDb.listSessionIdsWithPending().includes('session-13'), true);

      // A restart while paused rebuilds nothing for it.
      const restarted = createHarness();
      restarted.dispatcher.reconcile();
      await restarted.advanceTo('2026-07-19T10:00:00.000Z');
      assert.equal(restarted.sent.length, 0);
    });
  });

  test('resuming sends what came due while paused, and keeps waiting when nothing did', async () => {
    await withIsolatedDatabase(async () => {
      seedSession('session-14');
      const harness = createHarness();

      const overdue = scheduledMessagesDb.create({
        sessionId: 'session-14',
        provider: 'claude',
        content: 'its time passed',
        trigger: 'time',
        scheduledFor: '2026-07-18T10:30:00.000Z',
      });
      const later = scheduledMessagesDb.create({
        sessionId: 'session-14',
        provider: 'claude',
        content: 'still in the future',
        trigger: 'time',
        scheduledFor: '2026-07-18T12:00:00.000Z',
      });
      scheduledMessagesDb.pause(overdue.id);
      scheduledMessagesDb.pause(later.id);
      await harness.advanceTo('2026-07-18T11:00:00.000Z');
      assert.equal(harness.sent.length, 0);

      harness.dispatcher.schedule(
        scheduledMessagesDb.resume(overdue.id) ? scheduledMessagesDb.getById(overdue.id) as ScheduledMessageRow : overdue,
      );
      await Promise.resolve();
      assert.deepEqual(harness.sent.map((row) => row.id), [overdue.id], 'a time that passed fires on resume');

      harness.dispatcher.schedule(
        scheduledMessagesDb.resume(later.id) ? scheduledMessagesDb.getById(later.id) as ScheduledMessageRow : later,
      );
      await Promise.resolve();
      assert.deepEqual(harness.sent.map((row) => row.id), [overdue.id], 'one still ahead keeps waiting');

      await harness.advanceTo('2026-07-18T12:00:00.000Z');
      assert.deepEqual(harness.sent.map((row) => row.id), [overdue.id, later.id]);
    });
  });

  // The monitor's recovery is a one-time transition, so a paused row has to
  // remember that it missed one.
  test('a usage reset during an edit sends the message when it resumes, even across a restart', async () => {
    await withIsolatedDatabase(async () => {
      seedSession('session-15');
      const harness = createHarness();
      const create = (content: string) => scheduledMessagesDb.create({
        sessionId: 'session-15',
        provider: 'claude',
        content,
        trigger: 'usage-reset',
      });

      const missed = create('paused through the reset');
      const acrossRestart = create('paused through the reset, then the server restarted');
      const untouched = create('not being edited');
      scheduledMessagesDb.pause(missed.id);
      scheduledMessagesDb.pause(acrossRestart.id);

      await harness.dispatcher.fireUsageReset('claude');
      assert.deepEqual(harness.sent.map((row) => row.id), [untouched.id]);
      assert.equal(scheduledMessagesDb.getById(missed.id)?.reset_missed, 1);

      const noReset = create('paused after the reset');
      scheduledMessagesDb.pause(noReset.id);
      scheduledMessagesDb.resume(noReset.id);
      harness.dispatcher.schedule(scheduledMessagesDb.getById(noReset.id) as ScheduledMessageRow);
      await Promise.resolve();
      assert.equal(scheduledMessagesDb.getById(noReset.id)?.state, 'pending', 'no reset of its own to catch up on');

      scheduledMessagesDb.resume(missed.id);
      harness.dispatcher.schedule(scheduledMessagesDb.getById(missed.id) as ScheduledMessageRow);
      await Promise.resolve();
      assert.deepEqual(harness.sent.map((row) => row.id), [untouched.id, missed.id]);

      const restarted = createHarness();
      scheduledMessagesDb.resume(acrossRestart.id);
      restarted.dispatcher.reconcile();
      await Promise.resolve();
      assert.deepEqual(restarted.sent.map((row) => row.id), [acrossRestart.id], 'a rebuilt dispatcher still owes it');
    });
  });

  test('an edit keeps its attachments, and a second device takes over the same pause', async () => {
    await withIsolatedDatabase(async () => {
      seedSession('session-16');
      const harness = createHarness();
      const attachments = [{ path: '/assets/photo.png', name: 'photo.png', mimeType: 'image/png' }];

      try {
        setScheduledMessageRuntime({
          dispatcher: harness.dispatcher,
          onPendingChanged: () => {},
          isSessionBusy: () => false,
        });
        const row = createScheduledMessage({
          sessionId: 'session-16',
          provider: 'claude',
          content: 'look at this',
          options: { attachments, model: 'opus' },
          trigger: 'usage-reset',
        });

        const phone = pauseScheduledMessage(row.id);
        assert.equal(phone?.state, 'paused');
        // The stored copy an edit opens with carries the files back to the composer.
        assert.deepEqual(readScheduledMessageAttachments(phone as ScheduledMessageRow), attachments);
        // A second device opening the same edit is not an error; both see one paused message.
        assert.equal(pauseScheduledMessage(row.id)?.state, 'paused');

        const saved = resumeScheduledMessage(row.id, {
          content: 'look at this one',
          options: { attachments, model: 'opus' },
        });
        assert.equal(saved?.content, 'look at this one');
        assert.equal(saved?.state, 'pending', 'saving keeps waiting on the reset');
        assert.deepEqual(readScheduledMessageAttachments(saved as ScheduledMessageRow), attachments);
        // Saving twice cannot happen from a message that is no longer paused.
        assert.equal(resumeScheduledMessage(row.id, { content: 'stale', options: {} }), null);

        assert.equal(cancelScheduledMessage(row.id), true);
        assert.equal(pauseScheduledMessage(row.id), null);
      } finally {
        setScheduledMessageRuntime(null);
      }
    });
  });

  test('send now goes ahead of the trigger once, and waits instead while a reply runs', async () => {
    await withIsolatedDatabase(async () => {
      seedSession('session-17');
      const harness = createHarness();
      let busy = true;
      let pendingChangedCount = 0;

      try {
        assert.equal(sendScheduledMessageNow('missing'), 'unavailable');
        setScheduledMessageRuntime({
          dispatcher: harness.dispatcher,
          onPendingChanged: () => { pendingChangedCount += 1; },
          isSessionBusy: (sessionId) => busy && sessionId === 'session-17',
        });
        const row = createScheduledMessage({
          sessionId: 'session-17',
          provider: 'claude',
          content: 'go early',
          trigger: 'time',
          scheduledFor: '2026-07-18T12:00:00.000Z',
        });

        // Refused before the claim, so the message is still waiting, not failed.
        assert.equal(sendScheduledMessageNow(row.id), 'busy');
        assert.equal(scheduledMessagesDb.getById(row.id)?.state, 'pending');
        assert.equal(harness.sent.length, 0);

        busy = false;
        assert.equal(sendScheduledMessageNow(row.id), 'sent');
        await Promise.resolve();
        assert.deepEqual(harness.sent.map((entry) => entry.id), [row.id]);
        assert.equal(scheduledMessagesDb.getById(row.id)?.state, 'sent');
        assert.equal(pendingChangedCount, 2);
        assert.equal(sendScheduledMessageNow(row.id), 'not-pending');

        // Its own timer went with the early send.
        await harness.advanceTo('2026-07-18T13:00:00.000Z');
        assert.equal(harness.sent.length, 1);

        // A paused message is resumed or edited, never sent from under the edit.
        const paused = createScheduledMessage({
          sessionId: 'session-17',
          provider: 'claude',
          content: 'being edited',
          trigger: 'usage-reset',
        });
        pauseScheduledMessage(paused.id);
        assert.equal(sendScheduledMessageNow(paused.id), 'not-pending');
        assert.equal(scheduledMessagesDb.getById(paused.id)?.state, 'paused');
      } finally {
        setScheduledMessageRuntime(null);
      }
    });
  });

  test('a session set to Auto-Continue arms one continue per limit stop, up to the cap', async () => {
    await withIsolatedDatabase(() => {
      seedSession('session-auto');
      writeAutoContinueMessage('Keep going');
      // Cancelled rows stay listed, so "waiting" is the only count that matters.
      const waiting = () => listScheduledMessagesForSession('session-auto')
        .filter((row) => row.state === 'pending' || row.state === 'paused');

      // Off by default: a limit stop on an ordinary session arms nothing.
      assert.equal(armAutoContinueAfterLimitStop('session-auto'), 'off');
      assert.equal(waiting().length, 0);

      sessionsDb.setSessionAutoContinue('session-auto', true);
      assert.equal(armAutoContinueAfterLimitStop('session-auto'), 'armed');
      const [armed] = waiting();
      assert.equal(armed?.content, 'Keep going', 'the stored message is what goes');
      assert.equal(armed?.trigger_kind, 'usage-reset');

      // A second stop while the first is still waiting must not stack rows.
      assert.equal(armAutoContinueAfterLimitStop('session-auto'), 'already-waiting');
      assert.equal(waiting().length, 1);

      // Each firing counts once the row is out of the way.
      for (let fired = 1; fired < AUTO_CONTINUE_MAX_CONSECUTIVE; fired += 1) {
        cancelScheduledMessage(waiting()[0]!.id);
        assert.equal(armAutoContinueAfterLimitStop('session-auto'), 'armed');
      }

      // The cap: it stops and turns itself off rather than re-arming forever.
      cancelScheduledMessage(waiting()[0]!.id);
      assert.equal(armAutoContinueAfterLimitStop('session-auto'), 'capped');
      assert.equal(sessionsDb.getSessionAutoContinue('session-auto')?.enabled, false);
      assert.equal(waiting().length, 0, 'the cap arms nothing');

      // Turning it back on starts the count over, and anything the user sends
      // clears it too — that reset is what `chat.send` calls.
      sessionsDb.setSessionAutoContinue('session-auto', true);
      assert.equal(sessionsDb.getSessionAutoContinue('session-auto')?.streak, 0);
      assert.equal(armAutoContinueAfterLimitStop('session-auto'), 'armed');
      assert.equal(sessionsDb.getSessionAutoContinue('session-auto')?.streak, 1);
      sessionsDb.resetAutoContinueStreak('session-auto');
      assert.equal(sessionsDb.getSessionAutoContinue('session-auto')?.streak, 0);
    });
  });

  test('the Auto-Continue message defaults, persists, and falls back when cleared', async () => {
    await withIsolatedDatabase(() => {
      assert.equal(readAutoContinueMessage(), DEFAULT_AUTO_CONTINUE_MESSAGE);

      assert.equal(writeAutoContinueMessage('  Carry on where you left off  '), 'Carry on where you left off');
      assert.equal(readAutoContinueMessage(), 'Carry on where you left off');

      // Emptying the field in Settings restores the default rather than
      // scheduling a turn with nothing in it.
      assert.equal(writeAutoContinueMessage('   '), DEFAULT_AUTO_CONTINUE_MESSAGE);
      assert.equal(readAutoContinueMessage(), DEFAULT_AUTO_CONTINUE_MESSAGE);
    });
  });

  test('new sessions take the standing Auto-Continue mode Settings holds', async () => {
    await withIsolatedDatabase(() => {
      assert.equal(sessionsDb.getAutoContinueDefault(), false);
      seedSession('session-before');
      assert.equal(sessionsDb.getSessionAutoContinue('session-before')?.enabled, false);

      sessionsDb.setAutoContinueDefault(true);
      seedSession('session-after');
      assert.equal(sessionsDb.getSessionAutoContinue('session-after')?.enabled, true);

      // The default seeds a row, it does not steer one: sessions that already
      // exist keep whatever their own row says, either way.
      assert.equal(sessionsDb.getSessionAutoContinue('session-before')?.enabled, false);
      sessionsDb.setAutoContinueDefault(false);
      assert.equal(sessionsDb.getSessionAutoContinue('session-after')?.enabled, true);

      // A session the watcher indexes from disk is an existing conversation.
      sessionsDb.setAutoContinueDefault(true);
      sessionsDb.createSession('provider-native-id', 'claude', '/workspace/demo-project');
      assert.equal(sessionsDb.getSessionAutoContinue('provider-native-id')?.enabled, false);
    });
  });
});
