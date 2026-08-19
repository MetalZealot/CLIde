import assert from 'node:assert/strict';
import test from 'node:test';

import en from '../../../../i18n/locales/en/settings.json' with { type: 'json' };
import { SETTINGS_SCREENS, getScreen } from '../registry.js';
import { SETTINGS_SEARCH_ENTRIES } from '../searchIndex.js';
import { describeSearchResult, searchSettings } from '../search.js';

/**
 * Search is checked against the real `en` bundle rather than a fixture: the
 * point of the feature is that what the user reads is what they can type, and a
 * fixture would let the two drift silently.
 */
const translate = (key: string): string => {
  const value = key.split('.').reduce<unknown>(
    (node, part) => (node && typeof node === 'object' ? (node as Record<string, unknown>)[part] : undefined),
    en,
  );

  // i18next echoes an unresolved key, so mirroring that keeps assertions honest.
  return typeof value === 'string' ? value : key;
};

const search = (query: string) => searchSettings(query, translate);
const screenIds = (query: string) => search(query).map((result) => result.screenId);

test('a blank query matches nothing, rather than everything', () => {
  assert.deepEqual(search(''), []);
  assert.deepEqual(search('   '), []);
});

test('junk matches nothing', () => {
  assert.deepEqual(search('zzzzqqq'), []);
});

test('every screen is reachable by typing its own label', () => {
  for (const screen of SETTINGS_SCREENS) {
    const label = translate(screen.labelKey);
    assert.ok(
      screenIds(label).includes(screen.id),
      `${screen.id} is not found by searching its label "${label}"`,
    );
  }
});

test('a label prefix outranks a keyword mention', () => {
  const results = screenIds('notifications');
  assert.equal(results[0], 'notifications');
});

test('a screen appears at most once however many of its rows match', () => {
  // "model" hits both the STT and TTS model fields on the Backend screen.
  const results = screenIds('model');
  assert.equal(new Set(results).size, results.length);
  assert.ok(results.includes('chat.voice'));
});

test('a row label resolves to the screen that renders it', () => {
  const [first, ...rest] = search('minimap');
  assert.equal(first?.screenId, 'appearance.editor');
  assert.deepEqual(first?.matchedSettingLabelKeys, ['appearanceSettings.codeEditor.showMinimap.label']);
  assert.deepEqual(rest, []);
});

test('all tokens must match, but not contiguously', () => {
  assert.ok(screenIds('enter send').includes('chat'));
  assert.ok(screenIds('enter to send').includes('chat'));
  assert.equal(screenIds('enter minimap').length, 0);
});

test('an ancestor label disambiguates the three Permissions screens', () => {
  assert.deepEqual(screenIds('claude permissions'), ['agent.claude.permissions']);

  const bare = screenIds('permissions');
  assert.ok(bare.includes('agent.claude.permissions'));
  assert.ok(bare.includes('agent.cursor.permissions'));
  assert.ok(bare.includes('agent.codex.permissions'));
});

test('search is case insensitive', () => {
  assert.deepEqual(screenIds('MiNiMaP'), ['appearance.editor']);
});

test('a synonym that appears in no label still resolves', () => {
  // "quota" is only in the search index's keywords for Plan Usage.
  assert.ok(screenIds('quota').includes('agent.claude'));
});

test('describeSearchResult names the ancestor and the matched row', () => {
  const [permissions] = search('skip permission');
  assert.ok(permissions);
  assert.equal(
    describeSearchResult(permissions, translate),
    'Claude · Skip permission prompts (use with caution)',
  );

  const [editor] = search('minimap');
  assert.equal(describeSearchResult(editor, translate), 'Appearance · Show Minimap');
});

test('a row is only named when it contributed to the match', () => {
  // "claude permissions" is satisfied by the screen and its ancestor alone, so
  // listing all three permission rows as reasons would be noise.
  const [result] = search('claude permissions');
  assert.deepEqual(result.matchedSettingLabelKeys, []);
  assert.equal(describeSearchResult(result, translate), 'Claude');
});

test('describeSearchResult is empty when the screen matched on its own name', () => {
  const [notifications] = search('notifications');
  assert.equal(describeSearchResult(notifications, translate), '');
});

// The index cannot be checked for completeness — nothing knows which rows a
// screen renders — but it can be checked for rot, which is the failure that
// would otherwise show up as a result row labelled with a raw i18n key.
test('every search entry points at a real screen', () => {
  for (const entry of SETTINGS_SEARCH_ENTRIES) {
    assert.ok(getScreen(entry.screenId), `${entry.labelKey} points at unknown screen ${entry.screenId}`);
  }
});

test('every search entry resolves to a real en string', () => {
  for (const entry of SETTINGS_SEARCH_ENTRIES) {
    assert.notEqual(translate(entry.labelKey), entry.labelKey, `${entry.labelKey} is missing from en/settings.json`);
  }
});

test('every screen label and keyword set resolves to a real en string', () => {
  for (const screen of SETTINGS_SCREENS) {
    assert.notEqual(translate(screen.labelKey), screen.labelKey, `${screen.id} has no en label`);
    assert.ok(screen.keywords.trim().length > 0, `${screen.id} has no keywords`);
  }
});

test('auto-compact is findable by the words a confused user would type', () => {
  // The setting is Claude-only and named nowhere else in the UI, so search is
  // the only way most people will reach it.
  for (const query of ['autocompact', 'compact', 'context window']) {
    assert.ok(
      screenIds(query).includes('agent.claude.autoCompact'),
      `"${query}" should reach the auto-compact screen`,
    );
  }
});

test('auto-compact is offered for Claude alone', () => {
  const screens = SETTINGS_SCREENS.filter((screen) => screen.id.endsWith('.autoCompact'));
  assert.deepEqual(screens.map((screen) => screen.id), ['agent.claude.autoCompact']);
});
