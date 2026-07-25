import type {
  InteractiveRequestResponse,
  PendingInteractiveRequest,
} from '@/shared/types.js';

type SettlementReason = 'response' | 'timeout' | 'cancelled' | 'server_resolved';

type PendingEntry = {
  request: PendingInteractiveRequest;
  resolving: boolean;
  timeout?: NodeJS.Timeout;
  signal?: AbortSignal;
  abortHandler?: () => void;
  onResponse: (response: InteractiveRequestResponse) => void | Promise<void>;
  onTimeout?: () => void | Promise<void>;
  onCancel?: (reason: SettlementReason) => void | Promise<void>;
  onSettled?: (reason: SettlementReason) => void | Promise<void>;
};

export type RegisterInteractiveRequestOptions = {
  timeoutMs?: number;
  signal?: AbortSignal;
  onResponse: PendingEntry['onResponse'];
  onTimeout?: PendingEntry['onTimeout'];
  onCancel?: PendingEntry['onCancel'];
  onSettled?: PendingEntry['onSettled'];
};

export type ResolveInteractiveRequestResult =
  | { status: 'resolved'; request: PendingInteractiveRequest }
  | { status: 'not_found' }
  | { status: 'invalid'; error: string };

const pending = new Map<string, PendingEntry>();

function removeEntry(requestId: string): PendingEntry | null {
  const entry = pending.get(requestId);
  if (!entry) {
    return null;
  }

  pending.delete(requestId);
  if (entry.timeout) {
    clearTimeout(entry.timeout);
  }
  if (entry.signal && entry.abortHandler) {
    entry.signal.removeEventListener('abort', entry.abortHandler);
  }
  return entry;
}

async function settle(
  requestId: string,
  reason: SettlementReason,
  action?: (entry: PendingEntry) => void | Promise<void>,
): Promise<boolean> {
  const entry = removeEntry(requestId);
  if (!entry) {
    return false;
  }

  await action?.(entry);
  await entry.onSettled?.(reason);
  return true;
}

/**
 * Shared in-memory lifecycle for Claude tool callbacks and Codex App Server
 * requests. It owns reconnect replay, timeout, abort cancellation, duplicate
 * response rejection, and server-side resolution.
 */
export const interactiveRequestRegistry = {
  register(
    request: PendingInteractiveRequest,
    options: RegisterInteractiveRequestOptions,
  ): void {
    if (!request.requestId || pending.has(request.requestId)) {
      throw new Error(`Interactive request "${request.requestId}" is already pending.`);
    }

    const entry: PendingEntry = {
      request,
      resolving: false,
      signal: options.signal,
      onResponse: options.onResponse,
      onTimeout: options.onTimeout,
      onCancel: options.onCancel,
      onSettled: options.onSettled,
    };
    pending.set(request.requestId, entry);

    if (options.timeoutMs && options.timeoutMs > 0) {
      entry.timeout = setTimeout(() => {
        void settle(request.requestId, 'timeout', async (current) => {
          await current.onTimeout?.();
        }).catch((error) => {
          console.error('[InteractiveRequests] Timeout handler failed:', error);
        });
      }, options.timeoutMs);
      entry.timeout.unref?.();
    }

    if (options.signal) {
      entry.abortHandler = () => {
        void settle(request.requestId, 'cancelled', async (current) => {
          await current.onCancel?.('cancelled');
        }).catch((error) => {
          console.error('[InteractiveRequests] Cancellation handler failed:', error);
        });
      };
      if (options.signal.aborted) {
        entry.abortHandler();
      } else {
        options.signal.addEventListener('abort', entry.abortHandler, { once: true });
      }
    }
  },

  async resolve(
    requestId: string,
    response: InteractiveRequestResponse,
  ): Promise<ResolveInteractiveRequestResult> {
    const entry = pending.get(requestId);
    if (!entry) {
      return { status: 'not_found' };
    }
    if (entry.resolving) {
      return { status: 'not_found' };
    }
    entry.resolving = true;

    try {
      await entry.onResponse(response);
    } catch (error) {
      entry.resolving = false;
      return {
        status: 'invalid',
        error: error instanceof Error ? error.message : String(error),
      };
    }

    await settle(requestId, 'response');
    return { status: 'resolved', request: entry.request };
  },

  async markServerResolved(requestId: string): Promise<boolean> {
    return settle(requestId, 'server_resolved');
  },

  async cancelForSession(sessionId: string): Promise<void> {
    const ids = Array.from(pending.values())
      .filter((entry) => entry.request.sessionId === sessionId)
      .map((entry) => entry.request.requestId);

    await Promise.all(ids.map((id) =>
      settle(id, 'cancelled', async (entry) => {
        await entry.onCancel?.('cancelled');
      }),
    ));
  },

  getPendingForSession(sessionId: string): PendingInteractiveRequest[] {
    return Array.from(pending.values())
      .map((entry) => entry.request)
      .filter((request) => request.sessionId === sessionId);
  },

  get(requestId: string): PendingInteractiveRequest | null {
    return pending.get(requestId)?.request ?? null;
  },

  clearForTests(): void {
    for (const requestId of pending.keys()) {
      removeEntry(requestId);
    }
  },
};
