import assert from 'node:assert/strict';
import test, { describe } from 'node:test';

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import express from 'express';

import { createBrowserMcpEndpoint } from '@/modules/browser-use/browser-use-mcp-endpoint.service.js';
import {
  browserJsonResponse,
  browserScreenshotResponse,
  browserSnapshotResponse,
  ORDINARY_BROWSER_RESULT_MAX_BYTES,
} from '@/modules/browser-use/browser-use-mcp-content.js';
import {
  agentScreenshotResult,
  agentSessionSummary,
  agentSnapshotResult,
  agentTabsResult,
  browserUseService,
  publicBrowserSession,
  SNAPSHOT_TEXT_MAX_CHARS,
  type BrowserUseSession,
} from '@/modules/browser-use/browser-use.service.js';
import {
  createBrowserRuntime,
  resolveProfileDirectory,
  type BrowserLeaseReleaseReason,
} from '@/modules/browser-use/browser-use-runtime.service.js';

let contextSeq = 0;

function makeFakePlaywright() {
  const calls = {
    launches: 0,
    browserCloses: 0,
    persistentLaunches: [] as Array<{ directory: string; options: Record<string, unknown> }>,
    contextOptions: [] as Array<Record<string, unknown>>,
    contextCloses: 0,
  };
  const makeContext = () => ({
    contextId: `context-${++contextSeq}`,
    pages: () => [],
    close: async () => {
      calls.contextCloses += 1;
    },
  });
  const playwright = {
    chromium: {
      executablePath: () => '/nonexistent/chromium',
      launch: async () => {
        calls.launches += 1;
        return {
          on: () => undefined,
          newContext: async (options: Record<string, unknown>) => {
            calls.contextOptions.push(options);
            return makeContext();
          },
          close: async () => {
            calls.browserCloses += 1;
          },
        };
      },
      launchPersistentContext: async (directory: string, options: Record<string, unknown>) => {
        calls.persistentLaunches.push({ directory, options });
        return makeContext();
      },
    },
    devices: {
      'Pixel 7': { userAgent: 'phone-ua', viewport: { width: 412, height: 839 }, deviceScaleFactor: 2.625, isMobile: true, hasTouch: true, defaultBrowserType: 'chromium' },
      'Pixel 7 landscape': { userAgent: 'phone-ua', viewport: { width: 863, height: 360 }, deviceScaleFactor: 2.625, isMobile: true, hasTouch: true, defaultBrowserType: 'chromium' },
      'Galaxy Tab S4': { userAgent: 'tablet-ua', viewport: { width: 712, height: 1138 }, deviceScaleFactor: 2.25, isMobile: true, hasTouch: true, defaultBrowserType: 'chromium' },
    },
  };
  return { playwright, calls };
}

function makeRuntime(overrides: { maxSessions?: number; sessionTtlMs?: number; profileRoot?: string } = {}) {
  const { playwright, calls } = makeFakePlaywright();
  let clock = 1_000;
  const runtime = createBrowserRuntime({
    loadPlaywright: () => playwright,
    maxSessions: overrides.maxSessions ?? 3,
    sessionTtlMs: overrides.sessionTtlMs ?? 60_000,
    profileRoot: overrides.profileRoot ?? '/tmp/clide-browser-runtime-test/profiles',
    now: () => clock,
  });
  return { runtime, calls, advance: (ms: number) => { clock += ms; } };
}

describe('browser-use.service', () => {
  function makeSession(overrides: Partial<BrowserUseSession> = {}): BrowserUseSession {
    return {
      id: 'browser-session-1',
      ownerId: 'agent',
      createdBy: 'agent',
      runtime: 'local',
      status: 'ready',
      url: `https://example.com/${'path/'.repeat(200)}`,
      title: 'Example title '.repeat(100),
      screenshotDataUrl: 'data:image/jpeg;base64,c2Vuc2l0aXZlLWltYWdl',
      createdAt: '2026-07-29T12:00:00.000Z',
      updatedAt: '2026-07-29T12:01:00.000Z',
      lastAction: `navigate:${'https://example.com/'.repeat(100)}`,
      message: 'Browser status message. '.repeat(100),
      profileName: 'personal-profile',
      device: 'desktop',
      viewport: { width: 1440, height: 900 },
      cursor: { x: 120, y: 240, actor: 'agent' },
      screenshotVersion: 3,
      actions: [{ tool: 'browser_navigate', ok: true, at: '2026-07-29T12:00:30.000Z' }],
      ...overrides,
    };
  }

  test('browser monitor list starts empty without agent sessions', async () => {
    const sessions = await browserUseService.listSessions();

    assert.deepEqual(sessions, []);
  });

  test('human Browser session projection retains the monitoring screenshot', () => {
    const result = publicBrowserSession(makeSession());

    assert.equal(result.screenshotDataUrl, 'data:image/jpeg;base64,c2Vuc2l0aXZlLWltYWdl');
    assert.equal('ownerId' in result, false);
  });

  test('agent session summary omits human-only and screenshot fields', () => {
    const result = agentSessionSummary(makeSession());
    const serialized = JSON.stringify(result);

    assert.deepEqual(Object.keys(result), [
      'id',
      'status',
      'url',
      'title',
      'updatedAt',
      'lastAction',
      'message',
      'device',
      'viewport',
      'cursor',
    ]);
    assert.equal('ownerId' in result, false);
    assert.equal('screenshotDataUrl' in result, false);
    assert.equal('profileName' in result, false);
    assert.equal(serialized.includes('data:image'), false);
    assert.equal(result.url?.endsWith('…'), true);
    assert.equal(result.title?.endsWith('…'), true);
  });

  test('three worst-case agent summaries fit the ordinary MCP result budget', () => {
    const multibyteText = '🚀'.repeat(1_000);
    const result = [1, 2, 3].map((index) => agentSessionSummary(makeSession({
      id: `browser-session-${index}`,
      url: `https://example.com/${multibyteText}`,
      title: multibyteText,
      lastAction: multibyteText,
      message: multibyteText,
    })));

    assert.ok(Buffer.byteLength(JSON.stringify(result), 'utf8') <= 4_096);
  });

  test('agent snapshot returns bounded text without screenshot bytes', () => {
    const result = agentSnapshotResult(makeSession(), 'x'.repeat(SNAPSHOT_TEXT_MAX_CHARS + 500));

    assert.equal(result.text.length, SNAPSHOT_TEXT_MAX_CHARS);
    assert.equal(JSON.stringify(result).includes('data:image'), false);
    assert.equal('screenshotDataUrl' in result.session, false);
  });

  test('agent screenshot returns bare JPEG data separately from compact metadata', () => {
    const result = agentScreenshotResult(makeSession());

    assert.equal(result.data, 'c2Vuc2l0aXZlLWltYWdl');
    assert.equal(result.mimeType, 'image/jpeg');
    assert.equal(JSON.stringify(result.session).includes('data:image'), false);
  });

  test('agent tab results are bounded and retain the active tab', () => {
    const tabs = Array.from({ length: 12 }, (_, index) => ({
      index,
      url: `https://example.com/tab-${index}/${'path/'.repeat(100)}`,
      active: index === 10,
    }));
    const result = agentTabsResult(makeSession(), tabs);

    assert.equal(result.tabs.length, 8);
    assert.equal(result.tabs.some((tab) => tab.index === 10 && tab.active), true);
    assert.equal(result.totalTabs, 12);
    assert.equal(result.tabsTruncated, true);
    assert.ok(Buffer.byteLength(JSON.stringify(result), 'utf8') <= 4_096);
  });
});

describe('browser-use monitor projections', () => {
  function makeMonitorSession(): BrowserUseSession {
    return {
      id: 'browser-session-1',
      ownerId: 'agent',
      createdBy: 'agent',
      runtime: 'local',
      status: 'ready',
      url: 'https://example.com/',
      title: 'Example',
      screenshotDataUrl: 'data:image/jpeg;base64,c2Vuc2l0aXZlLWltYWdl',
      createdAt: '2026-07-29T12:00:00.000Z',
      updatedAt: '2026-07-29T12:01:00.000Z',
      lastAction: 'browser_click',
      message: null,
      profileName: null,
      device: 'phone',
      viewport: { width: 412, height: 839 },
      cursor: null,
      screenshotVersion: 7,
      actions: [
        { tool: 'browser_navigate', ok: true, at: '2026-07-29T12:00:30.000Z' },
        { tool: 'browser_click', ok: false, at: '2026-07-29T12:01:00.000Z' },
      ],
    };
  }

  test('the panel projection carries the trail, device and screenshot version', () => {
    const result = publicBrowserSession(makeMonitorSession());

    assert.equal(result.screenshotVersion, 7);
    assert.equal(result.device, 'phone');
    assert.deepEqual(result.actions.map((action) => [action.tool, action.ok]), [
      ['browser_navigate', true],
      ['browser_click', false],
    ]);
    assert.equal(result.screenshotDataUrl, 'data:image/jpeg;base64,c2Vuc2l0aXZlLWltYWdl');
  });

  test('the agent projection gains no monitor fields', () => {
    const result = agentSessionSummary(makeMonitorSession());

    assert.equal('actions' in result, false);
    assert.equal('screenshotVersion' in result, false);
    assert.equal(JSON.stringify(result).includes('data:image'), false);
  });

  test('recording against a released session is a no-op, not a throw', () => {
    assert.doesNotThrow(() => browserUseService.recordAgentAction('missing-session', {
      tool: 'browser_navigate',
      ok: true,
    }));
  });
});

describe('browser-use-mcp-content', () => {
  test('ordinary Browser MCP results are compact text within the byte budget', () => {
    const response = browserJsonResponse({ status: 'ready', message: 'ok' });

    assert.deepEqual(response, {
      content: [{
        type: 'text',
        text: '{"status":"ready","message":"ok"}',
      }],
    });
    assert.ok(Buffer.byteLength(response.content[0].text, 'utf8') <= ORDINARY_BROWSER_RESULT_MAX_BYTES);
  });

  test('ordinary Browser MCP results fail closed above the byte budget', () => {
    assert.throws(
      () => browserJsonResponse({ message: 'x'.repeat(ORDINARY_BROWSER_RESULT_MAX_BYTES) }),
      /exceeded the 4096-byte limit/,
    );
  });

  test('ordinary and snapshot responses reject screenshot-bearing DTOs', () => {
    const screenshotBearingResult = {
      screenshotDataUrl: 'data:image/jpeg;base64,c2Vuc2l0aXZl',
    };

    assert.throws(
      () => browserJsonResponse(screenshotBearingResult),
      /included screenshot data outside the explicit screenshot tool/,
    );
    assert.throws(
      () => browserSnapshotResponse(screenshotBearingResult),
      /included screenshot data outside the explicit screenshot tool/,
    );
  });

  test('snapshot results carry bounded page text without screenshot content', () => {
    const response = browserSnapshotResponse({
      session: { id: 'browser-session-1' },
      text: 'x'.repeat(12_000),
    });

    assert.equal(response.content[0].type, 'text');
    assert.equal(response.content[0].text.includes('data:image'), false);
    assert.equal(JSON.parse(response.content[0].text).text.length, 12_000);
  });

  test('explicit screenshots become MCP image content with compact text metadata', () => {
    const response = browserScreenshotResponse({
      session: {
        id: 'browser-session-1',
        status: 'ready',
        url: 'https://example.com/',
        title: 'Example',
        updatedAt: '2026-07-29T12:01:00.000Z',
        lastAction: 'screenshot',
        message: null,
        device: 'desktop',
        viewport: { width: 1440, height: 900 },
        cursor: null,
      },
      data: 'c2Vuc2l0aXZlLWltYWdl',
      mimeType: 'image/jpeg',
    });

    assert.equal(response.content[0].type, 'text');
    assert.equal(response.content[0].text.includes('c2Vuc2l0aXZlLWltYWdl'), false);
    assert.ok(Buffer.byteLength(response.content[0].text, 'utf8') <= ORDINARY_BROWSER_RESULT_MAX_BYTES);
    assert.deepEqual(response.content[1], {
      type: 'image',
      data: 'c2Vuc2l0aXZlLWltYWdl',
      mimeType: 'image/jpeg',
    });
  });

  test('explicit screenshot responses reject malformed API payloads', () => {
    assert.throws(
      () => browserScreenshotResponse({ session: { id: 'browser-session-1' } }),
      /missing JPEG image data/,
    );
  });
});

describe('browser-use-runtime.service', () => {
  test('temporary contexts share one browser that closes with its last lease', async () => {
    const { runtime, calls } = makeRuntime();

    const first = await runtime.acquireContext();
    const second = await runtime.acquireContext();

    assert.equal(calls.launches, 1);
    assert.equal(calls.contextOptions.length, 2);
    assert.equal(calls.contextOptions[0].serviceWorkers, undefined);
    assert.notEqual(first.id, second.id);

    await runtime.releaseContext(first.id);
    assert.equal(calls.browserCloses, 0);
    await runtime.releaseContext(second.id);
    assert.equal(calls.contextCloses, 2);
    assert.equal(calls.browserCloses, 1);
    assert.equal(runtime.listLeases().length, 0);
  });

  test('device presets emulate touch, pixel density and orientation', async () => {
    const { runtime, calls } = makeRuntime();

    const desktop = await runtime.acquireContext();
    const phone = await runtime.acquireContext({ device: 'phone' });
    const landscapePhone = await runtime.acquireContext({ device: 'phone', orientation: 'landscape' });

    assert.deepEqual(desktop.viewport, { width: 1440, height: 900 });
    assert.equal(desktop.orientation, 'landscape');
    assert.equal(phone.orientation, 'portrait');
    assert.deepEqual(phone.viewport, { width: 412, height: 839 });
    assert.equal(calls.contextOptions[1].isMobile, true);
    assert.equal(calls.contextOptions[1].hasTouch, true);
    assert.equal(calls.contextOptions[1].deviceScaleFactor, 2.625);
    assert.equal('defaultBrowserType' in calls.contextOptions[1], false);
    assert.deepEqual(landscapePhone.viewport, { width: 863, height: 360 });
    await runtime.closeAll();
  });

  test('the session cap counts temporary and profile leases together', async () => {
    const { runtime } = makeRuntime({ maxSessions: 2 });

    await runtime.acquireContext();
    await runtime.acquireContext({ profileName: 'Personal' });

    await assert.rejects(() => runtime.acquireContext(), /limited to 2 active agent sessions/);
    await runtime.closeAll();
  });

  test('a named profile is locked to one lease and stays inside the profile root', async () => {
    const { runtime, calls } = makeRuntime({ profileRoot: '/tmp/clide-browser-runtime-test/profiles' });

    const lease = await runtime.acquireContext({ profileName: 'My Profile' });
    assert.equal(lease.profileName, 'My Profile');
    assert.equal(calls.persistentLaunches[0].directory, '/tmp/clide-browser-runtime-test/profiles/my-profile');
    assert.equal(calls.launches, 0);

    await assert.rejects(() => runtime.acquireContext({ profileName: 'my profile' }), /already in use/);
    await runtime.releaseContext(lease.id);
    const again = await runtime.acquireContext({ profileName: 'my-profile' });
    assert.notEqual(again.id, lease.id);
    await runtime.closeAll();
  });

  test('profile names cannot escape the profile root', () => {
    const root = '/tmp/clide-browser-runtime-test/profiles';

    assert.throws(() => resolveProfileDirectory('..', root), /letter or digit/);
    assert.throws(() => resolveProfileDirectory('...', root), /letter or digit/);
    assert.throws(() => resolveProfileDirectory('///', root), /letter or digit/);
    assert.equal(resolveProfileDirectory('../etc', root).directory, `${root}/..-etc`);
    assert.equal(resolveProfileDirectory('..%2F..', root).directory, `${root}/..-2f..`);
  });

  test('idle leases expire, notify listeners and free the shared browser', async () => {
    const { runtime, calls, advance } = makeRuntime({ sessionTtlMs: 1_000 });
    const events: Array<{ id: string; reason: BrowserLeaseReleaseReason }> = [];
    runtime.onRelease((lease, reason) => events.push({ id: lease.id, reason }));

    const idle = await runtime.acquireContext();
    const active = await runtime.acquireContext();
    advance(900);
    runtime.touch(active.id);
    advance(200);

    const expired = await runtime.expireIdle();

    assert.deepEqual(expired.map((lease) => lease.id), [idle.id]);
    assert.deepEqual(events, [{ id: idle.id, reason: 'expired' }]);
    assert.equal(runtime.getLease(idle.id), null);
    assert.equal(runtime.getLease(active.id)?.id, active.id);
    assert.equal(calls.browserCloses, 0);

    await runtime.closeAll();
    assert.equal(events[1]?.reason, 'shutdown');
    assert.equal(calls.browserCloses, 1);
    assert.equal(runtime.listLeases().length, 0);
  });

  test('readiness reports missing Chromium without installing packages', () => {
    const { runtime } = makeRuntime();

    const readiness = runtime.getReadiness({ force: true });

    assert.equal(readiness.playwrightInstalled, true);
    assert.equal(readiness.chromiumInstalled, false);
    assert.equal(readiness.chromiumExecutablePath, '/nonexistent/chromium');
    assert.equal(readiness.installInProgress, false);
  });
});

describe('browser-use-mcp endpoint', () => {
  type EndpointHarness = {
    url: string;
    runtime: ReturnType<typeof makeRuntime>['runtime'];
    endpoint: ReturnType<typeof createBrowserMcpEndpoint>;
    cancelled: Promise<string>;
    close: () => Promise<void>;
  };

  const SLOW_TOOL_MS = 30_000;

  // A real MCP Server stands in for Playwright MCP so initialize, cancellation
  // and close run through SDK code without launching a browser.
  async function startEndpoint(overrides: {
    maxSessions?: number;
    recordAction?: (sessionId: string, action: { tool: string; ok: boolean }) => void;
  } = {}): Promise<EndpointHarness> {
    const { runtime } = makeRuntime({ maxSessions: overrides.maxSessions ?? 3 });
    let signalCancelled: (name: string) => void = () => undefined;
    const cancelled = new Promise<string>((resolve) => {
      signalCancelled = resolve;
    });

    const endpoint = createBrowserMcpEndpoint({
      runtime,
      recordAction: overrides.recordAction,
      openContext: (request) => runtime.acquireContext({
        profileName: request.profileName,
        device: request.device as 'desktop' | 'phone' | 'tablet' | null,
        orientation: request.orientation as 'portrait' | 'landscape' | null,
      }),
      createConnection: async (getContext: () => Promise<{ contextId: string }>) => {
        const server = new Server({ name: 'fake-playwright-mcp', version: '0' }, { capabilities: { tools: {} } });
        server.setRequestHandler(ListToolsRequestSchema, async () => ({
          tools: [
            { name: 'browser_navigate', description: 'navigate', inputSchema: { type: 'object' as const } },
            { name: 'browser_snapshot', description: 'snapshot', inputSchema: { type: 'object' as const } },
            { name: 'browser_run_code_unsafe', description: 'unsafe', inputSchema: { type: 'object' as const } },
            { name: 'browser_file_upload', description: 'upload', inputSchema: { type: 'object' as const } },
          ],
        }));
        server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
          if (request.params.name === 'slow') {
            await new Promise((resolve, reject) => {
              const timer = setTimeout(resolve, SLOW_TOOL_MS);
              extra.signal.addEventListener('abort', () => {
                clearTimeout(timer);
                signalCancelled(request.params.name);
                reject(new Error('cancelled'));
              });
            });
          }
          if (request.params.name === 'browser_fails') {
            return { content: [{ type: 'text' as const, text: 'nope' }], isError: true };
          }
          if (request.params.name === 'browser_snapshot') {
            return { content: [{ type: 'text' as const, text: 'S'.repeat(20_000) }] };
          }
          if (request.params.name === 'browser_navigate' && request.params.arguments?.big) {
            return { content: [{ type: 'text' as const, text: 'N'.repeat(20_000) }] };
          }
          return { content: [{ type: 'text' as const, text: (await getContext()).contextId }] };
        });
        return server;
      },
    });

    const app = express();
    app.use(express.json());
    app.all('/mcp', (req, res) => {
      void endpoint.handleRequest(req, res).catch(() => {
        if (!res.headersSent) {
          res.status(400).json({ jsonrpc: '2.0', error: { code: -32000, message: 'failed' }, id: null });
        }
      });
    });
    const server = app.listen(0, '127.0.0.1');
    await new Promise((resolve) => server.once('listening', resolve));
    const port = (server.address() as { port: number }).port;

    return {
      url: `http://127.0.0.1:${port}/mcp`,
      runtime,
      endpoint,
      cancelled,
      close: async () => {
        await runtime.closeAll();
        await new Promise((resolve) => server.close(resolve));
      },
    };
  }

  const HEADERS = { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' };
  const rpc = (id: number | null, method: string, params: Record<string, unknown> = {}) => JSON.stringify(
    id === null ? { jsonrpc: '2.0', method, params } : { jsonrpc: '2.0', id, method, params },
  );

  async function readRpc(response: Response): Promise<any> {
    const body = await response.text();
    const event = body.match(/^data: (.*)$/m);
    return JSON.parse(event ? event[1] : body);
  }

  async function initialize(harness: EndpointHarness, query = ''): Promise<{ status: number; sessionId: string }> {
    const response = await fetch(`${harness.url}${query}`, {
      method: 'POST',
      headers: HEADERS,
      body: rpc(1, 'initialize', {
        protocolVersion: '2025-03-26',
        capabilities: {},
        clientInfo: { name: 'clide-test', version: '0' },
      }),
    });
    const sessionId = response.headers.get('mcp-session-id') || '';
    await readRpc(response);
    await fetch(harness.url, {
      method: 'POST',
      headers: { ...HEADERS, 'mcp-session-id': sessionId },
      body: rpc(null, 'notifications/initialized'),
    });
    return { status: response.status, sessionId };
  }

  const callTool = (
    harness: EndpointHarness,
    sessionId: string,
    id: number,
    name: string,
    args: Record<string, unknown> = {},
  ) => fetch(harness.url, {
    method: 'POST',
    headers: { ...HEADERS, 'mcp-session-id': sessionId },
    body: rpc(id, 'tools/call', { name, arguments: args }),
  });

  const resultText = (payload: any): string => (payload.result.content || [])
    .map((item: { text?: string }) => item.text || '')
    .join('\n');

  test('initialize leases one context whose id is the MCP session id', async () => {
    const harness = await startEndpoint();
    try {
      const first = await initialize(harness, '?device=phone');

      assert.equal(first.status, 200);
      assert.equal(harness.runtime.getLease(first.sessionId)?.id, first.sessionId);
      assert.equal(harness.runtime.getLease(first.sessionId)?.device, 'phone');
      assert.deepEqual(harness.endpoint.listSessionIds(), [first.sessionId]);

      const second = await initialize(harness);
      assert.notEqual(second.sessionId, first.sessionId);
      assert.equal(harness.runtime.listLeases().length, 2);
    } finally {
      await harness.close();
    }
  });

  test('each session calls tools against its own context and rejects unknown ids', async () => {
    const harness = await startEndpoint();
    try {
      const first = await initialize(harness);
      const second = await initialize(harness);

      const firstResult = await readRpc(await callTool(harness, first.sessionId, 2, 'browser_navigate'));
      const secondResult = await readRpc(await callTool(harness, second.sessionId, 2, 'browser_navigate'));

      assert.match(resultText(firstResult), /^\[Untrusted page content/);
      assert.ok(resultText(firstResult).includes(harness.runtime.getLease(first.sessionId)!.context.contextId));
      assert.notEqual(resultText(firstResult), resultText(secondResult));

      const unknown = await callTool(harness, 'not-a-session', 3, 'browser_navigate');
      assert.equal(unknown.status, 404);

      const withoutSession = await fetch(harness.url, { method: 'POST', headers: HEADERS, body: rpc(4, 'tools/list') });
      assert.equal(withoutSession.status, 400);
    } finally {
      await harness.close();
    }
  });

  test('the denied tool is hidden from tools/list and never reaches the server', async () => {
    const harness = await startEndpoint();
    try {
      const { sessionId } = await initialize(harness);

      const listed = await readRpc(await fetch(harness.url, {
        method: 'POST',
        headers: { ...HEADERS, 'mcp-session-id': sessionId },
        body: rpc(2, 'tools/list'),
      }));
      assert.deepEqual(
        listed.result.tools.map((tool: { name: string }) => tool.name),
        ['browser_navigate', 'browser_snapshot', 'browser_use_device'],
      );

      for (const [id, tool] of [[3, 'browser_run_code_unsafe'], [4, 'browser_file_upload']] as const) {
        const denied = await readRpc(await callTool(harness, sessionId, id, tool));
        assert.equal(denied.result.isError, true);
        assert.match(denied.result.content[0].text, /not available/);
      }
    } finally {
      await harness.close();
    }
  });

  test('a session survives a dropped notification stream and a cancelled call', async () => {
    const harness = await startEndpoint();
    try {
      const { sessionId } = await initialize(harness);

      const streamAbort = new AbortController();
      const stream = await fetch(harness.url, {
        method: 'GET',
        headers: { ...HEADERS, 'mcp-session-id': sessionId },
        signal: streamAbort.signal,
      });
      assert.equal(stream.status, 200);
      assert.match(stream.headers.get('content-type') || '', /text\/event-stream/);
      streamAbort.abort();

      const callAbort = new AbortController();
      const pending = callTool(harness, sessionId, 2, 'slow').catch(() => null);
      // The slow call must be in flight before its cancellation arrives.
      await new Promise((resolve) => setTimeout(resolve, 50));
      const cancel = await fetch(harness.url, {
        method: 'POST',
        headers: { ...HEADERS, 'mcp-session-id': sessionId },
        body: rpc(null, 'notifications/cancelled', { requestId: 2, reason: 'client gave up' }),
        signal: callAbort.signal,
      });
      assert.equal(cancel.status, 202);
      assert.equal(await harness.cancelled, 'slow');
      callAbort.abort();
      await pending;

      const after = await readRpc(await callTool(harness, sessionId, 3, 'browser_navigate'));
      assert.ok(resultText(after).includes(harness.runtime.getLease(sessionId)!.context.contextId));
    } finally {
      await harness.close();
    }
  });

  test('results are labelled untrusted and held to their tool budget', async () => {
    const harness = await startEndpoint();
    try {
      const { sessionId } = await initialize(harness);

      const ordinary = await readRpc(await callTool(harness, sessionId, 2, 'browser_navigate', { big: true }));
      const ordinaryText = resultText(ordinary);
      assert.match(ordinaryText, /^\[Untrusted page content/);
      assert.match(ordinaryText, /Truncated to 4096 bytes\. Use browser_find/);
      assert.ok(Buffer.byteLength(ordinaryText, 'utf8') <= 4_096);

      // A snapshot is the agent's main way to read a page, so it gets the larger
      // budget before the same explicit truncation.
      const snapshot = await readRpc(await callTool(harness, sessionId, 3, 'browser_snapshot'));
      const snapshotText = resultText(snapshot);
      assert.match(snapshotText, /Truncated to 12288 bytes/);
      assert.ok(Buffer.byteLength(snapshotText, 'utf8') <= 12_288);
      assert.ok(Buffer.byteLength(snapshotText, 'utf8') > 12_000);

      const small = await readRpc(await callTool(harness, sessionId, 4, 'browser_navigate'));
      assert.equal(resultText(small).includes('Truncated'), false);
    } finally {
      await harness.close();
    }
  });

  test('the device tool swaps the context under a live session', async () => {
    const harness = await startEndpoint();
    try {
      const { sessionId } = await initialize(harness);
      const before = harness.runtime.getLease(sessionId)!.context.contextId;
      assert.equal(harness.runtime.getLease(sessionId)?.device, 'desktop');

      const swapped = await readRpc(await callTool(harness, sessionId, 2, 'browser_use_device', { device: 'phone' }));
      const lease = harness.runtime.getLease(sessionId)!;

      assert.equal(lease.device, 'phone');
      assert.equal(lease.orientation, 'portrait');
      assert.deepEqual(lease.viewport, { width: 412, height: 839 });
      assert.notEqual(lease.context.contextId, before);
      assert.match(resultText(swapped), /Navigate again/);

      // The same session id keeps working, now against the new context.
      const after = await readRpc(await callTool(harness, sessionId, 3, 'browser_navigate'));
      assert.ok(resultText(after).includes(lease.context.contextId));

      const rejected = await readRpc(await callTool(harness, sessionId, 4, 'browser_use_device', { device: 'watch' }));
      assert.equal(rejected.result.isError, true);
    } finally {
      await harness.close();
    }
  });

  test('completed tool calls are recorded at the transport with their outcome', async () => {
    const recorded: Array<{ sessionId: string; tool: string; ok: boolean }> = [];
    const harness = await startEndpoint({
      recordAction: (sessionId, action) => recorded.push({ sessionId, ...action }),
    });
    try {
      const { sessionId } = await initialize(harness);

      await callTool(harness, sessionId, 2, 'browser_navigate');
      await callTool(harness, sessionId, 3, 'browser_use_device', { device: 'phone' });
      await callTool(harness, sessionId, 4, 'browser_fails');
      // Denied tools never reach Playwright MCP, so they are not agent work.
      await callTool(harness, sessionId, 5, 'browser_run_code_unsafe');

      assert.deepEqual(recorded, [
        { sessionId, tool: 'browser_navigate', ok: true },
        { sessionId, tool: 'browser_use_device', ok: true },
        { sessionId, tool: 'browser_fails', ok: false },
      ]);
    } finally {
      await harness.close();
    }
  });

  test('closing releases the context, and releasing the context closes the session', async () => {
    const harness = await startEndpoint();
    try {
      const deleted = await initialize(harness);
      const expired = await initialize(harness);

      const response = await fetch(harness.url, {
        method: 'DELETE',
        headers: { ...HEADERS, 'mcp-session-id': deleted.sessionId },
      });
      assert.equal(response.status, 200);
      assert.equal(harness.runtime.getLease(deleted.sessionId), null);
      assert.equal(harness.endpoint.listSessionIds().includes(deleted.sessionId), false);
      assert.equal((await callTool(harness, deleted.sessionId, 2, 'browser_navigate')).status, 404);

      // A lease released anywhere else — expiry, panel Stop, shutdown — takes its
      // transport with it.
      await harness.runtime.releaseContext(expired.sessionId);
      assert.deepEqual(harness.endpoint.listSessionIds(), []);
      assert.equal((await callTool(harness, expired.sessionId, 3, 'browser_navigate')).status, 404);
    } finally {
      await harness.close();
    }
  });
});
