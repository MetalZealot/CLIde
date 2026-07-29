import assert from 'node:assert/strict';
import test from 'node:test';

import {
  SETTINGS_NAV_ROOT,
  currentScreenId,
  isAtRoot,
  navDepth,
  parentScreenId,
  settingsNavReducer,
} from '../navigation.js';

const reduce = (
  state: typeof SETTINGS_NAV_ROOT,
  ...actions: Parameters<typeof settingsNavReducer>[1][]
) => actions.reduce(settingsNavReducer, state);

test('the root is depth 0 with no current screen', () => {
  assert.equal(navDepth(SETTINGS_NAV_ROOT), 0);
  assert.equal(currentScreenId(SETTINGS_NAV_ROOT), null);
  assert.equal(isAtRoot(SETTINGS_NAV_ROOT), true);
});

test('pushing a top-level screen goes to depth 1', () => {
  const state = reduce(SETTINGS_NAV_ROOT, { type: 'push', id: 'appearance' });

  assert.deepEqual(state.stack, ['appearance']);
  assert.equal(currentScreenId(state), 'appearance');
  assert.equal(parentScreenId(state), null);
});

test('pushing a sub-screen from its parent goes to depth 2', () => {
  const state = reduce(
    SETTINGS_NAV_ROOT,
    { type: 'push', id: 'appearance' },
    { type: 'push', id: 'appearance.editor' },
  );

  assert.deepEqual(state.stack, ['appearance', 'appearance.editor']);
  assert.equal(parentScreenId(state), 'appearance');
});

test('popping unwinds one level at a time and stops at the root', () => {
  const deep = reduce(
    SETTINGS_NAV_ROOT,
    { type: 'push', id: 'appearance' },
    { type: 'push', id: 'appearance.editor' },
  );

  const once = settingsNavReducer(deep, { type: 'pop' });
  assert.deepEqual(once.stack, ['appearance']);

  const twice = settingsNavReducer(once, { type: 'pop' });
  assert.deepEqual(twice.stack, []);

  // A back gesture at the root must not underflow; the shell closes instead.
  const thrice = settingsNavReducer(twice, { type: 'pop' });
  assert.deepEqual(thrice.stack, []);
});

test('a sub-screen cannot be pushed from the root, only through its parent', () => {
  const state = settingsNavReducer(SETTINGS_NAV_ROOT, { type: 'push', id: 'appearance.editor' });

  assert.deepEqual(state.stack, [], 'skipping the parent would strand the back chevron');
});

test('a top-level screen cannot be pushed onto another screen', () => {
  const state = reduce(
    SETTINGS_NAV_ROOT,
    { type: 'push', id: 'appearance' },
    { type: 'push', id: 'about' },
  );

  assert.deepEqual(state.stack, ['appearance']);
});

test('depth is capped, so no screen can nest a third level', () => {
  const deep = reduce(
    SETTINGS_NAV_ROOT,
    { type: 'push', id: 'appearance' },
    { type: 'push', id: 'appearance.editor' },
  );

  const deeper = settingsNavReducer(deep, { type: 'push', id: 'appearance.editor' });
  assert.equal(navDepth(deeper), 2);
});

test('pushing an unknown id is a no-op rather than a corrupt stack', () => {
  const state = settingsNavReducer(SETTINGS_NAV_ROOT, { type: 'push', id: 'nonsense' });

  assert.deepEqual(state.stack, []);
});

test('open jumps straight to a sub-screen with its parent beneath it', () => {
  const state = settingsNavReducer(SETTINGS_NAV_ROOT, { type: 'open', id: 'appearance.editor' });

  assert.deepEqual(state.stack, ['appearance', 'appearance.editor']);
  assert.equal(parentScreenId(state), 'appearance', 'a deep link must still have a back path');
});

test('open replaces the stack rather than appending to it', () => {
  const state = reduce(
    SETTINGS_NAV_ROOT,
    { type: 'push', id: 'appearance' },
    { type: 'open', id: 'about' },
  );

  assert.deepEqual(state.stack, ['about']);
});

test('open with null or an unknown id lands on the root list', () => {
  assert.deepEqual(settingsNavReducer(SETTINGS_NAV_ROOT, { type: 'open', id: null }).stack, []);
  assert.deepEqual(settingsNavReducer(SETTINGS_NAV_ROOT, { type: 'open', id: 'gone' }).stack, []);
});

test('reset returns to the root from any depth', () => {
  const state = reduce(
    SETTINGS_NAV_ROOT,
    { type: 'push', id: 'appearance' },
    { type: 'push', id: 'appearance.editor' },
    { type: 'reset' },
  );

  assert.deepEqual(state.stack, []);
});

test('no-op actions return the same object, so React can skip a render', () => {
  const state = reduce(SETTINGS_NAV_ROOT, { type: 'push', id: 'appearance' });

  assert.equal(settingsNavReducer(state, { type: 'push', id: 'nonsense' }), state);
  assert.equal(settingsNavReducer(SETTINGS_NAV_ROOT, { type: 'pop' }), SETTINGS_NAV_ROOT);
});
