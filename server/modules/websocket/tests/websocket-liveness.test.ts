import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test, { describe } from 'node:test';

import { WebSocket } from 'ws';

import { handleChatConnection } from '@/modules/websocket/services/chat-websocket.service.js';
import { handleShellConnection } from '@/modules/websocket/services/shell-websocket.service.js';
import { attachWebSocketHeartbeat } from '@/modules/websocket/services/websocket-server.service.js';
import { connectedClients } from '@/modules/websocket/services/websocket-state.service.js';
import type { AuthenticatedWebSocketRequest } from '@/shared/types.js';

describe('websocket-liveness', () => {
  /**
   * Minimal stand-in for a websocket connection: an EventEmitter so the chat
   * handler's `ws.on('message')` wiring works, collecting every outbound JSON
   * frame for assertions.
   */
  class FakeConnection extends EventEmitter {
    readyState = 1; // WS_OPEN_STATE
    frames: Array<Record<string, unknown>> = [];

    send(data: string): void {
      this.frames.push(JSON.parse(data) as Record<string, unknown>);
    }
  }

  type ChatDependencies = Parameters<typeof handleChatConnection>[2];

  const noopDependencies: ChatDependencies = {
    runtime: {
      hasRuntime: () => false,
      run: async () => undefined,
      abort: async () => true,
      resolveInteractiveRequest: async () => ({ status: 'not_found' as const }),
      getPendingApprovalsForSession: () => [],
    },
  };

  function connectFake(): FakeConnection {
    const connection = new FakeConnection();
    handleChatConnection(
      connection as never,
      {} as AuthenticatedWebSocketRequest,
      noopDependencies
    );
    return connection;
  }

  function connectFakeWithDependencies(
    dependencies: ChatDependencies,
  ): FakeConnection {
    const connection = new FakeConnection();
    handleChatConnection(
      connection as never,
      {} as AuthenticatedWebSocketRequest,
      dependencies
    );
    return connection;
  }

  async function settle(): Promise<void> {
    // The message handler is async; let its microtasks drain.
    await new Promise((resolve) => setImmediate(resolve));
  }

  test('chat.ping is echoed as chat_pong with the client timestamp', async () => {
    const connection = connectFake();
    try {
      connection.emit('message', JSON.stringify({ type: 'chat.ping', ts: 1234567890 }));
      await settle();

      assert.equal(connection.frames.length, 1);
      const frame = connection.frames[0];
      assert.equal(frame.kind, 'chat_pong');
      assert.equal(frame.ts, 1234567890);
      assert.equal(typeof frame.timestamp, 'string');
    } finally {
      connectedClients.clear();
    }
  });

  test('chat.ping without a numeric ts still answers with a null echo', async () => {
    const connection = connectFake();
    try {
      connection.emit('message', JSON.stringify({ type: 'chat.ping' }));
      await settle();

      assert.equal(connection.frames.length, 1);
      assert.equal(connection.frames[0].kind, 'chat_pong');
      assert.equal(connection.frames[0].ts, null);
    } finally {
      connectedClients.clear();
    }
  });

  test('unknown message types still produce a protocol_error (ping must not regress this)', async () => {
    const connection = connectFake();
    try {
      connection.emit('message', JSON.stringify({ type: 'chat.nonsense' }));
      await settle();

      assert.equal(connection.frames.length, 1);
      assert.equal(connection.frames[0].kind, 'protocol_error');
      assert.equal(connection.frames[0].code, 'UNKNOWN_MESSAGE_TYPE');
    } finally {
      connectedClients.clear();
    }
  });

  test('chat.permission-response forwards normalized decisions and answer arrays', async () => {
    const calls: Array<{ requestId: string; payload: Record<string, unknown> }> = [];
    const connection = connectFakeWithDependencies({
      runtime: {
        ...noopDependencies.runtime,
        resolveInteractiveRequest: async (requestId, payload) => {
          calls.push({ requestId, payload });
          return { status: 'resolved' as const };
        },
      },
    });
    try {
      connection.emit('message', JSON.stringify({
        type: 'chat.permission-response',
        requestId: 'request-1',
        requestType: 'user_input',
        decision: 'allow_once',
        answers: { stable_id: ['A', 'free text'] },
        allow: true,
      }));
      await settle();

      assert.deepEqual(calls, [{
        requestId: 'request-1',
        payload: {
          allow: true,
          requestType: 'user_input',
          decision: 'allow_once',
          answers: { stable_id: ['A', 'free text'] },
          updatedInput: undefined,
          message: undefined,
          rememberEntry: undefined,
        },
      }]);
      assert.equal(connection.frames.length, 0);
    } finally {
      connectedClients.clear();
    }
  });

  test('chat.permission-response rejects invalid enums and malformed answer arrays before resolution', async () => {
    let calls = 0;
    const connection = connectFakeWithDependencies({
      runtime: {
        ...noopDependencies.runtime,
        resolveInteractiveRequest: async () => {
          calls += 1;
          return { status: 'resolved' as const };
        },
      },
    });
    try {
      connection.emit('message', JSON.stringify({
        type: 'chat.permission-response',
        requestId: 'request-1',
        decision: 'always_forever',
      }));
      await settle();
      connection.emit('message', JSON.stringify({
        type: 'chat.permission-response',
        requestId: 'request-2',
        requestType: 'user_input',
        answers: { stable_id: 'not-an-array' },
      }));
      await settle();

      assert.equal(calls, 0);
      assert.deepEqual(connection.frames.map((frame) => frame.code), [
        'INTERACTIVE_RESPONSE_INVALID',
        'INTERACTIVE_RESPONSE_INVALID',
      ]);
    } finally {
      connectedClients.clear();
    }
  });
  // --- transport heartbeat ----------------------------------------------------

  function createFakeSocket() {
    const socket = new EventEmitter() as EventEmitter & {
      readyState: number;
      pingCount: number;
      terminateCount: number;
      ping: () => void;
      terminate: () => void;
    };
    socket.readyState = WebSocket.OPEN;
    socket.pingCount = 0;
    socket.terminateCount = 0;
    socket.ping = () => {
      socket.pingCount += 1;
    };
    socket.terminate = () => {
      socket.terminateCount += 1;
    };
    return socket;
  }

  function createScheduler() {
    let callback: (() => void) | null = null;
    let wasCleared = false;

    return {
      setInterval(nextCallback: () => void) {
        callback = nextCallback;
        return 1 as unknown as NodeJS.Timeout;
      },
      clearInterval() {
        wasCleared = true;
      },
      tick() {
        callback?.();
      },
      cleared() {
        return wasCleared;
      },
    };
  }

  test('heartbeat terminates an open socket that does not answer its ping', () => {
    const socket = createFakeSocket();
    const scheduler = createScheduler();
    attachWebSocketHeartbeat(socket as never, 30_000, scheduler);

    scheduler.tick();
    assert.equal(socket.pingCount, 1);
    assert.equal(socket.terminateCount, 0);

    scheduler.tick();
    assert.equal(socket.terminateCount, 1);
    assert.equal(scheduler.cleared(), true);
  });

  test('heartbeat keeps responsive sockets open and stops after close', () => {
    const socket = createFakeSocket();
    const scheduler = createScheduler();
    attachWebSocketHeartbeat(socket as never, 30_000, scheduler);

    scheduler.tick();
    socket.emit('pong');
    scheduler.tick();

    assert.equal(socket.pingCount, 2);
    assert.equal(socket.terminateCount, 0);

    socket.emit('close');
    assert.equal(scheduler.cleared(), true);
  });
});

describe('shell-websocket.service', () => {
  function createFakeSocket() {
    const socket = new EventEmitter() as EventEmitter & {
      readyState: number;
      frames: string[];
      send: (data: string) => void;
    };
    socket.readyState = WebSocket.OPEN;
    socket.frames = [];
    socket.send = (data: string) => socket.frames.push(data);
    return socket;
  }

  function createFakePty() {
    let dataListener: ((data: string) => void) | null = null;
    let exitListener: ((event: { exitCode: number; signal?: number }) => void) | null = null;

    return {
      killed: false,
      onData(listener: (data: string) => void) {
        dataListener = listener;
        return { dispose: () => undefined };
      },
      onExit(listener: (event: { exitCode: number; signal?: number }) => void) {
        exitListener = listener;
        return { dispose: () => undefined };
      },
      emitData(data: string) {
        dataListener?.(data);
      },
      emitExit() {
        exitListener?.({ exitCode: 0 });
      },
      write() {},
      resize() {},
      kill() {
        this.killed = true;
      },
    };
  }

  test('a stale socket close cannot detach the socket that replaced it', async () => {
    const pty = createFakePty();
    const dependencies = {
      resolveProviderSessionId: () => null,
      spawnPty: () => pty as never,
    };
    const initMessage = JSON.stringify({
      type: 'init',
      projectPath: process.cwd(),
      sessionId: `stale-close-${Date.now()}`,
      hasSession: false,
      provider: 'plain-shell',
      isPlainShell: true,
      initialCommand: 'test-command',
    });

    const firstSocket = createFakeSocket();
    handleShellConnection(firstSocket as never, dependencies);
    firstSocket.emit('message', initMessage);
    await new Promise((resolve) => setImmediate(resolve));

    const replacementSocket = createFakeSocket();
    handleShellConnection(replacementSocket as never, dependencies);
    replacementSocket.emit('message', initMessage);
    await new Promise((resolve) => setImmediate(resolve));
    replacementSocket.frames.length = 0;

    // This ordering reproduces a delayed close from a backgrounded mobile tab.
    firstSocket.emit('close');
    pty.emitData('output-after-stale-close');

    assert.equal(pty.killed, false);
    assert.equal(replacementSocket.frames.length, 1);
    assert.match(replacementSocket.frames[0], /output-after-stale-close/);

    pty.emitExit();
  });

  test('shell output detects and normalizes a wrapped authentication URL', async () => {
    const pty = createFakePty();
    const socket = createFakeSocket();
    const dependencies = {
      resolveProviderSessionId: () => null,
      spawnPty: () => pty as never,
    };

    handleShellConnection(socket as never, dependencies);
    socket.emit(
      'message',
      JSON.stringify({
        type: 'init',
        projectPath: process.cwd(),
        sessionId: `wrapped-url-${Date.now()}`,
        hasSession: false,
        provider: 'plain-shell',
        isPlainShell: true,
        initialCommand: 'test-command',
      })
    );
    await new Promise((resolve) => setImmediate(resolve));
    socket.frames.length = 0;

    pty.emitData("Continue in your browser: https://example.com/authorize?\ncode=abc\x1b[0m");

    const frames = socket.frames.map((frame) => JSON.parse(frame) as Record<string, unknown>);
    const authenticationFrame = frames.find((frame) => frame.type === 'auth_url');
    assert.deepEqual(authenticationFrame, {
      type: 'auth_url',
      url: 'https://example.com/authorize?code=abc',
      autoOpen: false,
    });

    pty.emitExit();
  });

  test('Codex Shell launches the command supplied by the selected-runtime resolver', async () => {
    const pty = createFakePty();
    const socket = createFakeSocket();
    const spawnCalls: Array<{ shell: string; args: string[] }> = [];
    const buildCalls: Array<string | undefined> = [];
    const dependencies = {
      resolveProviderSessionId: () => 'provider-thread-42',
      buildCodexCommand: async (resumeSessionId?: string) => {
        buildCalls.push(resumeSessionId);
        return "'/approved/runtime/codex' 'resume' 'provider-thread-42' || '/approved/runtime/codex'";
      },
      spawnPty: (shell: string, args: string | string[]) => {
        spawnCalls.push({ shell, args: typeof args === 'string' ? [args] : args });
        return pty as never;
      },
    };

    handleShellConnection(socket as never, dependencies);
    socket.emit('message', JSON.stringify({
      type: 'init',
      projectPath: process.cwd(),
      sessionId: `codex-runtime-${Date.now()}`,
      hasSession: true,
      provider: 'codex',
    }));
    await new Promise((resolve) => setImmediate(resolve));

    assert.deepEqual(buildCalls, ['provider-thread-42']);
    assert.equal(spawnCalls.length, 1);
    assert.deepEqual(spawnCalls[0].args, [
      '-c',
      "'/approved/runtime/codex' 'resume' 'provider-thread-42' || '/approved/runtime/codex'",
    ]);
    pty.emitExit();
  });
});
