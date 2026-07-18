import type { LLMProvider } from '../../types/app';

export type ProviderUsageWindow = {
  id: string;
  utilization: number;
  resetsAt: string | null;
};

export type ProviderUsageStatus = {
  provider: LLMProvider;
  supported: boolean;
  reason?: 'api_key' | 'not_authenticated';
  windows?: ProviderUsageWindow[];
  fetchedAt?: string;
  stale?: boolean;
  error?: string;
};

export const providerUsageEndpoint = (provider: LLMProvider, refresh = false): string => (
  `/api/providers/${provider}/usage${refresh ? '?refresh=true' : ''}`
);
