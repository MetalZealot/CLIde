/**
 * The second pass of Settings search: individual setting labels, mapped to the
 * screen that renders them, so "minimap" or "enter to send" resolves to a
 * destination rather than to nothing.
 *
 * **Why this is data and not registration.** The IA spec describes screens
 * "registering" their setting labels, but only one screen is mounted at a time —
 * a mounted screen cannot advertise settings the user has not navigated to yet.
 * So the index is declared here, beside the registry, and stays free of React
 * for the same reason `registry.ts` is: it is unit-tested without a renderer.
 *
 * The cost is drift: a screen can gain a row without gaining an entry here. A
 * test asserts every entry points at a real screen and a real `en` key, which
 * catches deletions and typos but cannot catch an omission. Entries are
 * therefore *labels worth searching for*, not an exhaustive inventory — a
 * missing one degrades search, it does not break a screen.
 */

import { AGENT_PROVIDERS, agentScreenId } from './registry';
import type { AgentProviderId } from './registry';

export type SettingsSearchEntry = {
  screenId: string;
  /** i18n key in the `settings` namespace, resolved by the caller's `t`. */
  labelKey: string;
  /** Extra terms that are not in the label — synonyms and the words users type. */
  keywords?: string;
};

/**
 * Per-provider permission rows differ: Claude gates tools, Cursor gates shell
 * commands, Codex has a single mode picker instead of lists (and OpenCode has no
 * Permissions screen at all). Mirrors `AgentPermissionsScreen`'s own branching.
 */
const PERMISSION_ENTRY_KEYS: Record<AgentProviderId, string[]> = {
  claude: [
    'permissions.skipPermissions.label',
    'permissions.allowedTools.title',
    'permissions.blockedTools.title',
  ],
  cursor: [
    'permissions.skipPermissions.label',
    'permissions.allowedCommands.title',
    'permissions.blockedCommands.title',
  ],
  codex: ['permissions.codex.permissionMode'],
  opencode: [],
};

const AGENT_ENTRIES: SettingsSearchEntry[] = AGENT_PROVIDERS.flatMap((provider) => [
  { screenId: agentScreenId(provider.id), labelKey: 'agents.connectionStatus' },
  { screenId: agentScreenId(provider.id), labelKey: 'agents.login.title', keywords: 'sign in log in authenticate' },
  { screenId: agentScreenId(provider.id), labelKey: 'agents.usage.title', keywords: 'quota limit spend' },
  ...(provider.subsystems.includes('permissions')
    ? PERMISSION_ENTRY_KEYS[provider.id].map((labelKey) => ({
      screenId: agentScreenId(provider.id, 'permissions'),
      labelKey,
    }))
    : []),
  ...(provider.id === 'codex'
    ? [{
      screenId: agentScreenId('codex'),
      labelKey: 'agents.codexRuntime.title',
      keywords: 'runtime native executable binary version install path transport app server sdk rollback',
    }]
    : []),
  ...(provider.subsystems.includes('mcp')
    ? [{ screenId: agentScreenId(provider.id, 'mcp'), labelKey: 'mcpServers.addButton' }]
    : []),
]);

export const SETTINGS_SEARCH_ENTRIES: SettingsSearchEntry[] = [
  ...AGENT_ENTRIES,

  { screenId: 'appearance', labelKey: 'appearanceSettings.theme.title', keywords: 'dark light system mode' },
  { screenId: 'appearance', labelKey: 'appearanceSettings.language.title', keywords: 'locale translation' },

  { screenId: 'appearance.editor', labelKey: 'appearanceSettings.codeEditor.wordWrap.label' },
  { screenId: 'appearance.editor', labelKey: 'appearanceSettings.codeEditor.showMinimap.label' },
  { screenId: 'appearance.editor', labelKey: 'appearanceSettings.codeEditor.lineNumbers.label' },
  { screenId: 'appearance.editor', labelKey: 'appearanceSettings.codeEditor.fontSize.label' },

  { screenId: 'chat', labelKey: 'quickSettings.showRawParameters', keywords: 'tool parameters json' },
  { screenId: 'chat', labelKey: 'quickSettings.showThinking', keywords: 'reasoning' },
  { screenId: 'chat', labelKey: 'quickSettings.enterToSend', keywords: 'keyboard return newline' },
  { screenId: 'chat', labelKey: 'quickSettings.sendByCtrlEnter', keywords: 'keyboard ime' },
  { screenId: 'chat', labelKey: 'voiceSettings.enable', keywords: 'microphone dictation read aloud' },

  { screenId: 'chat.voice', labelKey: 'voiceSettings.baseUrl' },
  { screenId: 'chat.voice', labelKey: 'voiceSettings.apiKey' },
  { screenId: 'chat.voice', labelKey: 'voiceSettings.sttModel', keywords: 'whisper transcribe' },
  { screenId: 'chat.voice', labelKey: 'voiceSettings.ttsModel', keywords: 'read aloud speak' },
  { screenId: 'chat.voice', labelKey: 'voiceSettings.voice' },
  { screenId: 'chat.voice', labelKey: 'voiceSettings.format' },

  { screenId: 'notifications', labelKey: 'notifications.webPush.title', keywords: 'push browser' },
  { screenId: 'notifications', labelKey: 'notifications.desktop.title' },
  { screenId: 'notifications', labelKey: 'notifications.sound.title', keywords: 'tone chime audio' },
  { screenId: 'notifications', labelKey: 'notifications.events.title', keywords: 'action required stopped failed' },

  { screenId: 'projects-git', labelKey: 'git.name.label', keywords: 'identity commits author' },
  { screenId: 'projects-git', labelKey: 'git.email.label', keywords: 'identity commits author' },

  { screenId: 'plugins', labelKey: 'pluginSettings.installButton', keywords: 'git repository url' },

  { screenId: 'browser', labelKey: 'browserSettings.enable.label', keywords: 'playwright chromium runtime' },

  { screenId: 'tasks', labelKey: 'tasks.settings.enableLabel', keywords: 'taskmaster' },

  { screenId: 'credentials', labelKey: 'apiKeys.title', keywords: 'external api token' },
  { screenId: 'credentials', labelKey: 'apiKeys.github.title', keywords: 'personal access token clone private' },

  // About has no rows of its own — "version", "license" and "links" are already
  // in its registry keywords, which is the right place for a screen with no
  // settings to search inside.
];
