import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ORDINARY_BROWSER_RESULT_MAX_BYTES,
  browserJsonResponse,
  browserScreenshotResponse,
  browserSnapshotResponse,
} from '@/modules/browser-use/browser-use-mcp-content.js';

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
