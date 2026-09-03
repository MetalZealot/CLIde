import {
  CircleCheck,
  CircleHelp,
  Clock3,
  ExternalLink,
  LoaderCircle,
  OctagonAlert,
  TriangleAlert,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { cn } from '../../../../../lib/utils';
import { authenticatedFetch } from '../../../../../utils/api';
import type { AgentProviderId } from '../../../registry/registry';

type ServiceStatusState =
  | 'checking'
  | 'operational'
  | 'maintenance'
  | 'degraded'
  | 'partial_outage'
  | 'major_outage'
  | 'unavailable';

type AgentServiceStatusRowProps = {
  provider: AgentProviderId;
  statusPageUrl: string;
};

type ServiceStatusApiResponse = {
  success?: boolean;
  data?: {
    state?: unknown;
  };
};

const POLL_INTERVAL_MS = 60_000;

const STATUS_STATES = new Set<ServiceStatusState>([
  'operational',
  'maintenance',
  'degraded',
  'partial_outage',
  'major_outage',
  'unavailable',
]);

const isServiceStatusState = (value: unknown): value is Exclude<ServiceStatusState, 'checking'> => (
  typeof value === 'string' && STATUS_STATES.has(value as ServiceStatusState)
);

const stateDetails = {
  checking: {
    icon: LoaderCircle,
    iconClassName: 'animate-spin text-muted-foreground',
    labelClassName: 'text-muted-foreground',
    rowClassName: 'hover:bg-accent/40',
  },
  operational: {
    icon: CircleCheck,
    iconClassName: 'text-primary',
    labelClassName: 'text-primary',
    rowClassName: 'hover:bg-accent/40',
  },
  maintenance: {
    icon: Clock3,
    iconClassName: 'text-warning',
    labelClassName: 'text-warning',
    rowClassName: 'bg-warning/10 hover:bg-warning/15',
  },
  degraded: {
    icon: TriangleAlert,
    iconClassName: 'text-warning',
    labelClassName: 'text-warning',
    rowClassName: 'bg-warning/10 hover:bg-warning/15',
  },
  partial_outage: {
    icon: TriangleAlert,
    iconClassName: 'text-warning',
    labelClassName: 'text-warning',
    rowClassName: 'bg-warning/10 hover:bg-warning/15',
  },
  major_outage: {
    icon: OctagonAlert,
    iconClassName: 'text-destructive',
    labelClassName: 'text-destructive',
    rowClassName: 'bg-destructive/10 hover:bg-destructive/15',
  },
  unavailable: {
    icon: CircleHelp,
    iconClassName: 'text-muted-foreground',
    labelClassName: 'text-muted-foreground',
    rowClassName: 'hover:bg-accent/40',
  },
} satisfies Record<ServiceStatusState, {
  icon: typeof CircleCheck;
  iconClassName: string;
  labelClassName: string;
  rowClassName: string;
}>;

/** Compact live provider-status row used inside the Agent account/runtime card. */
export default function AgentServiceStatusRow({
  provider,
  statusPageUrl,
}: AgentServiceStatusRowProps) {
  const { t } = useTranslation('settings');
  const [state, setState] = useState<ServiceStatusState>('checking');
  const details = stateDetails[state];
  const StatusIcon = details.icon;
  const providerName = t(`agents.providers.${provider}`);

  useEffect(() => {
    let cancelled = false;
    let activeRequest: AbortController | null = null;

    const load = async () => {
      activeRequest?.abort();
      const controller = new AbortController();
      activeRequest = controller;

      try {
        const response = await authenticatedFetch(`/api/providers/${provider}/service-status`, {
          signal: controller.signal,
        });
        const payload = (await response.json()) as ServiceStatusApiResponse;
        if (!response.ok || !payload.success || !isServiceStatusState(payload.data?.state)) {
          throw new Error('Invalid provider service status response');
        }
        if (!cancelled) {
          setState(payload.data.state);
        }
      } catch {
        if (!cancelled && !controller.signal.aborted) {
          setState('unavailable');
        }
      }
    };

    setState('checking');
    void load();
    const pollTimer = window.setInterval(() => void load(), POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(pollTimer);
      activeRequest?.abort();
    };
  }, [provider]);

  return (
    <a
      href={statusPageUrl}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={t('agents.serviceStatus.view', {
        defaultValue: 'View {{agent}} service status',
        agent: providerName,
      })}
      className={cn(
        'flex min-h-14 items-center gap-3 px-4 py-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
        details.rowClassName,
      )}
    >
      <StatusIcon className={cn('h-4.5 w-4.5 flex-shrink-0', details.iconClassName)} />
      <span className="min-w-0 flex-1 text-sm font-medium text-foreground">
        {t('agents.serviceStatus.label', { defaultValue: 'Service status' })}
      </span>
      <span className={cn('whitespace-nowrap text-sm font-medium', details.labelClassName)}>
        {t(`agents.serviceStatus.states.${state}`, {
          defaultValue: state === 'partial_outage'
            ? 'Partial outage'
            : state === 'major_outage'
              ? 'Major outage'
              : state === 'checking'
                ? 'Checking…'
                : state.charAt(0).toUpperCase() + state.slice(1),
        })}
      </span>
      <ExternalLink className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
    </a>
  );
}
