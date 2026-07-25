import type { LLMProvider } from '../../types/app';

export type ProviderUsageWindow = {
  id: string;
  utilization: number;
  resetsAt: string | null;
  label?: string;
  bucketId?: string;
  durationMinutes?: number;
};

export type ProviderUsageSpendCredits = {
  kind: 'spend';
  enabled: boolean;
  usedAmount: number;
  limitAmount: number;
  currency: string;
  utilization: number;
  learnMoreUrl?: string;
  canPurchaseCredits?: boolean;
  memberDashboardAvailable?: boolean;
};

export type ProviderUsageBalanceCredits = {
  kind: 'balance';
  hasCredits: boolean;
  unlimited: boolean;
  balance: string | null;
  individualLimit?: {
    limit: string;
    used: string;
    remainingPercent: number;
    resetsAt: string | null;
  };
  limitReachedReason?: string;
};

export type ProviderUsageCredits =
  | ProviderUsageSpendCredits
  | ProviderUsageBalanceCredits;

export type ProviderUsageResetCreditDetail = {
  id: string;
  status: string;
  grantedAt: string | null;
  expiresAt: string | null;
  title: string | null;
  description: string | null;
};

export type ProviderUsageResetCredits = {
  availableCount: number;
  details?: ProviderUsageResetCreditDetail[];
};

export type ProviderUsageActivity = {
  lifetimeTokens?: number;
  peakDailyTokens?: number;
  longestRunningTurnSeconds?: number;
  currentStreakDays?: number;
  longestStreakDays?: number;
  daily?: Array<{
    date: string;
    tokens: number;
  }>;
};

export type ProviderUsageStatus = {
  provider: LLMProvider;
  supported: boolean;
  reason?: 'api_key' | 'not_authenticated';
  windows?: ProviderUsageWindow[];
  credits?: ProviderUsageCredits;
  resetCredits?: ProviderUsageResetCredits;
  activity?: ProviderUsageActivity;
  fetchedAt?: string;
  stale?: boolean;
  error?: string;
};

export const providerUsageEndpoint = (provider: LLMProvider, refresh = false): string => (
  `/api/providers/${provider}/usage${refresh ? '?refresh=true' : ''}`
);
