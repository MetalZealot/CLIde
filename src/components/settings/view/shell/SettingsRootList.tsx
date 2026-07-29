import { useTranslation } from 'react-i18next';

import { SETTINGS_GROUPS, getGroupScreens } from '../../registry/registry';
import { SETTINGS_ICONS } from '../primitives/SettingsIcons';
import SettingsNavRow from '../primitives/SettingsNavRow';

type SettingsRootListProps = {
  onSelect: (screenId: string) => void;
};

/**
 * Depth 0 on mobile: a scrollable grouped list of every destination.
 *
 * This is what replaces the ten-item horizontal pill bar. Section headers are
 * labels, not tappable. It owns its scroll container, like any other screen.
 */
export default function SettingsRootList({ onSelect }: SettingsRootListProps) {
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
              {getGroupScreens(group.id).map((screen) => (
                <SettingsNavRow
                  key={screen.id}
                  label={t(screen.labelKey)}
                  icon={SETTINGS_ICONS[screen.icon]}
                  onClick={() => onSelect(screen.id)}
                />
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
