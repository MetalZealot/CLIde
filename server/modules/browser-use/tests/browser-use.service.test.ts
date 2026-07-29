import assert from 'node:assert/strict';
import test from 'node:test';

import {
  SNAPSHOT_TEXT_MAX_CHARS,
  agentScreenshotResult,
  agentSessionSummary,
  agentSnapshotResult,
  agentTabsResult,
  browserUseService,
  publicBrowserSession,
  type BrowserUseSession,
} from '@/modules/browser-use/browser-use.service.js';

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
