import { useTranslation } from 'react-i18next';

import { cn } from '../../../../lib/utils';
import type { ProviderAuthStatusMap } from '../../../provider-auth/types';
import { describeSearchResult } from '../../registry/search';
import type { SettingsSearchResult } from '../../registry/search';
import {
  SETTINGS_GROUPS,
  getChildScreens,
  getGroupScreens,
  getScreen,
  parseAgentScreenId,
} from '../../registry/registry';
import { toProviderStatus } from '../../utils/providerStatus';
import { SETTINGS_ICONS } from '../primitives/SettingsIcons';
import SettingsSearchField from '../primitives/SettingsSearchField';
import SettingsStatus from '../primitives/SettingsStatus';

type SettingsRailProps = {
  /** The full navigation stack, so a selected sub-screen also marks its parent. */
  stack: string[];
  onSelect: (screenId: string) => void;
  providerAuthStatus: ProviderAuthStatusMap;
  searchQuery: string;
  onSearchQueryChange: (value: string) => void;
  /** Only meaningful while `searchQuery` is non-blank; empty means no matches. */
  searchResults: SettingsSearchResult[];
};

const RAIL_ROW_CLASS = 'flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm font-medium transition-colors duration-150';

/**
 * The desktop master pane. Renders the same registry as the mobile root list,
 * always visible, with no back affordance.
 *
 * A screen with children discloses them as indented rows once it is on the
 * stack, so the detail pane always shows a leaf. The rail is allowed to scroll
 * when that runs long — see decision 2 in the build plan; the search field sits
 * outside the scroller so it stays reachable.
 */
export default function SettingsRail({
  stack,
  onSelect,
  providerAuthStatus,
  searchQuery,
  onSearchQueryChange,
  searchResults,
}: SettingsRailProps) {
  const { t } = useTranslation('settings');
  const translate = (key: string) => t(key);
  const isSearching = searchQuery.trim().length > 0;
  const selectedId = stack.length > 0 ? stack[stack.length - 1] : null;

  return (
    <aside className="hidden w-64 flex-shrink-0 flex-col border-r border-border bg-muted/30 md:flex">
      <div className="flex-shrink-0 p-3 pb-0">
        <SettingsSearchField value={searchQuery} onChange={onSearchQueryChange} />
      </div>

      <nav className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-3">
        {isSearching ? (
          searchResults.length > 0 ? (
            <div className="space-y-1">
              {searchResults.map((result) => {
                const screen = getScreen(result.screenId);
                if (!screen) return null;

                const Icon = SETTINGS_ICONS[screen.icon];
                const description = describeSearchResult(result, translate);

                return (
                  <button
                    key={result.screenId}
                    type="button"
                    onClick={() => onSelect(result.screenId)}
                    className={cn(
                      RAIL_ROW_CLASS,
                      'items-start',
                      selectedId === result.screenId
                        ? 'bg-accent text-accent-foreground'
                        : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground',
                    )}
                  >
                    <Icon className="mt-0.5 h-4 w-4 flex-shrink-0" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">{t(screen.labelKey)}</span>
                      {description && (
                        <span className="mt-0.5 block truncate text-xs font-normal opacity-70">
                          {description}
                        </span>
                      )}
                    </span>
                  </button>
                );
              })}
            </div>
          ) : (
            <p className="px-3 py-6 text-sm text-muted-foreground">
              {t('search.noResults', { query: searchQuery.trim() })}
            </p>
          )
        ) : (
          SETTINGS_GROUPS.map((group) => (
            <div key={group.id} className="space-y-1">
              <h3 className="px-3 pb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                {t(group.labelKey)}
              </h3>

              {getGroupScreens(group.id).map((screen) => {
                const Icon = SETTINGS_ICONS[screen.icon];
                const children = getChildScreens(screen.id);
                const isOnStack = stack.includes(screen.id);
                const agent = parseAgentScreenId(screen.id);
                // Dot only: the rail is too narrow for "Signed out" beside a label.
                const status = agent ? toProviderStatus(providerAuthStatus[agent.provider]) : null;

                return (
                  <div key={screen.id} className="space-y-1">
                    <button
                      type="button"
                      onClick={() => onSelect(screen.id)}
                      className={cn(
                        RAIL_ROW_CLASS,
                        isOnStack
                          ? 'bg-accent text-accent-foreground'
                          : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground',
                      )}
                    >
                      <Icon className="h-4 w-4 flex-shrink-0" />
                      <span className="min-w-0 flex-1 truncate">{t(screen.labelKey)}</span>
                      {status && <SettingsStatus state={status.state} />}
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
                              selectedId === child.id
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
          ))
        )}
      </nav>
    </aside>
  );
}
