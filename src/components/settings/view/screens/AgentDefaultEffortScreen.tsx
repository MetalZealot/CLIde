import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { authenticatedFetch } from '../../../../utils/api';
import { SettingsGroup, SettingsRow, SettingsScreen, SettingsSelect } from '../primitives';

type EffortDefaultRow = {
  value: string;
  label: string;
  isDefault: boolean;
  /** Canonical id Claude Code files the setting under. */
  model: string;
  effort: string | null;
  builtIn: string;
  levels: string[];
};

type EffortDefaultsResponse = {
  success?: boolean;
  data?: { models?: EffortDefaultRow[] };
};

const EFFORT_DEFAULTS_URL = '/api/providers/claude/effort-defaults';

/**
 * Agents › Claude › Default effort.
 *
 * One level per current model, written to Claude Code's own per-model setting —
 * the one its effort slider saves — so a chat left on Default and a Shell
 * session run at the same level.
 */
export default function AgentDefaultEffortScreen() {
  const { t } = useTranslation('settings');
  const [rows, setRows] = useState<EffortDefaultRow[] | null>(null);
  const [savingModel, setSavingModel] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    authenticatedFetch(EFFORT_DEFAULTS_URL)
      .then((response) => response.json() as Promise<EffortDefaultsResponse>)
      .then((body) => { if (!cancelled) setRows(body.success ? body.data?.models ?? [] : []); })
      .catch(() => { if (!cancelled) setRows([]); });
    return () => { cancelled = true; };
  }, []);

  const handleChange = async (row: EffortDefaultRow, effort: string) => {
    setError(null);
    setSavingModel(row.model);
    try {
      const response = await authenticatedFetch(EFFORT_DEFAULTS_URL, {
        method: 'PUT',
        body: JSON.stringify({ model: row.model, effort }),
      });
      const body = (await response.json()) as EffortDefaultsResponse;
      if (!response.ok || !body.success) throw new Error('save failed');
      setRows(body.data?.models ?? []);
    } catch {
      setError(t('defaultEffort.saveFailed', { defaultValue: "Couldn't save the effort. Try again." }));
    } finally {
      setSavingModel(null);
    }
  };

  return (
    <SettingsScreen>
      <SettingsGroup
        divided
        description={t('defaultEffort.description', {
          defaultValue: "The effort each model runs at unless you pick another level in a chat. Claude Code's own effort slider changes the same setting, so Shell and Chat always agree. Max can only be picked per chat.",
        })}
      >
        {(rows ?? []).map((row) => (
          <SettingsRow key={row.model} stacked label={row.label}>
            <SettingsSelect
              value={row.effort ?? row.builtIn}
              options={row.levels.map((level) => ({
                value: level,
                label: level === row.builtIn
                  ? t('defaultEffort.builtIn', { defaultValue: "{{level}} (Claude's default)", level })
                  : level,
              }))}
              onChange={(effort) => { void handleChange(row, effort); }}
              ariaLabel={row.label}
              className={savingModel === row.model ? 'opacity-60' : undefined}
            />
          </SettingsRow>
        ))}
      </SettingsGroup>
      {error && <p role="alert" className="px-4 text-sm text-destructive">{error}</p>}
    </SettingsScreen>
  );
}
