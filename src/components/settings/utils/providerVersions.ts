import type { ProviderRuntimeVersions } from '../../provider-auth/types';

/**
 * "2.1.233 · SDK 0.3.233". The runtime leads because it is the half that moves
 * on its own; either half may be missing, and both missing means no row.
 */
export const formatVersionPair = (
  versions: Pick<ProviderRuntimeVersions, 'runtime' | 'sdk'>,
): string | null => {
  const parts = [versions.runtime, versions.sdk ? `SDK ${versions.sdk}` : null]
    .filter((part): part is string => Boolean(part));
  return parts.length > 0 ? parts.join(' · ') : null;
};
