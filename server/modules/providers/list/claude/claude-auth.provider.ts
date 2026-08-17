import spawn from 'cross-spawn';

import {
  loadClaudeSettingsEnv,
  readClaudeOAuthCredentials,
} from '@/modules/providers/list/claude/claude-credentials.js';
import {
  type ClaudeVersionPairRecord,
  observeClaudeVersionPair,
} from '@/modules/providers/list/claude/claude-version-pair.js';
import { resolveClaudeCodeExecutablePath } from '@/shared/claude-cli-path.js';
import type { IProviderAuth } from '@/shared/interfaces.js';
import type { ProviderAuthStatus } from '@/shared/types.js';
import { readOptionalString } from '@/shared/utils.js';

type ClaudeCredentialsStatus = {
  authenticated: boolean;
  email: string | null;
  method: string | null;
  error?: string;
};

export class ClaudeProviderAuth implements IProviderAuth {
  /**
   * Checks whether the Claude Code CLI is available on this host, and records
   * the version it reports against the SDK's — a missing binary surfaces as
   * `spawn.sync` returning an error, never as a throw.
   *
   * The recorded pair is returned rather than dropped, because the settings
   * screen is the only place a silent runtime self-update becomes visible.
   */
  private checkInstalled(): { installed: boolean; versions: ClaudeVersionPairRecord | null } {
    const cliPath = resolveClaudeCodeExecutablePath(process.env.CLAUDE_CLI_PATH);
    try {
      const result = spawn.sync(cliPath, ['--version'], { encoding: 'utf8', timeout: 5000 });
      if (result.error || result.status !== 0) {
        return { installed: false, versions: null };
      }
      return { installed: true, versions: observeClaudeVersionPair(result.stdout ?? '') };
    } catch {
      return { installed: false, versions: null };
    }
  }

  /**
   * Returns Claude installation and credential status using Claude Code's auth priority.
   */
  async getStatus(): Promise<ProviderAuthStatus> {
    const { installed, versions } = this.checkInstalled();

    if (!installed) {
      return {
        installed,
        provider: 'claude',
        authenticated: false,
        email: null,
        method: null,
        error: 'Claude Code CLI is not installed',
      };
    }

    const credentials = await this.checkCredentials();

    return {
      installed,
      provider: 'claude',
      authenticated: credentials.authenticated,
      email: credentials.authenticated ? credentials.email || 'Authenticated' : credentials.email,
      method: credentials.method,
      error: credentials.authenticated ? undefined : credentials.error || 'Not authenticated',
      ...(versions ? { versions } : {}),
    };
  }

  /**
   * Checks Claude credentials in the same priority order used by Claude Code.
   */
  private async checkCredentials(): Promise<ClaudeCredentialsStatus> {
    const missingCredentialsError = 'Claude CLI is not authenticated. Run claude /login or configure ANTHROPIC_API_KEY.';

    if (process.env.ANTHROPIC_AUTH_TOKEN?.trim()) {
      return { authenticated: true, email: 'Auth Token', method: 'api_key' };
    }

    if (process.env.ANTHROPIC_API_KEY?.trim()) {
      return { authenticated: true, email: 'API Key Auth', method: 'api_key' };
    }

    const settingsEnv = await loadClaudeSettingsEnv();
    if (readOptionalString(settingsEnv.ANTHROPIC_API_KEY)) {
      return { authenticated: true, email: 'API Key Auth', method: 'api_key' };
    }

    if (readOptionalString(settingsEnv.ANTHROPIC_AUTH_TOKEN)) {
      return { authenticated: true, email: 'Configured via settings.json', method: 'api_key' };
    }

    if (process.env.CLAUDE_CODE_OAUTH_TOKEN?.trim()) {
      return { authenticated: true, email: 'OAuth Token (long-lived)', method: 'environment' };
    }

    if (readOptionalString(settingsEnv.CLAUDE_CODE_OAUTH_TOKEN)) {
      return { authenticated: true, email: 'OAuth Token (long-lived)', method: 'environment' };
    }

    const oauthCredentials = await readClaudeOAuthCredentials();

    switch (oauthCredentials.status) {
      // `stale` = the 8-hour access token lapsed while idle, but the refresh
      // token is live and Claude Code renews it on the next turn. Reporting
      // that as logged out sent users to a /login they didn't need.
      case 'ok':
      case 'stale':
        return {
          authenticated: true,
          email: oauthCredentials.email,
          method: 'credentials_file',
        };
      case 'expired':
        return {
          authenticated: false,
          email: null,
          method: null,
          error: 'Claude login has expired. Run claude /login again.',
        };
      case 'missing':
        return {
          authenticated: false,
          email: null,
          method: null,
          error: missingCredentialsError,
        };
      case 'unreadable':
      default:
        return {
          authenticated: false,
          email: null,
          method: null,
          error: oauthCredentials.status === 'unreadable' && oauthCredentials.reason === 'parse'
            ? 'Claude credentials are unreadable. Run claude /login again.'
            : 'Unable to read Claude credentials. Run claude /login again.',
        };
    }
  }
}
