import type { SettingsStatusState } from '../view/primitives/SettingsStatus';
import type { AuthStatus } from '../types/types';

export type ProviderStatus = {
  state: SettingsStatusState;
  labelKey: string;
};

/**
 * One reading of a provider's auth status, shared by the mobile root list, the
 * desktop rail and the provider account card, so the three cannot drift.
 *
 * Copy is "Signed in" / "Signed out" per build-plan decision 3 — see
 * `SettingsStatus` for why that wording is now safe.
 */
export const toProviderStatus = (authStatus: AuthStatus): ProviderStatus => {
  if (authStatus.loading) {
    return { state: 'pending', labelKey: 'agents.authStatus.checking' };
  }

  return authStatus.authenticated
    ? { state: 'on', labelKey: 'agents.authStatus.signedIn' }
    : { state: 'off', labelKey: 'agents.authStatus.signedOut' };
};
