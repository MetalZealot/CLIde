import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Badge, Button } from '../../../../../shared/view/ui';
import { authenticatedFetch } from '../../../../../utils/api';
import { SettingsRow } from '../../primitives';

type RuntimeInstallation = {
  id: string;
  version: string;
  displayPath: string;
  sources: string[];
  bundled: boolean;
};

type RuntimeStatus = {
  installations: RuntimeInstallation[];
  activeInstallationId: string | null;
  previousInstallationId: string | null;
  liveProcessInstallationId: string | null;
  sdkVersion: string | null;
  liveProcessVersion: string | null;
  updatePending: boolean;
  activeError: string | null;
};

type RuntimeCheck = {
  installationId: string;
  compatibility: 'compatible' | 'incompatible' | 'check_failed';
  detail: string | null;
};

type ApiResponse<T> = {
  success?: boolean;
  data?: T;
  error?: string;
};

const readResponse = async <T,>(response: Response): Promise<T> => {
  const body = await response.json() as ApiResponse<T>;
  if (!response.ok || !body.success || !body.data) {
    throw new Error(body.error || 'Runtime request failed.');
  }
  return body.data;
};

const compactRuntimePath = (displayPath: string): string => {
  const normalized = displayPath.replace(/\\/g, '/');
  const binSuffix = normalized.match(/\/bin\/[^/]+$/)?.[0] ?? '';
  const marker = ['/standalone/releases/', '/node_modules/']
    .find((candidate) => normalized.includes(candidate));
  return marker && binSuffix ? `…${marker}…${binSuffix}` : displayPath;
};

type BusyAction = {
  action: 'check' | 'use' | 'rollback';
  installationId: string;
};

export default function CodexNativeRuntimeRow() {
  const { t } = useTranslation('settings');
  const [status, setStatus] = useState<RuntimeStatus | null>(null);
  const [checks, setChecks] = useState<Record<string, RuntimeCheck>>({});
  const [busy, setBusy] = useState<BusyAction | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expandedPathId, setExpandedPathId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void authenticatedFetch('/api/providers/codex/runtime')
      .then(readResponse<RuntimeStatus>)
      .then((nextStatus) => {
        if (!cancelled) setStatus(nextStatus);
      })
      .catch((loadError: unknown) => {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : String(loadError));
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const runCheck = async (installation: RuntimeInstallation) => {
    setBusy({ action: 'check', installationId: installation.id });
    setError(null);
    try {
      const response = await authenticatedFetch('/api/providers/codex/runtime/check', {
        method: 'POST',
        body: JSON.stringify({ installationId: installation.id }),
      });
      const result = await readResponse<RuntimeCheck>(response);
      setChecks((current) => ({ ...current, [installation.id]: result }));
    } catch (checkError) {
      setError(checkError instanceof Error ? checkError.message : String(checkError));
    } finally {
      setBusy(null);
    }
  };

  const select = async (installationId: string, action: 'use' | 'rollback') => {
    setBusy({ action, installationId });
    setError(null);
    try {
      const response = await authenticatedFetch('/api/providers/codex/runtime/selection', {
        method: 'PUT',
        body: JSON.stringify({ installationId }),
      });
      setStatus(await readResponse<RuntimeStatus>(response));
      setChecks({});
    } catch (selectionError) {
      setError(selectionError instanceof Error ? selectionError.message : String(selectionError));
    } finally {
      setBusy(null);
    }
  };

  if (!status) {
    return error ? <div className="px-4 py-3 text-xs text-destructive">{error}</div> : null;
  }

  const failureMessage = status.activeError || error;

  return (
    <SettingsRow
      stacked
      label={t('agents.codexRuntime.title')}
      description={t('agents.codexRuntime.description')}
    >
      <div className="space-y-3">
        <div className="space-y-2">
          {status.installations.map((installation) => {
            const isActive = installation.id === status.activeInstallationId;
            const check = checks[installation.id];
            const checked = check?.compatibility === 'compatible';
            const pathExpanded = expandedPathId === installation.id;
            const checkMessage = check
              ? checked
                ? t('agents.codexRuntime.checkPassed')
                : t('agents.codexRuntime.checkFailed', {
                    detail: check.detail || check.compatibility,
                  })
              : null;
            return (
              <div key={installation.id} className="min-w-0 rounded-md bg-muted/50 px-3 py-2">
                <div className="flex flex-wrap items-center gap-1.5 text-xs">
                  <span className="font-medium text-foreground">{installation.version}</span>
                  {isActive && (
                    <Badge variant="secondary">{t('agents.codexRuntime.active')}</Badge>
                  )}
                  {!isActive && <Badge variant="outline">{t('agents.codexRuntime.candidate')}</Badge>}
                  {installation.id === status.previousInstallationId && (
                    <Badge variant="outline">{t('agents.codexRuntime.previous')}</Badge>
                  )}
                  {installation.bundled && <Badge variant="outline">{t('agents.codexRuntime.bundled')}</Badge>}
                  {installation.id === status.liveProcessInstallationId && (
                    <Badge variant="outline">{t('agents.codexRuntime.live')}</Badge>
                  )}
                </div>
                <button
                  type="button"
                  className="mt-1 block max-w-full text-left font-mono text-xs text-muted-foreground"
                  title={installation.displayPath}
                  aria-expanded={pathExpanded}
                  onClick={() => setExpandedPathId(pathExpanded ? null : installation.id)}
                  onContextMenu={(event) => {
                    event.preventDefault();
                    setExpandedPathId(pathExpanded ? null : installation.id);
                  }}
                >
                  <span className={pathExpanded ? 'break-all' : 'block truncate'}>
                    {pathExpanded ? installation.displayPath : compactRuntimePath(installation.displayPath)}
                  </span>
                </button>

                {!isActive && (
                  <div className="mt-2 space-y-2">
                    {checkMessage && (
                      <div className={checked ? 'text-xs text-primary' : 'text-xs text-destructive'}>
                        {checkMessage}
                      </div>
                    )}
                    <div className="flex flex-wrap gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={busy !== null}
                        onClick={() => void runCheck(installation)}
                      >
                        {busy?.action === 'check' && busy.installationId === installation.id
                          ? t('agents.codexRuntime.checking')
                          : t('agents.codexRuntime.check')}
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        disabled={!checked || busy !== null}
                        onClick={() => void select(installation.id, 'use')}
                      >
                        {t('agents.codexRuntime.use')}
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <div className="text-xs text-muted-foreground">
          SDK {status.sdkVersion ?? t('agents.codexRuntime.unknown')} · {t('agents.codexRuntime.liveProcess')}{' '}
          {status.liveProcessVersion ?? t('agents.codexRuntime.none')}
          {status.updatePending ? ` · ${t('agents.codexRuntime.updatePending')}` : ''}
        </div>

        {failureMessage && (
          <div className="text-xs text-destructive">
            {failureMessage}
          </div>
        )}

        <div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={!status.previousInstallationId || busy !== null}
            onClick={() => status.previousInstallationId
              && void select(status.previousInstallationId, 'rollback')}
          >
            {t('agents.codexRuntime.rollback')}
          </Button>
        </div>
      </div>
    </SettingsRow>
  );
}
