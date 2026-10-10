/**
 * Remembers what a client request id produced, so a retried request (a resend
 * after a reconnect, a second tap on Retry) returns that result instead of
 * acting twice. In memory only: a server restart forgets every receipt.
 */

const REQUEST_ID_PATTERN = /^[A-Za-z0-9_-]{8,128}$/;

/** A client-minted request id, or null when absent or malformed. */
export function readRequestId(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  return REQUEST_ID_PATTERN.test(trimmed) ? trimmed : null;
}

export type RequestReceipts<T> = {
  get(key: string): T | undefined;
  set(key: string, value: T): void;
  clear(): void;
};

export function createRequestReceipts<T>({
  ttlMs,
  maxEntries,
  now = () => Date.now(),
}: {
  ttlMs: number;
  maxEntries: number;
  now?: () => number;
}): RequestReceipts<T> {
  // Insertion order is age order, so expiry and the size cap both trim from the front.
  const entries = new Map<string, { value: T; at: number }>();

  const prune = () => {
    const cutoff = now() - ttlMs;
    for (const [key, entry] of entries) {
      if (entry.at > cutoff && entries.size <= maxEntries) break;
      entries.delete(key);
    }
  };

  return {
    get(key) {
      prune();
      return entries.get(key)?.value;
    },
    set(key, value) {
      entries.delete(key);
      entries.set(key, { value, at: now() });
      prune();
    },
    clear() {
      entries.clear();
    },
  };
}
