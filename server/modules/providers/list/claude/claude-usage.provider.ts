import {
  hasClaudeApiKeyAuth,
  readClaudeOAuthCredentials,
} from '@/modules/providers/list/claude/claude-credentials.js';
import type { IProviderUsage } from '@/shared/interfaces.js';
import type {
  ProviderUsageCredits,
  ProviderUsageStatus,
  ProviderUsageWindow,
} from '@/shared/types.js';
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

/**
 * Reads a `{ amount_minor, currency, exponent }` money object (the shape used
 * inside `spend`) into a major-unit amount, e.g. `{7505, CAD, 2}` -> 75.05.
 */
const readMinorMoney = (value: unknown): { amount: number; currency: string } | null => {
  const record = readObjectRecord(value);
  if (!record) {
    return null;
  }

  const amountMinor = record.amount_minor;
  const currency = record.currency;
  if (typeof amountMinor !== 'number' || typeof currency !== 'string') {
    return null;
  }

  const exponent = typeof record.exponent === 'number' ? record.exponent : 0;
  return { amount: amountMinor / 10 ** exponent, currency };
};

/** Pulls the first markdown/inline link URL out of the `spend.disclaimer` text. */
const extractLearnMoreUrl = (disclaimer: unknown): string | undefined => {
  if (typeof disclaimer !== 'string') {
    return undefined;
  }

  const markdownLink = disclaimer.match(/\]\((https?:\/\/[^)\s]+)\)/);
  if (markdownLink) {
    return markdownLink[1];
  }

  const bareLink = disclaimer.match(/https?:\/\/[^\s)]+/);
  return bareLink?.[0];
};

/**
 * Extracts paid usage-credit state from the OAuth usage response.
 *
 * Prefers the richer `spend` object (`used`/`limit`/`cap.money` in minor units,
 * plus `enabled`/`disclaimer`/`can_purchase_credits`); falls back to the older
 * `extra_usage` shape (`used_credits`/`monthly_limit` in minor units scaled by
 * `decimal_places`). Returns undefined when the account reports no credit
 * concept, so the field stays absent for API-key auth and other providers.
 */
const parseUsageCredits = (body: Record<string, unknown>): ProviderUsageCredits | undefined => {
  const memberDashboardAvailable = body.member_dashboard_available === true;

  const spend = readObjectRecord(body.spend);
  if (spend) {
    const used = readMinorMoney(spend.used);
    const limit = readMinorMoney(spend.limit)
      ?? readMinorMoney(readObjectRecord(spend.cap)?.money);
    if (used && limit && limit.amount > 0) {
      return {
        kind: 'spend',
        enabled: spend.enabled === true,
        usedAmount: used.amount,
        limitAmount: limit.amount,
        currency: limit.currency || used.currency,
        utilization: clampUtilization((used.amount / limit.amount) * 100),
        learnMoreUrl: extractLearnMoreUrl(spend.disclaimer),
        canPurchaseCredits: spend.can_purchase_credits === true,
        memberDashboardAvailable,
      };
    }
  }

  const extra = readObjectRecord(body.extra_usage);
  if (extra) {
    const monthlyLimit = extra.monthly_limit;
    const usedCredits = extra.used_credits;
    const currency = extra.currency;
    const decimals = typeof extra.decimal_places === 'number' ? extra.decimal_places : 2;
    if (
      typeof monthlyLimit === 'number'
      && typeof usedCredits === 'number'
      && typeof currency === 'string'
      && monthlyLimit > 0
    ) {
      const limitAmount = monthlyLimit / 10 ** decimals;
      const usedAmount = usedCredits / 10 ** decimals;
      return {
        kind: 'spend',
        enabled: extra.is_enabled === true,
        usedAmount,
        limitAmount,
        currency,
        utilization: clampUtilization((usedAmount / limitAmount) * 100),
        memberDashboardAvailable,
      };
    }
  }

  return undefined;
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
        credits: parseUsageCredits(body),
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
