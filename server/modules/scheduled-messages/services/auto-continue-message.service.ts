/**
 * The message Auto-Continue sends when usage resets.
 *
 * Stored server-side so a standing per-session mode can read it with no
 * browser open; a blank stored value means "use the default" rather than
 * sending an empty turn.
 */

import { appConfigDb } from '@/modules/database/index.js';

const CONFIG_KEY = 'auto_continue_message';

export const DEFAULT_AUTO_CONTINUE_MESSAGE = 'Continue';

/** A prompt, not a document: long enough for a paragraph of instructions. */
export const MAX_AUTO_CONTINUE_MESSAGE_LENGTH = 2000;

export function readAutoContinueMessage(): string {
  return appConfigDb.get(CONFIG_KEY)?.trim() || DEFAULT_AUTO_CONTINUE_MESSAGE;
}

/**
 * Stores a new message, returning what a send would now use. Blank clears the
 * override, so emptying the field in Settings restores the default.
 */
export function writeAutoContinueMessage(value: string): string {
  appConfigDb.set(CONFIG_KEY, value.trim());
  return readAutoContinueMessage();
}
