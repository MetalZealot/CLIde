import assert from 'node:assert/strict';
import test, { describe } from 'node:test';

import { isUsageWindowResetPending } from './format';
import { supportsProviderUsageReset } from './types';

describe('format', () => {
  test('a window is reset-pending once its own reset timestamp has passed', () => {
    const past = new Date(Date.now() - 60_000).toISOString();
    const future = new Date(Date.now() + 60_000).toISOString();

    assert.equal(isUsageWindowResetPending(past), true);
    assert.equal(isUsageWindowResetPending(future), false);
    // An idle window carries no reset time and is not pending anything.
    assert.equal(isUsageWindowResetPending(null), false);
    assert.equal(isUsageWindowResetPending(undefined), false);
    assert.equal(isUsageWindowResetPending('not a date'), false);
  });
});

describe('types', () => {
  test('usage reset preferences are limited to usage-capable OAuth accounts', () => {
    assert.equal(supportsProviderUsageReset(true, 'oauth', true), true);
    assert.equal(supportsProviderUsageReset(true, 'chatgpt', true), true);
    // An API-key login bills per token and has no plan window to reset.
    assert.equal(supportsProviderUsageReset(true, 'api_key', true), false);
    // The provider's capability entry says it reports no schedulable resets.
    assert.equal(supportsProviderUsageReset(false, 'oauth', true), false);
    assert.equal(supportsProviderUsageReset(true, 'chatgpt', false), false);
  });
});
