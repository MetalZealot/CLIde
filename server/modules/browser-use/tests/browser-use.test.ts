import assert from 'node:assert/strict';
import test, { describe } from 'node:test';

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
  function makeFakePlaywright() {
    const calls = {
      launches: 0,
      browserCloses: 0,
      persistentLaunches: [] as Array<{ directory: string; options: Record<string, unknown> }>,
      contextOptions: [] as Array<Record<string, unknown>>,
      contextCloses: 0,
    };
    const makeContext = () => ({
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
