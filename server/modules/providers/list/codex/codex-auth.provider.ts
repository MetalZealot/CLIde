import { readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { resolveSelectedCodexRuntime } from '@/modules/providers/list/codex/codex-native-runtime.provider.js';
import type { IProviderAuth } from '@/shared/interfaces.js';
import type { ProviderAuthStatus } from '@/shared/types.js';
import { readObjectRecord, readOptionalString } from '@/shared/utils.js';

export type CodexCredentialsStatus = {
  authenticated: boolean;
  email: string | null;
  method: string | null;
  error?: string;
};

type CodexProviderAuthOptions = {
  resolveRuntime?: () => Promise<unknown>;
  readCredentials?: () => Promise<CodexCredentialsStatus>;
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
  private readonly resolveRuntime: () => Promise<unknown>;
  private readonly readCredentials: () => Promise<CodexCredentialsStatus>;

  constructor(options: CodexProviderAuthOptions = {}) {
    this.resolveRuntime = options.resolveRuntime ?? (() => resolveSelectedCodexRuntime('auth'));
    this.readCredentials = options.readCredentials ?? readCodexCredentialsStatus;
  }

  /**
   * Checks whether Codex is available to the server runtime.
   */
  private async checkInstalled(): Promise<boolean> {
    try {
      await this.resolveRuntime();
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Returns Codex SDK availability and credential status.
   */
  async getStatus(): Promise<ProviderAuthStatus> {
    const installed = await this.checkInstalled();
    const credentials = await this.readCredentials();

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
