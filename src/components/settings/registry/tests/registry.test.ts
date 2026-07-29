import assert from 'node:assert/strict';
import test from 'node:test';

import {
  LEGACY_SCREEN_IDS,
  MAX_SETTINGS_DEPTH,
  SETTINGS_GROUPS,
  SETTINGS_SCREENS,
  getChildScreens,
  getGroupScreens,
  getScreen,
  getScreenPath,
  normalizeScreenId,
} from '../registry.js';

// These invariants exist because the defect that motivated the registry was a
// nav entry missing from one of two hand-maintained arrays: `voice` was in the
// sidebar but not in SETTINGS_MAIN_TABS, so the command palette could not reach
// Voice. A registry only prevents that class of bug if something checks it.

test('screen ids are unique', () => {
  const ids = SETTINGS_SCREENS.map((screen) => screen.id);
  assert.equal(new Set(ids).size, ids.length);
});

test('group ids are unique and do not collide with screen ids', () => {
  const groupIds = SETTINGS_GROUPS.map((group) => group.id);
  assert.equal(new Set(groupIds).size, groupIds.length);

  const screenIds = new Set(SETTINGS_SCREENS.map((screen) => screen.id));
  const collisions = groupIds.filter((id) => screenIds.has(id));
  // 'agents' is deliberately both a group and the interim single Agents screen
  // until P4 splits it into per-provider screens. Deep links resolve against
  // screens only, so this is safe, but it should not spread.
  assert.deepEqual(collisions, ['agents']);
});

test('every screen belongs to a declared group', () => {
  const groupIds = new Set(SETTINGS_GROUPS.map((group) => group.id));

  for (const screen of SETTINGS_SCREENS) {
    assert.ok(groupIds.has(screen.group), `${screen.id} has unknown group ${screen.group}`);
  }
});

test('every group has at least one screen', () => {
  for (const group of SETTINGS_GROUPS) {
    assert.ok(getGroupScreens(group.id).length > 0, `group ${group.id} is empty`);
  }
});

test('every declared parent resolves to a real screen', () => {
  for (const screen of SETTINGS_SCREENS) {
    if (!screen.parent) continue;
    assert.ok(getScreen(screen.parent), `${screen.id} has unknown parent ${screen.parent}`);
  }
});

test('no screen sits deeper than the maximum depth', () => {
  for (const screen of SETTINGS_SCREENS) {
    const depth = getScreenPath(screen.id).length;
    assert.ok(depth <= MAX_SETTINGS_DEPTH, `${screen.id} is ${depth} deep`);
  }
});

test('a sub-screen shares its parent group, so the rail can nest it', () => {
  for (const screen of SETTINGS_SCREENS) {
    if (!screen.parent) continue;
    const parent = getScreen(screen.parent);
    assert.equal(screen.group, parent?.group, `${screen.id} is in a different group to its parent`);
  }
});

test('every screen carries a label key and keywords', () => {
  for (const screen of SETTINGS_SCREENS) {
    assert.ok(screen.labelKey.length > 0, `${screen.id} has no labelKey`);
    assert.ok(screen.keywords.trim().length > 0, `${screen.id} has no keywords`);
  }
});

test('getScreenPath returns the ancestor chain ending with the screen', () => {
  assert.deepEqual(getScreenPath('appearance.editor'), ['appearance', 'appearance.editor']);
  assert.deepEqual(getScreenPath('appearance'), ['appearance']);
  assert.deepEqual(getScreenPath('nope'), []);
});

test('getChildScreens finds sub-screens and returns none for leaves', () => {
  assert.deepEqual(getChildScreens('appearance').map((s) => s.id), ['appearance.editor']);
  assert.deepEqual(getChildScreens('about'), []);
});

test('getGroupScreens excludes sub-screens', () => {
  const appScreenIds = getGroupScreens('app').map((screen) => screen.id);
  assert.ok(appScreenIds.includes('appearance'));
  assert.ok(!appScreenIds.includes('appearance.editor'));
});

test('normalizeScreenId maps legacy tab ids to their new homes', () => {
  assert.equal(normalizeScreenId('api'), 'credentials');
  assert.equal(normalizeScreenId('tools'), 'agents');
});

test('every legacy mapping points at a screen that exists', () => {
  for (const [legacy, target] of Object.entries(LEGACY_SCREEN_IDS)) {
    assert.ok(getScreen(target), `legacy id ${legacy} maps to missing screen ${target}`);
  }
});

test('normalizeScreenId passes through current ids and rejects junk', () => {
  assert.equal(normalizeScreenId('appearance'), 'appearance');
  assert.equal(normalizeScreenId('appearance.editor'), 'appearance.editor');
  assert.equal(normalizeScreenId('does-not-exist'), null);
  assert.equal(normalizeScreenId(''), null);
  assert.equal(normalizeScreenId(undefined), null);
  assert.equal(normalizeScreenId(null), null);
});

test('every destination reachable before the restructure is still reachable', () => {
  // The pre-restructure tab list, including `voice`, which the old
  // SETTINGS_MAIN_TABS array omitted.
  const legacyTabs = [
    'agents', 'appearance', 'git', 'api', 'voice',
    'tasks', 'browser', 'notifications', 'plugins', 'about',
  ];

  for (const tab of legacyTabs) {
    assert.ok(normalizeScreenId(tab), `legacy tab ${tab} no longer resolves`);
  }
});
