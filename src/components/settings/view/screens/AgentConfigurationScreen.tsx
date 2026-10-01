import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Badge } from '../../../../shared/view/ui';
import { authenticatedFetch } from '../../../../utils/api';
import type { SettingsProject } from '../../types/types';
import {
  NO_PROJECT,
  cascadeUrl,
  claudeSettingLabel,
  initialConfigurationProject,
  projectPathOf,
  rememberConfigurationProject,
} from '../../utils/claudeConfiguration';
import { SettingsGroup, SettingsRow, SettingsScreen, SettingsSelect, SettingsTextField } from '../primitives';

type CascadeSource = 'user' | 'project' | 'local' | 'managed' | 'flag';
type CascadeTier = 'exposed' | 'adapt' | 'display' | 'terminal' | 'out-of-scope' | 'unclassified';

type CascadeControl =
  | { kind: 'boolean' }
  | { kind: 'number' }
  | { kind: 'string' }
  | { kind: 'enum'; options: string[] };

type CascadeEntry = {
  key: string;
  tier: CascadeTier;
  value?: unknown;
  source: CascadeSource | null;
  path?: string;
  alsoSetIn: CascadeSource[];
  redacted?: true;
  control?: CascadeControl;
  description?: string;
  inUserFile: boolean;
  userValue?: unknown;
};

type CascadeApiResponse = { success?: boolean; data?: { entries: CascadeEntry[] } };

/** A value to save, or `undefined` to reset the key to Claude Code's default. */
type SaveSetting = (key: string, value: unknown) => Promise<boolean>;

const TIER_ORDER: CascadeTier[] = ['exposed', 'adapt', 'display', 'unclassified', 'terminal', 'out-of-scope'];

/** Select value for "not in the user file". */
const DEFAULT_CHOICE = '';

const isScalar = (value: unknown): boolean => value === null || typeof value !== 'object';

function SourceBadge({ entry }: { entry: CascadeEntry }) {
  const { t } = useTranslation('settings');
  if (!entry.source) return null;
  return (
    <Badge
      variant={entry.source === 'managed' ? 'destructive' : 'secondary'}
      className="flex-shrink-0"
      title={entry.path}
    >
      {t(`configuration.sources.${entry.source}`)}
    </Badge>
  );
}

function ReadOnlyRow({ entry }: { entry: CascadeEntry }) {
  const { t } = useTranslation('settings');
  const sourceLabel = (source: CascadeSource) => t(`configuration.sources.${source}`);

  let summary: string;
  if (!entry.source) {
    summary = t('configuration.notSet');
  } else if (entry.redacted) {
    summary = t('configuration.hiddenValues', { names: (entry.value as string[]).join(', ') });
  } else if (isScalar(entry.value)) {
    summary = String(entry.value);
  } else {
    const count = Array.isArray(entry.value) ? entry.value.length : Object.keys(entry.value as object).length;
    summary = t('configuration.items', { count });
  }

  const expandable = Boolean(entry.source) && !entry.redacted && !isScalar(entry.value);

  return (
    <div className="px-4 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="break-all font-mono text-sm text-foreground">{entry.key}</div>
          {expandable ? (
            <details className="mt-0.5">
              <summary className="cursor-pointer text-sm text-muted-foreground">{summary}</summary>
              <pre className="mt-2 max-h-64 overflow-auto rounded-md bg-muted p-2 text-xs text-foreground">
                {JSON.stringify(entry.value, null, 2)}
              </pre>
            </details>
          ) : (
            <div className="mt-0.5 break-all text-sm text-muted-foreground">{summary}</div>
          )}
          {entry.alsoSetIn.length > 0 && (
            <div className="mt-0.5 text-xs text-muted-foreground">
              {t('configuration.alsoSetIn', { sources: entry.alsoSetIn.map(sourceLabel).join(', ') })}
            </div>
          )}
        </div>
        <SourceBadge entry={entry} />
      </div>
    </div>
  );
}

/** Free text or a number, saved on blur or Enter; emptied, it resets the key. */
function SettingTextInput({
  entry,
  label,
  disabled,
  onSave,
}: { entry: CascadeEntry; label: string; disabled: boolean; onSave: SaveSetting }) {
  const { t } = useTranslation('settings');
  const saved = entry.inUserFile ? String(entry.userValue ?? '') : '';
  const [draft, setDraft] = useState(saved);
  const [invalid, setInvalid] = useState(false);
  useEffect(() => { setDraft(saved); }, [saved]);

  const commit = async () => {
    const text = draft.trim();
    if (text === saved) return;
    if (text === '') {
      await onSave(entry.key, undefined);
      return;
    }
    const value = entry.control?.kind === 'number' ? Number(text) : text;
    if (typeof value === 'number' && !Number.isFinite(value)) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    await onSave(entry.key, value);
  };

  return (
    <div onKeyDown={(event) => { if (event.key === 'Enter') void commit(); }}>
      <SettingsTextField
        value={draft}
        onChange={(next) => { setDraft(next); setInvalid(false); }}
        onBlur={() => { void commit(); }}
        inputMode={entry.control?.kind === 'number' ? 'numeric' : 'text'}
        placeholder={t('configuration.default')}
        ariaLabel={label}
        disabled={disabled}
      />
      {invalid && <p className="mt-1 text-xs text-destructive">{t('configuration.invalidNumber')}</p>}
    </div>
  );
}

/** A key with a generated control. It edits the user file, whatever source wins. */
function EditableRow({ entry, onSave }: { entry: CascadeEntry; onSave: SaveSetting }) {
  const { t } = useTranslation('settings');
  const [saving, setSaving] = useState(false);
  const control = entry.control as CascadeControl;
  const label = claudeSettingLabel(entry.key, control.kind === 'boolean');
  const disabled = saving || entry.source === 'managed';
  const overriddenBy = entry.source && entry.source !== 'user' ? entry.source : null;

  const save: SaveSetting = async (key, value) => {
    setSaving(true);
    try {
      return await onSave(key, value);
    } finally {
      setSaving(false);
    }
  };

  const choiceValue = entry.inUserFile ? String(entry.userValue) : DEFAULT_CHOICE;
  const choices = control.kind === 'boolean'
    ? [
      { value: DEFAULT_CHOICE, label: t('configuration.default') },
      { value: 'true', label: t('configuration.on') },
      { value: 'false', label: t('configuration.off') },
    ]
    : control.kind === 'enum'
      ? [
        { value: DEFAULT_CHOICE, label: t('configuration.default') },
        ...control.options.map((option) => ({ value: option, label: option })),
      ]
      : null;

  const chooseValue = (next: string) => {
    if (next === DEFAULT_CHOICE) void save(entry.key, undefined);
    else void save(entry.key, control.kind === 'boolean' ? next === 'true' : next);
  };

  return (
    <div className="space-y-2 px-4 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium text-foreground">{label}</div>
          {entry.description && (
            <div className="mt-0.5 text-sm text-muted-foreground">{entry.description}</div>
          )}
        </div>
        {choices && (
          <SettingsSelect
            value={choiceValue}
            options={choices}
            onChange={chooseValue}
            ariaLabel={label}
            disabled={disabled}
            className="w-auto min-w-28 max-w-[45%] flex-shrink-0 pr-8"
          />
        )}
      </div>

      {!choices && (
        <SettingTextInput entry={entry} label={label} disabled={disabled} onSave={save} />
      )}

      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
        <span className="break-all font-mono">{entry.key}</span>
        <span aria-hidden>·</span>
        <span>{entry.source ? t(`configuration.sources.${entry.source}`) : t('configuration.default')}</span>
        {entry.inUserFile && entry.source !== 'managed' && (
          <>
            <span aria-hidden>·</span>
            <button
              type="button"
              className="text-primary underline-offset-2 hover:underline disabled:opacity-60"
              disabled={disabled}
              onClick={() => { void save(entry.key, undefined); }}
            >
              {t('configuration.reset')}
            </button>
          </>
        )}
      </div>

      {overriddenBy && (
        <p className="text-xs text-warning">
          {t('configuration.overridden', {
            source: t(`configuration.sources.${overriddenBy}`),
            value: isScalar(entry.value) ? String(entry.value) : '…',
          })}
        </p>
      )}
    </div>
  );
}

/**
 * Agents › Claude › Configuration.
 *
 * Every key Claude Code's settings files set, grouped by what CLIde does with
 * it. Keys with a generated control are edited in place and always written to
 * the user file; project and local files depend on the project, so the screen
 * resolves against one chosen project at a time.
 */
export default function AgentConfigurationScreen({ projects }: { projects: SettingsProject[] }) {
  const { t } = useTranslation('settings');
  const [workspacePath, setWorkspacePath] = useState(() => initialConfigurationProject(projects));
  const [entries, setEntries] = useState<CascadeEntry[] | null>(null);
  const [error, setError] = useState<'load' | 'save' | null>(null);

  const load = useCallback(async (isCancelled: () => boolean = () => false) => {
    try {
      const response = await authenticatedFetch(cascadeUrl(workspacePath));
      const body = (await response.json()) as CascadeApiResponse;
      if (isCancelled()) return;
      setEntries(body.success ? body.data?.entries ?? [] : null);
      setError(body.success ? null : 'load');
    } catch (loadError) {
      console.error('Error resolving Claude settings:', loadError);
      if (!isCancelled()) setError('load');
    }
  }, [workspacePath]);

  useEffect(() => {
    let cancelled = false;
    void load(() => cancelled);
    return () => { cancelled = true; };
  }, [load]);

  const saveSetting: SaveSetting = useCallback(async (key, value) => {
    try {
      const response = await authenticatedFetch(`/api/providers/claude/settings/${encodeURIComponent(key)}`, value === undefined
        ? { method: 'DELETE' }
        : { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ value }) });
      const body = (await response.json()) as { success?: boolean };
      setError(body.success ? null : 'save');
      // Re-resolve either way, so the row shows what the file now holds.
      await load();
      return Boolean(body.success);
    } catch (saveError) {
      console.error('Error saving Claude setting:', saveError);
      setError('save');
      return false;
    }
  }, [load]);

  const projectOptions = [
    ...projects
      .filter((project) => projectPathOf(project))
      .map((project) => ({ value: projectPathOf(project), label: project.displayName || project.name })),
    { value: NO_PROJECT, label: t('configuration.noProject') },
  ];

  const chooseProject = (next: string) => {
    rememberConfigurationProject(next);
    setWorkspacePath(next);
  };

  return (
    <SettingsScreen>
      <SettingsGroup description={t('configuration.description')}>
        <SettingsRow stacked label={t('configuration.project')}>
          <SettingsSelect
            value={workspacePath}
            options={projectOptions}
            onChange={chooseProject}
            ariaLabel={t('configuration.project')}
          />
        </SettingsRow>
      </SettingsGroup>

      {error && (
        <p className="text-xs text-amber-600 dark:text-amber-400">
          {t(error === 'load' ? 'configuration.loadError' : 'configuration.saveError')}
        </p>
      )}

      {entries && TIER_ORDER.map((tier) => {
        const rows = entries.filter((entry) => entry.tier === tier);
        if (rows.length === 0) return null;
        // Editable keys first, by the label they show; read-only ones after.
        const editable = rows
          .filter((entry) => entry.control)
          .sort((a, b) => claudeSettingLabel(a.key, a.control?.kind === 'boolean')
            .localeCompare(claudeSettingLabel(b.key, b.control?.kind === 'boolean')));
        const readOnly = rows.filter((entry) => !entry.control);
        return (
          <SettingsGroup
            key={tier}
            divided
            title={t(`configuration.tiers.${tier}.title`)}
            description={t(`configuration.tiers.${tier}.description`)}
          >
            {editable.map((entry) => <EditableRow key={entry.key} entry={entry} onSave={saveSetting} />)}
            {readOnly.map((entry) => <ReadOnlyRow key={entry.key} entry={entry} />)}
          </SettingsGroup>
        );
      })}
    </SettingsScreen>
  );
}
