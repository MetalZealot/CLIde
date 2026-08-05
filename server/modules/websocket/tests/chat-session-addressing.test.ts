import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { closeConnection, initializeDatabase, sessionsDb } from '@/modules/database/index.js';
import { chatRunRegistry } from '@/modules/websocket/services/chat-run-registry.service.js';
import { handleChatConnection } from '@/modules/websocket/services/chat-websocket.service.js';
import { connectedClients } from '@/modules/websocket/services/websocket-state.service.js';
import { getGlobalImageAssetsDir } from '@/shared/image-attachments.js';
import type { AuthenticatedWebSocketRequest } from '@/shared/types.js';

/**
 * Which id the gateway uses to address a running provider.
 *
 * Upstream v1.37 changed `options.sessionId` from the provider-native id to the
 * stable app id, and every runtime followed: Claude keys `activeSessions` by
 * `sessionKey()`, Cursor and OpenCode by `processKey`, all of which resolve to
 * the app id. The gateway kept addressing them by `providerSessionId` through
 * the merge, so `chat.abort` never found the run (Cursor and OpenCode have no
 * AbortController tier at all, so Stop did nothing) and `chat.subscribe`
 * replayed no pending approvals after a mid-prompt refresh.
 *
 * These tests pin the app id as the addressing key. They fail loudly against
 * provider-id addressing because the two ids are deliberately different here.
 */

class FakeConnection extends EventEmitter {
  readyState = 1; // WS_OPEN_STATE
  frames: Array<Record<string, unknown>> = [];

  send(data: string): void {
    this.frames.push(JSON.parse(data) as Record<string, unknown>);
  }
}

type ChatDependencies = Parameters<typeof handleChatConnection>[2];

async function withIsolatedDatabase(runTest: () => Promise<void>): Promise<void> {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const tempDirectory = await mkdtemp(path.join(tmpdir(), 'chat-addressing-'));

  closeConnection();
  process.env.DATABASE_PATH = path.join(tempDirectory, 'auth.db');
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

/** Lets the gateway's async message handlers settle before asserting. */
const flush = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

// Every provider runtime keys its process map by whatever id the gateway hands
// `run()`, so the id `abort()` is addressed with has to be that same one.
for (const provider of ['claude', 'cursor', 'codex', 'opencode'] as const) {
  test(`${provider}: chat.abort addresses the runtime by the app session id`, async () => {
    await withIsolatedDatabase(async () => {
      const appSessionId = `app-${provider}`;
      const providerSessionId = `native-${provider}-999`;
      sessionsDb.createAppSession(appSessionId, provider, '/workspace/demo');
      sessionsDb.assignProviderSessionId(appSessionId, providerSessionId);

      const abortedWith: string[] = [];
      const runReceived: Array<string | undefined> = [];
      let releaseRun = (): void => {};

      const dependencies: ChatDependencies = {
        runtime: {
          hasRuntime: () => true,
          run: async (_provider, _command, options) => {
            runReceived.push(options.sessionId as string | undefined);
            await new Promise<void>((resolve) => {
              releaseRun = resolve;
            });
          },
          abort: async (_provider, sessionId) => {
            abortedWith.push(sessionId);
            return true;
          },
          resolveInteractiveRequest: async () => ({ status: 'not_found' as const }),
          getPendingApprovalsForSession: () => [],
        },
      };

      const connection = new FakeConnection();
      handleChatConnection(connection as never, {} as AuthenticatedWebSocketRequest, dependencies);

      connection.emit('message', JSON.stringify({
        type: 'chat.send',
        sessionId: appSessionId,
        content: 'work on this',
      }));
      await flush();

      connection.emit('message', JSON.stringify({ type: 'chat.abort', sessionId: appSessionId }));
      await flush();
      releaseRun();
      await flush();

      // The run itself is dispatched with the app id — that is the contract the
      // abort key has to agree with.
      assert.deepEqual(runReceived, [appSessionId]);
      assert.deepEqual(abortedWith, [appSessionId]);
      assert.ok(
        !abortedWith.includes(providerSessionId),
        'the provider-native id must never be used to address a run',
      );
    });
  });
}

test('chat.subscribe replays pending approvals looked up by the app session id', async () => {
  await withIsolatedDatabase(async () => {
    const appSessionId = 'app-approval';
    const providerSessionId = 'native-approval-42';
    sessionsDb.createAppSession(appSessionId, 'claude', '/workspace/demo');
    sessionsDb.assignProviderSessionId(appSessionId, providerSessionId);

    const lookedUpWith: string[] = [];
    let releaseRun = (): void => {};

    const dependencies: ChatDependencies = {
      runtime: {
        hasRuntime: () => true,
        run: async () => {
          await new Promise<void>((resolve) => {
            releaseRun = resolve;
          });
        },
        abort: async () => true,
        resolveInteractiveRequest: async () => ({ status: 'not_found' as const }),
        getPendingApprovalsForSession: (sessionId) => {
          lookedUpWith.push(sessionId);
          // Runtimes register under the app id; a runtime that still stamps its
          // own id on the request must not leak it past the gateway.
          return sessionId === appSessionId
            ? [{
                requestId: 'req-1',
                sessionId: providerSessionId,
                toolName: 'request_user_input',
                isBlocking: false,
                autoResolutionMs: 120_000,
                expiresAt: '2026-08-12T12:02:00.000Z',
              }]
            : [];
        },
      },
    };

    const connection = new FakeConnection();
    handleChatConnection(connection as never, {} as AuthenticatedWebSocketRequest, dependencies);

    connection.emit('message', JSON.stringify({
      type: 'chat.send',
      sessionId: appSessionId,
      content: 'run a command',
    }));
    await flush();

    // A page refresh mid-approval: a second socket subscribes to the live run.
    const reconnected = new FakeConnection();
    handleChatConnection(reconnected as never, {} as AuthenticatedWebSocketRequest, dependencies);
    reconnected.emit('message', JSON.stringify({
      type: 'chat.subscribe',
      sessions: [{ sessionId: appSessionId }],
    }));
    await flush();
    releaseRun();
    await flush();

    assert.deepEqual(lookedUpWith, [appSessionId]);

    const subscribed = reconnected.frames.find((frame) => frame.kind === 'chat_subscribed');
    assert.ok(subscribed, 'the reconnecting socket should receive chat_subscribed');
    const pending = subscribed.pendingPermissions as Array<Record<string, unknown>>;
    assert.equal(pending.length, 1, 'the pending approval should survive the refresh');
    assert.equal(pending[0].requestId, 'req-1');
    assert.equal(pending[0].sessionId, appSessionId, 'the client only ever sees app ids');
    assert.equal(pending[0].isBlocking, false, 'blocking state should survive replay');
    assert.equal(pending[0].autoResolutionMs, 120_000);
    assert.equal(pending[0].expiresAt, '2026-08-12T12:02:00.000Z');
  });
});

test('chat.send forwards validated mixed attachments through the runtime contract', async () => {
  await withIsolatedDatabase(async () => {
    const appSessionId = 'app-attachments';
    sessionsDb.createAppSession(appSessionId, 'codex', '/workspace/demo');

    const assetsRoot = getGlobalImageAssetsDir();
    const image = {
      path: path.join(assetsRoot, 'screen.png'),
      name: 'screen.png',
      mimeType: 'image/png',
      size: 1024,
    };
    const file = {
      path: path.join(assetsRoot, 'brief.pdf'),
      name: 'brief.pdf',
      mimeType: 'application/pdf',
      size: 2048,
    };
    const receivedOptions: Array<Record<string, unknown>> = [];

    const dependencies: ChatDependencies = {
      runtime: {
        hasRuntime: () => true,
        run: async (_provider, _command, options) => {
          receivedOptions.push(options);
        },
        abort: async () => true,
        resolveInteractiveRequest: async () => ({ status: 'not_found' as const }),
        getPendingApprovalsForSession: () => [],
      },
    };

    const connection = new FakeConnection();
    handleChatConnection(connection as never, {} as AuthenticatedWebSocketRequest, dependencies);
    connection.emit('message', JSON.stringify({
      type: 'chat.send',
      sessionId: appSessionId,
      content: 'Inspect both attachments',
      options: {
        images: [image],
        files: [file],
        attachments: [file],
      },
    }));
    await flush();

    assert.equal(receivedOptions.length, 1);
    assert.equal(receivedOptions[0].sessionId, appSessionId);
    assert.deepEqual(receivedOptions[0].attachments, [image, file]);
    assert.deepEqual(receivedOptions[0].images, [image]);
    assert.deepEqual(receivedOptions[0].files, [file]);
  });
});
