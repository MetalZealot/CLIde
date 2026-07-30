import { useTranslation } from 'react-i18next';

import type { ProviderAuthStatusMap } from '../../../provider-auth/types';
import { SETTINGS_GROUPS, getGroupScreens, parseAgentScreenId } from '../../registry/registry';
import { toProviderStatus } from '../../utils/providerStatus';
import { SETTINGS_ICONS } from '../primitives/SettingsIcons';
import SettingsNavRow from '../primitives/SettingsNavRow';
import SettingsStatus from '../primitives/SettingsStatus';

type SettingsRootListProps = {
  onSelect: (screenId: string) => void;
  providerAuthStatus: ProviderAuthStatusMap;
};

/**
 * Depth 0 on mobile: a scrollable grouped list of every destination.
 *
 * This is what replaces the ten-item horizontal pill bar. Section headers are
 * labels, not tappable. It owns its scroll container, like any other screen.
 *
 * Provider rows carry their sign-in state, per the IA spec's root sketch — it is
 * the one piece of live data worth showing before you drill in.
 */
export default function SettingsRootList({ onSelect, providerAuthStatus }: SettingsRootListProps) {
  const { t } = useTranslation('settings');

  return (
    <div className="min-w-0 flex-1 overflow-y-auto overflow-x-hidden">
      <div className="space-y-6 p-4 pb-safe-area-inset-bottom">
        {SETTINGS_GROUPS.map((group) => (
          <section key={group.id} className="space-y-2">
            <h3 className="px-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              {t(group.labelKey)}
            </h3>

            <div className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card/50">
              {getGroupScreens(group.id).map((screen) => {
                const agent = parseAgentScreenId(screen.id);
                const status = agent ? toProviderStatus(providerAuthStatus[agent.provider]) : null;

                return (
                  <SettingsNavRow
                    key={screen.id}
                    label={t(screen.labelKey)}
                    icon={SETTINGS_ICONS[screen.icon]}
                    trailing={status && (
                      <SettingsStatus state={status.state} label={t(status.labelKey)} />
                    )}
                    onClick={() => onSelect(screen.id)}
                  />
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
