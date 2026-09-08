import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { cn } from '../../../../lib/utils';
import { SettingsRow } from '../primitives';

export type BrowserNetworkPolicy = {
  allowedOrigins: string[];
  blockedOrigins: string[];
};

type Props = {
  network: BrowserNetworkPolicy | null;
  onChange: (network: BrowserNetworkPolicy) => void;
  disabled?: boolean;
};

type ListKey = keyof BrowserNetworkPolicy;

const LISTS: ListKey[] = ['allowedOrigins', 'blockedOrigins'];

function parseList(value: string): string[] {
  const seen = new Set<string>();
  for (const line of value.split('\n')) {
    const origin = line.trim();
    if (origin) {
      seen.add(origin);
    }
  }
  return [...seen];
}

export default function BrowserOriginSettings({ network, onChange, disabled }: Props) {
  const { t } = useTranslation('settings');
  // Typing must not save per keystroke, so each box holds a draft until it
  // loses focus; a null draft means the box is showing the saved list.
  const [drafts, setDrafts] = useState<Partial<Record<ListKey, string>>>({});

  if (!network) {
    return null;
  }

  const commit = (key: ListKey, value: string) => {
    setDrafts((current) => ({ ...current, [key]: undefined }));
    onChange({ ...network, [key]: parseList(value) });
  };

  return (
    <>
      {LISTS.map((key) => {
        const draft = drafts[key];
        const value = draft === undefined ? network[key].join('\n') : draft;

        return (
          <SettingsRow
            key={key}
            stacked
            label={t(`browserSettings.origins.${key}.label`)}
            description={t(`browserSettings.origins.${key}.description`)}
          >
            <textarea
              value={value}
              rows={3}
              spellCheck={false}
              autoCapitalize="none"
              autoCorrect="off"
              aria-label={t(`browserSettings.origins.${key}.label`)}
              disabled={disabled}
              placeholder={t('browserSettings.origins.placeholder')}
              onChange={(event) => setDrafts((current) => ({ ...current, [key]: event.target.value }))}
              onBlur={(event) => commit(key, event.target.value)}
              className={cn(
                'w-full touch-manipulation resize-y rounded-lg border border-input bg-card p-2.5 font-mono text-sm text-foreground placeholder:text-muted-foreground',
                'focus:border-primary focus:ring-1 focus:ring-primary',
                disabled && 'cursor-not-allowed opacity-50',
              )}
            />
          </SettingsRow>
        );
      })}
    </>
  );
}
