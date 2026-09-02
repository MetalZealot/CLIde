/**
 * Every key of the Agent SDK's public `Settings` interface, and what CLIde does
 * with it.
 *
 * The cascade is already in force in every session, so a key here is not a
 * feature request — it is a statement about whether the user can reach it. The
 * drift test holds this table to the installed SDK exactly, so a release that
 * adds or removes a key fails by name instead of going unnoticed.
 */

export type ClaudeSettingTier =
  /** CLIde renders a control for it today. */
  | 'exposed'
  /** Real user value, works headless, no CLIde equivalent yet — build a control. */
  | 'adapt'
  /** Show the effective value with its source; never offer to edit it. */
  | 'display'
  /** Terminal chrome, or something CLIde's own UI already owns. Never surface. */
  | 'terminal'
  /** Enterprise policy, auth plumbing, or a host surface CLIde is not. */
  | 'out-of-scope';


/** Controls that exist. */
const EXPOSED: readonly string[] = [
  'autoCompactEnabled', 'autoCompactWindow',
];

/** The build list. */
const ADAPT: readonly string[] = [
  'additionalMarketplaces', 'advisorModel', 'agent', 'agentPushNotifEnabled',
  'alwaysThinkingEnabled', 'askUserQuestionTimeout', 'attribution', 'autoContinueAtUsageLimit',
  'autoDreamEnabled', 'autoMemoryDirectory', 'autoMemoryEnabled', 'autoUploadSessions',
  'cleanupPeriodDays', 'dialogExpiry', 'disableAllHooks', 'disableArtifact', 'disableAutoMode',
  'disableBundledSkills', 'disableClaudeAiConnectors', 'disableSkillShellExecution',
  'disableWorkflows', 'disabledMcpjsonServers', 'enableAllProjectMcpServers', 'enableArtifact',
  'enableWorkflows', 'enabledMcpjsonServers', 'enabledPlugins', 'extraKnownMarketplaces',
  'fallbackModel', 'fastMode', 'fastModePerSessionOptIn', 'fileCheckpointingEnabled',
  'fileSuggestion', 'includeCoAuthoredBy', 'includeGitInstructions', 'inputNeededNotifEnabled',
  'language', 'modelPicker', 'outputStyle', 'permissions', 'plansDirectory', 'pluginConfigs',
  'precomputeCompactionEnabled', 'promptCacheTtl', 'promptSuggestionEnabled',
  'respectGitignore', 'showClearContextOnPlanAccept', 'showThinkingSummaries', 'skillOverrides',
  'skipWebFetchPreflight', 'subagentPromptCacheTtl', 'switchModelsOnFlag',
  'syncClaudeAiPlugins', 'syncClaudeAiSkills', 'todoFeatureEnabled',
  'workflowKeywordTriggerEnabled', 'workflowSizeGuideline', 'worktree',
];

/** Read-only. `hooks` and `sandbox` sit here because a JSON blob behind a text area is worse than no control. */
const DISPLAY: readonly string[] = [
  'allowedMcpServers', 'availableModels', 'claudeMd', 'claudeMdExcludes',
  'companyAnnouncements', 'deniedMcpServers', 'effortLevel', 'enforceAvailableModels', 'env',
  'hooks', 'minimumVersion', 'model', 'modelOverrides', 'modelSettings',
  'requiredMaximumVersion', 'requiredMinimumVersion', 'sandbox',
  'skipDangerousModePermissionPrompt', 'ultracode',
];

/** Terminal-bound, or CLIde owns the equivalent. */
const TERMINAL: readonly string[] = [
  'autoScrollEnabled', 'defaultShell', 'defaultView', 'editorMode', 'emojiCompletionEnabled',
  'footerLinksRegexes', 'keybindingFlavor', 'prUrlTemplate', 'preferredNotifChannel',
  'prefersReducedMotion', 'respondToBashCommands', 'showMessageTimestamps', 'showTurnDuration',
  'spellcheck', 'spinnerTipsEnabled', 'spinnerTipsOverride', 'spinnerVerbs', 'statusLine',
  'subagentStatusLine', 'syntaxHighlightingDisabled', 'teammateMode',
  'terminalProgressBarEnabled', 'terminalTitleFromRename', 'theme', 'timeFormat', 'timeZone',
  'tui', 'verbose', 'viewMode', 'vimInsertModeRemaps', 'voice', 'voiceEnabled',
  'wheelScrollAccelerationEnabled',
];

/** Not settable, or not CLIde's to set. */
const OUT_OF_SCOPE: readonly string[] = [
  'allowAllClaudeAiMcps', 'allowManagedHooksOnly', 'allowManagedMcpServersOnly',
  'allowManagedPermissionRulesOnly', 'allowedChannelPlugins', 'allowedHttpHookUrls',
  'allowedMarketplaces', 'apiKeyHelper', 'autoUpdatesChannel', 'awsAuthRefresh',
  'awsCredentialExport', 'blockedMarketplaces', 'channelsEnabled', 'crossSessionInbound',
  'daemonColdStart', 'desktopSessionCleanupPeriodDays', 'disableAgentView',
  'disableCommandPluginSources', 'disableDeepLinkRegistration', 'disableRemoteControl',
  'disableSideloadFlags', 'feedbackDrafts', 'feedbackSurveyRate', 'forceLoginGatewayUrl',
  'forceLoginMethod', 'forceLoginOrgUUID', 'forceRemoteSettingsRefresh', 'gcpAuthRefresh',
  'httpHookAllowedEnvVars', 'isolatePeerMachines', 'managedSourcesBehavior', 'modelPricing',
  'otelHeadersHelper', 'parentSettingsBehavior', 'pluginSuggestionMarketplaces',
  'pluginTrustMessage', 'policyHelper', 'processWrapper', 'proxyAuthHelper', 'remote',
  'remoteControlAtStartup', 'skillListingBudgetFraction', 'skillListingMaxDescChars',
  'sshConfigs', 'strictKnownMarketplaces', 'strictPluginOnlyCustomization',
  'wslInheritsWindowsSettings',
];

const byTier = (keys: readonly string[], tier: ClaudeSettingTier): [string, ClaudeSettingTier][] => (
  keys.map((key) => [key, tier])
);

export const CLAUDE_SETTINGS_CATALOG: Readonly<Record<string, ClaudeSettingTier>> = Object.fromEntries([
  ...byTier(EXPOSED, 'exposed'),
  ...byTier(ADAPT, 'adapt'),
  ...byTier(DISPLAY, 'display'),
  ...byTier(TERMINAL, 'terminal'),
  ...byTier(OUT_OF_SCOPE, 'out-of-scope'),
]);

/** Keys of one tier, for a screen that renders a tier at a time. */
export const claudeSettingsInTier = (tier: ClaudeSettingTier): string[] => (
  Object.entries(CLAUDE_SETTINGS_CATALOG)
    .filter(([, value]) => value === tier)
    .map(([key]) => key)
    .sort()
);
