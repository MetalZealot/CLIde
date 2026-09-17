import type { LLMProvider, ProviderModelOption } from '../../../types/app';

export const DEFAULT_EFFORT_VALUE = 'default';

export const FALLBACK_PROVIDER_EFFORT_VALUES: Partial<Record<LLMProvider, readonly string[]>> = {
  claude: ['low', 'medium', 'high', 'xhigh', 'max'],
  codex: ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'],
  opencode: ['none', 'low', 'medium', 'high', 'xhigh', 'max'],
};

export const toProviderEffortOptions = (
  values: readonly string[],
): NonNullable<ProviderModelOption['effort']>['values'] => values.map((value) => ({ value }));

/**
 * A catalog entry that declares no effort values has no effort control, so it
 * offers none. The provider-wide list is a guess for a model the catalog does
 * not know at all, never a substitute for what a known model omits.
 */
export const resolveEffortValuesForModel = (
  option: ProviderModelOption | null,
  providerFallback: readonly string[],
): NonNullable<ProviderModelOption['effort']>['values'] => (
  option ? option.effort?.values ?? [] : toProviderEffortOptions(providerFallback)
);
