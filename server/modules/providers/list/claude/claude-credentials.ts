import { readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { readObjectRecord, readOptionalString } from '@/shared/utils.js';

export type ClaudeOAuthCredentials =
  | { status: 'ok'; accessToken: string; email: string | null }
  | { status: 'stale'; accessToken: string; email: string | null }
  | { status: 'expired' }
  | { status: 'missing' }
  | { status: 'unreadable'; reason: 'parse' | 'io' };

const hasErrorCode = (error: unknown, code: string): boolean => (
  error instanceof Error && 'code' in error && error.code === code
);

/**
 * Reads Claude settings env values that the CLI can use even when the server process env is empty.
 */
export const loadClaudeSettingsEnv = async (): Promise<Record<string, unknown>> => {
  try {
    const settingsPath = path.join(os.homedir(), '.claude', 'settings.json');
    const content = await readFile(settingsPath, 'utf8');
    const settings = readObjectRecord(JSON.parse(content));
    return readObjectRecord(settings?.env) ?? {};
  } catch {
    return {};
  }
};

/**
 * Returns whether Claude auth resolves to an API key/auth token, which takes
 * priority over the OAuth credentials file in Claude Code's auth order.
 */
export const hasClaudeApiKeyAuth = async (): Promise<boolean> => {
  if (process.env.ANTHROPIC_AUTH_TOKEN?.trim() || process.env.ANTHROPIC_API_KEY?.trim()) {
    return true;
  }

  const settingsEnv = await loadClaudeSettingsEnv();
  return Boolean(
    readOptionalString(settingsEnv.ANTHROPIC_API_KEY)
    || readOptionalString(settingsEnv.ANTHROPIC_AUTH_TOKEN),
  );
};

/**
 * Reads the OAuth access token from `~/.claude/.credentials.json`.
 *
 * The token never leaves the server process; callers use it for status checks
 * and first-party API calls only.
 *
 * Access tokens last ~8 hours, but Claude Code silently renews them from the
 * refresh token (valid for weeks) on the next turn. An expired access token
 * with a live refresh token is therefore `stale`, not a logged-out account:
 * first-party API calls will 401 until something refreshes it, yet the login
 * itself is intact. Only a missing/expired refresh token means `expired`.
 */
export const readClaudeOAuthCredentials = async (): Promise<ClaudeOAuthCredentials> => {
  try {
    const credPath = path.join(os.homedir(), '.claude', '.credentials.json');
    const content = await readFile(credPath, 'utf8');
    const creds = readObjectRecord(JSON.parse(content)) ?? {};
    const oauth = readObjectRecord(creds.claudeAiOauth);
    const accessToken = readOptionalString(oauth?.accessToken);

    if (!accessToken) {
      return { status: 'missing' };
    }

    const email = readOptionalString(creds.email) ?? readOptionalString(creds.user) ?? null;

    const expiresAt = typeof oauth?.expiresAt === 'number' ? oauth.expiresAt : undefined;
    if (expiresAt && Date.now() >= expiresAt) {
      const refreshTokenExpiresAt = typeof oauth?.refreshTokenExpiresAt === 'number'
        ? oauth.refreshTokenExpiresAt
        : undefined;
      const refreshable = Boolean(readOptionalString(oauth?.refreshToken))
        && (refreshTokenExpiresAt === undefined || Date.now() < refreshTokenExpiresAt);

      return refreshable ? { status: 'stale', accessToken, email } : { status: 'expired' };
    }

    return { status: 'ok', accessToken, email };
  } catch (error) {
    if (hasErrorCode(error, 'ENOENT')) {
      return { status: 'missing' };
    }

    return { status: 'unreadable', reason: error instanceof SyntaxError ? 'parse' : 'io' };
  }
};
