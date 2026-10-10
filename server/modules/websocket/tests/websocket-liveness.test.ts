// Three suites: chat.ping/chat_pong echo plus the transport heartbeat, the
// shell-websocket PTY launch, auth-URL, and Codex-launch paths, and the Terminal
// tab's resumable PTY.
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test, { describe } from 'node:test';

import { WebSocket } from 'ws';

import { handleChatConnection } from '@/modules/websocket/services/chat-websocket.service.js';
import { handleShellConnection } from '@/modules/websocket/services/shell-websocket.service.js';
import { handleTerminalConnection } from '@/modules/websocket/services/terminal-websocket.service.js';
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

  test('a new Claude Shell runs under a minted id that later visits reattach to', async () => {
    const pty = createFakePty();
    const spawnCalls: string[][] = [];
    const dependencies = {
      resolveProviderSessionId: () => null,
      spawnPty: (_shell: string, args: string | string[]) => {
        spawnCalls.push(typeof args === 'string' ? [args] : args);
        return pty as never;
      },
    };

    const socket = createFakeSocket();
    handleShellConnection(socket as never, dependencies);
    socket.emit('message', JSON.stringify({
      type: 'init',
      projectPath: process.cwd(),
      sessionId: null,
      hasSession: false,
      provider: 'claude',
    }));
    await new Promise((resolve) => setImmediate(resolve));

    const frames = socket.frames.map((frame) => JSON.parse(frame) as Record<string, unknown>);
    const assigned = frames.find((frame) => frame.type === 'session-assigned');
    assert.ok(assigned && typeof assigned.sessionId === 'string');
    assert.match(assigned.sessionId as string, /^[0-9a-f-]{36}$/);
    assert.deepEqual(spawnCalls, [['-c', `claude --session-id "${assigned.sessionId}"`]]);

    // Opening the sidebar row the watcher creates for that id reaches the same CLI.
    const revisit = createFakeSocket();
    handleShellConnection(revisit as never, dependencies);
    revisit.emit('message', JSON.stringify({
      type: 'init',
      projectPath: process.cwd(),
      sessionId: assigned.sessionId,
      hasSession: true,
      provider: 'claude',
    }));
    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(spawnCalls.length, 1);
    assert.match(revisit.frames[0], /Reconnected to existing session/);
    pty.emitExit();
  });

  test('a new Shell for a provider that cannot take an id is not assigned one', async () => {
    const pty = createFakePty();
    const socket = createFakeSocket();
    handleShellConnection(socket as never, {
      resolveProviderSessionId: () => null,
      spawnPty: () => pty as never,
    });
    socket.emit('message', JSON.stringify({
      type: 'init',
      projectPath: process.cwd(),
      sessionId: null,
      hasSession: false,
      provider: 'cursor',
    }));
    await new Promise((resolve) => setImmediate(resolve));

    const frames = socket.frames.map((frame) => JSON.parse(frame) as Record<string, unknown>);
    assert.equal(frames.some((frame) => frame.type === 'session-assigned'), false);
    pty.emitExit();
  });
});

describe('terminal-websocket.service', () => {
  type Control = Record<string, unknown> & { type: string };

  function createSocket() {
    const socket = new EventEmitter() as EventEmitter & {
      readyState: number;
      control: Control[];
      data: Buffer[];
      closedWith: number | null;
      send: (data: string | Buffer, options?: unknown, done?: () => void) => void;
      close: (code?: number) => void;
    };
    socket.readyState = WebSocket.OPEN;
    socket.control = [];
    socket.data = [];
    socket.closedWith = null;
    socket.send = (data, options, done) => {
      if (Buffer.isBuffer(data)) {
        socket.data.push(data);
      } else {
        socket.control.push(JSON.parse(data) as Control);
      }
      (typeof options === 'function' ? options as () => void : done)?.();
    };
    socket.close = (code) => {
      socket.closedWith = code ?? 1000;
      socket.readyState = WebSocket.CLOSED;
      socket.emit('close');
    };
    return socket;
  }

  function createPty() {
    let dataListener: ((data: string) => void) | null = null;
    let exitListener: ((event: { exitCode: number }) => void) | null = null;
    return {
      killed: false,
      written: [] as Buffer[],
      onData(listener: (data: string) => void) {
        dataListener = listener;
        return { dispose: () => undefined };
      },
      onExit(listener: (event: { exitCode: number }) => void) {
        exitListener = listener;
        return { dispose: () => undefined };
      },
      emitData(data: string) {
        dataListener?.(data);
      },
      emitExit() {
        exitListener?.({ exitCode: 0 });
      },
      write(data: Buffer) {
        this.written.push(data);
      },
      resize() {},
      pause() {},
      resume() {},
      kill() {
        this.killed = true;
      },
    };
  }

  const userRequest = (id: number) => ({ user: { id } }) as unknown as AuthenticatedWebSocketRequest;

  function setup() {
    const ptys: ReturnType<typeof createPty>[] = [];
    const spawns: Array<{ args: string[]; cwd: string; env: NodeJS.ProcessEnv }> = [];
    const spawnPty = ((_file: string, args: string | string[], options: { cwd: string; env: NodeJS.ProcessEnv }) => {
      spawns.push({ args: args as string[], cwd: options.cwd, env: options.env });
      const pty = createPty();
      ptys.push(pty);
      return pty;
    }) as never;
    const connect = (init: Record<string, unknown>, userId = 1) => {
      const socket = createSocket();
      handleTerminalConnection(socket as never, userRequest(userId), { spawnPty });
      socket.emit('message', Buffer.from(JSON.stringify({ type: 'init', cols: 80, rows: 24, ...init })), false);
      return socket;
    };
    return { ptys, spawns, connect };
  }

  test('a new terminal is an interactive shell in the project, without the server NODE_ENV', () => {
    const { spawns, connect, ptys } = setup();
    const socket = connect({ cwd: process.cwd() });

    assert.equal(socket.control[0]?.type, 'hello');
    assert.deepEqual(spawns[0]?.args, []);
    assert.equal(spawns[0]?.cwd, process.cwd());
    assert.equal(spawns[0]?.env.NODE_ENV, undefined);
    const ready = socket.control.find((frame) => frame.type === 'ready');
    assert.equal(ready?.resumed, false);
    assert.equal(ready?.seq, 0);
    socket.emit('message', JSON.stringify({ type: 'close' }), false);
    assert.equal(ptys[0]?.killed, true);
  });

  test('a reconnect resumes the same shell and replays only the bytes it missed', () => {
    const { ptys, spawns, connect } = setup();
    const first = connect({ cwd: process.cwd() });
    const sessionId = first.control.find((frame) => frame.type === 'ready')?.sessionId;
    ptys[0]!.emitData('seen\r\n');
    const seen = first.data[0]!.length;
    first.emit('close');
    ptys[0]!.emitData('missed\r\n');

    const second = connect({ sessionId, seq: seen });
    assert.equal(spawns.length, 1);
    const ready = second.control.find((frame) => frame.type === 'ready');
    assert.deepEqual([ready?.resumed, ready?.reset, ready?.seq], [true, false, seen]);
    assert.equal(Buffer.concat(second.data).toString(), 'missed\r\n');

    second.emit('message', Buffer.from('ls\r'), true);
    assert.equal(ptys[0]!.written[0]?.toString(), 'ls\r');
    second.emit('message', JSON.stringify({ type: 'close' }), false);
  });

  test('a cursor the buffer cannot satisfy resets the screen and replays everything kept', () => {
    const { ptys, connect } = setup();
    const first = connect({ cwd: process.cwd() });
    const sessionId = first.control.find((frame) => frame.type === 'ready')?.sessionId;
    ptys[0]!.emitData('history');
    first.emit('close');

    const second = connect({ sessionId, seq: 999_999 });
    const ready = second.control.find((frame) => frame.type === 'ready');
    assert.deepEqual([ready?.reset, ready?.seq], [true, 0]);
    assert.equal(Buffer.concat(second.data).toString(), 'history');
    second.emit('message', JSON.stringify({ type: 'close' }), false);
  });

  test('a second socket takes the shell from the first, and another user cannot attach at all', () => {
    const { ptys, spawns, connect } = setup();
    const first = connect({ cwd: process.cwd() });
    const sessionId = first.control.find((frame) => frame.type === 'ready')?.sessionId;

    const stranger = connect({ sessionId }, 2);
    assert.equal(spawns.length, 2);
    assert.equal(stranger.control.find((frame) => frame.type === 'ready')?.resumed, false);

    const second = connect({ sessionId });
    assert.equal(first.closedWith, 4409);
    assert.equal(second.control.find((frame) => frame.type === 'ready')?.resumed, true);
    ptys[0]!.emitData('to second');
    assert.equal(Buffer.concat(second.data).toString(), 'to second');

    for (const socket of [second, stranger]) {
      socket.emit('message', JSON.stringify({ type: 'close' }), false);
    }
  });
});
