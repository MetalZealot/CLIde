import { type ReactNode, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { ClaudeSettingEntry, SaveClaudeSetting } from '../../../hooks/useClaudeSettings';
import type { SettingsProject } from '../../../types/types';
import { projectPathOf } from '../../../utils/claudeConfiguration';
import type { ClaudeChoiceOption, ClaudeSettingRowSpec } from '../../../utils/claudeSettingsLayout';
import { SettingsSelect, SettingsTextField, SettingsToggle } from '../../primitives';

type ValueRowSpec = Exclude<ClaudeSettingRowSpec, { kind: 'screen' }>;

type ClaudeSettingRowProps = {
  spec: ValueRowSpec;
  /** Absent while loading, or when the installed SDK no longer has the key. */
  entry: ClaudeSettingEntry | undefined;
  projects: SettingsProject[];
  onSave: SaveClaudeSetting;
};

/** Select value for "not in the user file". */
const UNSET = '__unset__';

const isPlainObject = (value: unknown): value is Record<string, unknown> => (
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)
);

/** The free-text and number fields: saved on blur or Enter, and emptied, reset. */
function TextControl({ entry, label, disabled, onSave }: {
  entry: ClaudeSettingEntry; label: string; disabled: boolean; onSave: SaveClaudeSetting;
}) {
  const { t } = useTranslation('settings');
  const saved = entry.inUserFile ? String(entry.userValue ?? '') : '';
  const [draft, setDraft] = useState(saved);
  useEffect(() => { setDraft(saved); }, [saved]);

  const commit = () => {
    const text = draft.trim();
    if (text === saved) return;
    void onSave(entry.key, text === '' ? undefined : text);
  };

  return (
    <div className="w-40 flex-shrink-0" onKeyDown={(event) => { if (event.key === 'Enter') commit(); }}>
      <SettingsTextField
        value={draft}
        onChange={setDraft}
        onBlur={commit}
        placeholder={t('claudeSettings.standard')}
        ariaLabel={label}
        disabled={disabled}
      />
    </div>
  );
}

/**
 * One Claude Code setting under a plain-language name. The control shows what
 * is in force from the user file — Claude Code's default when the key is
 * unset — and every change writes the user file, the same one `/config` does.
 */
export default function ClaudeSettingRow({ spec, entry, projects, onSave }: ClaudeSettingRowProps) {
  const { t } = useTranslation('settings');
  const [saving, setSaving] = useState(false);
  const label = t(`claudeSettings.rows.${spec.key}.label`);
  const description = t(`claudeSettings.rows.${spec.key}.description`);

  if (!entry) {
    return (
      <div className="px-4 py-4">
        <div className="text-sm font-medium text-foreground">{label}</div>
        <div className="mt-0.5 text-sm text-muted-foreground">{description}</div>
      </div>
    );
  }

  const managed = entry.source === 'managed';
  const disabled = saving || managed;
  const save: SaveClaudeSetting = async (key, value) => {
    setSaving(true);
    try {
      return await onSave(key, value);
    } finally {
      setSaving(false);
    }
  };

  const formatValue = (value: unknown): string => {
    if (typeof value === 'boolean') return t(value ? 'claudeSettings.options.on' : 'claudeSettings.options.off');
    if (isPlainObject(value)) {
      return Object.entries(value).map(([name, inner]) => `${name}: ${String(inner)}`).join(', ');
    }
    return String(value);
  };

  // A richer form than the control can write (custom attribution text) is shown, not overwritten.
  const kind = spec.kind === 'switch' && entry.inUserFile && typeof entry.userValue !== 'boolean'
    ? 'summary'
    : spec.kind;

  let control: ReactNode = null;
  if (kind === 'switch' && spec.kind === 'switch') {
    const stored = entry.inUserFile ? Boolean(entry.userValue) : spec.default;
    control = (
      <SettingsToggle
        checked={spec.invert ? !stored : stored}
        disabled={disabled}
        ariaLabel={label}
        onChange={(next) => { void save(spec.key, spec.invert ? !next : next); }}
      />
    );
  } else if (kind === 'choice' && spec.kind === 'choice') {
    const options: ClaudeChoiceOption[] = [...spec.options];
    const current = entry.inUserFile ? entry.userValue : spec.default;
    if (entry.inUserFile && !options.some((option) => option.value === current)) {
      options.push({ value: current as string | number | boolean, labelKey: '' });
    }
    const choices = [
      ...(spec.default === undefined
        ? [{ value: UNSET, label: t(spec.unsetLabelKey ?? 'claudeSettings.options.claudeDecides') }]
        : []),
      ...options.map((option, index) => ({
        value: String(index),
        label: option.labelKey ? t(option.labelKey) : formatValue(option.value),
      })),
    ];
    const selectedIndex = current === undefined ? -1 : options.findIndex((option) => option.value === current);
    control = (
      <SettingsSelect
        value={selectedIndex < 0 ? UNSET : String(selectedIndex)}
        options={choices}
        disabled={disabled}
        ariaLabel={label}
        className="w-auto min-w-28 max-w-[45%] flex-shrink-0 pr-8"
        onChange={(next) => {
          void save(spec.key, next === UNSET ? undefined : options[Number(next)].value);
        }}
      />
    );
  } else if (kind === 'text') {
    control = <TextControl entry={entry} label={label} disabled={disabled} onSave={save} />;
  } else {
    control = (
      <span className="max-w-[45%] truncate text-sm text-muted-foreground">
        {entry.source ? formatValue(entry.value) : t('claudeSettings.default')}
      </span>
    );
  }

  // A choice's own label where it has one, so a note reads like the control.
  const describeValue = (value: unknown): string => {
    const option = spec.kind === 'choice' ? spec.options.find((candidate) => candidate.value === value) : undefined;
    return option ? t(option.labelKey) : formatValue(value);
  };

  const overrides = entry.overrides ?? [];
  const projectName = (workspacePath: string) => {
    const project = projects.find((candidate) => projectPathOf(candidate) === workspacePath);
    return project ? project.displayName || project.name : workspacePath;
  };

  return (
    <div className="px-4 py-4">
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium text-foreground">{label}</div>
          <div className="mt-0.5 text-sm text-muted-foreground">{description}</div>
          <div className="mt-1 flex flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground">
            {managed && <span>{t('claudeSettings.managed')}</span>}
            {!managed && entry.inUserFile && (
              <>
                <span className="text-foreground">{t('claudeSettings.setByYou')}</span>
                <span aria-hidden>·</span>
                <button
                  type="button"
                  className="text-primary underline-offset-2 hover:underline disabled:opacity-60"
                  disabled={disabled}
                  onClick={() => { void save(spec.key, undefined); }}
                >
                  {t('claudeSettings.reset')}
                </button>
              </>
            )}
            {!managed && !entry.inUserFile && <span>{t('claudeSettings.default')}</span>}
          </div>
        </div>
        {control}
      </div>
      {overrides.length > 0 && (
        <p className="mt-2 rounded-md bg-warning/10 px-2 py-1.5 text-xs text-warning">
          {overrides.length === 1
            ? t('claudeSettings.overriddenOne', {
              project: projectName(overrides[0].workspacePath),
              value: describeValue(overrides[0].value),
            })
            : t('claudeSettings.overriddenMany', {
              count: overrides.length,
              projects: overrides.map((override) => projectName(override.workspacePath)).join(', '),
            })}
        </p>
      )}
    </div>
  );
}
