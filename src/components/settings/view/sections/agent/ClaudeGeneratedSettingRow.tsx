import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { ClaudeSettingControl, ClaudeSettingEntry, SaveClaudeSetting } from '../../../hooks/useClaudeSettings';
import { cn } from '../../../../../lib/utils';
import { claudeSettingLabel } from '../../../utils/claudeConfiguration';
import { SettingsSelect, SettingsTextField } from '../../primitives';

type CascadeEntry = ClaudeSettingEntry;
type CascadeControl = ClaudeSettingControl;
type SaveSetting = SaveClaudeSetting;

/** Select value for "not in the user file". */
const DEFAULT_CHOICE = '';

const isScalar = (value: unknown): boolean => value === null || typeof value !== 'object';

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

/** A key with a control generated from its SDK type. It edits the user file, whatever source wins. */
export default function ClaudeGeneratedSettingRow({ entry, onSave }: { entry: CascadeEntry; onSave: SaveSetting }) {
  const { t } = useTranslation('settings');
  const [saving, setSaving] = useState(false);
  const [expanded, setExpanded] = useState(false);
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
            // Anthropic's descriptions run to a paragraph; two lines until tapped.
            <button
              type="button"
              className={cn('mt-0.5 text-left text-sm text-muted-foreground', !expanded && 'line-clamp-2')}
              aria-expanded={expanded}
              onClick={() => setExpanded((open) => !open)}
            >
              {entry.description}
            </button>
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
