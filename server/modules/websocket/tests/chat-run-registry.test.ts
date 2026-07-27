import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { closeConnection, initializeDatabase, sessionsDb } from '@/modules/database/index.js';
import { chatRunRegistry } from '@/modules/websocket/services/chat-run-registry.service.js';
import { connectedClients } from '@/modules/websocket/services/websocket-state.service.js';

/**
 * Minimal stand-in for a websocket connection: collects every JSON frame the
 * gateway writer forwards so assertions can inspect the outbound protocol.
 */
class FakeConnection {
  readyState = 1; // WS_OPEN_STATE
  frames: Array<Record<string, unknown>> = [];

  send(data: string): void {
    this.frames.push(JSON.parse(data) as Record<string, unknown>);
  }
}

async function withIsolatedDatabase(runTest: () => void | Promise<void>): Promise<void> {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const tempDirectory = await mkdtemp(path.join(tmpdir(), 'chat-run-registry-'));
  const databasePath = path.join(tempDirectory, 'auth.db');

  closeConnection();
  process.env.DATABASE_PATH = databasePath;
  await initializeDatabase();

  try {
    await runTest();
  } finally {
    connectedClients.clear();
    chatRunRegistry.clearAll();
    closeConnection();
    if (previousDatabasePath === undefined) {
      delete process.env.DATABASE_PATH;
    } else {
      process.env.DATABASE_PATH = previousDatabasePath;
    }
    await rm(tempDirectory, { recursive: true, force: true });
  }
}

test('live events are remapped to the app session id and sequenced', async () => {
  await withIsolatedDatabase(() => {
    sessionsDb.createAppSession('app-run-1', 'claude', '/workspace/demo');
    const connection = new FakeConnection();
    const run = chatRunRegistry.startRun({
      appSessionId: 'app-run-1',
      provider: 'claude',
      providerSessionId: null,
      connection,
      userId: 'user-1',
    });
    assert.ok(run);

    run.writer.send({ kind: 'stream_delta', provider: 'claude', sessionId: 'provider-id-9', content: 'hello' });
    run.writer.send({ kind: 'text', provider: 'claude', sessionId: 'provider-id-9', content: 'hello world' });

    assert.equal(connection.frames.length, 2);
    assert.equal(connection.frames[0]?.sessionId, 'app-run-1');
    assert.equal(connection.frames[0]?.seq, 1);
    assert.equal(connection.frames[0]?.runId, run.runId);
    assert.equal(connection.frames[1]?.sessionId, 'app-run-1');
    assert.equal(connection.frames[1]?.seq, 2);
    assert.equal(connection.frames[1]?.runId, run.runId);
  });
});

test('session_created is swallowed and persisted as the provider-id mapping', async () => {
  await withIsolatedDatabase(() => {
    sessionsDb.createAppSession('app-run-2', 'cursor', '/workspace/demo');
    const connection = new FakeConnection();
    connectedClients.add(connection as never);
    const run = chatRunRegistry.startRun({
      appSessionId: 'app-run-2',
      provider: 'cursor',
      providerSessionId: null,
      connection,
      userId: null,
    });
    assert.ok(run);

    run.writer.send({
      kind: 'session_created',
      provider: 'cursor',
      sessionId: 'cursor-native-7',
      newSessionId: 'cursor-native-7',
    });

    // The provider-native event itself is never forwarded...
    const sessionUpserts = connection.frames.filter((frame) => frame.kind === 'session_upserted');
    assert.equal(sessionUpserts.length, 1);
    assert.equal(sessionUpserts[0]?.sessionId, 'app-run-2');
    assert.equal(sessionUpserts[0]?.providerSessionId, 'cursor-native-7');
    // ...but the canonical mapping is recorded and persisted in the database.
    assert.equal(run.providerSessionId, 'cursor-native-7');
    assert.equal(sessionsDb.getSessionById('app-run-2')?.provider_session_id, 'cursor-native-7');
  });
});

test('provider session metadata updates the mapped transcript before history reconciliation', async () => {
  await withIsolatedDatabase(() => {
    sessionsDb.createAppSession('app-rewind', 'codex', '/workspace/demo');
    sessionsDb.assignProviderSessionId('app-rewind', 'codex-parent');
    sessionsDb.createSession(
      'codex-parent',
      'codex',
      '/workspace/demo',
      undefined,
      undefined,
      undefined,
      '/tmp/codex-parent.jsonl',
    );
    const connection = new FakeConnection();
    const run = chatRunRegistry.startRun({
      appSessionId: 'app-rewind',
      provider: 'codex',
      providerSessionId: 'codex-parent',
      connection,
      userId: null,
    });
    assert.ok(run);

    run.writer.setSessionId('codex-child', {
      projectPath: '/workspace/demo',
      jsonlPath: '/tmp/codex-child.jsonl',
    });

    const row = sessionsDb.getSessionById('app-rewind');
    assert.equal(row?.provider_session_id, 'codex-child');
    assert.equal(row?.jsonl_path, '/tmp/codex-child.jsonl');
    // The old transcript is tombstoned: re-indexing it resolves to the
    // stable row instead of resurrecting a duplicate.
    assert.equal(
      sessionsDb.createSession('codex-parent', 'codex', '/workspace/demo'),
      'app-rewind',
    );
  });
});

test('complete marks the run finished and duplicate completes are dropped', async () => {
  await withIsolatedDatabase(() => {
    sessionsDb.createAppSession('app-run-3', 'codex', '/workspace/demo');
    const connection = new FakeConnection();
    const run = chatRunRegistry.startRun({
      appSessionId: 'app-run-3',
      provider: 'codex',
      providerSessionId: null,
      connection,
      userId: null,
    });
    assert.ok(run);

    run.writer.send({ kind: 'complete', provider: 'codex', sessionId: 'native-3', exitCode: 0 });
    // Late duplicate from a killed runtime's exit handler.
    run.writer.send({ kind: 'complete', provider: 'codex', sessionId: 'native-3', exitCode: 1 });

    const completes = connection.frames.filter((frame) => frame.kind === 'complete');
    assert.equal(completes.length, 1);
    assert.equal(completes[0]?.actualSessionId, 'app-run-3');
    assert.equal(chatRunRegistry.isProcessing('app-run-3'), false);

    // completeRun is also a no-op once the run already completed.
    chatRunRegistry.completeRun('app-run-3', { exitCode: 1 });
    assert.equal(connection.frames.filter((frame) => frame.kind === 'complete').length, 1);
  });
});

test('dangling non-complete events after abort are dropped, not just duplicate completes', async () => {
  await withIsolatedDatabase(() => {
    sessionsDb.createAppSession('app-run-3b', 'claude', '/workspace/demo');
    const connection = new FakeConnection();
    const run = chatRunRegistry.startRun({
      appSessionId: 'app-run-3b',
      provider: 'claude',
      providerSessionId: null,
      connection,
      userId: null,
    });
    assert.ok(run);

    // Abort completes the run early (before the runtime's async generator
    // has actually stopped yielding).
    run.writer.sendComplete({ exitCode: 1, aborted: true });
    // The runtime's generator was still mid-flight when interrupt() resolved
    // and goes on producing a few more buffered messages.
    run.writer.send({ kind: 'stream_delta', provider: 'claude', sessionId: 'native-3b', content: 'dangling' });
    run.writer.send({ kind: 'complete', provider: 'claude', sessionId: 'native-3b', exitCode: 0 });

    assert.equal(connection.frames.length, 1);
    assert.equal(connection.frames[0]?.kind, 'complete');
  });
});

test('beginAbort claims a running run once and rejects concurrent duplicates', async () => {
  await withIsolatedDatabase(() => {
    sessionsDb.createAppSession('app-run-abort', 'claude', '/workspace/demo');
    const connection = new FakeConnection();
    const run = chatRunRegistry.startRun({
      appSessionId: 'app-run-abort',
      provider: 'claude',
      providerSessionId: 'native-abort',
      connection,
      userId: null,
    });
    assert.ok(run);

    // First Stop click claims the abort.
    const claimed = chatRunRegistry.beginAbort('app-run-abort');
    assert.equal(claimed, run);

    // A mashed second click (or a duplicate key handler) while the first
    // abort's provider interrupt call is still in flight must not get its
    // own claim — that would fire a second concurrent interrupt against the
    // same provider runtime.
    assert.equal(chatRunRegistry.beginAbort('app-run-abort'), null);

    // No active run at all still reports null, same as before this guard.
    assert.equal(chatRunRegistry.beginAbort('no-such-session'), null);
  });
});

test('abort before the runtime announces a provider session id still cancels the run', async () => {
  await withIsolatedDatabase(() => {
    sessionsDb.createAppSession('app-run-early-abort', 'claude', '/workspace/demo');
    const connection = new FakeConnection();
    // A brand-new session's first message: there is no provider-native id yet,
    // and there will not be one until the runtime announces it mid-stream.
    const run = chatRunRegistry.startRun({
      appSessionId: 'app-run-early-abort',
      provider: 'claude',
      providerSessionId: null,
      connection,
      userId: null,
    });
    assert.ok(run);
    assert.equal(run.abortController.signal.aborted, false);

    // Stop pressed immediately after send, while the runtime is still
    // spawning. The id-keyed provider interrupt has nothing to address here —
    // this is precisely the window in which abort used to be a silent no-op
    // and the run went on to produce a full reply.
    const claimed = chatRunRegistry.beginAbort('app-run-early-abort');
    assert.equal(claimed, run);
    assert.equal(run.providerSessionId, null);

    // The signal handed to the runtime at spawn time carries the cancellation
    // instead, and is already aborted by the time the runtime reads it.
    assert.equal(run.abortController.signal.aborted, true);
  });
});

test('an aborted complete reports whether the run reached the provider', async () => {
  await withIsolatedDatabase(() => {
    sessionsDb.createAppSession('app-run-undelivered', 'claude', '/workspace/demo');
    const connection = new FakeConnection();
    const run = chatRunRegistry.startRun({
      appSessionId: 'app-run-undelivered',
      provider: 'claude',
      providerSessionId: null,
      connection,
      userId: null,
    });
    assert.ok(run);

    // Stop before the runtime emitted anything at all: the provider never took
    // the turn, so the client's optimistic user row has nothing behind it.
    chatRunRegistry.beginAbort('app-run-undelivered');
    chatRunRegistry.completeRun('app-run-undelivered', { exitCode: 0, aborted: true });

    const complete = connection.frames.find((frame) => frame.kind === 'complete');
    assert.equal(complete?.aborted, true);
    assert.equal(complete?.deliveredToProvider, false);
  });
});

test('an abort after the run produced output is reported as delivered', async () => {
  await withIsolatedDatabase(() => {
    sessionsDb.createAppSession('app-run-delivered', 'claude', '/workspace/demo');
    const connection = new FakeConnection();
    const run = chatRunRegistry.startRun({
      appSessionId: 'app-run-delivered',
      provider: 'claude',
      providerSessionId: 'native-delivered',
      connection,
      userId: null,
    });
    assert.ok(run);

    // The runtime got going and streamed before the user hit Stop, so the turn
    // is real, is in the transcript, and its bubble must stay put.
    run.writer.send({ kind: 'stream_delta', provider: 'claude', sessionId: 'native-delivered', content: 'thinking' });
    chatRunRegistry.beginAbort('app-run-delivered');
    chatRunRegistry.completeRun('app-run-delivered', { exitCode: 0, aborted: true });

    const complete = connection.frames.find((frame) => frame.kind === 'complete');
    assert.equal(complete?.aborted, true);
    assert.equal(complete?.deliveredToProvider, true);
  });
});

test('a normally finished run carries no delivery flag', async () => {
  await withIsolatedDatabase(() => {
    sessionsDb.createAppSession('app-run-normal', 'codex', '/workspace/demo');
    const connection = new FakeConnection();
    const run = chatRunRegistry.startRun({
      appSessionId: 'app-run-normal',
      provider: 'codex',
      providerSessionId: null,
      connection,
      userId: null,
    });
    assert.ok(run);

    // The flag only disambiguates aborts; a run that ends on its own always
    // delivered, and must not trip the client's retraction path.
    chatRunRegistry.completeRun('app-run-normal', { exitCode: 0 });

    const complete = connection.frames.find((frame) => frame.kind === 'complete');
    assert.equal(complete?.aborted, false);
    assert.equal(complete?.deliveredToProvider, undefined);
  });
});

test('each run gets its own abort controller', async () => {
  await withIsolatedDatabase(() => {
    sessionsDb.createAppSession('app-run-abort-scope', 'claude', '/workspace/demo');
    const connection = new FakeConnection();

    const firstRun = chatRunRegistry.startRun({
      appSessionId: 'app-run-abort-scope',
      provider: 'claude',
      providerSessionId: null,
      connection,
      userId: null,
    });
    assert.ok(firstRun);
    chatRunRegistry.beginAbort('app-run-abort-scope');
    chatRunRegistry.completeRun('app-run-abort-scope', { exitCode: 0, aborted: true });

    // The next message in the same session must not inherit the aborted
    // signal — a per-session controller would cancel every later run instantly.
    const secondRun = chatRunRegistry.startRun({
      appSessionId: 'app-run-abort-scope',
      provider: 'claude',
      providerSessionId: null,
      connection,
      userId: null,
    });
    assert.ok(secondRun);
    assert.equal(secondRun.abortController.signal.aborted, false);
    assert.notEqual(secondRun.abortController, firstRun.abortController);
  });
});

test('a finished run\'s safety net cannot complete the session\'s next run', async () => {
  await withIsolatedDatabase(() => {
    sessionsDb.createAppSession('app-run-9', 'codex', '/workspace/demo');
    const connection = new FakeConnection();

    const firstRun = chatRunRegistry.startRun({
      appSessionId: 'app-run-9',
      provider: 'codex',
      providerSessionId: null,
      connection,
      userId: null,
    });
    assert.ok(firstRun);
    firstRun.writer.send({ kind: 'complete', provider: 'codex', sessionId: 'native-9', exitCode: 0 });

    // A queued message starts the next run before the first run's runtime
    // promise settles (the chat handler's `finally` hasn't executed yet).
    const secondRun = chatRunRegistry.startRun({
      appSessionId: 'app-run-9',
      provider: 'codex',
      providerSessionId: null,
      connection,
      userId: null,
    });
    assert.ok(secondRun);

    // First run's safety net fires late: it must not touch the new run.
    chatRunRegistry.completeRunIfCurrent(firstRun, { exitCode: 1 });
    assert.equal(chatRunRegistry.isProcessing('app-run-9'), true);
    assert.equal(connection.frames.filter((frame) => frame.kind === 'complete').length, 1);

    // The second run's own safety net still works while it is current.
    chatRunRegistry.completeRunIfCurrent(secondRun, { exitCode: 1 });
    assert.equal(chatRunRegistry.isProcessing('app-run-9'), false);
    assert.equal(connection.frames.filter((frame) => frame.kind === 'complete').length, 2);
  });
});

test('listRunningRuns returns only currently running app sessions', async () => {
  await withIsolatedDatabase(() => {
    sessionsDb.createAppSession('app-run-7', 'claude', '/workspace/demo');
    sessionsDb.createAppSession('app-run-8', 'codex', '/workspace/demo');
    const connection = new FakeConnection();

    const completedRun = chatRunRegistry.startRun({
      appSessionId: 'app-run-7',
      provider: 'claude',
      providerSessionId: null,
      connection,
      userId: null,
    });
    assert.ok(completedRun);

    const runningRun = chatRunRegistry.startRun({
      appSessionId: 'app-run-8',
      provider: 'codex',
      providerSessionId: null,
      connection,
      userId: null,
    });
    assert.ok(runningRun);

    chatRunRegistry.completeRun('app-run-7', { exitCode: 0 });

    const runningSessions = chatRunRegistry.listRunningRuns();
    assert.deepEqual(runningSessions.map((session) => session.sessionId), ['app-run-8']);
    assert.equal(runningSessions[0]?.provider, 'codex');
  });
});

test('replayEvents returns only events after the requested seq for the matching run', async () => {
  await withIsolatedDatabase(() => {
    sessionsDb.createAppSession('app-run-4', 'claude', '/workspace/demo');
    const connection = new FakeConnection();
    const run = chatRunRegistry.startRun({
      appSessionId: 'app-run-4',
      provider: 'claude',
      providerSessionId: null,
      connection,
      userId: null,
    });
    assert.ok(run);

    run.writer.send({ kind: 'stream_delta', provider: 'claude', sessionId: 'x', content: 'a' });
    run.writer.send({ kind: 'stream_delta', provider: 'claude', sessionId: 'x', content: 'b' });
    run.writer.send({ kind: 'stream_delta', provider: 'claude', sessionId: 'x', content: 'c' });

    const replayed = chatRunRegistry.replayEvents('app-run-4', 1, run.runId);
    assert.deepEqual(replayed.map((event) => event.content), ['b', 'c']);
    assert.deepEqual(replayed.map((event) => event.seq), [2, 3]);
  });
});

test('replayEvents ignores the client seq when its runId is stale or missing', async () => {
  await withIsolatedDatabase(() => {
    sessionsDb.createAppSession('app-run-10', 'claude', '/workspace/demo');
    const connection = new FakeConnection();
    const run = chatRunRegistry.startRun({
      appSessionId: 'app-run-10',
      provider: 'claude',
      providerSessionId: null,
      connection,
      userId: null,
    });
    assert.ok(run);

    run.writer.send({ kind: 'stream_delta', provider: 'claude', sessionId: 'x', content: 'a' });
    run.writer.send({ kind: 'stream_delta', provider: 'claude', sessionId: 'x', content: 'b' });

    // `seq` restarts per run, so a counter recorded against another run (or
    // before a server restart) says nothing about this one: a client stuck on
    // run 1's high-water mark must still receive ALL of run 2's events.
    const staleRun = chatRunRegistry.replayEvents('app-run-10', 40, 'some-older-run-id');
    assert.deepEqual(staleRun.map((event) => event.content), ['a', 'b']);

    const noRun = chatRunRegistry.replayEvents('app-run-10', 40, null);
    assert.deepEqual(noRun.map((event) => event.content), ['a', 'b']);

    const omitted = chatRunRegistry.replayEvents('app-run-10', 40);
    assert.deepEqual(omitted.map((event) => event.content), ['a', 'b']);
  });
});

test('consecutive runs for one session carry distinct runIds', async () => {
  await withIsolatedDatabase(() => {
    sessionsDb.createAppSession('app-run-11', 'codex', '/workspace/demo');
    const connection = new FakeConnection();

    const firstRun = chatRunRegistry.startRun({
      appSessionId: 'app-run-11',
      provider: 'codex',
      providerSessionId: null,
      connection,
      userId: null,
    });
    assert.ok(firstRun);
    assert.ok(firstRun.runId);
    chatRunRegistry.completeRun('app-run-11', { exitCode: 0 });

    const secondRun = chatRunRegistry.startRun({
      appSessionId: 'app-run-11',
      provider: 'codex',
      providerSessionId: null,
      connection,
      userId: null,
    });
    assert.ok(secondRun);
    assert.notEqual(secondRun.runId, firstRun.runId);
  });
});

test('attachConnection reroutes the live stream to a new socket', async () => {
  await withIsolatedDatabase(() => {
    sessionsDb.createAppSession('app-run-5', 'opencode', '/workspace/demo');
    const firstConnection = new FakeConnection();
    const run = chatRunRegistry.startRun({
      appSessionId: 'app-run-5',
      provider: 'opencode',
      providerSessionId: null,
      connection: firstConnection,
      userId: null,
    });
    assert.ok(run);

    run.writer.send({ kind: 'stream_delta', provider: 'opencode', sessionId: 'o', content: 'before' });

    const secondConnection = new FakeConnection();
    assert.equal(chatRunRegistry.attachConnection('app-run-5', secondConnection), true);
    run.writer.send({ kind: 'stream_delta', provider: 'opencode', sessionId: 'o', content: 'after' });

    assert.deepEqual(firstConnection.frames.map((frame) => frame.content), ['before']);
    assert.deepEqual(secondConnection.frames.map((frame) => frame.content), ['after']);
  });
});

test('startRun rejects a second concurrent run for the same session', async () => {
  await withIsolatedDatabase(() => {
    sessionsDb.createAppSession('app-run-6', 'opencode', '/workspace/demo');
    const connection = new FakeConnection();
    const first = chatRunRegistry.startRun({
      appSessionId: 'app-run-6',
      provider: 'opencode',
      providerSessionId: null,
      connection,
      userId: null,
    });
    assert.ok(first);

    const second = chatRunRegistry.startRun({
      appSessionId: 'app-run-6',
      provider: 'opencode',
      providerSessionId: null,
      connection,
      userId: null,
    });
    assert.equal(second, null);

    // After the run finishes a new one is allowed again.
    chatRunRegistry.completeRun('app-run-6', { exitCode: 0 });
    const third = chatRunRegistry.startRun({
      appSessionId: 'app-run-6',
      provider: 'opencode',
      providerSessionId: null,
      connection,
      userId: null,
    });
    assert.ok(third);
  });
});
