import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { ProviderModelsDefinition } from '../../../types/app';
import { authenticatedFetch } from '../../../utils/api';
import { readProviderDefaultModel } from '../../../utils/providerDefaultModel';
import type { AgentProviderId } from '../registry/registry';

/** Reads one value through an authenticated GET; null until it lands or if it fails. */
export function useFetchedValue<T>(url: string | null, pick: (data: unknown) => T | null): T | null {
  const [value, setValue] = useState<T | null>(null);
  useEffect(() => {
    if (!url) return undefined;
    let cancelled = false;
    authenticatedFetch(url)
      .then((response) => response.json())
      .then((body) => { if (!cancelled && body.success) setValue(pick(body.data)); })
      .catch(() => {});
    return () => { cancelled = true; };
    // `pick` is a pure reader; the URL alone decides when to refetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url]);
  return value;
}

/** The model a new chat starts on: the stored choice, else the catalog's own default. */
export function useDefaultModelLabel(provider: AgentProviderId, enabled = true): string | null {
  const catalog = useFetchedValue(
    enabled ? `/api/providers/${provider}/models` : null,
    (data) => (data as { models?: ProviderModelsDefinition }).models ?? null,
  );
  if (!catalog) return null;
  const stored = readProviderDefaultModel(provider);
  const option = catalog.OPTIONS.find((candidate) => candidate.value === stored)
    ?? catalog.OPTIONS.find((candidate) => candidate.isDefault);
  return option?.label ?? null;
}

/** The level Claude's default model runs at, as the composer shows it. */
export function useClaudeDefaultEffort(enabled = true): string | null {
  return useFetchedValue(
    enabled ? '/api/providers/claude/effort-defaults' : null,
    (data) => {
      const rows = (data as { models?: { isDefault?: boolean; effort?: string | null }[] }).models ?? [];
      return (rows.find((row) => row.isDefault) ?? rows[0])?.effort ?? null;
    },
  );
}

export function useClaudeAutoCompactLabel(enabled = true): string | null {
  const { t } = useTranslation('settings');
  return useFetchedValue(
    enabled ? '/api/providers/claude/auto-compact' : null,
    (data) => ((data as { enabled?: boolean }).enabled ? t('agents.subsystems.on') : t('agents.subsystems.off')),
  );
}
