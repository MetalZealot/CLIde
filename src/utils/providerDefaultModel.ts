import type { LLMProvider } from '../types/app';

/**
 * The model a brand-new chat starts on, per provider.
 *
 * Deliberately a different key from `<provider>-model`, which records the model
 * picked *last* and is what a new chat would otherwise inherit. An explicit
 * default has to outrank that: without the separation, choosing a one-off model
 * for a single chat would quietly redefine every chat after it, which is the
 * behaviour this setting exists to stop.
 *
 * An empty value means no explicit default, and the provider catalog's own
 * `DEFAULT` applies — for Claude that is the model resolved from its settings
 * cascade, so "unset" still means something specific rather than nothing.
 */
const storageKey = (provider: LLMProvider): string => `${provider}-default-model`;

export const readProviderDefaultModel = (provider: LLMProvider): string => (
  localStorage.getItem(storageKey(provider))?.trim() || ''
);

export const writeProviderDefaultModel = (provider: LLMProvider, model: string): void => {
  const normalized = model.trim();
  if (normalized) {
    localStorage.setItem(storageKey(provider), normalized);
    return;
  }
  localStorage.removeItem(storageKey(provider));
};
