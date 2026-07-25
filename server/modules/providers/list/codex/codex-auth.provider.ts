import { readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import spawn from 'cross-spawn';

import type { IProviderAuth } from '@/shared/interfaces.js';
import type { ProviderAuthStatus } from '@/shared/types.js';
import { readObjectRecord, readOptionalString } from '@/shared/utils.js';

export type CodexCredentialsStatus = {
  authenticated: boolean;
  email: string | null;
  method: string | null;
  error?: string;
};

/**
 * Extracts the user email from a Codex id_token when a readable JWT payload exists.
 */
const readEmailFromIdToken = (idToken: string): string => {
  try {
    const parts = idToken.split('.');
    if (parts.length >= 2) {
      const payload = readObjectRecord(JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')));
      return readOptionalString(payload?.email) ?? readOptionalString(payload?.user) ?? 'Authenticated';
    }
  } catch {
    // Fall back to a generic authenticated marker if the token payload is not readable.
  }

  return 'Authenticated';
};

/**
 * Reads Codex auth.json and checks OAuth tokens or an API key fallback.
 *
 * Kept as a shared read-only helper so account-level provider features can
 * classify auth without copying credential parsing or invoking the CLI.
 */
export const readCodexCredentialsStatus = async (): Promise<CodexCredentialsStatus> => {
  try {
    const authPath = path.join(os.homedir(), '.codex', 'auth.json');
    const content = await readFile(authPath, 'utf8');
    const auth = readObjectRecord(JSON.parse(content)) ?? {};
    const tokens = readObjectRecord(auth.tokens) ?? {};
    const idToken = readOptionalString(tokens.id_token);
    const accessToken = readOptionalString(tokens.access_token);

    if (idToken || accessToken) {
      return {
        authenticated: true,
        email: idToken ? readEmailFromIdToken(idToken) : 'Authenticated',
        method: 'credentials_file',
      };
    }

    if (readOptionalString(auth.OPENAI_API_KEY)) {
      return { authenticated: true, email: 'API Key Auth', method: 'api_key' };
    }

    return { authenticated: false, email: null, method: null, error: 'No valid tokens found' };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    return {
      authenticated: false,
      email: null,
      method: null,
      error: code === 'ENOENT' ? 'Codex not configured' : error instanceof Error ? error.message : 'Failed to read Codex auth',
    };
  }
};

export class CodexProviderAuth implements IProviderAuth {
  /**
   * Checks whether Codex is available to the server runtime.
   */
  private checkInstalled(): boolean {
    try {
      spawn.sync('codex', ['--version'], { stdio: 'ignore', timeout: 5000 });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Returns Codex SDK availability and credential status.
   */
  async getStatus(): Promise<ProviderAuthStatus> {
    const installed = this.checkInstalled();
    const credentials = await readCodexCredentialsStatus();

    return {
      installed,
      provider: 'codex',
      authenticated: credentials.authenticated,
      email: credentials.email,
      method: credentials.method,
      error: credentials.authenticated ? undefined : credentials.error || 'Not authenticated',
    };
  }
}
