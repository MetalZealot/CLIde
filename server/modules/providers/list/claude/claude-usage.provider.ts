import {
  hasClaudeApiKeyAuth,
  readClaudeOAuthCredentials,
} from '@/modules/providers/list/claude/claude-credentials.js';
import type { IProviderUsage } from '@/shared/interfaces.js';
import type { ProviderUsageStatus, ProviderUsageWindow } from '@/shared/types.js';
import { readObjectRecord } from '@/shared/utils.js';

const CLAUDE_USAGE_ENDPOINT = 'https://api.anthropic.com/api/oauth/usage';
const USAGE_FETCH_TIMEOUT_MS = 10_000;

const clampUtilization = (value: number): number => Math.min(100, Math.max(0, value));

/**
 * Extracts rate-limit windows from the OAuth usage response.
 *
 * The response is a flat object whose window entries (five_hour, seven_day,
 * seven_day_opus, ...) each carry `utilization` + a `resets_at` key; unknown
 * window keys are kept generically so new plan buckets appear without code
 * changes. `resets_at` is null while a window is idle/unstarted (e.g. the
 * 5-hour window right after a reset) — such windows are still real and must be
 * kept, so the guard checks for the *presence* of a `resets_at` key rather than
 * a string value. Sibling objects like `extra_usage`/`spend` have no `resets_at`
 * key at all and are skipped.
 */
const parseUsageWindows = (body: Record<string, unknown>): ProviderUsageWindow[] => {
  const windows: ProviderUsageWindow[] = [];

  for (const [key, value] of Object.entries(body)) {
    const record = readObjectRecord(value);
    if (!record) {
      continue;
    }

    const utilization = record.utilization;
    if (typeof utilization !== 'number' || !('resets_at' in record)) {
      continue;
    }

    const resetsAt = typeof record.resets_at === 'string' ? record.resets_at : null;

    windows.push({
      id: key,
      utilization: clampUtilization(utilization),
      resetsAt,
    });
  }

  return windows;
};

export class ClaudeProviderUsage implements IProviderUsage {
  /**
   * Fetches plan usage from the Claude OAuth usage endpoint.
   *
   * Only OAuth (subscription) sign-in has plan windows; API-key auth reports
   * `supported: false` so the UI hides the usage surface.
   */
  async getUsage(): Promise<ProviderUsageStatus> {
    if (await hasClaudeApiKeyAuth()) {
      return { provider: 'claude', supported: false, reason: 'api_key' };
    }

    const credentials = await readClaudeOAuthCredentials();
    if (credentials.status !== 'ok') {
      return {
        provider: 'claude',
        supported: true,
        reason: 'not_authenticated',
        error: credentials.status === 'expired'
          ? 'Claude login has expired. Run claude /login again.'
          : 'Claude CLI is not authenticated. Run claude /login first.',
      };
    }

    try {
      const response = await fetch(CLAUDE_USAGE_ENDPOINT, {
        headers: {
          Authorization: `Bearer ${credentials.accessToken}`,
          'anthropic-beta': 'oauth-2025-04-20',
          'Content-Type': 'application/json',
        },
        signal: AbortSignal.timeout(USAGE_FETCH_TIMEOUT_MS),
      });

      if (!response.ok) {
        return {
          provider: 'claude',
          supported: true,
          error: `Usage endpoint returned ${response.status}.`,
        };
      }

      const body = readObjectRecord(await response.json());
      if (!body) {
        return {
          provider: 'claude',
          supported: true,
          error: 'Usage endpoint returned an unexpected response.',
        };
      }

      return {
        provider: 'claude',
        supported: true,
        windows: parseUsageWindows(body),
        fetchedAt: new Date().toISOString(),
      };
    } catch {
      return {
        provider: 'claude',
        supported: true,
        error: 'Unable to reach the Claude usage endpoint.',
      };
    }
  }
}
