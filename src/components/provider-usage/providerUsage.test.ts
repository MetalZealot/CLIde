import assert from 'node:assert/strict';
import test, { afterEach, before, describe } from 'node:test';

import i18next from 'i18next';
import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { initReactI18next } from 'react-i18next';

import { isUsageWindowResetPending } from './format';
import { useProviderUsage } from './hooks/useProviderUsage';
import { UsageResetCreditsRow } from './UsageWindowList';
import { supportsProviderUsageReset } from './types';

let root: Root | null = null;

before(async () => {
  await i18next.use(initReactI18next).init({
    lng: 'en',
    fallbackLng: false,
    defaultNS: 'common',
    resources: { en: { common: {} } },
  });
});

afterEach(async () => {
  await React.act(async () => root?.unmount());
  document.body.innerHTML = '';
  root = null;
});

describe('format', () => {
  test('a window is reset-pending once its own reset timestamp has passed', () => {
    const past = new Date(Date.now() - 60_000).toISOString();
    const future = new Date(Date.now() + 60_000).toISOString();

    assert.equal(isUsageWindowResetPending(past), true);
    assert.equal(isUsageWindowResetPending(future), false);
    // An idle window carries no reset time and is not pending anything.
    assert.equal(isUsageWindowResetPending(null), false);
    assert.equal(isUsageWindowResetPending(undefined), false);
    assert.equal(isUsageWindowResetPending('not a date'), false);
  });
});

describe('types', () => {
  test('usage reset preferences are limited to usage-capable OAuth accounts', () => {
    assert.equal(supportsProviderUsageReset(true, 'oauth', true), true);
    assert.equal(supportsProviderUsageReset(true, 'chatgpt', true), true);
    // An API-key login bills per token and has no plan window to reset.
    assert.equal(supportsProviderUsageReset(true, 'api_key', true), false);
    // The provider's capability entry says it reports no schedulable resets.
    assert.equal(supportsProviderUsageReset(false, 'oauth', true), false);
    assert.equal(supportsProviderUsageReset(true, 'chatgpt', false), false);
  });
});

describe('UsageResetCreditsRow', () => {
  test('confirms the earliest expiring credit and reports a successful reset', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    const submissions: Array<{ idempotencyKey: string; creditId?: string }> = [];

    await React.act(async () => {
      root?.render(React.createElement(UsageResetCreditsRow, {
        resetCredits: {
          availableCount: 3,
          details: [{
            id: 'later',
            status: 'available',
            grantedAt: null,
            expiresAt: '2026-09-20T12:00:00.000Z',
            title: null,
            description: null,
          }, {
            id: 'earlier',
            status: 'available',
            grantedAt: null,
            expiresAt: '2026-09-15T12:00:00.000Z',
            title: null,
            description: null,
          }],
        },
        onRedeem: async (input) => {
          submissions.push(input);
          return {
            provider: 'codex',
            outcome: 'reset',
            usage: {
              provider: 'codex',
              supported: true,
              resetCredits: { availableCount: 2 },
            },
          };
        },
      }));
    });

    const useReset = [...container.querySelectorAll<HTMLButtonElement>('button')]
      .find((button) => button.textContent?.trim() === 'Use reset');
    assert.ok(useReset);
    await React.act(async () => useReset.click());

    const dialog = document.querySelector<HTMLElement>('[role="dialog"]');
    assert.ok(dialog);
    assert.match(dialog.textContent ?? '', /refreshes eligible 5-hour and weekly limits/);
    assert.match(dialog.textContent ?? '', /changes your next weekly reset date/);
    assert.match(dialog.textContent ?? '', /This reset expires/);

    const confirm = [...dialog.querySelectorAll<HTMLButtonElement>('button')]
      .find((button) => button.textContent?.trim() === 'Use reset');
    assert.ok(confirm);
    await React.act(async () => {
      confirm.click();
      await Promise.resolve();
    });

    assert.equal(submissions.length, 1);
    assert.equal(submissions[0].creditId, 'earlier');
    assert.ok(submissions[0].idempotencyKey.length > 0);
    assert.match(container.textContent ?? '', /Usage reset applied/);
    assert.equal(document.querySelector('[role="dialog"]'), null);
  });

  test('disables stale redemption and links unsupported runtimes to provider usage', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    await React.act(async () => {
      root?.render(React.createElement(React.Fragment, null,
        React.createElement(UsageResetCreditsRow, {
          resetCredits: { availableCount: 1 },
          onRedeem: async () => {
            throw new Error('should not run');
          },
          redemptionDisabled: true,
        }),
        React.createElement(UsageResetCreditsRow, {
          resetCredits: { availableCount: 1 },
          managementUrl: 'https://chatgpt.com/#settings/Usage',
        }),
      ));
    });

    const button = container.querySelector<HTMLButtonElement>('button');
    assert.equal(button?.disabled, true);
    assert.match(button?.title ?? '', /Refresh usage/);
    const link = container.querySelector<HTMLAnchorElement>('a');
    assert.equal(link?.href, 'https://chatgpt.com/#settings/Usage');
    assert.equal(link?.target, '_blank');
  });

  test('keeps one idempotency key across a retry of the same confirmation', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    const submissions: Array<{ idempotencyKey: string; creditId?: string }> = [];

    await React.act(async () => {
      root?.render(React.createElement(UsageResetCreditsRow, {
        resetCredits: { availableCount: 1 },
        onRedeem: async (input) => {
          submissions.push(input);
          if (submissions.length === 1) throw new Error('Connection interrupted.');
          return {
            provider: 'codex',
            outcome: 'nothingToReset',
            usage: { provider: 'codex', supported: true, resetCredits: { availableCount: 1 } },
          };
        },
      }));
    });

    const useReset = container.querySelector<HTMLButtonElement>('button');
    assert.ok(useReset);
    await React.act(async () => useReset.click());

    const dialog = document.querySelector<HTMLElement>('[role="dialog"]');
    assert.ok(dialog);
    const firstConfirm = [...dialog.querySelectorAll<HTMLButtonElement>('button')]
      .find((button) => button.textContent?.trim() === 'Use reset');
    assert.ok(firstConfirm);
    await React.act(async () => {
      firstConfirm.click();
      await Promise.resolve();
    });
    assert.match(dialog.textContent ?? '', /Connection interrupted/);

    const secondConfirm = [...dialog.querySelectorAll<HTMLButtonElement>('button')]
      .find((button) => button.textContent?.trim() === 'Use reset');
    assert.ok(secondConfirm);
    await React.act(async () => {
      secondConfirm.click();
      await Promise.resolve();
    });

    assert.equal(submissions.length, 2);
    assert.equal(submissions[0].idempotencyKey, submissions[1].idempotencyKey);
    assert.match(container.textContent ?? '', /Nothing needs resetting yet/);
    assert.equal(document.querySelector('[role="dialog"]'), null);
  });

  test('replaces an unavailable runtime action with the provider fallback', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    await React.act(async () => {
      root?.render(React.createElement(UsageResetCreditsRow, {
        resetCredits: { availableCount: 1 },
        managementUrl: 'https://chatgpt.com/#settings/Usage',
        onRedeem: async () => {
          throw Object.assign(new Error('This runtime cannot use resets.'), {
            code: 'USAGE_RESET_REDEMPTION_UNSUPPORTED',
          });
        },
      }));
    });

    const useReset = container.querySelector<HTMLButtonElement>('button');
    assert.ok(useReset);
    await React.act(async () => useReset.click());
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]');
    assert.ok(dialog);
    const confirm = [...dialog.querySelectorAll<HTMLButtonElement>('button')]
      .find((button) => button.textContent?.trim() === 'Use reset');
    assert.ok(confirm);
    await React.act(async () => {
      confirm.click();
      await Promise.resolve();
    });

    assert.match(dialog.textContent ?? '', /This runtime cannot use resets/);
    assert.equal(
      [...dialog.querySelectorAll<HTMLButtonElement>('button')]
        .some((button) => button.textContent?.trim() === 'Use reset'),
      false,
    );
    assert.equal(
      dialog.querySelector<HTMLAnchorElement>('a')?.href,
      'https://chatgpt.com/#settings/Usage',
    );
  });
});

describe('useProviderUsage', () => {
  test('posts one reset attempt and replaces the shared usage reading', async () => {
    const originalFetch = globalThis.fetch;
    const requests: Array<{ url: string; method: string; body: string | null }> = [];
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      requests.push({
        url: String(input),
        method: init?.method ?? 'GET',
        body: typeof init?.body === 'string' ? init.body : null,
      });
      const resetCount = init?.method === 'POST' ? 2 : 3;
      const usage = {
        provider: 'codex' as const,
        supported: true,
        resetCredits: { availableCount: resetCount },
      };
      return new Response(JSON.stringify(init?.method === 'POST'
        ? { success: true, data: { provider: 'codex', outcome: 'reset', usage } }
        : { success: true, data: usage }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as typeof fetch;

    const container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    const Harness = () => {
      const { usage, redeemResetCredit } = useProviderUsage('codex');
      return React.createElement(
        'button',
        {
          type: 'button',
          onClick: () => {
            void redeemResetCredit({ idempotencyKey: 'attempt-1', creditId: 'credit-1' });
          },
        },
        String(usage?.resetCredits?.availableCount ?? 'loading'),
      );
    };

    try {
      await React.act(async () => {
        root?.render(React.createElement(Harness));
        await new Promise((resolve) => window.setTimeout(resolve, 0));
      });
      assert.equal(container.textContent, '3');

      await React.act(async () => {
        container.querySelector('button')?.click();
        await new Promise((resolve) => window.setTimeout(resolve, 0));
      });

      assert.equal(container.textContent, '2');
      assert.equal(requests.at(-1)?.url, '/api/providers/codex/usage/reset');
      assert.equal(requests.at(-1)?.method, 'POST');
      assert.deepEqual(JSON.parse(requests.at(-1)?.body ?? '{}'), {
        idempotencyKey: 'attempt-1',
        creditId: 'credit-1',
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
