import assert from 'node:assert/strict';
import test from 'node:test';

import type { ProviderRuntimeVersions } from '../../provider-auth/types';

import { formatVersionPair } from './providerVersions';

const NOW = Date.parse('2026-08-17T12:00:00.000Z');

const versions = (overrides: Partial<ProviderRuntimeVersions> = {}): ProviderRuntimeVersions => ({
  runtime: '2.1.233',
  sdk: '0.3.233',
  observedAt: new Date(NOW).toISOString(),
  ...overrides,
});

test('the pair reads runtime first and drops whichever half is unknown', () => {
  assert.equal(formatVersionPair(versions()), '2.1.233 · SDK 0.3.233');
  assert.equal(formatVersionPair(versions({ sdk: null })), '2.1.233');
  assert.equal(formatVersionPair(versions({ runtime: null })), 'SDK 0.3.233');
  // Nothing to say, so the row must not render at all.
  assert.equal(formatVersionPair(versions({ runtime: null, sdk: null })), null);
});
