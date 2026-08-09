import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveUsagePopoverView } from './useChatComposerState';

test('usage commands route to provider-specific popover detail', () => {
  assert.equal(resolveUsagePopoverView('usage', 'claude'), 'summary');
  assert.equal(resolveUsagePopoverView('usage', 'codex'), 'activity');
  assert.equal(resolveUsagePopoverView('cost', 'codex'), 'activity');
});

test('context commands expose only Claude breakdown detail', () => {
  assert.equal(resolveUsagePopoverView('context', 'claude'), 'breakdown');
  assert.equal(resolveUsagePopoverView('context', 'codex'), 'summary');
  assert.equal(resolveUsagePopoverView('status', 'claude'), null);
});
