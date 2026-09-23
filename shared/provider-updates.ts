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
