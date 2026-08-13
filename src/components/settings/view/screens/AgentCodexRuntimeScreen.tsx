import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Badge, Button } from '../../../../shared/view/ui';
import { authenticatedFetch } from '../../../../utils/api';
import {
  type CodexTransportDiagnostics,
  type CodexTransportKind,
  type RuntimeCheck,
  type RuntimeInstallation,
  type RuntimeStatus,
  readRuntimeResponse,
  toRuntimeErrorMessage,
  useCodexRuntimeStatus,
  useCodexTransport,
} from '../../hooks/useCodexRuntime';
import SettingsRow from '../SettingsRow';
import { SettingsGroup, SettingsScreen } from '../primitives';

type BusyAction = {
  action: 'check' | 'use' | 'rollback';
  installationId: string;
};

/**
 * Middle segments carry no identity once the version and the binary name are
 * shown, and a full path wraps to four lines on a phone.
 */
const compactRuntimePath = (displayPath: string): string => {
  const normalized = displayPath.replace(/\\/g, '/');
  const binSuffix = normalized.match(/\/bin\/[^/]+$/)?.[0] ?? '';
  const marker = ['/standalone/releases/', '/node_modules/']
    .find((candidate) => normalized.includes(candidate));
  return marker && binSuffix ? `…${marker}…${binSuffix}` : displayPath;
};

/**
 * The runtime API speaks in enum values. Every one reaching the user is mapped
 * to a sentence here — nothing renders `check_failed` or `app-server` raw.
 */
const useRuntimeCopy = () => {
  const { t } = useTranslation('settings');

  const transportLabel = (transport: CodexTransportKind): string => (
    t(`agents.codexTransport.kinds.${transport}`)
  );

  const healthLabel = (health: CodexTransportDiagnostics['health']): string => (
    t(`agents.codexTransport.health.${health}`)
  );

  const checkMessage = (check: RuntimeCheck): string => (
    check.compatibility === 'compatible'
      ? t('agents.codexRuntime.checkPassed')
      : t('agents.codexRuntime.checkFailed', {
        detail: check.detail || t(`agents.codexRuntime.compatibility.${check.compatibility}`),
      })
  );

  return { t, transportLabel, healthLabel, checkMessage };
};

type InstallationRowProps = {
  installation: RuntimeInstallation;
  status: RuntimeStatus;
  check: RuntimeCheck | undefined;
  busy: BusyAction | null;
  pathExpanded: boolean;
  onTogglePath: () => void;
  onCheck: () => void;
  onSelect: (action: 'use' | 'rollback') => void;
};

/**
 * One installation, one state badge. Provenance ("bundled") and liveness are
 * sentences below the version rather than further badges, so the badge column
 * stays readable at a glance.
 */
function InstallationRow({
  installation,
  status,
  check,
  busy,
  pathExpanded,
  onTogglePath,
  onCheck,
  onSelect,
}: InstallationRowProps) {
  const { t, checkMessage } = useRuntimeCopy();
  const isActive = installation.id === status.activeInstallationId;
  const isPrevious = installation.id === status.previousInstallationId;
  const checked = check?.compatibility === 'compatible';
  const isBusy = busy !== null;
  const showPendingNote = isActive
    && status.updatePending
    && status.liveProcessInstallationId !== status.activeInstallationId;

  return (
    <div className="min-w-0 px-4 py-3.5">
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
          {installation.version}
        </span>
        {isActive && <Badge variant="secondary">{t('agents.codexRuntime.active')}</Badge>}
        {!isActive && isPrevious && (
          <Badge variant="outline">{t('agents.codexRuntime.previous')}</Badge>
        )}
      </div>

      {installation.bundled && (
        <div className="mt-0.5 text-xs text-muted-foreground">
          {t('agents.codexRuntime.bundledNote')}
        </div>
      )}

      <button
        type="button"
        className="mt-1 block max-w-full text-left font-mono text-xs text-muted-foreground hover:text-foreground"
        title={installation.displayPath}
        aria-expanded={pathExpanded}
        onClick={onTogglePath}
      >
        <span className={pathExpanded ? 'break-all' : 'block truncate'}>
          {pathExpanded ? installation.displayPath : compactRuntimePath(installation.displayPath)}
        </span>
      </button>

      {showPendingNote && (
        <div className="mt-1.5 text-xs text-muted-foreground">
          {t('agents.codexRuntime.pendingNote', {
            version: status.liveProcessVersion ?? t('agents.codexRuntime.unknown'),
          })}
        </div>
      )}

      {check && !isActive && (
        <div className={checked ? 'mt-2 text-xs text-primary' : 'mt-2 text-xs text-destructive'}>
          {checkMessage(check)}
        </div>
      )}

      {!isActive && (
        <div className="mt-2 flex flex-wrap gap-2">
          {isPrevious ? (
            <Button type="button" variant="outline" size="sm" disabled={isBusy} onClick={() => onSelect('rollback')}>
              {t('agents.codexRuntime.rollback')}
            </Button>
          ) : (
            <>
              <Button type="button" variant="outline" size="sm" disabled={isBusy} onClick={onCheck}>
                {busy?.action === 'check' && busy.installationId === installation.id
                  ? t('agents.codexRuntime.checking')
                  : t('agents.codexRuntime.check')}
              </Button>
              <Button type="button" size="sm" disabled={!checked || isBusy} onClick={() => onSelect('use')}>
                {t('agents.codexRuntime.use')}
              </Button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Codex's runtime and chat transport, off the provider screen.
 *
 * They were inline on the account card, where a five-badge installation list and
 * a permanently visible version footer sat above the rows a user actually came
 * for. Diagnostics belong one level down: the account card now shows only the
 * exception (`isTransportDegraded`), and everything else is here.
 */
export default function AgentCodexRuntimeScreen() {
  const { t, transportLabel, healthLabel } = useRuntimeCopy();
  const { status, error, setError, applyStatus } = useCodexRuntimeStatus(true);
  const transport = useCodexTransport(true);
  const [checks, setChecks] = useState<Record<string, RuntimeCheck>>({});
  const [busy, setBusy] = useState<BusyAction | null>(null);
  const [expandedPathId, setExpandedPathId] = useState<string | null>(null);

  const runCheck = async (installation: RuntimeInstallation) => {
    setBusy({ action: 'check', installationId: installation.id });
    setError(null);
    try {
      const response = await authenticatedFetch('/api/providers/codex/runtime/check', {
        method: 'POST',
        body: JSON.stringify({ installationId: installation.id }),
      });
      const result = await readRuntimeResponse<RuntimeCheck>(response);
      setChecks((current) => ({ ...current, [installation.id]: result }));
    } catch (checkError) {
      setError(toRuntimeErrorMessage(checkError));
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
      applyStatus(await readRuntimeResponse<RuntimeStatus>(response));
      setChecks({});
    } catch (selectionError) {
      setError(toRuntimeErrorMessage(selectionError));
    } finally {
      setBusy(null);
    }
  };

  if (!status) {
    return (
      <SettingsScreen>
        <SettingsGroup tone={error ? 'danger' : 'default'}>
          <div className={error ? 'px-4 py-3 text-sm text-destructive' : 'px-4 py-3 text-sm text-muted-foreground'}>
            {error ?? t('agents.codexRuntime.loading')}
          </div>
        </SettingsGroup>
      </SettingsScreen>
    );
  }

  const failureMessage = status.activeError || error;

  return (
    <SettingsScreen description={t('agents.codexRuntime.description')}>
      <SettingsGroup title={t('agents.codexRuntime.installationsTitle')} divided>
        {status.installations.map((installation) => (
          <InstallationRow
            key={installation.id}
            installation={installation}
            status={status}
            check={checks[installation.id]}
            busy={busy}
            pathExpanded={expandedPathId === installation.id}
            onTogglePath={() => setExpandedPathId(
              expandedPathId === installation.id ? null : installation.id,
            )}
            onCheck={() => void runCheck(installation)}
            onSelect={(action) => void select(installation.id, action)}
          />
        ))}
      </SettingsGroup>

      {failureMessage && (
        <SettingsGroup tone="danger">
          <div className="px-4 py-3 text-sm text-destructive">{failureMessage}</div>
        </SettingsGroup>
      )}

      <SettingsGroup title={t('agents.codexRuntime.diagnosticsTitle')} divided>
        {transport && (
          <SettingsRow
            label={t('agents.codexTransport.title')}
            description={t('agents.codexTransport.detail', {
              configured: transportLabel(transport.configured),
              health: healthLabel(transport.health),
            })}
          >
            <Badge
              variant="secondary"
              className={transport.actual === transport.configured
                ? 'bg-muted'
                : 'border-warning/40 bg-warning/10 text-warning'}
            >
              {transportLabel(transport.actual)}
            </Badge>
          </SettingsRow>
        )}

        <SettingsRow label={t('agents.codexRuntime.sdkVersion')}>
          <span className="text-sm text-muted-foreground">
            {status.sdkVersion ?? t('agents.codexRuntime.unknown')}
          </span>
        </SettingsRow>

        <SettingsRow
          label={t('agents.codexRuntime.liveProcess')}
          description={status.updatePending ? t('agents.codexRuntime.updatePending') : undefined}
        >
          <span className="text-sm text-muted-foreground">
            {status.liveProcessVersion ?? t('agents.codexRuntime.none')}
          </span>
        </SettingsRow>
      </SettingsGroup>
    </SettingsScreen>
  );
}
