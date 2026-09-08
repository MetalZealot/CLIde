import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { authenticatedFetch } from '../../../../utils/api';
import { SettingsRow, SettingsSelect, SettingsTextField } from '../primitives';

export type BrowserViewportProfile =
  | { mode: 'device'; device: string }
  | { mode: 'custom'; width: number; height: number };

const VIEWPORT_PRESETS = ['desktop', 'tablet', 'phone'] as const;
export type BrowserViewportPreset = typeof VIEWPORT_PRESETS[number];
export type BrowserViewportProfiles = Record<BrowserViewportPreset, BrowserViewportProfile>;

type DeviceDescriptor = {
  name: string;
  width: number;
  height: number;
  isMobile: boolean;
  hasTouch: boolean;
  deviceScaleFactor: number;
};

type DeviceCatalogue = {
  devices: DeviceDescriptor[];
  defaults: BrowserViewportProfiles;
  limits: { min: number; max: number; recommendedMax: number };
};

type Props = {
  viewports: BrowserViewportProfiles | null;
  onChange: (viewports: BrowserViewportProfiles) => void;
  disabled?: boolean;
};

const CUSTOM_VALUE = 'custom';
// A tablet's short edge is its portrait width; below this the registry entry is
// a phone.
const TABLET_MIN_SHORT_EDGE = 600;

function belongsTo(preset: BrowserViewportPreset, device: DeviceDescriptor): boolean {
  if (!device.isMobile) {
    return preset === 'desktop';
  }
  if (preset === 'desktop') {
    return false;
  }
  const shortEdge = Math.min(device.width, device.height);
  return preset === 'tablet' ? shortEdge >= TABLET_MIN_SHORT_EDGE : shortEdge < TABLET_MIN_SHORT_EDGE;
}

function sizeOf(
  profile: BrowserViewportProfile,
  devices: DeviceDescriptor[],
): { width: number; height: number } | null {
  if (profile.mode === 'custom') {
    return { width: profile.width, height: profile.height };
  }
  const descriptor = devices.find((device) => device.name === profile.device);
  return descriptor ? { width: descriptor.width, height: descriptor.height } : null;
}

export default function BrowserViewportSettings({ viewports, onChange, disabled }: Props) {
  const { t } = useTranslation('settings');
  const [catalogue, setCatalogue] = useState<DeviceCatalogue | null>(null);
  const [drafts, setDrafts] = useState<Partial<Record<BrowserViewportPreset, { width: string; height: string }>>>({});

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const response = await authenticatedFetch('/api/browser-use/devices');
        const data = await response.json();
        if (!cancelled && response.ok && data?.success !== false) {
          setCatalogue(data.data as DeviceCatalogue);
        }
      } catch {
        // The rows still render from the stored profiles; only the picker's
        // option list needs the registry.
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const devices = useMemo(() => catalogue?.devices || [], [catalogue]);
  const limits = catalogue?.limits || { min: 240, max: 4000, recommendedMax: 1568 };

  const optionsByPreset = useMemo(() => {
    const build = (preset: BrowserViewportPreset) => [
      ...devices.filter((device) => belongsTo(preset, device)).map((device) => ({
        value: `device:${device.name}`,
        label: `${device.name} — ${device.width}×${device.height}`,
      })),
      { value: CUSTOM_VALUE, label: t('browserSettings.viewport.custom') },
    ];
    return { desktop: build('desktop'), tablet: build('tablet'), phone: build('phone') };
  }, [devices, t]);

  if (!viewports) {
    return null;
  }

  const commit = (preset: BrowserViewportPreset, profile: BrowserViewportProfile) => {
    onChange({ ...viewports, [preset]: profile });
  };

  const selectDevice = (preset: BrowserViewportPreset, value: string) => {
    if (value !== CUSTOM_VALUE) {
      setDrafts((current) => ({ ...current, [preset]: undefined }));
      commit(preset, { mode: 'device', device: value.slice('device:'.length) });
      return;
    }
    // Custom starts from whatever the row already shows, so the picker never
    // resets the size out from under a size edit.
    const size = sizeOf(viewports[preset], devices)
      || sizeOf(catalogue?.defaults?.[preset] || { mode: 'custom', width: 1440, height: 900 }, devices)
      || { width: 1440, height: 900 };
    commit(preset, { mode: 'custom', ...size });
  };

  const commitEdge = (preset: BrowserViewportPreset, edge: 'width' | 'height', raw: string) => {
    const profile = viewports[preset];
    if (profile.mode !== 'custom') {
      return;
    }
    const parsed = Number.parseInt(raw, 10);
    const next = Number.isFinite(parsed)
      ? Math.min(limits.max, Math.max(limits.min, parsed))
      : profile[edge];
    setDrafts((current) => ({ ...current, [preset]: undefined }));
    commit(preset, { ...profile, [edge]: next });
  };

  return (
    <>
      {VIEWPORT_PRESETS.map((preset) => {
        const profile = viewports[preset];
        const isCustom = profile.mode === 'custom';
        const selected = isCustom ? CUSTOM_VALUE : `device:${profile.device}`;
        const options = optionsByPreset[preset];
        // A stored device the registry no longer lists would otherwise select
        // the first option silently.
        const known = options.some((option) => option.value === selected);
        const descriptor = isCustom ? null : devices.find((device) => device.name === profile.device);
        const draft = drafts[preset];
        const size = sizeOf(profile, devices);
        const oversized = Boolean(size && Math.max(size.width, size.height) > limits.recommendedMax);

        return (
          <SettingsRow
            key={preset}
            stacked
            label={t(`browserSettings.viewport.presets.${preset}`)}
            description={t(`browserSettings.viewport.descriptions.${preset}`)}
          >
            <div className="space-y-2">
              <SettingsSelect
                value={known ? selected : CUSTOM_VALUE}
                options={known ? options : [{ value: selected, label: profile.mode === 'device' ? profile.device : '' }, ...options]}
                onChange={(value) => selectDevice(preset, value)}
                ariaLabel={t(`browserSettings.viewport.presets.${preset}`)}
                disabled={disabled}
              />

              {isCustom && (
                <div className="flex items-center gap-2">
                  <SettingsTextField
                    value={draft ? draft.width : String(profile.width)}
                    onChange={(value) => setDrafts((current) => ({
                      ...current,
                      [preset]: { width: value, height: draft ? draft.height : String(profile.height) },
                    }))}
                    onBlur={() => commitEdge(preset, 'width', draft ? draft.width : String(profile.width))}
                    inputMode="numeric"
                    ariaLabel={t('browserSettings.viewport.width')}
                    disabled={disabled}
                    className="flex-1"
                  />
                  <span className="text-sm text-muted-foreground">×</span>
                  <SettingsTextField
                    value={draft ? draft.height : String(profile.height)}
                    onChange={(value) => setDrafts((current) => ({
                      ...current,
                      [preset]: { width: draft ? draft.width : String(profile.width), height: value },
                    }))}
                    onBlur={() => commitEdge(preset, 'height', draft ? draft.height : String(profile.height))}
                    inputMode="numeric"
                    ariaLabel={t('browserSettings.viewport.height')}
                    disabled={disabled}
                    className="flex-1"
                  />
                </div>
              )}

              {descriptor && (
                <p className="text-xs text-muted-foreground">
                  {t('browserSettings.viewport.descriptorDetail', {
                    scale: descriptor.deviceScaleFactor,
                    input: t(descriptor.hasTouch
                      ? 'browserSettings.viewport.touch'
                      : 'browserSettings.viewport.pointer'),
                  })}
                </p>
              )}

              {oversized && (
                <p className="text-xs text-warning">
                  {t('browserSettings.viewport.oversized', { limit: limits.recommendedMax })}
                </p>
              )}
            </div>
          </SettingsRow>
        );
      })}
    </>
  );
}
