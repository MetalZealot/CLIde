import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, beforeEach, describe, it } from 'node:test';

import { readClaudeOAuthCredentials } from '@/modules/providers/list/claude/claude-credentials.js';

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
