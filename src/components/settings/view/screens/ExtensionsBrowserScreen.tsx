import { useCallback, useEffect, useState } from 'react';
import { Download, Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Button } from '../../../../shared/view/ui';
import { authenticatedFetch } from '../../../../utils/api';
import { SettingsGroup, SettingsRow, SettingsScreen, SettingsToggle } from '../primitives';

type BrowserUseSettings = {
  enabled: boolean;
};

type BrowserUseStatus = {
  enabled: boolean;
  available: boolean;
  playwrightInstalled: boolean;
  chromiumInstalled: boolean;
  installInProgress: boolean;
  message: string;
};

async function readJson<T>(response: Response): Promise<T> {
  const data = await response.json();
  if (!response.ok || data.success === false) {
    throw new Error(data.error || data.details || `Request failed (${response.status})`);
  }
  return data as T;
}

/**
 * Browser enable toggle, Playwright/Chromium runtime status chips, and the
 * runtime install button. Ported from `BrowserUseSettingsTab`; the fetch/install
 * logic is unchanged, only the chrome moves to the shared primitives.
 */
export default function ExtensionsBrowserScreen() {
  const { t } = useTranslation('settings');
  const [settings, setSettings] = useState<BrowserUseSettings | null>(null);
  const [status, setStatus] = useState<BrowserUseStatus | null>(null);
  const [isSettingsLoading, setIsSettingsLoading] = useState(true);
  const [isStatusLoading, setIsStatusLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isInstalling, setIsInstalling] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadSettings = useCallback(async () => {
    const settingsResponse = await authenticatedFetch('/api/browser-use/settings');
    const settingsData = await readJson<{ data: { settings: BrowserUseSettings } }>(settingsResponse);
    setSettings(settingsData.data.settings);
  }, []);

  const loadStatus = useCallback(async () => {
    const statusResponse = await authenticatedFetch('/api/browser-use/status');
    const statusData = await readJson<{ data: BrowserUseStatus }>(statusResponse);
    setStatus(statusData.data);
  }, []);

  useEffect(() => {
    setError(null);
    setIsSettingsLoading(true);
    setIsStatusLoading(true);

    void loadSettings()
      .catch((err) => setError(err instanceof Error ? err.message : t('browserSettings.errors.loadSettings')))
      .finally(() => setIsSettingsLoading(false));

    void loadStatus()
      .catch((err) => setError(err instanceof Error ? err.message : t('browserSettings.errors.loadStatus')))
      .finally(() => setIsStatusLoading(false));
    // `t` is a dependency because the fallback messages are translated; a
    // language switch re-runs two cheap GETs, which is the honest trade against
    // holding a message key in state purely to keep it out of this array.
  }, [loadSettings, loadStatus, t]);

  const updateSettings = async (nextSettings: Partial<BrowserUseSettings>) => {
    setIsSaving(true);
    setError(null);
    try {
      const response = await authenticatedFetch('/api/browser-use/settings', {
        method: 'PUT',
        body: JSON.stringify(nextSettings),
      });
      const data = await readJson<{ data: { settings: BrowserUseSettings } }>(response);
      setSettings(data.data.settings);
      window.dispatchEvent(new Event('browserUseSettingsChanged'));
      setIsStatusLoading(true);
      await loadStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('browserSettings.errors.saveSettings'));
    } finally {
      setIsStatusLoading(false);
      setIsSaving(false);
    }
  };

  const installBrowserBinaries = async () => {
    setIsInstalling(true);
    setError(null);
    try {
      const response = await authenticatedFetch('/api/browser-use/runtime/install', { method: 'POST' });
      await readJson(response);
      setIsStatusLoading(true);
      await loadStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('browserSettings.errors.installRuntime'));
    } finally {
      setIsStatusLoading(false);
      setIsInstalling(false);
    }
  };

  const browserEnabled = settings?.enabled === true;
  const needsBrowserBinaries = Boolean(browserEnabled && status && (!status.playwrightInstalled || !status.chromiumInstalled));
  const runtimeLabel = (installed?: boolean) => {
    if (isStatusLoading && !status) {
      return t('browserSettings.runtime.checking');
    }
    return t(installed ? 'browserSettings.runtime.installed' : 'browserSettings.runtime.missing');
  };

  const statusLabel = () => {
    if (isStatusLoading && !status) return t('browserSettings.runtime.checking');
    if (status?.available) return t('browserSettings.runtime.ready');
    return t(browserEnabled ? 'browserSettings.runtime.setupRequired' : 'browserSettings.runtime.disabled');
  };

  return (
    <SettingsScreen description={t('browserSettings.description')}>
      <SettingsGroup divided>
        <SettingsRow
          label={t('browserSettings.enable.label')}
          description={t('browserSettings.enable.description')}
        >
          {isSettingsLoading && !settings ? (
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          ) : (
            <SettingsToggle
              checked={browserEnabled}
              onChange={(value) => void updateSettings({ enabled: value })}
              ariaLabel={t('browserSettings.enable.label')}
              disabled={isSaving}
            />
          )}
        </SettingsRow>

        <div className="space-y-4 px-4 py-4">
          <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
            <span className="rounded-md border border-border px-2 py-1">
              {t('browserSettings.runtime.playwright', { state: runtimeLabel(status?.playwrightInstalled) })}
            </span>
            <span className="rounded-md border border-border px-2 py-1">
              {t('browserSettings.runtime.chromium', { state: runtimeLabel(status?.chromiumInstalled) })}
            </span>
            <span className="rounded-md border border-border px-2 py-1">
              {t('browserSettings.runtime.status', { state: statusLabel() })}
            </span>
          </div>

          {needsBrowserBinaries && (
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0 space-y-1">
                <div className="text-sm font-medium text-foreground">
                  {t('browserSettings.runtime.requiredTitle')}
                </div>
                <p className="text-sm text-muted-foreground">
                  {status?.message || t('browserSettings.runtime.requiredDescription')}
                </p>
              </div>

              <Button
                type="button"
                size="sm"
                onClick={() => void installBrowserBinaries()}
                disabled={isInstalling || status?.installInProgress}
                className="flex-shrink-0"
              >
                {isInstalling || status?.installInProgress ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Download className="h-4 w-4" />
                )}
                {t(isInstalling || status?.installInProgress
                  ? 'browserSettings.runtime.installing'
                  : 'browserSettings.runtime.install')}
              </Button>
            </div>
          )}

          {error && (
            <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </div>
          )}
        </div>
      </SettingsGroup>
    </SettingsScreen>
  );
}
