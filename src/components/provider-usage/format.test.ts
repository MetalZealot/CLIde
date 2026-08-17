import assert from 'node:assert/strict';
import test from 'node:test';

import { isUsageWindowResetPending } from './format';

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
