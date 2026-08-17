import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizeClaudeRateLimitEvent } from '@/modules/providers/list/claude/claude-usage.provider.js';
import { createProviderUsageService } from '@/modules/providers/services/provider-usage.service.js';
import type { ProviderUsageStatus } from '@/shared/types.js';

test('failed refresh preserves the last successful timestamp and becomes retryable after the safety floor', async () => {
  let now = Date.parse('2026-08-16T12:00:00.000Z');
  let calls = 0;
  const successful: ProviderUsageStatus = {
    provider: 'claude',
    supported: true,
    windows: [{ id: 'five_hour', utilization: 20, resetsAt: '2026-08-16T13:00:00.000Z' }],
    fetchedAt: '2026-08-16T12:00:00.000Z',
  };
  const service = createProviderUsageService({
    now: () => now,
    resolveUsage: () => ({
      getUsage: async () => {
        calls += 1;
        return calls === 1
          ? successful
          : { provider: 'claude', supported: true, error: 'temporarily unavailable' };
      },
    }),
  });

  assert.deepEqual(await service.getProviderUsage('claude'), successful);
  now += 60_001;
  const stale = await service.getProviderUsage('claude');
  assert.equal(stale.stale, true);
  assert.equal(stale.fetchedAt, successful.fetchedAt);

  now += 15_001;
  await service.getProviderUsage('claude');
  assert.equal(calls, 3);
});

test('Claude live rate-limit events normalize epoch seconds into shared windows', () => {
  assert.deepEqual(normalizeClaudeRateLimitEvent({
    rateLimitType: 'seven_day_sonnet',
    utilization: 67.5,
    resetsAt: 1_776_000_000,
  }), {
    id: 'seven_day_sonnet',
    utilization: 67.5,
    resetsAt: new Date(1_776_000_000_000).toISOString(),
  });
});
