import { useTranslation } from 'react-i18next';

import type { ProviderAuthStatusMap } from '../../../provider-auth/types';
import { describeSearchResult } from '../../registry/search';
import type { SettingsSearchResult } from '../../registry/search';
import { SETTINGS_GROUPS, getGroupScreens, getScreen, parseAgentScreenId } from '../../registry/registry';
import { toProviderStatus } from '../../utils/providerStatus';
import { SETTINGS_ICONS } from '../primitives/SettingsIcons';
import SettingsNavRow from '../primitives/SettingsNavRow';
import SettingsSearchField from '../primitives/SettingsSearchField';
import SettingsStatus from '../primitives/SettingsStatus';

type SettingsRootListProps = {
  /** A grouped row: always a depth-1 push from here. */
  onSelect: (screenId: string) => void;
  /** A search result, which may be a sub-screen and so needs the whole path. */
  onSelectResult: (screenId: string) => void;
  providerAuthStatus: ProviderAuthStatusMap;
  searchQuery: string;
  onSearchQueryChange: (value: string) => void;
  /** Only meaningful while `searchQuery` is non-blank; empty means no matches. */
  searchResults: SettingsSearchResult[];
};

/**
 * Depth 0 on mobile: a search field over a scrollable grouped list of every
 * destination.
 *
 * This is what replaces the ten-item horizontal pill bar. Section headers are
 * labels, not tappable. It owns its scroll container, like any other screen —
 * the search field sits outside it, so it stays put while the list moves.
 *
 * Provider rows carry their sign-in state, per the IA spec's root sketch — it is
 * the one piece of live data worth showing before you drill in.
 */
export default function SettingsRootList({
  onSelect,
  onSelectResult,
  providerAuthStatus,
  searchQuery,
  onSearchQueryChange,
  searchResults,
}: SettingsRootListProps) {
  const { t } = useTranslation('settings');
  const translate = (key: string) => t(key);
  const isSearching = searchQuery.trim().length > 0;

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="flex-shrink-0 px-4 pt-4">
        <SettingsSearchField value={searchQuery} onChange={onSearchQueryChange} />
      </div>

      <div className="min-w-0 flex-1 overflow-y-auto overflow-x-hidden">
        <div className="space-y-6 p-4 pb-safe-area-inset-bottom">
          {isSearching ? (
            searchResults.length > 0 ? (
              <div className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card/50">
                {searchResults.map((result) => {
                  const screen = getScreen(result.screenId);
                  if (!screen) return null;

                  return (
                    <SettingsNavRow
                      key={result.screenId}
                      label={t(screen.labelKey)}
                      description={describeSearchResult(result, translate) || undefined}
                      icon={SETTINGS_ICONS[screen.icon]}
                      onClick={() => onSelectResult(result.screenId)}
                    />
                  );
                })}
              </div>
            ) : (
              <p className="py-8 text-center text-sm text-muted-foreground">
                {t('search.noResults', { query: searchQuery.trim() })}
              </p>
            )
          ) : (
            SETTINGS_GROUPS.map((group) => (
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
            ))
          )}
        </div>
      </div>
    </div>
  );
}
