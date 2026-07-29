import { useTranslation } from 'react-i18next';

import { cn } from '../../../../lib/utils';
import { SETTINGS_GROUPS, getChildScreens, getGroupScreens } from '../../registry/registry';
import { SETTINGS_ICONS } from '../primitives/SettingsIcons';

type SettingsRailProps = {
  /** The full navigation stack, so a selected sub-screen also marks its parent. */
  stack: string[];
  onSelect: (screenId: string) => void;
};

/**
 * The desktop master pane. Renders the same registry as the mobile root list,
 * always visible, with no back affordance.
 *
 * A screen with children discloses them as indented rows once it is on the
 * stack, so the detail pane always shows a leaf. The rail is allowed to scroll
 * when that runs long — see decision 2 in the build plan.
 */
export default function SettingsRail({ stack, onSelect }: SettingsRailProps) {
  const { t } = useTranslation('settings');

  return (
    <aside className="hidden w-64 flex-shrink-0 overflow-y-auto border-r border-border bg-muted/30 md:flex md:flex-col">
      <nav className="flex flex-col gap-4 p-3">
        {SETTINGS_GROUPS.map((group) => (
          <div key={group.id} className="space-y-1">
            <h3 className="px-3 pb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              {t(group.labelKey)}
            </h3>

            {getGroupScreens(group.id).map((screen) => {
              const Icon = SETTINGS_ICONS[screen.icon];
              const children = getChildScreens(screen.id);
              const isOnStack = stack.includes(screen.id);

              return (
                <div key={screen.id} className="space-y-1">
                  <button
                    type="button"
                    onClick={() => onSelect(screen.id)}
                    className={cn(
                      'flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm font-medium transition-colors duration-150',
                      isOnStack
                        ? 'bg-accent text-accent-foreground'
                        : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground',
                    )}
                  >
                    <Icon className="h-4 w-4 flex-shrink-0" />
                    <span className="truncate">{t(screen.labelKey)}</span>
                  </button>

                  {isOnStack && children.length > 0 && (
                    <div className="space-y-1 pl-4">
                      {children.map((child) => (
                        <button
                          key={child.id}
                          type="button"
                          onClick={() => onSelect(child.id)}
                          className={cn(
                            'flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm transition-colors duration-150',
                            stack[stack.length - 1] === child.id
                              ? 'bg-accent text-accent-foreground'
                              : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground',
                          )}
                        >
                          <span className="truncate">{t(child.labelKey)}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </nav>
    </aside>
  );
}
