/** Update status shared by the authenticated provider API and New Session notice. */
export type ProviderCliUpdateStatus = {
  provider: 'claude' | 'codex';
  installedVersion: string | null;
  latestVersion: string | null;
  updateAvailable: boolean;
  canUpdate: boolean;
  state: 'idle' | 'waiting' | 'updating' | 'updated' | 'error';
  message: string | null;
};

/** Claude plugin/marketplace refresh status for the Skills page. */
export type ClaudePluginUpdateStatus = {
  state: 'idle' | 'updating' | 'error';
  lastUpdatedAt: string | null;
  updatedPlugins: number;
  message: string | null;
};

/** The Agent SDK CLIde bundles against npm's latest; it updates by a code change, never from the UI. */
export type ClaudeSdkReleaseStatus = {
  installedVersion: string | null;
  /** The Claude Code CLI version the installed SDK was built against. */
  builtForCliVersion: string | null;
  /** The Claude Code CLI CLIde actually runs. */
  cliVersion: string | null;
  /** Newest published SDK built for the installed CLI, or for the closest older one. */
  matchedVersion: string | null;
  /** `behind`: move up to `matchedVersion`. `ahead`: the SDK expects a newer CLI than the installed one. */
  drift: 'behind' | 'ahead' | null;
};
