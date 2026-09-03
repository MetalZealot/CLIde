import type { LLMProvider } from '@/shared/types.js';
import { AppError } from '@/shared/utils.js';

type ProviderServiceStatusState =
  | 'operational'
  | 'maintenance'
  | 'degraded'
  | 'partial_outage'
  | 'major_outage'
  | 'unavailable';

type ProviderServiceStatus = {
  provider: LLMProvider;
  state: ProviderServiceStatusState;
  statusPageUrl: string;
  checkedAt: string;
};

type StatusPageConfig = {
  summaryUrl: string;
  statusPageUrl: string;
  componentNames: string[];
};

type CachedStatus = {
  expiresAtMs: number;
  status: ProviderServiceStatus;
};

type ProviderServiceStatusDependencies = {
  fetch: typeof globalThis.fetch;
  now: () => number;
  timeoutMs: number;
  cacheTtlMs: number;
  unavailableCacheTtlMs: number;
};

const STATUS_PAGE_CONFIG: Partial<Record<LLMProvider, StatusPageConfig>> = {
  claude: {
    summaryUrl: 'https://status.claude.com/api/v2/summary.json',
    statusPageUrl: 'https://status.claude.com/',
    componentNames: ['Claude Code', 'Claude API (api.anthropic.com)'],
  },
  codex: {
    summaryUrl: 'https://status.openai.com/api/v2/summary.json',
    statusPageUrl: 'https://status.openai.com/',
    componentNames: ['Codex API'],
  },
};

/** Provider capabilities uses this to advertise the safe external destination. */
export function getProviderServiceStatusPageUrl(provider: LLMProvider): string | null {
  return STATUS_PAGE_CONFIG[provider]?.statusPageUrl ?? null;
}

const STATUS_SEVERITY: Record<Exclude<ProviderServiceStatusState, 'unavailable'>, number> = {
  operational: 0,
  maintenance: 1,
  degraded: 2,
  partial_outage: 3,
  major_outage: 4,
};

const normalizeComponentStatus = (
  value: unknown,
): Exclude<ProviderServiceStatusState, 'unavailable'> | null => {
  switch (value) {
    case 'operational':
      return 'operational';
    case 'under_maintenance':
      return 'maintenance';
    case 'degraded_performance':
      return 'degraded';
    case 'partial_outage':
      return 'partial_outage';
    case 'major_outage':
      return 'major_outage';
    default:
      return null;
  }
};

const readComponentStatuses = (
  payload: unknown,
  componentNames: string[],
): Array<Exclude<ProviderServiceStatusState, 'unavailable'>> | null => {
  if (!payload || typeof payload !== 'object') {
    return null;
  }

  const components = (payload as Record<string, unknown>).components;
  if (!Array.isArray(components)) {
    return null;
  }

  const statuses = componentNames.map((componentName) => {
    const component = components.find((candidate) => (
      candidate
      && typeof candidate === 'object'
      && (candidate as Record<string, unknown>).name === componentName
    ));
    return normalizeComponentStatus(
      component && typeof component === 'object'
        ? (component as Record<string, unknown>).status
        : null,
    );
  });

  return statuses.every((status) => status !== null)
    ? statuses as Array<Exclude<ProviderServiceStatusState, 'unavailable'>>
    : null;
};

const mostSevereStatus = (
  statuses: Array<Exclude<ProviderServiceStatusState, 'unavailable'>>,
): Exclude<ProviderServiceStatusState, 'unavailable'> => (
  statuses.reduce((current, candidate) => (
    STATUS_SEVERITY[candidate] > STATUS_SEVERITY[current] ? candidate : current
  ), 'operational')
);

/**
 * Factory used by the provider integration tests to inject deterministic HTTP
 * and clock behavior. The provider route consumes the singleton below.
 */
export function createProviderServiceStatusService(
  overrides: Partial<ProviderServiceStatusDependencies> = {},
) {
  const dependencies: ProviderServiceStatusDependencies = {
    fetch: globalThis.fetch,
    now: Date.now,
    timeoutMs: 3_000,
    cacheTtlMs: 60_000,
    unavailableCacheTtlMs: 10_000,
    ...overrides,
  };
  const cache = new Map<LLMProvider, CachedStatus>();
  const inFlight = new Map<LLMProvider, Promise<ProviderServiceStatus>>();

  const fetchProviderServiceStatus = async (
    provider: LLMProvider,
    config: StatusPageConfig,
  ): Promise<ProviderServiceStatus> => {
    const checkedAt = new Date(dependencies.now()).toISOString();

    try {
      const response = await dependencies.fetch(config.summaryUrl, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(dependencies.timeoutMs),
      });
      if (!response.ok) {
        throw new Error(`Status page returned HTTP ${response.status}`);
      }

      const statuses = readComponentStatuses(await response.json(), config.componentNames);
      if (!statuses) {
        throw new Error('Status page response did not include every required component');
      }

      return {
        provider,
        state: mostSevereStatus(statuses),
        statusPageUrl: config.statusPageUrl,
        checkedAt,
      };
    } catch {
      return {
        provider,
        state: 'unavailable',
        statusPageUrl: config.statusPageUrl,
        checkedAt,
      };
    }
  };

  return {
    async getProviderServiceStatus(provider: LLMProvider): Promise<ProviderServiceStatus> {
      const config = STATUS_PAGE_CONFIG[provider];
      if (!config) {
        throw new AppError(`Service status is unavailable for provider "${provider}".`, {
          code: 'PROVIDER_SERVICE_STATUS_UNSUPPORTED',
          statusCode: 400,
        });
      }

      const now = dependencies.now();
      const cached = cache.get(provider);
      if (cached && cached.expiresAtMs > now) {
        return cached.status;
      }

      const pending = inFlight.get(provider);
      if (pending) {
        return pending;
      }

      const request = fetchProviderServiceStatus(provider, config).then((status) => {
        cache.set(provider, {
          status,
          expiresAtMs: dependencies.now() + (
            status.state === 'unavailable'
              ? dependencies.unavailableCacheTtlMs
              : dependencies.cacheTtlMs
          ),
        });
        return status;
      });
      inFlight.set(provider, request);
      void request.finally(() => {
        if (inFlight.get(provider) === request) {
          inFlight.delete(provider);
        }
      });
      return request;
    },
  };
}

/** Provider route service for public Claude and Codex status-page readings. */
export const providerServiceStatusService = createProviderServiceStatusService();
