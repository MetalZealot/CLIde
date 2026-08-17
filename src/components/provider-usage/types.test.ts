import assert from 'node:assert/strict';
import test from 'node:test';

import { supportsProviderUsageReset } from './types';

test('usage reset preferences are limited to usage-capable OAuth accounts', () => {
  assert.equal(supportsProviderUsageReset(true, 'oauth', true), true);
  assert.equal(supportsProviderUsageReset(true, 'chatgpt', true), true);
  // An API-key login bills per token and has no plan window to reset.
  assert.equal(supportsProviderUsageReset(true, 'api_key', true), false);
  // The provider's capability entry says it reports no schedulable resets.
  assert.equal(supportsProviderUsageReset(false, 'oauth', true), false);
  assert.equal(supportsProviderUsageReset(true, 'chatgpt', false), false);
});
