import { useEffect, useMemo, useState } from 'react';
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

export default function CodexNativeRuntimeRow() {
  const { t } = useTranslation('settings');
  const [status, setStatus] = useState<RuntimeStatus | null>(null);
  const [check, setCheck] = useState<RuntimeCheck | null>(null);
  const [busy, setBusy] = useState<'check' | 'use' | 'rollback' | null>(null);
  const [error, setError] = useState<string | null>(null);

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

  const candidate = useMemo(() => status?.installations.find((installation) => (
    installation.id !== status.activeInstallationId && !installation.bundled
  )) ?? status?.installations.find((installation) => (
    installation.id !== status.activeInstallationId
  )) ?? null, [status]);

  const runCheck = async () => {
    if (!candidate) return;
    setBusy('check');
    setError(null);
    try {
      const response = await authenticatedFetch('/api/providers/codex/runtime/check', {
        method: 'POST',
        body: JSON.stringify({ installationId: candidate.id }),
      });
      setCheck(await readResponse<RuntimeCheck>(response));
    } catch (checkError) {
      setError(checkError instanceof Error ? checkError.message : String(checkError));
    } finally {
      setBusy(null);
    }
  };

  const select = async (installationId: string, action: 'use' | 'rollback') => {
    setBusy(action);
    setError(null);
    try {
      const response = await authenticatedFetch('/api/providers/codex/runtime/selection', {
        method: 'PUT',
        body: JSON.stringify({ installationId }),
      });
      setStatus(await readResponse<RuntimeStatus>(response));
      setCheck(null);
    } catch (selectionError) {
      setError(selectionError instanceof Error ? selectionError.message : String(selectionError));
    } finally {
      setBusy(null);
    }
  };

  if (!status) {
    return error ? <div className="px-4 py-3 text-xs text-destructive">{error}</div> : null;
  }

  const checkedCandidate = Boolean(
    candidate
    && check?.installationId === candidate.id
    && check.compatibility === 'compatible',
  );
  const checkMessage = check
    ? check.compatibility === 'compatible'
      ? t('agents.codexRuntime.checkPassed')
      : t('agents.codexRuntime.checkFailed', {
          detail: check.detail || check.compatibility,
        })
    : null;
  const failureMessage = status.activeError || error
    || (check?.compatibility !== 'compatible' ? checkMessage : null);

  return (
    <SettingsRow
      stacked
      label={t('agents.codexRuntime.title')}
      description={t('agents.codexRuntime.description')}
    >
      <div className="space-y-3">
        <div className="space-y-2">
          {status.installations.map((installation) => {
            const isCandidate = candidate?.id === installation.id;
            return (
              <div key={installation.id} className="min-w-0 rounded-md bg-muted/50 px-3 py-2">
                <div className="flex flex-wrap items-center gap-1.5 text-xs">
                  <span className="font-medium text-foreground">{installation.version}</span>
                  {installation.id === status.activeInstallationId && (
                    <Badge variant="secondary">{t('agents.codexRuntime.active')}</Badge>
                  )}
                  {isCandidate && <Badge variant="outline">{t('agents.codexRuntime.candidate')}</Badge>}
                  {installation.id === status.previousInstallationId && (
                    <Badge variant="outline">{t('agents.codexRuntime.previous')}</Badge>
                  )}
                  {installation.bundled && <Badge variant="outline">{t('agents.codexRuntime.bundled')}</Badge>}
                  {installation.id === status.liveProcessInstallationId && (
                    <Badge variant="outline">{t('agents.codexRuntime.live')}</Badge>
                  )}
                </div>
                <div className="mt-1 break-all font-mono text-xs text-muted-foreground">
                  {installation.displayPath}
                </div>
              </div>
            );
          })}
        </div>

        <div className="text-xs text-muted-foreground">
          SDK {status.sdkVersion ?? t('agents.codexRuntime.unknown')} · {t('agents.codexRuntime.liveProcess')}{' '}
          {status.liveProcessVersion ?? t('agents.codexRuntime.none')}
          {status.updatePending ? ` · ${t('agents.codexRuntime.updatePending')}` : ''}
        </div>

        {(failureMessage || checkMessage) && (
          <div className={failureMessage ? 'text-xs text-destructive' : 'text-xs text-primary'}>
            {failureMessage || checkMessage}
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" size="sm" disabled={!candidate || busy !== null} onClick={runCheck}>
            {busy === 'check' ? t('agents.codexRuntime.checking') : t('agents.codexRuntime.check')}
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={!candidate || !checkedCandidate || busy !== null}
            onClick={() => candidate && void select(candidate.id, 'use')}
          >
            {t('agents.codexRuntime.use')}
          </Button>
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
