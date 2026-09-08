import { useTranslation } from 'react-i18next';

import { SettingsRow, SettingsSelect } from '../primitives';

export type BrowserDevicePreset = 'desktop' | 'tablet' | 'phone';

export type BrowserSessionPolicy = {
  defaultDevice: BrowserDevicePreset;
  maxSessions: number;
  // Minutes, with 0 meaning idle sessions are never reclaimed.
  sessionTtlMinutes: number;
};

type Props = {
  policy: BrowserSessionPolicy | null;
  onChange: (policy: Partial<BrowserSessionPolicy>) => void;
  disabled?: boolean;
};

const DEVICE_PRESETS: BrowserDevicePreset[] = ['desktop', 'tablet', 'phone'];
const SESSION_COUNTS = [1, 2, 3, 4, 5];
const TTL_MINUTES = [5, 15, 30, 60, 0];

// The server clamps to a wider range than the picker offers, and an environment
// variable can seed a value outside it, so a stored value that is not on the
// list joins it rather than selecting the first option silently. Never (0)
// stays last, where it reads as the end of the scale rather than the start.
function withStored(values: number[], stored: number): number[] {
  if (values.includes(stored)) {
    return values;
  }
  return [...values, stored].sort((a, b) => (a === 0 ? 1 : b === 0 ? -1 : a - b));
}

export default function BrowserSessionSettings({ policy, onChange, disabled }: Props) {
  const { t } = useTranslation('settings');

  if (!policy) {
    return null;
  }

  const ttlLabel = (minutes: number) => (minutes === 0
    ? t('browserSettings.sessions.never')
    : t('browserSettings.sessions.minutes', { count: minutes }));

  return (
    <>
      <SettingsRow
        stacked
        label={t('browserSettings.sessions.defaultDevice.label')}
        description={t('browserSettings.sessions.defaultDevice.description')}
      >
        <SettingsSelect
          value={policy.defaultDevice}
          options={DEVICE_PRESETS.map((preset) => ({
            value: preset,
            label: t(`browserSettings.viewport.presets.${preset}`),
          }))}
          onChange={(defaultDevice) => onChange({ defaultDevice })}
          ariaLabel={t('browserSettings.sessions.defaultDevice.label')}
          disabled={disabled}
        />
      </SettingsRow>

      <SettingsRow
        stacked
        label={t('browserSettings.sessions.maxSessions.label')}
        description={t('browserSettings.sessions.maxSessions.description')}
      >
        <SettingsSelect
          value={String(policy.maxSessions)}
          options={withStored(SESSION_COUNTS, policy.maxSessions).map((count) => ({
            value: String(count),
            label: String(count),
          }))}
          onChange={(value) => onChange({ maxSessions: Number.parseInt(value, 10) })}
          ariaLabel={t('browserSettings.sessions.maxSessions.label')}
          disabled={disabled}
        />
      </SettingsRow>

      <SettingsRow
        stacked
        label={t('browserSettings.sessions.idleTimeout.label')}
        description={t('browserSettings.sessions.idleTimeout.description')}
      >
        <SettingsSelect
          value={String(policy.sessionTtlMinutes)}
          options={withStored(TTL_MINUTES, policy.sessionTtlMinutes).map((minutes) => ({
            value: String(minutes),
            label: ttlLabel(minutes),
          }))}
          onChange={(value) => onChange({ sessionTtlMinutes: Number.parseInt(value, 10) })}
          ariaLabel={t('browserSettings.sessions.idleTimeout.label')}
          disabled={disabled}
        />
      </SettingsRow>
    </>
  );
}
