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
  | 'appearance'
  | 'codeEditor'
  | 'chat'
  | 'voice'
  | 'notifications'
  | 'git'
  | 'plugins'
  | 'browser'
  | 'tasks'
  | 'credentials'
  | 'about'
  | 'providerClaude'
  | 'providerCursor'
  | 'providerCodex'
  | 'providerOpenCode'
  | 'permissions'
  | 'mcp'
  | 'skills';

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
 * The four CLI providers, promoted to root by P4. Declared as data because
 * their screens are otherwise identical: each is an account screen with up to
 * three subsystem sub-screens, and hand-writing fourteen near-identical nodes
 * is exactly the divergence the registry exists to prevent.
 *
 * Mirrors `LLMProvider` from `types/app`, restated here so this module keeps its
 * no-imports property; `AGENT_PROVIDER_IDS` is checked against it in the view
 * layer, which is where the two meet.
 */
export type AgentProviderId = 'claude' | 'cursor' | 'codex' | 'opencode';

export type AgentSubsystem = 'permissions' | 'mcp' | 'skills';

type AgentProviderDescriptor = {
  id: AgentProviderId;
  icon: SettingsIconName;
  /**
   * OpenCode has neither a permissions UI nor per-provider skills, so it gets
   * neither row. This is the pre-existing capability shape, not a new decision:
   * `AgentCategoryContentSection` rendered nothing for OpenCode › Permissions,
   * and the IA spec's provider sketch lists Skills as hidden for it.
   */
  subsystems: AgentSubsystem[];
};

export const AGENT_PROVIDERS: AgentProviderDescriptor[] = [
  { id: 'claude', icon: 'providerClaude', subsystems: ['permissions', 'mcp', 'skills'] },
  { id: 'cursor', icon: 'providerCursor', subsystems: ['permissions', 'mcp', 'skills'] },
  { id: 'codex', icon: 'providerCodex', subsystems: ['permissions', 'mcp', 'skills'] },
  { id: 'opencode', icon: 'providerOpenCode', subsystems: ['mcp'] },
];

export const AGENT_PROVIDER_IDS: AgentProviderId[] = AGENT_PROVIDERS.map((provider) => provider.id);

const SUBSYSTEM_NODES: Record<AgentSubsystem, { labelKey: string; icon: SettingsIconName; keywords: string }> = {
  permissions: {
    labelKey: 'tabs.permissions',
    icon: 'permissions',
    keywords: 'permissions allow deny skip tools commands bypass mode',
  },
  mcp: {
    labelKey: 'tabs.mcpServers',
    icon: 'mcp',
    keywords: 'mcp model context protocol servers stdio http sse',
  },
  skills: {
    labelKey: 'tabs.skills',
    icon: 'skills',
    keywords: 'skills upload folder markdown',
  },
};

/** `agent.claude`, and `agent.claude.permissions` for a subsystem. */
export const agentScreenId = (provider: AgentProviderId, subsystem?: AgentSubsystem): string => (
  subsystem ? `agent.${provider}.${subsystem}` : `agent.${provider}`
);

const AGENT_SCREENS: SettingsScreenNode[] = AGENT_PROVIDERS.flatMap((provider) => [
  {
    kind: 'screen' as const,
    id: agentScreenId(provider.id),
    labelKey: `agents.providers.${provider.id}`,
    icon: provider.icon,
    group: 'agents' as const,
    // Deliberately *not* listing the subsystems here: each subsystem is its own
    // screen with its own keywords, so repeating them would make "claude
    // permissions" match both the account screen and the Permissions screen.
    keywords: `${provider.id} agent provider account sign in login usage plan`,
  },
  ...provider.subsystems.map((subsystem) => ({
    kind: 'screen' as const,
    id: agentScreenId(provider.id, subsystem),
    labelKey: SUBSYSTEM_NODES[subsystem].labelKey,
    icon: SUBSYSTEM_NODES[subsystem].icon,
    group: 'agents' as const,
    keywords: `${provider.id} ${SUBSYSTEM_NODES[subsystem].keywords}`,
    parent: agentScreenId(provider.id),
  })),
]);

/**
 * Every destination in Settings. Since P4 this is the IA spec's root list
 * exactly: the interim single `agents` screen is gone, replaced by the four
 * provider screens above and their subsystem sub-screens.
 */
export const SETTINGS_SCREENS: SettingsScreenNode[] = [
  ...AGENT_SCREENS,
  {
    kind: 'screen',
    id: 'appearance',
    labelKey: 'mainTabs.appearance',
    icon: 'appearance',
    group: 'app',
    keywords: 'appearance theme dark light system language',
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
    id: 'chat',
    labelKey: 'mainTabs.chat',
    icon: 'chat',
    group: 'app',
    keywords: 'chat messages input voice speech microphone dictation raw parameters thinking enter send',
  },
  {
    kind: 'screen',
    id: 'chat.voice',
    labelKey: 'voiceSettings.backendTitle',
    icon: 'voice',
    group: 'app',
    keywords: 'voice backend speech stt tts api key model format base url',
    parent: 'chat',
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
    id: 'projects-git',
    labelKey: 'mainTabs.projectsGit',
    icon: 'git',
    group: 'app',
    keywords: 'projects git identity name email commits sorting sort order',
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
 * `tools` predates the Agents tab; both it and `agents` land on Claude's
 * provider screen, which is where the old Agents tab opened (Claude × Account).
 * `voice` was its own top-level tab; its enable toggle now lives on the `chat`
 * screen itself, but the deep link goes straight to the backend sub-screen since
 * that was the old tab's substance. `git` was its own top-level tab; P3b merged
 * it with project sorting into `projects-git`.
 */
export const LEGACY_SCREEN_IDS: Record<string, string> = {
  tools: 'agent.claude',
  agents: 'agent.claude',
  api: 'credentials',
  'api-tokens': 'credentials',
  voice: 'chat.voice',
  git: 'projects-git',
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
export type AgentScreenRef = {
  provider: AgentProviderId;
  /** null on the provider's own account screen. */
  subsystem: AgentSubsystem | null;
};

const AGENT_SCREEN_REFS = new Map<string, AgentScreenRef>(
  AGENT_PROVIDERS.flatMap((provider) => [
    [agentScreenId(provider.id), { provider: provider.id, subsystem: null }] as const,
    ...provider.subsystems.map((subsystem) => (
      [agentScreenId(provider.id, subsystem), { provider: provider.id, subsystem }] as const
    )),
  ]),
);

/**
 * Which provider and subsystem a screen id refers to, or null for any screen
 * outside the Agents group. Lets the view layer branch on two small values
 * instead of a fourteen-case switch, and keeps the id format an implementation
 * detail of this module.
 */
export const parseAgentScreenId = (id: string | null | undefined): AgentScreenRef | null => (
  id ? AGENT_SCREEN_REFS.get(id) ?? null : null
);

export const normalizeScreenId = (id: string | null | undefined): string | null => {
  if (!id) {
    return null;
  }

  const mapped = LEGACY_SCREEN_IDS[id] ?? id;
  return getScreen(mapped) ? mapped : null;
};
