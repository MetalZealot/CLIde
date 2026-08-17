// Provider authentication: Claude account state, stored credentials, Codex auth.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test, { after, beforeEach, describe, it } from 'node:test';

import { ClaudeProviderAuth } from '@/modules/providers/list/claude/claude-auth.provider.js';
import { readClaudeOAuthCredentials } from '@/modules/providers/list/claude/claude-credentials.js';
import { CodexProviderAuth } from '@/modules/providers/list/codex/codex-auth.provider.js';

describe('claude-auth', () => {
  // checkCredentials() is private, but unlike getStatus() it never shells out to the
  // `claude` CLI — it only reads env vars and ~/.claude files. Calling it directly
  // (TypeScript's `private` has no runtime effect) tests the priority order without
  // depending on `claude` being installed in the test environment.
  type CheckCredentialsResult = {
    authenticated: boolean;
    email: string | null;
    method: string | null;
    error?: string;
  };

  const checkCredentials = (auth: ClaudeProviderAuth): Promise<CheckCredentialsResult> =>
    (auth as unknown as { checkCredentials: () => Promise<CheckCredentialsResult> }).checkCredentials();

  const ENV_KEYS = ['CLAUDE_CODE_OAUTH_TOKEN', 'ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN'] as const;

  const withEnv = async (
    overrides: Partial<Record<(typeof ENV_KEYS)[number], string>>,
    fn: () => Promise<void>,
  ) => {
    const original: Partial<Record<(typeof ENV_KEYS)[number], string>> = {};
    for (const key of ENV_KEYS) {
      original[key] = process.env[key];
      const value = overrides[key];
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    try {
      await fn();
    } finally {
      for (const key of ENV_KEYS) {
        if (original[key] === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = original[key];
        }
      }
    }
  };

  const withTempHome = async (fn: (homeDir: string) => Promise<void>) => {
    const homeDir = await mkdtemp(path.join(os.tmpdir(), 'claude-auth-test-'));
    const originalHome = process.env.HOME;
    process.env.HOME = homeDir;
    try {
      await fn(homeDir);
    } finally {
      if (originalHome === undefined) {
        delete process.env.HOME;
      } else {
        process.env.HOME = originalHome;
      }
      await rm(homeDir, { recursive: true, force: true });
    }
  };

  const writeCredentialsFile = async (homeDir: string, body: unknown) => {
    const claudeDir = path.join(homeDir, '.claude');
    await mkdir(claudeDir, { recursive: true });
    await writeFile(path.join(claudeDir, '.credentials.json'), JSON.stringify(body));
  };

  const writeSettingsFile = async (homeDir: string, env: Record<string, string>) => {
    const claudeDir = path.join(homeDir, '.claude');
    await mkdir(claudeDir, { recursive: true });
    await writeFile(path.join(claudeDir, 'settings.json'), JSON.stringify({ env }));
  };

  test('checkCredentials: CLAUDE_CODE_OAUTH_TOKEN set is authenticated via environment, even with a stale credentials file', async () => {
    await withTempHome(async (homeDir) => {
      await writeCredentialsFile(homeDir, {
        claudeAiOauth: { accessToken: 'stale-token', expiresAt: 1_000_000_000_000 }, // long expired
      });

      await withEnv({ CLAUDE_CODE_OAUTH_TOKEN: 'test-oauth-token' }, async () => {
        const status = await checkCredentials(new ClaudeProviderAuth());
        assert.equal(status.authenticated, true);
        assert.equal(status.method, 'environment');
      });
    });
  });

  test('checkCredentials: CLAUDE_CODE_OAUTH_TOKEN configured via settings.json env block is authenticated via environment', async () => {
    await withTempHome(async (homeDir) => {
      await writeSettingsFile(homeDir, { CLAUDE_CODE_OAUTH_TOKEN: 'test-oauth-token-from-settings' });
      await writeCredentialsFile(homeDir, {
        claudeAiOauth: { accessToken: 'stale-token', expiresAt: 1_000_000_000_000 }, // long expired
      });

      await withEnv({}, async () => {
        const status = await checkCredentials(new ClaudeProviderAuth());
        assert.equal(status.authenticated, true);
        assert.equal(status.method, 'environment');
      });
    });
  });

  test('checkCredentials: no CLAUDE_CODE_OAUTH_TOKEN, valid credentials file falls back to credentials_file', async () => {
    await withTempHome(async (homeDir) => {
      await writeCredentialsFile(homeDir, {
        claudeAiOauth: { accessToken: 'valid-token', expiresAt: Date.now() + 60 * 60 * 1000 },
        email: 'someone@example.com',
      });

      await withEnv({}, async () => {
        const status = await checkCredentials(new ClaudeProviderAuth());
        assert.equal(status.authenticated, true);
        assert.equal(status.method, 'credentials_file');
        assert.equal(status.email, 'someone@example.com');
      });
    });
  });

  test('checkCredentials: no CLAUDE_CODE_OAUTH_TOKEN, expired credentials file reports not authenticated', async () => {
    await withTempHome(async (homeDir) => {
      await writeCredentialsFile(homeDir, {
        claudeAiOauth: { accessToken: 'stale-token', expiresAt: 1_000_000_000_000 },
      });

      await withEnv({}, async () => {
        const status = await checkCredentials(new ClaudeProviderAuth());
        assert.equal(status.authenticated, false);
        assert.match(status.error ?? '', /expired/i);
      });
    });
  });

  test('checkCredentials: ANTHROPIC_API_KEY takes precedence over CLAUDE_CODE_OAUTH_TOKEN', async () => {
    await withTempHome(async () => {
      await withEnv(
        { ANTHROPIC_API_KEY: 'test-api-key', CLAUDE_CODE_OAUTH_TOKEN: 'test-oauth-token' },
        async () => {
          const status = await checkCredentials(new ClaudeProviderAuth());
          assert.equal(status.authenticated, true);
          assert.equal(status.method, 'api_key');
        },
      );
    });
  });
});

describe('claude-credentials', () => {
  // os.homedir() reads $HOME on POSIX, so pointing HOME at a temp dir is enough
  // to feed the reader a synthetic ~/.claude/.credentials.json.
  const originalHome = process.env.HOME;
  const tempRoots: string[] = [];

  const HOUR_MS = 60 * 60 * 1000;

  const useHome = (): string => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'clide-creds-'));
    tempRoots.push(root);
    mkdirSync(path.join(root, '.claude'), { recursive: true });
    process.env.HOME = root;
    return root;
  };

  const writeCredentials = (root: string, oauth: Record<string, unknown>): void => {
    writeFileSync(
      path.join(root, '.claude', '.credentials.json'),
      JSON.stringify({ claudeAiOauth: oauth }),
    );
  };

  after(() => {
    process.env.HOME = originalHome;
    tempRoots.forEach((root) => rmSync(root, { recursive: true, force: true }));
  });

  describe('readClaudeOAuthCredentials', () => {
    let home = '';

    beforeEach(() => {
      home = useHome();
    });

    it('reports a live access token as ok', async () => {
      writeCredentials(home, {
        accessToken: 'live-token',
        refreshToken: 'refresh',
        expiresAt: Date.now() + HOUR_MS,
        refreshTokenExpiresAt: Date.now() + 30 * 24 * HOUR_MS,
      });

      assert.equal((await readClaudeOAuthCredentials()).status, 'ok');
    });

    it('reports an idle-expired access token with a live refresh token as stale', async () => {
      writeCredentials(home, {
        accessToken: 'lapsed-token',
        refreshToken: 'refresh',
        expiresAt: Date.now() - HOUR_MS,
        refreshTokenExpiresAt: Date.now() + 30 * 24 * HOUR_MS,
      });

      const result = await readClaudeOAuthCredentials();

      assert.equal(result.status, 'stale');
      assert.equal(result.status === 'stale' ? result.accessToken : null, 'lapsed-token');
    });

    it('treats a missing refresh token as a genuinely expired login', async () => {
      writeCredentials(home, {
        accessToken: 'lapsed-token',
        expiresAt: Date.now() - HOUR_MS,
      });

      assert.equal((await readClaudeOAuthCredentials()).status, 'expired');
    });

    it('treats an expired refresh token as a genuinely expired login', async () => {
      writeCredentials(home, {
        accessToken: 'lapsed-token',
        refreshToken: 'refresh',
        expiresAt: Date.now() - 30 * 24 * HOUR_MS,
        refreshTokenExpiresAt: Date.now() - HOUR_MS,
      });

      assert.equal((await readClaudeOAuthCredentials()).status, 'expired');
    });

    it('treats an expired access token with no refresh expiry as stale', async () => {
      writeCredentials(home, {
        accessToken: 'lapsed-token',
        refreshToken: 'refresh',
        expiresAt: Date.now() - HOUR_MS,
      });

      assert.equal((await readClaudeOAuthCredentials()).status, 'stale');
    });

    it('reports a missing credentials file', async () => {
      assert.equal((await readClaudeOAuthCredentials()).status, 'missing');
    });

    it('reports an unparseable credentials file', async () => {
      writeFileSync(path.join(home, '.claude', '.credentials.json'), '{ not json');

      const result = await readClaudeOAuthCredentials();

      assert.equal(result.status, 'unreadable');
      assert.equal(result.status === 'unreadable' ? result.reason : null, 'parse');
    });
  });
});

describe('codex-auth', () => {
  test('Codex auth reports the selected runtime as installed', async () => {
    let runtimeReads = 0;
    const provider = new CodexProviderAuth({
      resolveRuntime: async () => { runtimeReads += 1; },
      readCredentials: async () => ({
        authenticated: true,
        email: 'codex@example.test',
        method: 'credentials_file',
      }),
    });

    assert.deepEqual(await provider.getStatus(), {
      installed: true,
      provider: 'codex',
      authenticated: true,
      email: 'codex@example.test',
      method: 'credentials_file',
      error: undefined,
    });
    assert.equal(runtimeReads, 1);
  });

  test('Codex auth does not substitute a PATH binary when the selection is invalid', async () => {
    const provider = new CodexProviderAuth({
      resolveRuntime: async () => { throw new Error('selection changed'); },
      readCredentials: async () => ({ authenticated: false, email: null, method: null }),
    });

    assert.equal((await provider.getStatus()).installed, false);
  });
});
