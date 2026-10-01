import {
  readClaudeSdkBuiltForCliVersion,
  readClaudeSdkVersion,
} from '@/modules/providers/list/claude/claude-version-pair.js';
import { isNewer, providerCliUpdatesService } from '@/modules/providers/services/provider-cli-updates.service.js';

import type { ClaudeSdkReleaseStatus } from '../../../../shared/provider-updates.js';

/** One published SDK and the CLI version it was built against. */
type SdkRelease = { sdk: string; cli: string };

type SdkReleaseDependencies = {
  installed: () => { version: string | null; builtFor: string | null };
  cliVersion: () => Promise<string | null>;
  releases: () => Promise<SdkRelease[]>;
  now: () => number;
};

const RELEASE_VERSION = /^\d+\.\d+\.\d+$/;
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
const RETRY_INTERVAL_MS = 5 * 60 * 1000;

/** The full packument (~1 MB, measured 2026-10-01) is the only npm view that carries `claudeCodeVersion`. */
const fetchSdkReleases = async (): Promise<SdkRelease[]> => {
  const response = await fetch('https://registry.npmjs.org/@anthropic-ai/claude-agent-sdk', {
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error('Release check failed.');
  const versions = ((await response.json()) as { versions?: Record<string, { claudeCodeVersion?: unknown }> }).versions;
  if (!versions || typeof versions !== 'object') throw new Error('Invalid release list.');
  return Object.entries(versions).flatMap(([sdk, manifest]) => (
    RELEASE_VERSION.test(sdk) && typeof manifest?.claudeCodeVersion === 'string'
      && RELEASE_VERSION.test(manifest.claudeCodeVersion)
      ? [{ sdk, cli: manifest.claudeCodeVersion }]
      : []
  ));
};

/** Newest SDK built for `cli` or an older CLI, so a CLI release with no SDK of its own still pairs. */
export const matchSdkToCli = (releases: SdkRelease[], cli: string): string | null => {
  let match: string | null = null;
  for (const release of releases) {
    if (isNewer(release.cli, cli)) continue;
    if (!match || isNewer(release.sdk, match)) match = release.sdk;
  }
  return match;
};

/** Read-only: compares the installed SDK against the one built for the installed CLI. */
export class ClaudeSdkReleaseService {
  private releases: SdkRelease[] = [];
  private checkedUntil = 0;
  private pending: Promise<void> | null = null;

  constructor(private readonly dependencies: SdkReleaseDependencies) {}

  async getStatus(): Promise<ClaudeSdkReleaseStatus> {
    if (this.checkedUntil <= this.dependencies.now()) {
      this.pending ??= this.refresh().finally(() => { this.pending = null; });
      await this.pending;
    }
    const installed = this.dependencies.installed();
    const cliVersion = await this.dependencies.cliVersion().catch(() => null);
    const matchedVersion = cliVersion ? matchSdkToCli(this.releases, cliVersion) : null;

    let drift: ClaudeSdkReleaseStatus['drift'] = null;
    if (installed.builtFor && cliVersion && isNewer(installed.builtFor, cliVersion)) {
      drift = 'ahead';
    } else if (installed.version && matchedVersion && isNewer(matchedVersion, installed.version)) {
      drift = 'behind';
    }

    return {
      installedVersion: installed.version,
      builtForCliVersion: installed.builtFor,
      cliVersion,
      matchedVersion,
      drift,
    };
  }

  private async refresh(): Promise<void> {
    try {
      this.releases = await this.dependencies.releases();
      this.checkedUntil = this.dependencies.now() + CHECK_INTERVAL_MS;
    } catch {
      this.checkedUntil = this.dependencies.now() + RETRY_INTERVAL_MS;
    }
  }
}

export const claudeSdkReleaseService = new ClaudeSdkReleaseService({
  installed: () => ({ version: readClaudeSdkVersion(), builtFor: readClaudeSdkBuiltForCliVersion() }),
  cliVersion: async () => (await providerCliUpdatesService.getStatus('claude')).installedVersion,
  releases: fetchSdkReleases,
  now: Date.now,
});
