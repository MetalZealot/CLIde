import { readClaudeSdkVersion } from '@/modules/providers/list/claude/claude-version-pair.js';
import { isNewer } from '@/modules/providers/services/provider-cli-updates.service.js';

import type { ClaudeSdkReleaseStatus } from '../../../../shared/provider-updates.js';

type SdkReleaseDependencies = {
  installed: () => string | null;
  latest: () => Promise<string>;
  now: () => number;
};

const VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
const RETRY_INTERVAL_MS = 5 * 60 * 1000;

const fetchLatestSdkVersion = async (): Promise<string> => {
  const response = await fetch('https://registry.npmjs.org/@anthropic-ai/claude-agent-sdk/latest', {
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) throw new Error('Release check failed.');
  const version: unknown = ((await response.json()) as { version?: unknown }).version;
  if (typeof version !== 'string' || !VERSION.test(version)) throw new Error('Invalid release version.');
  return version;
};

/** Read-only: reports whether npm has a newer SDK than the one installed. */
export class ClaudeSdkReleaseService {
  private latestVersion: string | null = null;
  private checkedUntil = 0;
  private pending: Promise<void> | null = null;

  constructor(private readonly dependencies: SdkReleaseDependencies) {}

  async getStatus(): Promise<ClaudeSdkReleaseStatus> {
    if (this.checkedUntil <= this.dependencies.now()) {
      this.pending ??= this.refresh().finally(() => { this.pending = null; });
      await this.pending;
    }
    const installedVersion = this.dependencies.installed();
    return {
      installedVersion,
      latestVersion: this.latestVersion,
      behind: Boolean(installedVersion && this.latestVersion && isNewer(this.latestVersion, installedVersion)),
    };
  }

  private async refresh(): Promise<void> {
    try {
      this.latestVersion = await this.dependencies.latest();
      this.checkedUntil = this.dependencies.now() + CHECK_INTERVAL_MS;
    } catch {
      this.checkedUntil = this.dependencies.now() + RETRY_INTERVAL_MS;
    }
  }
}

export const claudeSdkReleaseService = new ClaudeSdkReleaseService({
  installed: readClaudeSdkVersion,
  latest: fetchLatestSdkVersion,
  now: Date.now,
});
