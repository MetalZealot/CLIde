import type { ApiErrorPayload } from './types';

export async function parseJsonSafely<T>(response: Response): Promise<T | null> {
  try {
    return (await response.json()) as T;
  } catch {
    return null;
  }
}

/**
 * The server's human-readable message from a failed response body, or null.
 * Accepts `error: 'message'`, the AppError envelope `error: { code, message }`,
 * and a top-level `message`; anything but a non-blank string is skipped, since
 * an object rendered as a React child unmounts the whole app.
 */
export function readApiErrorMessage(body: unknown): string | null {
  if (!body || typeof body !== 'object') {
    return null;
  }

  const { error, message } = body as { error?: unknown; message?: unknown };
  const candidates = [
    error && typeof error === 'object' ? (error as { message?: unknown }).message : error,
    message,
  ];
  const readable = candidates.find(
    (candidate): candidate is string => typeof candidate === 'string' && candidate.trim() !== '',
  );
  return readable ?? null;
}

export function resolveApiErrorMessage(payload: ApiErrorPayload | null, fallback: string): string {
  return readApiErrorMessage(payload) ?? fallback;
}
