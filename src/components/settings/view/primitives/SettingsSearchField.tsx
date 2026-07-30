import { Search, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { cn } from '../../../../lib/utils';

type SettingsSearchFieldProps = {
  value: string;
  onChange: (value: string) => void;
  className?: string;
};

/**
 * Search input for the mobile root list and the desktop rail.
 *
 * Escape clears the query rather than bubbling: an in-progress search is the
 * nearest thing to dismiss, and the field is the only place in Settings that
 * has one.
 */
export default function SettingsSearchField({ value, onChange, className }: SettingsSearchFieldProps) {
  const { t } = useTranslation('settings');
  const placeholder = t('search.placeholder');

  return (
    <div className={cn('relative', className)}>
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />

      <input
        type="search"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape' && value) {
            event.stopPropagation();
            onChange('');
          }
        }}
        placeholder={placeholder}
        aria-label={placeholder}
        autoComplete="off"
        className={cn(
          'w-full touch-manipulation rounded-lg border border-input bg-card py-2 pl-9 pr-9 text-sm text-foreground placeholder:text-muted-foreground',
          'focus:border-primary focus:ring-1 focus:ring-primary',
          // Safari renders its own clear affordance on type=search; ours is below.
          '[&::-webkit-search-cancel-button]:hidden',
        )}
      />

      {value && (
        <button
          type="button"
          onClick={() => onChange('')}
          aria-label={t('search.clear')}
          className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-muted-foreground transition-colors hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}
