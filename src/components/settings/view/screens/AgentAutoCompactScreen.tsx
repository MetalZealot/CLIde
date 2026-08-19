import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { authenticatedFetch } from '../../../../utils/api';
import {
  SettingsGroup,
  SettingsRow,
  SettingsScreen,
  SettingsSelect,
  SettingsToggle,
} from '../primitives';

/** Absence of a cap. Claude Code writes `auto` by deleting the key. */
const AUTO = 'auto';

type AutoCompactSettings = {
  enabled: boolean;
  window: number | null;
  envOverride: number | null;
  maxWindow: number;
  options: number[];
};

type AutoCompactApiResponse = { success?: boolean; data?: AutoCompactSettings };

const formatWindow = (tokens: number): string => (
  tokens >= 1_000_000
    ? `${(tokens / 1_000_000).toFixed(tokens % 1_000_000 === 0 ? 0 : 1)}M tokens`
    : `${Math.round(tokens / 1_000)}K tokens`
);

/**
 * Agents › Claude › Auto-compact.
 *
 * Claude-only: these are keys in Claude Code's own settings file, global across
 * every session, project and Shell — the same value `/autocompact` writes.
 *
 * The window is a CAP, not the point where compaction fires: the runtime
 * compacts below whichever is smaller, this or the model's own window. Showing
 * a cap without the window it cuts is what let a 200K cap on a 1M model pass
 * for the model's own size.
 */
export default function AgentAutoCompactScreen() {
  const { t } = useTranslation('settings');
  const [settings, setSettings] = useState<AutoCompactSettings | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const response = await authenticatedFetch('/api/providers/claude/auto-compact');
        const body = (await response.json()) as AutoCompactApiResponse;
        if (!cancelled) {
          setSettings(body.success ? body.data ?? null : null);
          setError(!body.success);
        }
      } catch (loadError) {
        console.error('Error loading auto-compact settings:', loadError);
        if (!cancelled) setError(true);
      }
    };

    void load();
    return () => { cancelled = true; };
  }, []);

  const save = useCallback(async (update: { enabled?: boolean; window?: number | null }) => {
    setIsSaving(true);
    setError(false);
    try {
      const response = await authenticatedFetch('/api/providers/claude/auto-compact', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(update),
      });
      const body = (await response.json()) as AutoCompactApiResponse;
      // The server returns the file as it now reads, so a rejected or clamped
      // value corrects the control rather than leaving it showing the request.
      if (body.success && body.data) setSettings(body.data);
      else setError(true);
    } catch (saveError) {
      console.error('Error saving auto-compact settings:', saveError);
      setError(true);
    } finally {
      setIsSaving(false);
    }
  }, []);

  const envLocked = settings?.envOverride != null;
  const windowOptions = [
    { value: AUTO, label: t('autoCompact.auto', { defaultValue: 'Auto (recommended)' }) },
    ...(settings?.options ?? []).map((option) => ({
      value: String(option),
      label: formatWindow(option),
    })),
  ];

  const description = envLocked
    ? t('autoCompact.envLocked', {
      defaultValue: 'CLAUDE_CODE_AUTO_COMPACT_WINDOW is set in the environment and outranks this file, so changes here will not take effect until it is unset.',
    })
    : t('autoCompact.description', {
      defaultValue: 'Auto-compact summarises the conversation before it fills the context window. The window below is a cap: Claude compacts below whichever is smaller, this or the model’s own window. Shared with Claude Code’s /autocompact.',
    });

  return (
    <SettingsScreen>
      <SettingsGroup
        divided
        description={description}
        tone={envLocked ? 'warning' : undefined}
      >
        <SettingsRow label={t('autoCompact.enabled', { defaultValue: 'Auto-compact' })}>
          <SettingsToggle
            checked={settings?.enabled ?? true}
            disabled={!settings || isSaving}
            onChange={(next) => { void save({ enabled: next }); }}
            ariaLabel={t('autoCompact.enabled', { defaultValue: 'Auto-compact' })}
          />
        </SettingsRow>

        <SettingsRow
          stacked
          label={t('autoCompact.window', { defaultValue: 'Context window cap' })}
        >
          <SettingsSelect
            value={settings?.window == null ? AUTO : String(settings.window)}
            options={windowOptions}
            disabled={!settings || isSaving || envLocked}
            onChange={(next) => {
              void save({ window: next === AUTO ? null : Number(next) });
            }}
            ariaLabel={t('autoCompact.window', { defaultValue: 'Context window cap' })}
          />
        </SettingsRow>
      </SettingsGroup>

      {error && (
        <p className="text-xs text-amber-600 dark:text-amber-400">
          {t('autoCompact.saveError', {
            defaultValue: "Couldn't read or write Claude Code's settings file.",
          })}
        </p>
      )}
    </SettingsScreen>
  );
}
