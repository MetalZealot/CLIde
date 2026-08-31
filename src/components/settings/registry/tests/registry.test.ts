import assert from 'node:assert/strict';
import test, { describe } from 'node:test';

import en from '../../../../i18n/locales/en/settings.json';
import {
  currentScreenId,
  isAtRoot,
  navDepth,
  parentScreenId,
  SETTINGS_NAV_ROOT,
  settingsNavReducer,
} from '../navigation.js';
import {
  AGENT_PROVIDER_IDS,
  AGENT_PROVIDERS,
  agentScreenId,
  getChildScreens,
  getGroupScreens,
  getScreen,
  getScreenPath,
  LEGACY_SCREEN_IDS,
  MAX_SETTINGS_DEPTH,
  normalizeScreenId,
  parseAgentScreenId,
  SETTINGS_GROUPS,
  SETTINGS_SCREENS,
} from '../registry.js';
import { describeSearchResult, searchSettings } from '../search.js';
import { SETTINGS_SEARCH_ENTRIES } from '../searchIndex.js';

describe('registry', () => {
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
    // P2's interim `agents` screen shared its id with the Agents group; P4 replaced
    // it with per-provider screens, so no id is both a group and a screen again.
    assert.deepEqual(groupIds.filter((id) => screenIds.has(id)), []);
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
    assert.deepEqual(
      getScreenPath('chat.voice.library'),
      ['chat', 'chat.voice', 'chat.voice.library'],
    );
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
    // Both old Agents-tab ids land on Claude's provider screen, which is where the
    // tab opened: its provider pill defaulted to Claude and its category to Account.
    assert.equal(normalizeScreenId('tools'), 'agent.claude');
    assert.equal(normalizeScreenId('agents'), 'agent.claude');
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

  // P4 promoted the four providers to the root list. These invariants stand in for
  // the old provider × category grid: every combination that grid could reach must
  // still be a screen, and no combination it could not reach may appear.

  test('every provider has a root screen in the agents group', () => {
    const agentRootIds = getGroupScreens('agents').map((screen) => screen.id);
    assert.deepEqual(agentRootIds, AGENT_PROVIDER_IDS.map((id) => agentScreenId(id)));
  });

  test('a provider discloses exactly the subsystems it declares', () => {
    for (const provider of AGENT_PROVIDERS) {
      const childIds = getChildScreens(agentScreenId(provider.id)).map((screen) => screen.id);
      assert.deepEqual(
        childIds,
        provider.subsystems.map((subsystem) => agentScreenId(provider.id, subsystem)),
      );
    }
  });

  test('OpenCode has neither a permissions nor a skills screen', () => {
    // Both were unreachable-or-blank before the restructure: the old category pane
    // rendered nothing for OpenCode › Permissions, and Skills was already hidden.
    assert.equal(getScreen('agent.opencode.permissions'), undefined);
    assert.equal(getScreen('agent.opencode.skills'), undefined);
    assert.ok(getScreen('agent.opencode.mcp'));
  });

  test('parseAgentScreenId round-trips agent screens and ignores the rest', () => {
    assert.deepEqual(parseAgentScreenId('agent.codex'), { provider: 'codex', subsystem: null });
    assert.deepEqual(parseAgentScreenId('agent.codex.mcp'), { provider: 'codex', subsystem: 'mcp' });
    assert.equal(parseAgentScreenId('agent.opencode.skills'), null);
    assert.equal(parseAgentScreenId('appearance'), null);
    assert.equal(parseAgentScreenId(null), null);
  });

  test('every agent screen is parseable, and every parse names a real screen', () => {
    for (const screen of SETTINGS_SCREENS) {
      const parsed = parseAgentScreenId(screen.id);
      assert.equal(
        parsed !== null,
        screen.group === 'agents',
        `${screen.id} disagrees about being an agent screen`,
      );
    }
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
});

describe('navigation', () => {
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

  test('depth is capped, so no screen can nest beyond the Voice Library level', () => {
    const deep = reduce(
      SETTINGS_NAV_ROOT,
      { type: 'push', id: 'chat' },
      { type: 'push', id: 'chat.voice' },
      { type: 'push', id: 'chat.voice.library' },
    );

    const deeper = settingsNavReducer(deep, { type: 'push', id: 'chat.voice.library' });
    assert.equal(navDepth(deeper), 3);
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
});

describe('search', () => {
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

  test('reading-size customization resolves to Appearance', () => {
    const [result] = search('reading size');
    assert.equal(result?.screenId, 'appearance');
    assert.deepEqual(result?.matchedSettingLabelKeys, ['appearanceSettings.typography.readingSize.label']);
  });

  test('typeface customization resolves to Appearance', () => {
    const [result] = search('typeface');
    assert.equal(result?.screenId, 'appearance');
    assert.deepEqual(result?.matchedSettingLabelKeys, ['appearanceSettings.typography.fontFamily.label']);
  });

  test('line-spacing customization resolves to Appearance', () => {
    const [result] = search('line spacing');
    assert.equal(result?.screenId, 'appearance');
    assert.deepEqual(result?.matchedSettingLabelKeys, ['appearanceSettings.typography.lineSpacing.label']);
    assert.ok(screenIds('condensed text').includes('appearance'));
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

  test('every registered screen has a real label, not an echoed key', () => {
    // A screen whose label is missing still renders — as its own dotted key —
    // and still matches search, so nothing else here would catch it.
    for (const screen of SETTINGS_SCREENS) {
      assert.notEqual(
        translate(screen.labelKey),
        screen.labelKey,
        `${screen.id} has no translation for "${screen.labelKey}"`,
      );
    }
  });
});
