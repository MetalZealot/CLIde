/**
 * The single source of truth for Settings' information architecture.
 *
 * This module is deliberately **pure data with no React imports** — it drives the
 * mobile root list, the desktop rail, deep links, the command palette and (in a
 * later phase) search, and it is unit-tested with `node:test` without a renderer.
 * Icons are therefore named, not imported; the view layer maps the names to
 * components in `SettingsIcons.tsx`, and the mapping is exhaustive by type.
 *
 * Screen ids are stable strings and are used as deep links, so treat them as a
 * public contract: renaming one needs an entry in LEGACY_SCREEN_IDS.
 */

export type SettingsIconName =
  | 'agents'
  | 'appearance'
  | 'codeEditor'
  | 'voice'
  | 'notifications'
  | 'git'
  | 'plugins'
  | 'browser'
  | 'tasks'
  | 'credentials'
  | 'about';

export type SettingsGroupId = 'agents' | 'app' | 'extensions' | 'system';

export type SettingsGroupNode = {
  kind: 'group';
  id: SettingsGroupId;
  labelKey: string;
};

export type SettingsScreenNode = {
  kind: 'screen';
  id: string;
  labelKey: string;
  icon: SettingsIconName;
  group: SettingsGroupId;
  /** Space-separated search terms; feeds the command palette now and search in P6. */
  keywords: string;
  /** Present on sub-screens (depth 2). Absent means the screen sits at depth 1. */
  parent?: string;
};

export type SettingsNode = SettingsGroupNode | SettingsScreenNode;

export const SETTINGS_GROUPS: SettingsGroupNode[] = [
  { kind: 'group', id: 'agents', labelKey: 'groups.agents' },
  { kind: 'group', id: 'app', labelKey: 'groups.app' },
  { kind: 'group', id: 'extensions', labelKey: 'groups.extensions' },
  { kind: 'group', id: 'system', labelKey: 'groups.system' },
];

/**
 * Three screens here are **interim** and are absorbed by later phases of the
 * build plan, which is why the list is not yet identical to the IA spec's root:
 *
 * - `agents` becomes four provider screens (`agent.claude`, …) in P4.
 * - `voice` is absorbed into `chat.voice` in P3a.
 * - `git` merges with project sorting into `projects-git` in P3b.
 *
 * They are listed now so that every destination that exists today stays
 * reachable; the shape of the registry, not the final destination list, is what
 * this phase proves.
 */
export const SETTINGS_SCREENS: SettingsScreenNode[] = [
  {
    kind: 'screen',
    id: 'agents',
    labelKey: 'mainTabs.agents',
    icon: 'agents',
    group: 'agents',
    keywords: 'agents providers claude cursor codex opencode account permissions mcp skills',
  },
  {
    kind: 'screen',
    id: 'appearance',
    labelKey: 'mainTabs.appearance',
    icon: 'appearance',
    group: 'app',
    keywords: 'appearance theme dark light system language project sorting',
  },
  {
    kind: 'screen',
    id: 'appearance.editor',
    labelKey: 'appearanceSettings.codeEditor.title',
    icon: 'codeEditor',
    group: 'app',
    keywords: 'code editor word wrap minimap line numbers font size',
    parent: 'appearance',
  },
  {
    kind: 'screen',
    id: 'voice',
    labelKey: 'mainTabs.voice',
    icon: 'voice',
    group: 'app',
    keywords: 'voice speech stt tts microphone dictation',
  },
  {
    kind: 'screen',
    id: 'notifications',
    labelKey: 'mainTabs.notifications',
    icon: 'notifications',
    group: 'app',
    keywords: 'notifications alerts push sound events',
  },
  {
    kind: 'screen',
    id: 'git',
    labelKey: 'mainTabs.git',
    icon: 'git',
    group: 'app',
    keywords: 'git identity name email commits',
  },
  {
    kind: 'screen',
    id: 'plugins',
    labelKey: 'mainTabs.plugins',
    icon: 'plugins',
    group: 'extensions',
    keywords: 'plugins extensions integrations',
  },
  {
    kind: 'screen',
    id: 'browser',
    labelKey: 'mainTabs.browser',
    icon: 'browser',
    group: 'extensions',
    keywords: 'browser playwright chromium automation',
  },
  {
    kind: 'screen',
    id: 'tasks',
    labelKey: 'mainTabs.tasks',
    icon: 'tasks',
    group: 'extensions',
    keywords: 'tasks taskmaster',
  },
  {
    kind: 'screen',
    id: 'credentials',
    labelKey: 'mainTabs.credentials',
    icon: 'credentials',
    group: 'system',
    keywords: 'credentials api tokens keys github auth',
  },
  {
    kind: 'screen',
    id: 'about',
    labelKey: 'mainTabs.about',
    icon: 'about',
    group: 'system',
    keywords: 'about version info license links',
  },
];

export const SETTINGS_NODES: SettingsNode[] = [...SETTINGS_GROUPS, ...SETTINGS_SCREENS];

/** The deepest a screen may sit. Enforced by tests and by the navigation reducer. */
export const MAX_SETTINGS_DEPTH = 2;

/**
 * Old tab ids kept working as deep links. `openSettings('api')` and any
 * bookmarked palette entry must keep resolving after the restructure.
 * `tools` predates the Agents tab; `agents` is still a real screen id today and
 * needs no entry until P4 splits it.
 */
export const LEGACY_SCREEN_IDS: Record<string, string> = {
  tools: 'agents',
  api: 'credentials',
  'api-tokens': 'credentials',
};

const SCREENS_BY_ID = new Map(SETTINGS_SCREENS.map((screen) => [screen.id, screen]));

export const getScreen = (id: string | null | undefined): SettingsScreenNode | undefined => (
  id ? SCREENS_BY_ID.get(id) : undefined
);

/** Screens shown at the top level of a group — i.e. everything without a parent. */
export const getGroupScreens = (groupId: SettingsGroupId): SettingsScreenNode[] => (
  SETTINGS_SCREENS.filter((screen) => screen.group === groupId && !screen.parent)
);

export const getChildScreens = (parentId: string): SettingsScreenNode[] => (
  SETTINGS_SCREENS.filter((screen) => screen.parent === parentId)
);

/**
 * The ancestor chain for a screen, ending with the screen itself — exactly the
 * navigation stack needed to land on it from the root.
 */
export const getScreenPath = (id: string): string[] => {
  const path: string[] = [];
  let current = getScreen(id);

  while (current) {
    path.unshift(current.id);
    current = current.parent ? getScreen(current.parent) : undefined;
  }

  return path;
};

/**
 * Resolves anything a caller might pass — a current id, a legacy tab id, junk —
 * to a real screen id, or null meaning "open at the root list".
 */
export const normalizeScreenId = (id: string | null | undefined): string | null => {
  if (!id) {
    return null;
  }

  const mapped = LEGACY_SCREEN_IDS[id] ?? id;
  return getScreen(mapped) ? mapped : null;
};
