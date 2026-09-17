import { authenticatedFetch } from './api';

/** Mirrors the server default; used only when the setting cannot be read. */
export const DEFAULT_AUTO_CONTINUE_MESSAGE = 'Continue';

export const MAX_AUTO_CONTINUE_MESSAGE_LENGTH = 2000;

const ENDPOINT = '/api/scheduled-messages/auto-continue-message';

/**
 * What an Auto-Continue send should say. Read at the moment it is needed, so
 * an edit on another device takes effect without a reload; an unreachable
 * server falls back to the default rather than scheduling an empty turn.
 */
export async function fetchAutoContinueMessage(): Promise<string> {
  try {
    const response = await authenticatedFetch(ENDPOINT);
    if (!response.ok) return DEFAULT_AUTO_CONTINUE_MESSAGE;
    const data = await response.json() as { message?: string };
    return data.message?.trim() || DEFAULT_AUTO_CONTINUE_MESSAGE;
  } catch {
    return DEFAULT_AUTO_CONTINUE_MESSAGE;
  }
}

/** Saves the message, returning what a send would now use, or null on failure. */
export async function saveAutoContinueMessage(message: string): Promise<string | null> {
  try {
    const response = await authenticatedFetch(ENDPOINT, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message }),
    });
    if (!response.ok) return null;
    const data = await response.json() as { message?: string };
    return data.message ?? DEFAULT_AUTO_CONTINUE_MESSAGE;
  } catch {
    return null;
  }
}
