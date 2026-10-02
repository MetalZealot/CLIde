/**
 * Where each Claude Code setting lives in CLIde, and how it is presented.
 *
 * A key absent here still has a generated control in Advanced, so this list is
 * curation, never coverage. Labels and help text are i18n keys under
 * `claudeSettings.rows.<key>`. A `default` is Claude Code's own value when the
 * key is unset, decoded from the CLI 2.1.286; a key whose default depends on
 * the server or context has none and offers "Claude decides" instead.
 */

import type { ClaudeSettingEntry } from '../hooks/useClaudeSettings';
import type { AgentSubsystem } from '../registry/registry';

import { claudeSettingLabel } from './claudeConfiguration';

export type ClaudeChoiceOption = { value: string | number | boolean; labelKey: string };

export type ClaudeSettingRowSpec =
  | { kind: 'switch'; key: string; default: boolean; invert?: boolean }
  | { kind: 'choice'; key: string; options: ClaudeChoiceOption[]; default?: string | number | boolean; unsetLabelKey?: string }
  | { kind: 'text'; key: string; numeric?: boolean }
  | { kind: 'summary'; key: string }
  | { kind: 'screen'; screen: AgentSubsystem };

export type ClaudeSettingsSection = { titleKey?: string; rows: ClaudeSettingRowSpec[] };

export type ClaudeSettingsCategory = 'modelThinking' | 'responses' | 'memory' | 'git' | 'history';

const ON_OFF: ClaudeChoiceOption[] = [
  { value: true, labelKey: 'claudeSettings.options.on' },
  { value: false, labelKey: 'claudeSettings.options.off' },
];

export const CLAUDE_SETTINGS_LAYOUT: Record<ClaudeSettingsCategory, ClaudeSettingsSection[]> = {
  modelThinking: [
    { rows: [{ kind: 'screen', screen: 'model' }, { kind: 'screen', screen: 'effort' }] },
    {
      titleKey: 'claudeSettings.sections.thinking',
      rows: [
        { kind: 'switch', key: 'alwaysThinkingEnabled', default: true },
        { kind: 'choice', key: 'showThinkingSummaries', options: ON_OFF },
      ],
    },
    {
      titleKey: 'claudeSettings.sections.speedCost',
      rows: [
        { kind: 'switch', key: 'fastMode', default: false },
        {
          kind: 'choice',
          key: 'promptCacheTtl',
          unsetLabelKey: 'claudeSettings.options.automatic',
          options: [
            { value: '5m', labelKey: 'claudeSettings.options.minutes5' },
            { value: '1h', labelKey: 'claudeSettings.options.hour1' },
          ],
        },
        { kind: 'screen', screen: 'autoCompact' },
      ],
    },
  ],
  responses: [
    {
      rows: [
        {
          kind: 'choice',
          key: 'outputStyle',
          unsetLabelKey: 'claudeSettings.options.defaultStyle',
          options: [
            { value: 'Explanatory', labelKey: 'claudeSettings.options.explanatory' },
            { value: 'Learning', labelKey: 'claudeSettings.options.learning' },
          ],
        },
        { kind: 'text', key: 'language' },
      ],
    },
    {
      titleKey: 'claudeSettings.sections.whileWorking',
      rows: [
        { kind: 'switch', key: 'todoFeatureEnabled', default: true },
        { kind: 'switch', key: 'promptSuggestionEnabled', default: true },
        {
          kind: 'choice',
          key: 'askUserQuestionTimeout',
          default: 'never',
          options: [
            { value: 'never', labelKey: 'claudeSettings.options.never' },
            { value: '60s', labelKey: 'claudeSettings.options.seconds60' },
            { value: '5m', labelKey: 'claudeSettings.options.minutes5' },
            { value: '10m', labelKey: 'claudeSettings.options.minutes10' },
          ],
        },
        { kind: 'choice', key: 'autoContinueAtUsageLimit', options: ON_OFF },
      ],
    },
  ],
  memory: [
    {
      rows: [
        { kind: 'switch', key: 'autoMemoryEnabled', default: true },
        { kind: 'choice', key: 'autoDreamEnabled', options: ON_OFF },
        { kind: 'text', key: 'autoMemoryDirectory' },
      ],
    },
  ],
  git: [
    {
      rows: [
        { kind: 'switch', key: 'includeGitInstructions', default: true },
        { kind: 'switch', key: 'attribution', default: true },
        { kind: 'switch', key: 'respectGitignore', default: true },
        { kind: 'summary', key: 'worktree' },
      ],
    },
  ],
  history: [
    {
      rows: [
        {
          kind: 'choice',
          key: 'cleanupPeriodDays',
          default: 30,
          options: [7, 30, 90, 365].map((days) => ({ value: days, labelKey: `claudeSettings.options.days${days}` })),
        },
        { kind: 'switch', key: 'fileCheckpointingEnabled', default: true },
        { kind: 'choice', key: 'autoUploadSessions', options: ON_OFF },
        { kind: 'text', key: 'plansDirectory' },
      ],
    },
  ],
};

/** Behaviour switches on Claude's Tools screen; each `disable*` key reads as its positive. */
export const CLAUDE_TOOLS_ROWS: ClaudeSettingRowSpec[] = [
  { kind: 'switch', key: 'disableAllHooks', default: false, invert: true },
  { kind: 'switch', key: 'disableBundledSkills', default: false, invert: true },
  { kind: 'switch', key: 'disableSkillShellExecution', default: false, invert: true },
];

/** Claude Code's own pushes to the Claude mobile app, on the Notifications screen. */
export const CLAUDE_NOTIFICATION_ROWS: ClaudeSettingRowSpec[] = [
  { kind: 'switch', key: 'inputNeededNotifEnabled', default: true },
  { kind: 'switch', key: 'agentPushNotifEnabled', default: true },
];

/**
 * Keys with a home outside Advanced: the rows above, plus the ones a dedicated
 * screen or a later phase owns.
 */
export const CLAUDE_PLACED_KEYS: ReadonlySet<string> = new Set([
  ...Object.values(CLAUDE_SETTINGS_LAYOUT).flatMap((sections) => sections.flatMap((section) => section.rows)),
  ...CLAUDE_TOOLS_ROWS,
  ...CLAUDE_NOTIFICATION_ROWS,
]
  .flatMap((row) => ('key' in row ? [row.key] : []))
  .concat(['includeCoAuthoredBy', 'permissions', 'disableAutoMode']));

export const isClaudeSettingsCategory = (subsystem: string): subsystem is ClaudeSettingsCategory => (
  subsystem in CLAUDE_SETTINGS_LAYOUT
);

export const claudeEntryLabel = (entry: ClaudeSettingEntry): string => (
  claudeSettingLabel(entry.key, entry.control?.kind === 'boolean')
);

/** Every editable key without a home elsewhere, sorted by the label it shows. */
export const advancedClaudeEntries = (entries: Map<string, ClaudeSettingEntry> | null): ClaudeSettingEntry[] => (
  [...(entries?.values() ?? [])]
    .filter((entry) => entry.control && !CLAUDE_PLACED_KEYS.has(entry.key))
    .sort((a, b) => claudeEntryLabel(a).localeCompare(claudeEntryLabel(b)))
);
