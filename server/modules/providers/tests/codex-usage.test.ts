import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  readCodexAccountUsage,
  readCodexModelList,
} from '@/modules/providers/list/codex/codex-app-server.client.js';
import {
  CodexProviderUsage,
  normalizeCodexAccountActivity,
  normalizeCodexRateLimits,
} from '@/modules/providers/list/codex/codex-usage.provider.js';

const FALLBACK_SNAPSHOT = {
  limitId: 'codex',
  limitName: 'Codex',
  primary: {
    usedPercent: 42,
    windowDurationMins: 300,
    resetsAt: 1_700_000_000,
  },
  secondary: {
    usedPercent: 71,
    windowDurationMins: 10_080,
    resetsAt: 1_700_100_000,
  },
  credits: {
    hasCredits: true,
    unlimited: false,
    balance: '12.50',
  },
  individualLimit: {
    limit: '100.00',
    used: '35.00',
    remainingPercent: 65,
    resetsAt: 1_700_200_000,
  },
};

test('Codex usage normalizes multi-bucket windows without duplicating the fallback snapshot', () => {
  const usage = normalizeCodexRateLimits({
    rateLimits: FALLBACK_SNAPSHOT,
    rateLimitsByLimitId: {
      codex: FALLBACK_SNAPSHOT,
      review: {
        limitId: 'review',
        limitName: 'Code review',
        primary: {
          usedPercent: 120,
          windowDurationMins: 60,
          resetsAt: null,
        },
      },
    },
    rateLimitResetCredits: {
      availableCount: 2,
      credits: [{
        id: 'reset-1',
        status: 'available',
        grantedAt: 1_700_300_000,
        expiresAt: 1_700_400_000,
        title: 'Rate-limit reset',
        description: 'Reset an eligible Codex window.',
      }],
    },
  });

  assert.deepEqual(usage.windows, [
    {
      id: 'review:primary',
      bucketId: 'review',
      label: 'Code review',
      utilization: 100,
      resetsAt: null,
      durationMinutes: 60,
    },
    {
      id: 'codex:primary',
      bucketId: 'codex',
      label: 'Codex',
      utilization: 42,
      resetsAt: '2023-11-14T22:13:20.000Z',
      durationMinutes: 300,
    },
    {
      id: 'codex:secondary',
      bucketId: 'codex',
      label: 'Codex',
      utilization: 71,
      resetsAt: '2023-11-16T02:00:00.000Z',
      durationMinutes: 10_080,
    },
  ]);
  assert.deepEqual(usage.credits, {
    kind: 'balance',
    hasCredits: true,
    unlimited: false,
    balance: '12.50',
    individualLimit: {
      limit: '100.00',
      used: '35.00',
      remainingPercent: 65,
      resetsAt: '2023-11-17T05:46:40.000Z',
    },
  });
  assert.deepEqual(usage.resetCredits, {
    availableCount: 2,
    details: [{
      id: 'reset-1',
      status: 'available',
      grantedAt: '2023-11-18T09:33:20.000Z',
      expiresAt: '2023-11-19T13:20:00.000Z',
      title: 'Rate-limit reset',
      description: 'Reset an eligible Codex window.',
    }],
  });
});

test('Codex usage falls back to the historical single-bucket view', () => {
  const usage = normalizeCodexRateLimits({
    rateLimits: {
      ...FALLBACK_SNAPSHOT,
      credits: {
        hasCredits: false,
        unlimited: true,
        balance: null,
      },
      individualLimit: null,
      rateLimitReachedType: 'rate_limit_reached',
    },
    rateLimitsByLimitId: null,
  });

  assert.equal(usage.windows.length, 2);
  assert.equal(usage.windows[0].label, undefined);
  assert.deepEqual(usage.credits, {
    kind: 'balance',
    hasCredits: false,
    unlimited: true,
    balance: null,
    limitReachedReason: 'rate_limit_reached',
  });
});

test('Codex usage normalizes account token activity separately from plan limits', () => {
  assert.deepEqual(normalizeCodexAccountActivity({
    summary: {
      lifetimeTokens: 3_160_000,
      peakDailyTokens: 850_000,
      longestRunningTurnSec: 181,
      currentStreakDays: 2,
      longestStreakDays: 7,
    },
    dailyUsageBuckets: [
      { startDate: '2026-07-23', tokens: 120_000 },
      { startDate: '2026-07-24', tokens: 850_000 },
      { startDate: null, tokens: 10 },
    ],
  }), {
    lifetimeTokens: 3_160_000,
    peakDailyTokens: 850_000,
    longestRunningTurnSeconds: 181,
    currentStreakDays: 2,
    longestStreakDays: 7,
    daily: [
      { date: '2026-07-23', tokens: 120_000 },
      { date: '2026-07-24', tokens: 850_000 },
    ],
  });

  assert.equal(normalizeCodexAccountActivity({
    summary: {
      lifetimeTokens: null,
    },
    dailyUsageBuckets: [],
  }), undefined);
});

test('Codex provider usage hides subscription limits for API-key auth', async () => {
  let accountUsageReads = 0;
  const provider = new CodexProviderUsage({
    readCredentials: async () => ({
      authenticated: true,
      email: 'API Key Auth',
      method: 'api_key',
    }),
    readAccountUsage: async () => {
      accountUsageReads += 1;
      return { rateLimits: {} };
    },
  });

  assert.deepEqual(await provider.getUsage(), {
    provider: 'codex',
    supported: false,
    reason: 'api_key',
  });
  assert.equal(accountUsageReads, 0);
});

test('Codex provider usage reports missing login without starting app-server', async () => {
  let accountUsageReads = 0;
  const provider = new CodexProviderUsage({
    readCredentials: async () => ({
      authenticated: false,
      email: null,
      method: null,
    }),
    readAccountUsage: async () => {
      accountUsageReads += 1;
      return { rateLimits: {} };
    },
  });

  assert.deepEqual(await provider.getUsage(), {
    provider: 'codex',
    supported: true,
    reason: 'not_authenticated',
    error: 'Codex CLI is not authenticated. Run codex login first.',
  });
  assert.equal(accountUsageReads, 0);
});

test('Codex provider usage returns normalized account limits', async () => {
  const provider = new CodexProviderUsage({
    readCredentials: async () => ({
      authenticated: true,
      email: 'codex@example.com',
      method: 'credentials_file',
    }),
    readAccountUsage: async () => ({
      rateLimits: {
        rateLimits: FALLBACK_SNAPSHOT,
        rateLimitResetCredits: {
          availableCount: 0,
          credits: [],
        },
      },
      activity: {
        summary: {
          lifetimeTokens: 3_160_000,
          peakDailyTokens: 850_000,
          longestRunningTurnSec: 181,
          currentStreakDays: 2,
          longestStreakDays: 7,
        },
        dailyUsageBuckets: null,
      },
    }),
  });

  const usage = await provider.getUsage();
  assert.equal(usage.provider, 'codex');
  assert.equal(usage.supported, true);
  assert.equal(usage.windows?.[0].durationMinutes, 300);
  assert.equal(usage.credits?.kind, 'balance');
  assert.equal(usage.resetCredits?.availableCount, 0);
  assert.equal(usage.activity?.lifetimeTokens, 3_160_000);
  assert.match(usage.fetchedAt ?? '', /^\d{4}-\d{2}-\d{2}T/);
});

test('Codex app-server client initializes before reading account limits and activity', async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'codex-usage-app-server-'));
  const fakeServerPath = path.join(tempRoot, 'fake-app-server.mjs');

  try {
    await writeFile(
      fakeServerPath,
      `import readline from 'node:readline';
const lines = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
const keepAlive = setInterval(() => {}, 1_000);
let initialized = false;
let accountResponses = 0;
for await (const line of lines) {
  const message = JSON.parse(line);
  if (message.method === 'initialize') {
    process.stdout.write(JSON.stringify({ id: message.id, result: {
      codexHome: '/tmp/codex',
      platformFamily: 'unix',
      platformOs: 'linux',
      userAgent: 'fake'
    } }) + '\\n');
  } else if (message.method === 'initialized') {
    initialized = true;
  } else if (message.method === 'account/rateLimits/read') {
    process.stdout.write(JSON.stringify(initialized
      ? { id: message.id, result: { rateLimits: { primary: { usedPercent: 25 } } } }
      : { id: message.id, error: { code: -32000, message: 'not initialized' } }
    ) + '\\n');
    accountResponses += 1;
  } else if (message.method === 'account/usage/read') {
    process.stdout.write(JSON.stringify(initialized
      ? { id: message.id, result: { summary: { lifetimeTokens: 1234 }, dailyUsageBuckets: null } }
      : { id: message.id, error: { code: -32000, message: 'not initialized' } }
    ) + '\\n');
    accountResponses += 1;
  }
  if (accountResponses === 2) {
    clearInterval(keepAlive);
  }
}
`,
      'utf8',
    );

    const result = await readCodexAccountUsage({
      command: {
        command: process.execPath,
        args: [fakeServerPath],
      },
      timeoutMs: 2_000,
    });

    assert.deepEqual(result, {
      rateLimits: {
        rateLimits: {
          primary: {
            usedPercent: 25,
          },
        },
      },
      activity: {
        summary: {
          lifetimeTokens: 1234,
        },
        dailyUsageBuckets: null,
      },
    });
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test('Codex app-server client reads every model/list page', async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'codex-models-app-server-'));
  const fakeServerPath = path.join(tempRoot, 'fake-app-server.mjs');
  try {
    await writeFile(fakeServerPath, `
import readline from 'node:readline';
const lines = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
let initialized = false;
const send = (value) => process.stdout.write(JSON.stringify(value) + '\\n');
for await (const line of lines) {
  const message = JSON.parse(line);
  if (message.method === 'initialize') {
    if (message.params?.capabilities?.experimentalApi !== true) process.exit(20);
    send({ id: message.id, result: { userAgent: 'fake' } });
  } else if (message.method === 'initialized') {
    initialized = true;
  } else if (message.method === 'model/list') {
    if (!initialized) process.exit(21);
    const suffix = message.params.cursor ? 'two' : 'one';
    send({ id: message.id, result: {
      data: [{
        id: 'id-' + suffix,
        model: 'model-' + suffix,
        displayName: 'Model ' + suffix,
        description: '',
        hidden: false,
        supportedReasoningEfforts: [],
        defaultReasoningEffort: 'medium',
        isDefault: !message.params.cursor
      }],
      nextCursor: message.params.cursor ? null : 'page-2'
    } });
  }
}
`, 'utf8');
    const models = await readCodexModelList({
      command: { command: process.execPath, args: [fakeServerPath] },
      timeoutMs: 2_000,
    });
    assert.deepEqual(models.map((model) => model.model), ['model-one', 'model-two']);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});
