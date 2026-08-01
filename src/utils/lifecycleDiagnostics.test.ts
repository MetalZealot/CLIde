import assert from 'node:assert/strict';
import test from 'node:test';

import {
  appendLifecycleDiagnosticEvent,
  normalizeResumeProbeMode,
  type LifecycleDiagnosticEvent,
} from './lifecycleDiagnostics';

const event = (sequence: number): LifecycleDiagnosticEvent => ({
  sequence,
  timestamp: '2026-08-01T00:00:00.000Z',
  elapsedMs: sequence,
  bootId: 'boot-a',
  name: `event-${sequence}`,
});

test('lifecycle diagnostics retain only the newest bounded events', () => {
  const retained = appendLifecycleDiagnosticEvent(
    [event(1), event(2), event(3)],
    event(4),
    3,
  );

  assert.deepEqual(retained.map((entry) => entry.sequence), [2, 3, 4]);
});

test('resume probe mode accepts only supported diagnostic values', () => {
  assert.equal(normalizeResumeProbeMode('none'), 'none');
  assert.equal(normalizeResumeProbeMode('auth'), 'auth');
  assert.equal(normalizeResumeProbeMode('ws'), 'ws');
  assert.equal(normalizeResumeProbeMode('all'), 'all');
  assert.equal(normalizeResumeProbeMode('unexpected'), 'all');
  assert.equal(normalizeResumeProbeMode(null), 'all');
});
