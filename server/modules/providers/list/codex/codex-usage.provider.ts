import {
  readCodexCredentialsStatus,
  type CodexCredentialsStatus,
} from '@/modules/providers/list/codex/codex-auth.provider.js';
import {
  readCodexAccountUsage,
  type CodexAccountUsageResponse,
} from '@/modules/providers/list/codex/codex-app-server.client.js';
import type { IProviderUsage } from '@/shared/interfaces.js';
import type {
  ProviderUsageActivity,
  ProviderUsageBalanceCredits,
  ProviderUsageResetCredits,
  ProviderUsageStatus,
  ProviderUsageWindow,
} from '@/shared/types.js';
import { readObjectRecord, readOptionalString } from '@/shared/utils.js';

type CodexUsageReader = () => Promise<CodexAccountUsageResponse>;
type CodexCredentialsReader = () => Promise<CodexCredentialsStatus>;

type CodexProviderUsageDependencies = {
  readCredentials?: CodexCredentialsReader;
  readAccountUsage?: CodexUsageReader;
};

type NormalizedCodexUsage = {
  windows: ProviderUsageWindow[];
  credits?: ProviderUsageBalanceCredits;
  resetCredits?: ProviderUsageResetCredits;
};

const clampPercentage = (value: number): number => Math.min(100, Math.max(0, value));

const unixSecondsToIso = (value: unknown): string | null => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return null;
  }

  const date = new Date(value * 1000);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
};

const readNonNegativeNumber = (value: unknown): number | undefined => {
  if (typeof value === 'bigint') {
    return value >= 0n && value <= BigInt(Number.MAX_SAFE_INTEGER)
      ? Number(value)
      : undefined;
  }

  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    return undefined;
  }

  return Math.floor(value);
};

const readWindow = (
  value: unknown,
  bucketId: string,
  position: 'primary' | 'secondary',
  label?: string,
): ProviderUsageWindow | null => {
  const record = readObjectRecord(value);
  if (!record || typeof record.usedPercent !== 'number' || !Number.isFinite(record.usedPercent)) {
    return null;
  }

  const durationMinutes = typeof record.windowDurationMins === 'number'
    && Number.isFinite(record.windowDurationMins)
    && record.windowDurationMins > 0
    ? record.windowDurationMins
    : undefined;

  return {
    id: `${bucketId}:${position}`,
    bucketId,
    utilization: clampPercentage(record.usedPercent),
    resetsAt: unixSecondsToIso(record.resetsAt),
    ...(label ? { label } : {}),
    ...(durationMinutes ? { durationMinutes } : {}),
  };
};

const readBalanceCredits = (value: unknown): ProviderUsageBalanceCredits | undefined => {
  const snapshot = readObjectRecord(value);
  if (!snapshot) {
    return undefined;
  }

  const credits = readObjectRecord(snapshot.credits);
  const individualLimit = readObjectRecord(snapshot.individualLimit);
  if (!credits && !individualLimit) {
    return undefined;
  }

  const hasCreditSnapshot = Boolean(
    credits
    && typeof credits.hasCredits === 'boolean'
    && typeof credits.unlimited === 'boolean',
  );
  const normalizedIndividualLimit = (
    individualLimit
    && typeof individualLimit.limit === 'string'
    && typeof individualLimit.used === 'string'
    && typeof individualLimit.remainingPercent === 'number'
    && Number.isFinite(individualLimit.remainingPercent)
  ) ? {
      limit: individualLimit.limit,
      used: individualLimit.used,
      remainingPercent: clampPercentage(individualLimit.remainingPercent),
      resetsAt: unixSecondsToIso(individualLimit.resetsAt),
    }
    : undefined;

  if (!hasCreditSnapshot && !normalizedIndividualLimit) {
    return undefined;
  }

  return {
    kind: 'balance',
    hasCredits: credits?.hasCredits === true,
    unlimited: credits?.unlimited === true,
    balance: typeof credits?.balance === 'string' ? credits.balance : null,
    ...(normalizedIndividualLimit ? { individualLimit: normalizedIndividualLimit } : {}),
    ...(typeof snapshot.rateLimitReachedType === 'string'
      ? { limitReachedReason: snapshot.rateLimitReachedType }
      : {}),
  };
};

const readResetCredits = (value: unknown): ProviderUsageResetCredits | undefined => {
  const summary = readObjectRecord(value);
  const availableCount = readNonNegativeNumber(summary?.availableCount);
  if (!summary || availableCount === undefined) {
    return undefined;
  }

  const details = Array.isArray(summary.credits)
    ? summary.credits.flatMap((credit): NonNullable<ProviderUsageResetCredits['details']> => {
      const record = readObjectRecord(credit);
      const id = readOptionalString(record?.id);
      const status = readOptionalString(record?.status);
      if (!record || !id || !status) {
        return [];
      }

      return [{
        id,
        status,
        grantedAt: unixSecondsToIso(record.grantedAt),
        expiresAt: unixSecondsToIso(record.expiresAt),
        title: readOptionalString(record.title) ?? null,
        description: readOptionalString(record.description) ?? null,
      }];
    })
    : undefined;

  return {
    availableCount,
    ...(details ? { details } : {}),
  };
};

export const normalizeCodexAccountActivity = (
  value: unknown,
): ProviderUsageActivity | undefined => {
  const body = readObjectRecord(value);
  const summary = readObjectRecord(body?.summary);
  const daily = Array.isArray(body?.dailyUsageBuckets)
    ? body.dailyUsageBuckets.flatMap((bucket): NonNullable<ProviderUsageActivity['daily']> => {
      const record = readObjectRecord(bucket);
      const date = readOptionalString(record?.startDate);
      const tokens = readNonNegativeNumber(record?.tokens);
      return record && date && tokens !== undefined ? [{ date, tokens }] : [];
    })
    : undefined;

  const activity: ProviderUsageActivity = {
    lifetimeTokens: readNonNegativeNumber(summary?.lifetimeTokens),
    peakDailyTokens: readNonNegativeNumber(summary?.peakDailyTokens),
    longestRunningTurnSeconds: readNonNegativeNumber(summary?.longestRunningTurnSec),
    currentStreakDays: readNonNegativeNumber(summary?.currentStreakDays),
    longestStreakDays: readNonNegativeNumber(summary?.longestStreakDays),
    ...(daily && daily.length > 0 ? { daily } : {}),
  };

  return Object.values(activity).some((entry) => entry !== undefined)
    ? activity
    : undefined;
};

/**
 * Normalizes the stable Codex account/rateLimits/read result.
 *
 * Newer CLIs expose a map of independently metered limits. The historical
 * `rateLimits` snapshot is used only as a fallback so the same windows are not
 * rendered twice.
 */
export const normalizeCodexRateLimits = (value: unknown): NormalizedCodexUsage => {
  const body = readObjectRecord(value);
  const fallbackSnapshot = readObjectRecord(body?.rateLimits);
  if (!body || !fallbackSnapshot) {
    throw new Error('Codex rate-limit response is missing rateLimits.');
  }

  const byLimitId = readObjectRecord(body.rateLimitsByLimitId);
  let snapshots = byLimitId
    ? Object.entries(byLimitId)
      .map(([key, snapshot]) => [key, readObjectRecord(snapshot)] as const)
      .filter((entry): entry is readonly [string, Record<string, unknown>] => entry[1] !== null)
    : [];

  if (snapshots.length === 0) {
    const fallbackId = readOptionalString(fallbackSnapshot.limitId) ?? 'codex';
    snapshots = [[fallbackId, fallbackSnapshot]];
  }

  const showBucketLabels = snapshots.length > 1;
  const windows = snapshots.flatMap(([mapKey, snapshot]) => {
    const bucketId = readOptionalString(snapshot.limitId) ?? mapKey;
    const label = showBucketLabels ? readOptionalString(snapshot.limitName) : undefined;
    return [
      readWindow(snapshot.primary, bucketId, 'primary', label),
      readWindow(snapshot.secondary, bucketId, 'secondary', label),
    ].filter((window): window is ProviderUsageWindow => window !== null);
  });

  windows.sort((left, right) => (
    (left.durationMinutes ?? Number.MAX_SAFE_INTEGER)
    - (right.durationMinutes ?? Number.MAX_SAFE_INTEGER)
  ));

  return {
    windows,
    credits: readBalanceCredits(fallbackSnapshot)
      ?? snapshots.map(([, snapshot]) => readBalanceCredits(snapshot)).find(Boolean),
    resetCredits: readResetCredits(body.rateLimitResetCredits),
  };
};

export class CodexProviderUsage implements IProviderUsage {
  private readonly readCredentials: CodexCredentialsReader;
  private readonly readAccountUsage: CodexUsageReader;

  constructor({
    readCredentials = readCodexCredentialsStatus,
    readAccountUsage = readCodexAccountUsage,
  }: CodexProviderUsageDependencies = {}) {
    this.readCredentials = readCredentials;
    this.readAccountUsage = readAccountUsage;
  }

  async getUsage(): Promise<ProviderUsageStatus> {
    const credentials = await this.readCredentials();
    if (credentials.method === 'api_key') {
      return { provider: 'codex', supported: false, reason: 'api_key' };
    }

    if (!credentials.authenticated) {
      return {
        provider: 'codex',
        supported: true,
        reason: 'not_authenticated',
        error: 'Codex CLI is not authenticated. Run codex login first.',
      };
    }

    try {
      const response = await this.readAccountUsage();
      const usage = normalizeCodexRateLimits(response.rateLimits);
      const activity = normalizeCodexAccountActivity(response.activity);
      return {
        provider: 'codex',
        supported: true,
        windows: usage.windows,
        credits: usage.credits,
        ...(usage.resetCredits ? { resetCredits: usage.resetCredits } : {}),
        ...(activity ? { activity } : {}),
        fetchedAt: new Date().toISOString(),
      };
    } catch {
      return {
        provider: 'codex',
        supported: true,
        error: 'Unable to read plan usage from the Codex CLI.',
      };
    }
  }
}
