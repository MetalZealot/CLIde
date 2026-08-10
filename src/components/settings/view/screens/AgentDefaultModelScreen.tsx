import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { ProviderModelsDefinition } from '../../../../types/app';
import { authenticatedFetch } from '../../../../utils/api';
import {
  readProviderDefaultModel,
  writeProviderDefaultModel,
} from '../../../../utils/providerDefaultModel';
import type { AgentProviderId } from '../../registry/registry';
import { SettingsGroup, SettingsRow, SettingsScreen, SettingsSelect } from '../primitives';

/** Empty means "no explicit default" — the provider's own default applies. */
const FOLLOW_PROVIDER = '';

type ProviderModelsApiResponse = {
  success?: boolean;
  data?: { models?: ProviderModelsDefinition };
};

/**
 * Agents › <provider> › Default model.
 *
 * Sets which model a *new* chat with this provider starts on. Without it the
 * composer inherits whatever was picked last, so a one-off choice in a single
 * chat quietly becomes every later chat's model.
 *
 * Provider-agnostic by construction: the list is whatever that provider's
 * `/models` catalog returns, so a provider with no catalog degrades to the
 * single "provider default" row rather than needing a special case here.
 */
export default function AgentDefaultModelScreen({ provider }: { provider: AgentProviderId }) {
  const { t } = useTranslation('settings');
  const [catalog, setCatalog] = useState<ProviderModelsDefinition | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [selected, setSelected] = useState<string>(() => readProviderDefaultModel(provider));

  useEffect(() => {
    setSelected(readProviderDefaultModel(provider));
  }, [provider]);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);

    const load = async () => {
      try {
        const response = await authenticatedFetch(`/api/providers/${provider}/models`);
        const body = (await response.json()) as ProviderModelsApiResponse;
        if (!cancelled) {
          setCatalog(body.success ? body.data?.models ?? null : null);
        }
      } catch (error) {
        console.error('Error loading the provider model catalog:', error);
        if (!cancelled) {
          setCatalog(null);
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [provider]);

  const legacyLabel = t('defaultModel.legacy', { defaultValue: 'Legacy' });
  const options = useMemo(() => {
    const providerDefault = catalog?.OPTIONS.find((option) => option.isDefault);
    return [
      {
        value: FOLLOW_PROVIDER,
        label: providerDefault
          ? t('defaultModel.followNamed', {
            defaultValue: 'Provider default ({{model}})',
            model: providerDefault.label,
          })
          : t('defaultModel.follow', { defaultValue: 'Provider default' }),
      },
      ...(catalog?.OPTIONS ?? []).map((option) => ({
        value: option.value,
        label: option.group === 'legacy'
          ? `${option.label} — ${legacyLabel}`
          : option.label,
      })),
    ];
  }, [catalog, legacyLabel, t]);

  // A default recorded before the catalog changed (or picked on another
  // machine) may name a model this provider no longer offers. Showing it as
  // selected would be a lie, so fall back to the provider default row.
  const value = options.some((option) => option.value === selected) ? selected : FOLLOW_PROVIDER;

  const handleChange = (nextValue: string) => {
    setSelected(nextValue);
    writeProviderDefaultModel(provider, nextValue);
  };

  return (
    <SettingsScreen>
      <SettingsGroup
        divided
        description={t('defaultModel.description', {
          defaultValue: 'The model each new chat with this provider starts on. Changing the model inside a chat only affects that chat.',
        })}
      >
        <SettingsRow stacked label={t('defaultModel.label', { defaultValue: 'Default model' })}>
          <SettingsSelect
            value={value}
            options={options}
            onChange={handleChange}
            ariaLabel={t('defaultModel.label', { defaultValue: 'Default model' })}
            className={isLoading ? 'opacity-60' : undefined}
          />
        </SettingsRow>
      </SettingsGroup>
    </SettingsScreen>
  );
}
