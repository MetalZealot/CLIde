import assert from 'node:assert/strict';
import test from 'node:test';

import type { ProviderRuntimeVersions } from '../../provider-auth/types';

import {
  VERSION_MOVE_NOTICE_WINDOW_MS,
  describeVersionMoves,
  formatVersionAge,
  formatVersionPair,
} from './providerVersions';

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

test('only the half that actually moved is reported', () => {
  const runtimeOnly = versions({
    previous: { runtime: '2.1.229', sdk: '0.3.233', observedAt: new Date(NOW - 60_000).toISOString() },
  });
  assert.deepEqual(describeVersionMoves(runtimeOnly, NOW), [
    { half: 'runtime', from: '2.1.229', to: '2.1.233' },
  ]);

  const both = versions({
    previous: { runtime: '2.1.229', sdk: '0.3.165', observedAt: new Date(NOW - 60_000).toISOString() },
  });
  assert.deepEqual(describeVersionMoves(both, NOW), [
    { half: 'runtime', from: '2.1.229', to: '2.1.233' },
    { half: 'sdk', from: '0.3.165', to: '0.3.233' },
  ]);
});

test('a first observation and a stale move both stay silent', () => {
  // No `previous`: the pair has never moved as far as CLIde knows.
  assert.deepEqual(describeVersionMoves(versions(), NOW), []);

  const stale = versions({
    observedAt: new Date(NOW - VERSION_MOVE_NOTICE_WINDOW_MS - 1000).toISOString(),
    previous: { runtime: '2.1.229', sdk: '0.3.233', observedAt: new Date(NOW - 1e9).toISOString() },
  });
  assert.deepEqual(describeVersionMoves(stale, NOW), [], 'an old move is not news');

  const fresh = versions({
    observedAt: new Date(NOW - VERSION_MOVE_NOTICE_WINDOW_MS + 1000).toISOString(),
    previous: { runtime: '2.1.229', sdk: '0.3.233', observedAt: new Date(NOW - 1e9).toISOString() },
  });
  assert.equal(describeVersionMoves(fresh, NOW).length, 1, 'inside the window it still is');
});

test('a corrupt timestamp is treated as no news rather than crashing the card', () => {
  const broken = versions({
    observedAt: 'not-a-date',
    previous: { runtime: '2.1.229', sdk: '0.3.233', observedAt: 'also-not-a-date' },
  });
  assert.deepEqual(describeVersionMoves(broken, NOW), []);
  assert.equal(formatVersionAge('not-a-date', NOW), null);
});

test('the observation age is coarse and never negative', () => {
  assert.equal(formatVersionAge(new Date(NOW - 30_000).toISOString(), NOW), 'just now');
  assert.equal(formatVersionAge(new Date(NOW - 12 * 60_000).toISOString(), NOW), '12m ago');
  assert.equal(formatVersionAge(new Date(NOW - 3 * 3_600_000).toISOString(), NOW), '3h ago');
  assert.equal(formatVersionAge(new Date(NOW - 50 * 3_600_000).toISOString(), NOW), '2d ago');
  // A host clock behind the server's must not read as a future observation.
  assert.equal(formatVersionAge(new Date(NOW + 60_000).toISOString(), NOW), null);
});
