import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test, { after, afterEach, before } from 'node:test';

import i18next from 'i18next';
import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { initReactI18next } from 'react-i18next';

import TokenUsageSummary from './TokenUsageSummary';

let root: Root | null = null;
let container: HTMLDivElement | null = null;
const originalFetch = globalThis.fetch;
let claudeCreditSpend = 0;

const usageByProvider = {
  claude: {
    provider: 'claude',
    supported: true,
    windows: [
      {
        id: 'seven_day',
        utilization: 25,
        resetsAt: '2026-08-10T01:00:00.000Z',
        durationMinutes: 10_080,
      },
      {
        id: 'five_hour',
        utilization: 75,
        resetsAt: '2026-08-09T22:30:00.000Z',
        durationMinutes: 300,
      },
    ],
    credits: {
      kind: 'spend',
      enabled: true,
      usedAmount: 0,
      limitAmount: 50,
      currency: 'USD',
      utilization: 0,
    },
  },
  codex: {
    provider: 'codex',
    supported: true,
    windows: [
      {
        id: 'seven_day',
        utilization: 52,
        resetsAt: '2026-08-15T01:00:00.000Z',
        durationMinutes: 10_080,
      },
    ],
    credits: {
      kind: 'balance',
      hasCredits: true,
      unlimited: false,
      balance: '$25.00',
    },
    activity: {
      lifetimeTokens: 1_250_000,
      peakDailyTokens: 250_000,
      currentStreakDays: 4,
      daily: [
        { date: '2026-08-08', tokens: 120_000 },
        { date: '2026-08-09', tokens: 80_000 },
      ],
    },
  },
} as const;

before(async () => {
  const commonTranslations = JSON.parse(readFileSync(
    new URL('../../../../i18n/locales/en/common.json', import.meta.url),
    'utf8',
  )) as Record<string, unknown>;
  await i18next.use(initReactI18next).init({
    lng: 'en',
    fallbackLng: false,
    defaultNS: 'common',
    resources: { en: { common: commonTranslations } },
  });

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const provider = String(input).includes('/codex/') ? 'codex' : 'claude';
    const data = provider === 'claude'
      ? {
          ...usageByProvider.claude,
          credits: {
            ...usageByProvider.claude.credits,
            usedAmount: claudeCreditSpend,
            utilization: (claudeCreditSpend / usageByProvider.claude.credits.limitAmount) * 100,
          },
        }
      : usageByProvider.codex;
    return new Response(JSON.stringify({ success: true, data }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof fetch;
});

after(() => {
  globalThis.fetch = originalFetch;
});

afterEach(async () => {
  await React.act(async () => root?.unmount());
  container?.remove();
  document.querySelectorAll('[role="dialog"]').forEach((dialog) => dialog.remove());
  root = null;
  container = null;
});

const mount = async (element: React.ReactNode) => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await React.act(async () => {
    root?.render(element);
    await new Promise((resolve) => window.setTimeout(resolve, 0));
  });
  return container;
};

const openPopover = async (host: HTMLElement) => {
  const trigger = host.querySelector<HTMLButtonElement>('button');
  assert.ok(trigger);
  trigger.getBoundingClientRect = () => ({
    x: 340,
    y: 700,
    left: 340,
    right: 372,
    top: 700,
    bottom: 732,
    width: 32,
    height: 32,
    toJSON: () => ({}),
  });
  Object.defineProperty(window, 'innerWidth', { value: 384, configurable: true });
  Object.defineProperty(window, 'innerHeight', { value: 800, configurable: true });
  await React.act(async () => trigger.click());
  const dialog = document.querySelector<HTMLElement>('[role="dialog"]');
  assert.ok(dialog);
  return { trigger, dialog };
};

test('Claude usage follows the compact mockup order and drills into only its breakdown', async () => {
  let breakdownOpens = 0;
  const summary = (
    <TokenUsageSummary
      provider="claude"
      usage={{
        used: 117_721,
        total: 967_000,
        autoCompactThreshold: 934_000,
        isAutoCompactEnabled: true,
      }}
      request={{ id: 0, view: 'summary' }}
      onRequestBreakdown={() => { breakdownOpens += 1; }}
      onRefreshBreakdown={() => {}}
      isRefreshingBreakdown={false}
      canRefreshBreakdown={false}
    />
  );
  const host = await mount(summary);
  const { trigger, dialog } = await openPopover(host);
  const text = dialog.textContent || '';

  assert.equal(trigger.getAttribute('aria-label'), 'Show usage; credits available');
  assert.match(trigger.textContent || '', /\$/);
  assert.match(text, /Session13% used117,721 \/ 934,000 · AutoBreakdown/);
  assert.match(text, /5-hour limit75% usedResets at/);
  assert.match(text, /Weekly25% usedResets \w+ /);
  assert.ok(text.indexOf('5-hour limit') < text.indexOf('Weekly'));
  assert.match(text, /Credits\/Tokens\$0\.00/);
  assert.doesNotMatch(text, /Plan usage limits|Full usage|Refresh/);

  const link = dialog.querySelector<HTMLAnchorElement>('a');
  assert.equal(link?.textContent?.trim(), 'Manage Plan and Balance');
  assert.equal(link?.href, 'https://claude.ai/new#settings/usage');

  const breakdown = [...dialog.querySelectorAll<HTMLButtonElement>('button')]
    .find((button) => button.textContent?.includes('Breakdown'));
  assert.ok(breakdown);
  await React.act(async () => breakdown.click());
  assert.equal(breakdownOpens, 1);
  assert.match(document.querySelector('[role="dialog"]')?.textContent || '', /Loading session breakdown/);

  await React.act(async () => root?.render(
    <TokenUsageSummary
      provider="claude"
      usage={{
        used: 117_721,
        total: 967_000,
        autoCompactThreshold: 934_000,
        isAutoCompactEnabled: true,
      }}
      request={{
        id: 1,
        view: 'breakdown',
        context: {
          provider: 'claude',
          detail: 'full',
          maxTokens: 967_000,
          autoCompactThreshold: 934_000,
          isAutoCompactEnabled: true,
          breakdown: {
            categories: [
              { name: 'System prompt', tokens: 20_000 },
              { name: 'Messages', tokens: 97_721 },
              { name: 'Free space', tokens: 816_279 },
              { name: 'Autocompact buffer', tokens: 33_000 },
            ],
            messageBreakdown: {
              toolCallTokens: 0,
              toolResultTokens: 10_000,
              attachmentTokens: 0,
              assistantMessageTokens: 40_000,
              userMessageTokens: 47_721,
              redirectedContextTokens: 0,
              unattributedTokens: 0,
            },
          },
        },
      }}
      onRequestBreakdown={() => { breakdownOpens += 1; }}
      onRefreshBreakdown={() => {}}
      isRefreshingBreakdown={false}
      canRefreshBreakdown={false}
    />,
  ));
  const breakdownText = document.querySelector('[role="dialog"]')?.textContent || '';
  assert.match(breakdownText, /Session breakdown/);
  assert.match(breakdownText, /What is in the window/);
  assert.match(breakdownText, /Messages97,721/);
  assert.doesNotMatch(breakdownText, /5-hour limit|Weekly|Credits\/Tokens|Manage Plan/);
});

test('Codex omits breakdown and links weekly usage to account activity', async () => {
  const host = await mount(
    <TokenUsageSummary
      provider="codex"
      usage={{ used: 42_000, total: 258_400, isAutoCompactEnabled: false }}
      request={{ id: 0, view: 'summary' }}
      onRequestBreakdown={() => {}}
      onRefreshBreakdown={() => {}}
      isRefreshingBreakdown={false}
      canRefreshBreakdown={false}
    />,
  );
  const { dialog } = await openPopover(host);
  const text = dialog.textContent || '';

  assert.match(text, /Session16% used42,000 \/ 258,400/);
  assert.doesNotMatch(text, /Breakdown/);
  assert.match(text, /Weekly52% used.*Usage/);
  assert.doesNotMatch(text, /5-hour/);
  assert.doesNotMatch(text, /Auto(?: off)?/);
  assert.match(text, /Credits\/Tokens\$25\.00/);
  assert.equal(
    dialog.querySelector<HTMLAnchorElement>('a')?.href,
    'https://chatgpt.com/#settings/Usage',
  );

  const usageButton = [...dialog.querySelectorAll<HTMLButtonElement>('button')]
    .find((button) => button.textContent?.trim() === 'Usage');
  assert.ok(usageButton);
  await React.act(async () => usageButton.click());
  const activityText = document.querySelector('[role="dialog"]')?.textContent || '';
  assert.match(activityText, /Usage activity/);
  assert.match(activityText, /Lifetime tokens1\.25M/);
  assert.match(activityText, /Recent daily activity/);
  assert.doesNotMatch(activityText, /Session16%|Weekly52%|Credits\/Tokens/);
});

test('Claude does not claim exhausted spend credits are available', async () => {
  claudeCreditSpend = usageByProvider.claude.credits.limitAmount;
  const realDateNow = Date.now;
  Date.now = () => realDateNow() + 61_000;
  try {
    const host = await mount(
      <TokenUsageSummary
        provider="claude"
        usage={{ used: 10_000, total: 200_000 }}
        request={{ id: 0, view: 'summary' }}
        onRequestBreakdown={() => {}}
        onRefreshBreakdown={() => {}}
        isRefreshingBreakdown={false}
        canRefreshBreakdown={false}
      />,
    );
    const { trigger } = await openPopover(host);

    assert.equal(trigger.getAttribute('aria-label'), 'Show usage');
    assert.doesNotMatch(trigger.textContent || '', /\$/);
  } finally {
    claudeCreditSpend = 0;
    Date.now = realDateNow;
  }
});
