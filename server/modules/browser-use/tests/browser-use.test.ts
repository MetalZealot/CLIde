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
