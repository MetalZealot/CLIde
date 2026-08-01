export type ResumeProbe = 'auth' | 'ws';
export type ResumeProbeMode = 'all' | 'none' | ResumeProbe;

export type LifecycleDiagnosticDetails = Record<
  string,
  string | number | boolean | null | undefined
>;

export type LifecycleDiagnosticEvent = {
  sequence: number;
  timestamp: string;
  elapsedMs: number;
  bootId: string;
  name: string;
  details?: LifecycleDiagnosticDetails;
};

type StoredLifecycleDiagnostics = {
  version: 1;
  events: LifecycleDiagnosticEvent[];
};

const ENABLED_STORAGE_KEY = 'clide:lifecycle-debug:enabled';
const EVENTS_STORAGE_KEY = 'clide:lifecycle-debug:events:v1';
const RESUME_PROBE_STORAGE_KEY = 'clide:lifecycle-debug:resume-probes';
const PENDING_PICKER_STORAGE_KEY = 'clide:lifecycle-debug:pending-picker:v1';
const MAX_EVENTS = 240;
export const LIFECYCLE_DIAGNOSTIC_EVENT = 'clide:lifecycle-diagnostic';

const startedAt = typeof performance !== 'undefined' ? performance.now() : 0;
const bootId = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
  ? crypto.randomUUID()
  : `${Date.now()}-${Math.random().toString(16).slice(2)}`;

let initialized = false;
let peerChannel: BroadcastChannel | null = null;

type PendingPicker = {
  bootId: string;
  openedAt: string;
  interaction: string;
};

const getStorage = (): Storage | null => {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
};

const readStoredEvents = (storage: Storage): LifecycleDiagnosticEvent[] => {
  try {
    const parsed = JSON.parse(storage.getItem(EVENTS_STORAGE_KEY) ?? '') as StoredLifecycleDiagnostics;
    return parsed?.version === 1 && Array.isArray(parsed.events) ? parsed.events : [];
  } catch {
    return [];
  }
};

const readPendingPicker = (storage: Storage): PendingPicker | null => {
  try {
    const parsed = JSON.parse(storage.getItem(PENDING_PICKER_STORAGE_KEY) ?? '') as PendingPicker;
    return typeof parsed?.bootId === 'string'
      && typeof parsed.openedAt === 'string'
      && typeof parsed.interaction === 'string'
      ? parsed
      : null;
  } catch {
    return null;
  }
};

export const appendLifecycleDiagnosticEvent = (
  events: LifecycleDiagnosticEvent[],
  event: LifecycleDiagnosticEvent,
  limit = MAX_EVENTS,
): LifecycleDiagnosticEvent[] => [...events, event].slice(-Math.max(1, limit));

export const normalizeResumeProbeMode = (value: string | null): ResumeProbeMode => {
  return value === 'none' || value === 'auth' || value === 'ws' ? value : 'all';
};

const routeShape = () => {
  if (typeof window === 'undefined') return 'unknown';
  return window.location.pathname.startsWith('/session/')
    ? '/session/:sessionId'
    : window.location.pathname;
};

const setConfigFromQuery = () => {
  if (typeof window === 'undefined') return;
  const storage = getStorage();
  if (!storage) return;

  const params = new URLSearchParams(window.location.search);
  const enabled = params.get('clideDebug');
  if (enabled === '1') {
    storage.setItem(ENABLED_STORAGE_KEY, '1');
  } else if (enabled === '0') {
    storage.removeItem(ENABLED_STORAGE_KEY);
  }

  if (params.has('resumeProbes')) {
    storage.setItem(
      RESUME_PROBE_STORAGE_KEY,
      normalizeResumeProbeMode(params.get('resumeProbes')),
    );
  }
};

export const isLifecycleDiagnosticsEnabled = () => {
  const storage = getStorage();
  return storage?.getItem(ENABLED_STORAGE_KEY) === '1';
};

export const getResumeProbeMode = (): ResumeProbeMode => {
  const storage = getStorage();
  return normalizeResumeProbeMode(storage?.getItem(RESUME_PROBE_STORAGE_KEY) ?? null);
};

export const isResumeProbeEnabled = (probe: ResumeProbe) => {
  const mode = getResumeProbeMode();
  return mode === 'all' || mode === probe;
};

export const getLifecycleDiagnostics = (): LifecycleDiagnosticEvent[] => {
  const storage = getStorage();
  return storage ? readStoredEvents(storage) : [];
};

export const clearLifecycleDiagnostics = () => {
  const storage = getStorage();
  if (!storage) return;
  storage.removeItem(EVENTS_STORAGE_KEY);
  storage.removeItem(PENDING_PICKER_STORAGE_KEY);
  window.dispatchEvent(new Event(LIFECYCLE_DIAGNOSTIC_EVENT));
};

export const beginFilePickerDiagnostic = (interaction: 'pointer' | 'keyboard') => {
  if (!isLifecycleDiagnosticsEnabled()) return;
  const storage = getStorage();
  if (!storage) return;

  const pending: PendingPicker = {
    bootId,
    openedAt: new Date().toISOString(),
    interaction,
  };
  storage.setItem(PENDING_PICKER_STORAGE_KEY, JSON.stringify(pending));
  recordLifecycleDiagnostic('picker.open', { interaction });
};

export const finishFilePickerDiagnostic = (
  outcome: 'change' | 'cancel',
  details?: LifecycleDiagnosticDetails,
) => {
  if (!isLifecycleDiagnosticsEnabled()) return;
  const storage = getStorage();
  if (!storage) return;

  recordLifecycleDiagnostic(`picker.${outcome}`, details);
  storage.removeItem(PENDING_PICKER_STORAGE_KEY);
};

export const recordLifecycleDiagnostic = (
  name: string,
  details?: LifecycleDiagnosticDetails,
) => {
  if (!isLifecycleDiagnosticsEnabled()) return;
  const storage = getStorage();
  if (!storage) return;

  try {
    const previous = readStoredEvents(storage);
    const event: LifecycleDiagnosticEvent = {
      sequence: (previous.at(-1)?.sequence ?? 0) + 1,
      timestamp: new Date().toISOString(),
      elapsedMs: Math.round(
        typeof performance !== 'undefined' ? performance.now() - startedAt : 0,
      ),
      bootId,
      name,
      ...(details ? { details } : {}),
    };
    const stored: StoredLifecycleDiagnostics = {
      version: 1,
      events: appendLifecycleDiagnosticEvent(previous, event),
    };
    storage.setItem(EVENTS_STORAGE_KEY, JSON.stringify(stored));
    window.dispatchEvent(new Event(LIFECYCLE_DIAGNOSTIC_EVENT));
  } catch {
    // Diagnostics must never change application behavior.
  }
};

const serviceWorkerState = (registration?: ServiceWorkerRegistration) => ({
  controller: navigator.serviceWorker.controller?.scriptURL ?? null,
  active: registration?.active?.scriptURL ?? null,
  activeState: registration?.active?.state ?? null,
  waiting: registration?.waiting?.scriptURL ?? null,
  installing: registration?.installing?.scriptURL ?? null,
});

const runtimeState = () => {
  const memory = performance as Performance & {
    memory?: {
      usedJSHeapSize?: number;
      totalJSHeapSize?: number;
      jsHeapSizeLimit?: number;
    };
  };
  const navigatorWithMemory = navigator as Navigator & { deviceMemory?: number };
  const toMegabytes = (bytes?: number) => typeof bytes === 'number'
    ? Math.round((bytes / 1024 / 1024) * 10) / 10
    : null;

  return {
    deviceMemoryGiB: navigatorWithMemory.deviceMemory ?? null,
    usedJsHeapMb: toMegabytes(memory.memory?.usedJSHeapSize),
    totalJsHeapMb: toMegabytes(memory.memory?.totalJSHeapSize),
    jsHeapLimitMb: toMegabytes(memory.memory?.jsHeapSizeLimit),
  };
};

export const recordServiceWorkerRegistration = (
  registration: ServiceWorkerRegistration,
  source: 'main' | 'ready',
) => {
  recordLifecycleDiagnostic('service-worker.registration', {
    source,
    scope: registration.scope,
    ...serviceWorkerState(registration),
  });
};

export const initializeLifecycleDiagnostics = () => {
  if (initialized || typeof window === 'undefined' || typeof document === 'undefined') return;
  initialized = true;
  setConfigFromQuery();
  if (!isLifecycleDiagnosticsEnabled()) return;

  const navigation = performance.getEntriesByType('navigation')[0] as
    | PerformanceNavigationTiming
    | undefined;
  const moduleAsset = document.querySelector<HTMLScriptElement>('script[type="module"][src]')?.src;
  const standalone = window.matchMedia?.('(display-mode: standalone)').matches
    || Boolean((navigator as Navigator & { standalone?: boolean }).standalone);
  const documentWithDiscardState = document as Document & { wasDiscarded?: boolean };
  const storage = getStorage();
  const pendingPicker = storage ? readPendingPicker(storage) : null;

  recordLifecycleDiagnostic('boot', {
    navigationType: navigation?.type ?? 'unknown',
    route: routeShape(),
    visibility: document.visibilityState,
    standalone,
    moduleAsset: moduleAsset ?? null,
    userAgent: navigator.userAgent,
    resumeProbes: getResumeProbeMode(),
    wasDiscarded: Boolean(documentWithDiscardState.wasDiscarded),
    pendingPickerBootId: pendingPicker?.bootId ?? null,
    pendingPickerOpenedAt: pendingPicker?.openedAt ?? null,
    pendingPickerInteraction: pendingPicker?.interaction ?? null,
    ...runtimeState(),
  });

  if (typeof BroadcastChannel === 'function') {
    peerChannel = new BroadcastChannel('clide:lifecycle-debug:peers:v1');
    peerChannel.addEventListener('message', (event: MessageEvent) => {
      const message = event.data as {
        type?: unknown;
        bootId?: unknown;
        visibility?: unknown;
        standalone?: unknown;
      };
      if (message?.bootId === bootId || typeof message?.bootId !== 'string') return;
      if (message.type !== 'hello' && message.type !== 'present') return;

      recordLifecycleDiagnostic('page.peer-detected', {
        peerBootId: message.bootId,
        peerVisibility: typeof message.visibility === 'string' ? message.visibility : 'unknown',
        peerStandalone: Boolean(message.standalone),
        signal: message.type,
      });

      if (message.type === 'hello') {
        peerChannel?.postMessage({
          type: 'present',
          bootId,
          visibility: document.visibilityState,
          standalone,
        });
      }
    });
    peerChannel.postMessage({
      type: 'hello',
      bootId,
      visibility: document.visibilityState,
      standalone,
    });
  }

  let hiddenAt: number | null = null;
  const recordVisibility = () => {
    const now = performance.now();
    const hiddenDurationMs = document.visibilityState === 'visible' && hiddenAt !== null
      ? Math.round(now - hiddenAt)
      : null;
    if (document.visibilityState === 'hidden') {
      hiddenAt = now;
    }
    recordLifecycleDiagnostic('page.visibility', {
      state: document.visibilityState,
      hiddenDurationMs,
      ...runtimeState(),
    });
  };
  const recordPageShow = (event: PageTransitionEvent) => recordLifecycleDiagnostic('page.show', {
    persisted: event.persisted,
  });
  const recordPageHide = (event: PageTransitionEvent) => recordLifecycleDiagnostic('page.hide', {
    persisted: event.persisted,
  });
  const recordFreeze = () => recordLifecycleDiagnostic('page.freeze');
  const recordResume = () => recordLifecycleDiagnostic('page.resume');
  const recordFocus = () => recordLifecycleDiagnostic('page.focus', runtimeState());
  const recordBlur = () => recordLifecycleDiagnostic('page.blur', runtimeState());
  const recordError = (event: ErrorEvent) => recordLifecycleDiagnostic('page.error', {
    message: event.message || 'unknown error',
  });
  const recordRejection = (event: PromiseRejectionEvent) => recordLifecycleDiagnostic(
    'page.unhandled-rejection',
    { reason: event.reason instanceof Error ? event.reason.message : String(event.reason) },
  );

  document.addEventListener('visibilitychange', recordVisibility);
  window.addEventListener('pageshow', recordPageShow);
  window.addEventListener('pagehide', recordPageHide);
  document.addEventListener('freeze', recordFreeze);
  document.addEventListener('resume', recordResume);
  window.addEventListener('focus', recordFocus);
  window.addEventListener('blur', recordBlur);
  window.addEventListener('error', recordError);
  window.addEventListener('unhandledrejection', recordRejection);

  if ('serviceWorker' in navigator) {
    recordLifecycleDiagnostic('service-worker.controller', serviceWorkerState());
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      recordLifecycleDiagnostic('service-worker.controller-change', serviceWorkerState());
    });
    void navigator.serviceWorker.ready
      .then((registration) => {
        recordServiceWorkerRegistration(registration, 'ready');
      })
      .catch(() => {
        // Registration failures are captured by the caller in main.jsx.
      });
    void navigator.serviceWorker.getRegistrations()
      .then((registrations) => {
        recordLifecycleDiagnostic('service-worker.registrations', {
          count: registrations.length,
          scopes: registrations.map((registration) => registration.scope).join(','),
        });
      })
      .catch(() => {
        // Diagnostics must not add a new unhandled rejection.
      });
  }
};

export const getLifecycleBootId = () => bootId;
