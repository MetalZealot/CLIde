// Chat view subcomponents; each component scoped to its own describe.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test, { after, afterEach, before, describe } from 'node:test';

import i18next from 'i18next';
import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { initReactI18next } from 'react-i18next';

import { getNextRoutinePermissionMode } from '../../utils/chatPermissions';

import ComposerModelMenu from './ComposerModelMenu';
import ComposerPermissionMenu from './ComposerPermissionMenu';
import ChatExportMenu from './ChatExportMenu';
import NativeImageAttachmentPicker from './NativeImageAttachmentPicker';
import TokenUsageSummary from './TokenUsageSummary';

describe('ChatExportMenu', () => {
  test('enables results only with tool calls and loads complete history before export', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    let loadAllCalls = 0;
    const originalCreateObjectURL = URL.createObjectURL;
    const originalRevokeObjectURL = URL.revokeObjectURL;
    const originalAnchorClick = window.HTMLAnchorElement.prototype.click;
    URL.createObjectURL = () => 'blob:chat-export-test';
    URL.revokeObjectURL = () => undefined;
    window.HTMLAnchorElement.prototype.click = () => undefined;

    try {
      await React.act(async () => {
        root.render(
          <ChatExportMenu
            messages={[{ type: 'assistant', content: 'Loaded page', timestamp: '2026-08-17T12:00:00.000Z' }]}
            sessionTitle="Export test"
            assistantLabel="Codex"
            hasMoreMessages
            isLoadingAllMessages={false}
            loadAllMessages={async () => {
              loadAllCalls += 1;
              return [{ type: 'assistant', content: 'Complete session', timestamp: '2026-08-17T12:00:00.000Z' }];
            }}
          />,
        );
      });

      await React.act(async () => {
        container.querySelector<HTMLButtonElement>('button[aria-label="Export chat"]')?.click();
      });

      const checkboxes = container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]');
      assert.equal(checkboxes.length, 3);
      assert.equal(checkboxes[1]?.disabled, true);

      await React.act(async () => {
        checkboxes[0]?.click();
      });
      assert.equal(container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')[1]?.disabled, false);

      const markdownButton = Array.from(container.querySelectorAll<HTMLButtonElement>('button'))
        .find((button) => button.textContent?.includes('Markdown'));
      await React.act(async () => {
        markdownButton?.click();
        await Promise.resolve();
      });
      assert.equal(loadAllCalls, 1);
    } finally {
      await React.act(async () => root.unmount());
      container.remove();
      URL.createObjectURL = originalCreateObjectURL;
      URL.revokeObjectURL = originalRevokeObjectURL;
      window.HTMLAnchorElement.prototype.click = originalAnchorClick;
    }
  });
});

describe('TokenUsageSummary', () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;
  const originalFetch = globalThis.fetch;
  let claudeCreditSpend = 0;
  const providerUsageRequests: string[] = [];

  /** Reset labels are countdowns, so fixtures must sit in the future at run time. */
  const inMinutes = (minutes: number) => new Date(Date.now() + minutes * 60_000).toISOString();

  const usageByProvider = {
    claude: {
      provider: 'claude',
      supported: true,
      windows: [
        {
          id: 'seven_day',
          utilization: 25,
          resetsAt: inMinutes(3 * 1440 + 120),
          durationMinutes: 10_080,
        },
        {
          id: 'five_hour',
          utilization: 75,
          resetsAt: inMinutes(90),
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
          resetsAt: inMinutes(5 * 1440),
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
      providerUsageRequests.push(String(input));
      if (String(input).includes('/context-ceiling')) {
        return new Response(JSON.stringify({
          success: true,
          data: {
            total: 200_000,
            autoCompactThreshold: 167_000,
            isAutoCompactEnabled: true,
            ceilingSource: 'settings',
            ceilingCap: 200_000,
            modelContextWindow: 1_000_000,
          },
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
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
          ceilingSource: 'auto',
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
    assert.match(text, /Context & Usage/);
    assert.match(trigger.textContent || '', /\$/);
    assert.match(text, /Session118k \/ 934k · Auto13%/);
    // Label, reset and percentage on one line.
    assert.match(text, /5-hour limitResets in \d+h \d+m75%/);
    assert.match(text, /WeeklyResets in \d+d \d+h25%/);
    assert.ok(text.indexOf('5-hour limit') < text.indexOf('Weekly'));
    assert.match(text, /Credits\/Tokens\$0\.00/);
    assert.doesNotMatch(text, /Plan usage limits|Full usage|Refresh/);

    const refreshButton = dialog.querySelector<HTMLButtonElement>('button[aria-label="Refresh"]');
    assert.ok(refreshButton);
    const requestCountBeforeRefresh = providerUsageRequests.length;
    await React.act(async () => {
      refreshButton.click();
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });
    assert.equal(providerUsageRequests.length, requestCountBeforeRefresh + 1);
    assert.match(providerUsageRequests.at(-1) || '', /[?&]refresh=true/);

    const link = dialog.querySelector<HTMLAnchorElement>('a');
    assert.equal(link?.textContent?.trim(), 'Manage Plan and Balance');
    assert.equal(link?.href, 'https://claude.ai/new#settings/usage');

    const breakdown = dialog.querySelector<HTMLButtonElement>(
      'button[aria-label="Session breakdown"]',
    );
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
    assert.match(breakdownText, /What is in the window/);
    assert.match(breakdownText, /Messages97,721/);
    // Expanded in place, so the session line it explains and the plan windows
    // stay on screen beside it rather than being swapped out.
    assert.match(breakdownText, /118k \/ 934k13%/);
    assert.match(breakdownText, /5-hour limit|Weekly/);
  });

  test('a session with no live frame derives its ceiling, and never lends it to another provider', async () => {
    const props = {
      request: { id: 0, view: 'summary' as const },
      onRequestBreakdown: () => {},
      onRefreshBreakdown: () => {},
      isRefreshingBreakdown: false,
      canRefreshBreakdown: false,
    };
    const host = await mount(
      <TokenUsageSummary provider="claude" usage={{ used: 0 }} model="opus" {...props} />,
    );
    const { dialog } = await openPopover(host);

    // Nothing has streamed, so the numbers come from the model and settings.json
    // rather than reading as a bare "0 tokens".
    assert.match(dialog.textContent || '', /Session0 \/ 167k · Custom0%/);

    // The composer survives a session switch; the Claude ceiling must not.
    await React.act(async () => {
      root?.render(<TokenUsageSummary provider="codex" usage={{ used: 0 }} {...props} />);
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });
    const codexText = document.querySelector('[role="dialog"]')?.textContent || '';
    assert.match(codexText, /Session0 tokens0%/);
    assert.doesNotMatch(codexText, /167k|Custom/);
  });

  test('a capped ceiling names its source and the model window behind it', async () => {
    const host = await mount(
      <TokenUsageSummary
        provider="claude"
        usage={{
          used: 114_222,
          total: 200_000,
          autoCompactThreshold: 167_000,
          isAutoCompactEnabled: true,
          ceilingSource: 'settings',
          ceilingCap: 200_000,
          modelContextWindow: 1_000_000,
        }}
        request={{ id: 0, view: 'summary' }}
        onRequestBreakdown={() => {}}
        onRefreshBreakdown={() => {}}
        isRefreshingBreakdown={false}
        canRefreshBreakdown={false}
      />,
    );
    const { dialog } = await openPopover(host);
    const text = dialog.textContent || '';

    assert.match(text, /114k \/ 167k · Custom/);
    // The cap belongs to the breakdown, so no row gains a second line here.
    assert.doesNotMatch(text, /capped at/);
    assert.doesNotMatch(text, /· Auto/);
    // The source word is the way in to the setting that produced it.
    assert.ok(dialog.querySelector('button[title="Auto-compact settings"]'));
  });

  test('an uncapped ceiling says auto and shows no cap line', async () => {
    const host = await mount(
      <TokenUsageSummary
        provider="claude"
        usage={{
          used: 122_942,
          total: 1_000_000,
          autoCompactThreshold: 967_000,
          isAutoCompactEnabled: true,
          ceilingSource: 'auto',
          modelContextWindow: 1_000_000,
        }}
        request={{ id: 0, view: 'summary' }}
        onRequestBreakdown={() => {}}
        onRefreshBreakdown={() => {}}
        isRefreshingBreakdown={false}
        canRefreshBreakdown={false}
      />,
    );
    const { dialog } = await openPopover(host);
    const text = dialog.textContent || '';

    assert.match(text, /123k \/ 967k · Auto/);
    assert.doesNotMatch(text, /capped at/);
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

    assert.match(text, /Context & Usage/);
    assert.match(text, /Session42k \/ 258k16%/);
    assert.equal(dialog.querySelector('button[aria-label="Session breakdown"]'), null);
    assert.match(text, /WeeklyResets in \d+d \d+h52%/);
    // The per-window usage link is a chevron now, so it is named, not labelled.
    const labels = [...dialog.querySelectorAll('[aria-label]')]
      .map((node) => node.getAttribute('aria-label'));
    assert.ok(labels.includes('View Weekly usage'));
    assert.doesNotMatch(text, /5-hour/);
    assert.doesNotMatch(text, /Auto(?: off)?/);
    assert.match(text, /Credits\/Tokens\$25\.00/);
    assert.equal(
      dialog.querySelector<HTMLAnchorElement>('a')?.href,
      'https://chatgpt.com/#settings/Usage',
    );

    const usageButton = [...dialog.querySelectorAll<HTMLButtonElement>('button')]
      .find((button) => button.getAttribute('aria-label') === 'View Weekly usage');
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

  test('an expanded breakdown does not carry one session\'s reading into the next', async () => {
    const summary = (sessionKey: string) => (
      <TokenUsageSummary
        provider="claude"
        usage={{ used: 10_000, total: 200_000 }}
        request={{
          id: 1,
          view: 'breakdown',
          context: {
            provider: 'claude',
            detail: 'full',
            usedTokens: 10_000,
            breakdown: { categories: [{ name: 'Session A memory', tokens: 4_000 }] },
          },
        }}
        onRequestBreakdown={() => {}}
        onRefreshBreakdown={() => {}}
        isRefreshingBreakdown={false}
        canRefreshBreakdown={false}
        sessionKey={sessionKey}
      />
    );
    // The `/context` request opens the panel itself, so no trigger click here.
    await mount(summary('session-a'));
    const dialog = document.querySelector('[role="dialog"]');
    assert.ok(dialog);
    assert.match(dialog.textContent || '', /Session A memory/);

    await React.act(async () => root?.render(summary('session-b')));
    const switched = document.querySelector('[role="dialog"]');
    assert.ok(switched);
    assert.doesNotMatch(switched.textContent || '', /Session A memory/);
    assert.equal(
      switched.querySelector('button[aria-label="Session breakdown"]')?.getAttribute('aria-expanded'),
      'false',
    );
  });
});

describe('ComposerMenus', () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;

  before(async () => {
    const chatTranslations = JSON.parse(readFileSync(
      new URL('../../../../i18n/locales/en/chat.json', import.meta.url),
      'utf8',
    )) as Record<string, unknown>;
    await i18next.use(initReactI18next).init({
      lng: 'en',
      fallbackLng: false,
      defaultNS: 'chat',
      resources: { en: { chat: chatTranslations } },
    });
  });

  afterEach(async () => {
    await React.act(async () => root?.unmount());
    container?.remove();
    document.querySelectorAll('[role="menu"]').forEach((menu) => menu.remove());
    root = null;
    container = null;
  });

  const mount = async (element: React.ReactNode) => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    await React.act(async () => root?.render(element));
    return container;
  };

  test('routine permission toggle includes provider Auto but excludes elevated and special modes', () => {
    const modes = ['default', 'auto', 'acceptEdits', 'bypassPermissions', 'plan'];
    assert.equal(getNextRoutinePermissionMode('default', modes), 'auto');
    assert.equal(getNextRoutinePermissionMode('auto', modes), 'acceptEdits');
    assert.equal(getNextRoutinePermissionMode('acceptEdits', modes), 'default');
    assert.equal(getNextRoutinePermissionMode('plan', modes), 'default');
    assert.equal(getNextRoutinePermissionMode('bypassPermissions', modes), 'default');
    assert.equal(
      getNextRoutinePermissionMode('default', ['default', 'acceptEdits', 'bypassPermissions']),
      'acceptEdits',
    );
  });

  test('dragging across the effort track previews locally and commits once on release', async () => {
    const effortSelections: string[] = [];
    const host = await mount(
      <ComposerModelMenu
        effort="high"
        effortOptions={[{ value: 'low' }, { value: 'high' }]}
        onSelectEffort={(value) => effortSelections.push(value)}
        model="model-a"
        modelOptions={[{ value: 'model-a', label: 'Model A' }]}
        onSelectModel={async () => {}}
        modelsLoading={false}
        openRequest={0}
        provider="claude"
        providerLabel="Claude"
      />,
    );

    const trigger = host.querySelector('button');
    assert.ok(trigger);
    await React.act(async () => trigger.click());

    // Three stops across 208px: default 0-69, low 69-138, high 138-208.
    const effortTrack = document.querySelector<HTMLElement>('[role="radiogroup"]');
    assert.ok(effortTrack);
    effortTrack.getBoundingClientRect = () => ({
      x: 0, y: 0, left: 0, right: 208, top: 0, bottom: 32, width: 208, height: 32,
      toJSON: () => ({}),
    });
    const checkedLabel = () => document
      .querySelector<HTMLElement>('[role="radio"][aria-checked="true"]')
      ?.getAttribute('aria-label');

    await React.act(async () => {
      effortTrack.dispatchEvent(new window.MouseEvent('pointerdown', { bubbles: true, button: 0, clientX: 190 }));
      effortTrack.dispatchEvent(new window.MouseEvent('pointermove', { bubbles: true, button: 0, clientX: 10 }));
    });
    assert.equal(checkedLabel(), 'Default', 'the track paints the dragged-over stop');
    assert.deepEqual(effortSelections, [], 'a drag in progress writes nothing');

    await React.act(async () => {
      effortTrack.dispatchEvent(new window.MouseEvent('pointermove', { bubbles: true, button: 0, clientX: 100 }));
    });
    assert.equal(checkedLabel(), 'low');
    assert.deepEqual(effortSelections, [], 'crossing three stops is still one choice');

    await React.act(async () => {
      effortTrack.dispatchEvent(new window.MouseEvent('pointerup', { bubbles: true, button: 0, clientX: 100 }));
    });
    assert.deepEqual(effortSelections, ['low'], 'release commits exactly once');
  });

  test('a drag returning to where it started commits nothing', async () => {
    const effortSelections: string[] = [];
    const host = await mount(
      <ComposerModelMenu
        effort="high"
        effortOptions={[{ value: 'low' }, { value: 'high' }]}
        onSelectEffort={(value) => effortSelections.push(value)}
        model="model-a"
        modelOptions={[{ value: 'model-a', label: 'Model A' }]}
        onSelectModel={async () => {}}
        modelsLoading={false}
        openRequest={0}
        provider="claude"
        providerLabel="Claude"
      />,
    );

    const trigger = host.querySelector('button');
    assert.ok(trigger);
    await React.act(async () => trigger.click());

    const effortTrack = document.querySelector<HTMLElement>('[role="radiogroup"]');
    assert.ok(effortTrack);
    effortTrack.getBoundingClientRect = () => ({
      x: 0, y: 0, left: 0, right: 208, top: 0, bottom: 32, width: 208, height: 32,
      toJSON: () => ({}),
    });

    await React.act(async () => {
      effortTrack.dispatchEvent(new window.MouseEvent('pointerdown', { bubbles: true, button: 0, clientX: 190 }));
      effortTrack.dispatchEvent(new window.MouseEvent('pointermove', { bubbles: true, button: 0, clientX: 10 }));
      effortTrack.dispatchEvent(new window.MouseEvent('pointermove', { bubbles: true, button: 0, clientX: 190 }));
      effortTrack.dispatchEvent(new window.MouseEvent('pointerup', { bubbles: true, button: 0, clientX: 190 }));
    });
    assert.deepEqual(effortSelections, []);
    assert.equal(
      document.querySelector<HTMLElement>('[role="radio"][aria-checked="true"]')?.getAttribute('aria-label'),
      'high',
      'the preview clears back to the committed value',
    );
  });

  test('model trigger opens one menu containing reasoning and model choices', async () => {
    const effortSelections: string[] = [];
    const modelSelections: string[] = [];
    const host = await mount(
      <ComposerModelMenu
        effort="high"
        effortOptions={[{ value: 'low' }, { value: 'high' }]}
        onSelectEffort={(value) => effortSelections.push(value)}
        model="model-b"
        modelOptions={[
          { value: 'model-a', label: 'Model A', description: 'A long model description' },
          { value: 'model-b', label: 'Model B', description: 'Another long model description' },
        ]}
        onSelectModel={async (value) => { modelSelections.push(value); }}
        modelsLoading={false}
        openRequest={0}
        provider="claude"
        providerLabel="Claude"
      />,
    );

    const trigger = host.querySelector('button');
    assert.ok(trigger);
    trigger.getBoundingClientRect = () => ({
      x: 16,
      y: 700,
      left: 16,
      right: 176,
      top: 700,
      bottom: 732,
      width: 160,
      height: 32,
      toJSON: () => ({}),
    });
    Object.defineProperty(window, 'innerWidth', { value: 384, configurable: true });
    assert.match(trigger.textContent || '', /Model B/);
    assert.match(trigger.textContent || '', /high/);

    await React.act(async () => trigger.click());
    const menu = document.querySelector('[role="menu"]');
    assert.match(menu?.textContent || '', /Model A/);
    assert.match(menu?.textContent || '', /Effort/);
    assert.match(menu?.textContent || '', /high/);
    assert.doesNotMatch(menu?.textContent || '', /long model description/);
    const menuRight = Number.parseFloat((menu as HTMLElement).style.right);
    const menuMaxWidth = Number.parseFloat((menu as HTMLElement).style.maxWidth);
    assert.ok(window.innerWidth - menuRight - menuMaxWidth >= 8, 'menu stays inside the left viewport edge');

    const effortTrack = document.querySelector<HTMLElement>('[role="radiogroup"]');
    assert.ok(effortTrack);
    effortTrack.getBoundingClientRect = () => ({
      x: 0,
      y: 0,
      left: 0,
      right: 208,
      top: 0,
      bottom: 32,
      width: 208,
      height: 32,
      toJSON: () => ({}),
    });
    await React.act(async () => {
      effortTrack.dispatchEvent(new window.MouseEvent('pointerdown', { bubbles: true, button: 0, clientX: 190 }));
      effortTrack.dispatchEvent(new window.MouseEvent('pointermove', { bubbles: true, button: 0, clientX: 10 }));
      effortTrack.dispatchEvent(new window.MouseEvent('pointerup', { bubbles: true, button: 0, clientX: 10 }));
    });
    assert.deepEqual(effortSelections, ['default']);

    const lowEffortButton = document.querySelector<HTMLButtonElement>('[role="radio"][aria-label="low"]');
    assert.ok(lowEffortButton);
    await React.act(async () => lowEffortButton.click());
    assert.deepEqual(effortSelections, ['default', 'low']);
    assert.ok(document.querySelector('[role="menu"]'), 'effort selection keeps the combined menu open');

    const modelAButton = [...document.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]')]
      .find((button) => button.textContent?.includes('Model A'));
    assert.ok(modelAButton);
    await React.act(async () => modelAButton.click());
    assert.deepEqual(modelSelections, ['model-a']);
  });

  test('model selection stays open and reports a failed session update', async () => {
    const host = await mount(
      <ComposerModelMenu
        effort="default"
        effortOptions={[]}
        onSelectEffort={() => {}}
        model="model-a"
        modelOptions={[
          { value: 'model-a', label: 'Model A' },
          { value: 'model-b', label: 'Model B' },
        ]}
        onSelectModel={async () => {
          throw new Error('Unable to change the active model for this session.');
        }}
        modelsLoading={false}
        openRequest={0}
        provider="claude"
        providerLabel="Claude"
      />,
    );

    const trigger = host.querySelector<HTMLButtonElement>('button');
    assert.ok(trigger);
    await React.act(async () => trigger.click());
    const modelBButton = [...document.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]')]
      .find((button) => button.textContent?.includes('Model B'));
    assert.ok(modelBButton);

    await React.act(async () => modelBButton.click());

    assert.ok(document.querySelector('[role="menu"]'), 'failed selection leaves the menu open');
    assert.match(
      document.querySelector('[role="alert"]')?.textContent || '',
      /Unable to change the active model for this session/,
    );
  });

  const mountModelMenu = (overrides: Partial<React.ComponentProps<typeof ComposerModelMenu>> = {}) => mount(
    <ComposerModelMenu
      effort="default"
      effortOptions={[]}
      onSelectEffort={() => {}}
      model="model-a"
      modelOptions={[{ value: 'model-a', label: 'Model A' }]}
      onSelectModel={async () => {}}
      modelsLoading={false}
      openRequest={0}
      provider="claude"
      providerLabel="Claude"
      providerOptions={[
        { value: 'claude', label: 'Claude' },
        { value: 'codex', label: 'Codex' },
        { value: 'cursor', label: 'Cursor' },
        { value: 'opencode', label: 'OpenCode' },
      ]}
      {...overrides}
    />,
  );

  test('a new chat can switch provider from the model menu', async () => {
    const providerSelections: string[] = [];
    const host = await mountModelMenu({ onSelectProvider: (next) => providerSelections.push(next) });

    const trigger = host.querySelector<HTMLButtonElement>('button');
    assert.ok(trigger);
    await React.act(async () => trigger.click());

    const providerRow = document.querySelector<HTMLButtonElement>('[role="menu"] [aria-label="Select model provider"]');
    assert.ok(providerRow, 'the model menu heads with the provider');
    assert.match(providerRow.textContent || '', /Claude/);
    await React.act(async () => providerRow.click());

    const menu = document.querySelector('[role="menu"]');
    assert.match(menu?.textContent || '', /Codex/);
    assert.match(menu?.textContent || '', /OpenCode/);
    assert.doesNotMatch(menu?.textContent || '', /Model A/, 'the provider list replaces the model list');

    const codexButton = [...document.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]')]
      .find((button) => button.textContent?.includes('Codex'));
    assert.ok(codexButton);
    await React.act(async () => codexButton.click());

    assert.deepEqual(providerSelections, ['codex']);
    assert.match(
      document.querySelector('[role="menu"]')?.textContent || '',
      /Model A/,
      'picking a provider returns to the model list',
    );
  });

  test('an established session shows its provider without offering a switch', async () => {
    const host = await mountModelMenu({ onSelectProvider: null });

    const trigger = host.querySelector<HTMLButtonElement>('button');
    assert.ok(trigger);
    await React.act(async () => trigger.click());

    const menu = document.querySelector('[role="menu"]');
    assert.match(menu?.textContent || '', /Claude/, 'the provider stays visible as a label');
    assert.equal(
      document.querySelector('[role="menu"] [aria-label="Select model provider"]'),
      null,
      'no provider switcher once the session exists',
    );
  });

  test('permission trigger toggles routine access while the chevron opens every mode', async () => {
    const selections: string[] = [];
    const host = await mount(
      <ComposerPermissionMenu
        permissionMode="default"
        permissionModes={['default', 'auto', 'acceptEdits', 'bypassPermissions']}
        onSelectPermissionMode={(mode) => selections.push(mode)}
        collaborationMode={null}
        collaborationModes={[]}
        onSelectCollaborationMode={() => {}}
        provider="claude"
        providerLabel="Claude"
      />,
    );

    const trigger = host.querySelector<HTMLButtonElement>('button');
    assert.ok(trigger);
    await React.act(async () => trigger.click());
    assert.deepEqual(selections, ['auto']);
    assert.equal(document.querySelector('[role="menu"]'), null, 'quick toggle does not open the full picker');

    const menuTrigger = host.querySelector<HTMLButtonElement>('[aria-label="Show all access modes"]');
    assert.ok(menuTrigger);
    await React.act(async () => menuTrigger.click());

    const menu = document.querySelector('[role="menu"]');
    assert.match(menu?.textContent || '', /Permissions/);
    assert.match(menu?.textContent || '', /Ask Before Tools/);
    assert.doesNotMatch(menu?.textContent || '', /Default Mode/);

    const bypassButton = [...document.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]')]
      .find((button) => button.textContent?.toLowerCase().includes('bypass'));
    assert.ok(bypassButton);
    await React.act(async () => bypassButton.click());
    assert.deepEqual(selections, ['auto', 'bypassPermissions']);
  });

  test('long press opens every permission mode and suppresses the following quick toggle', async () => {
    const selections: string[] = [];
    const host = await mount(
      <ComposerPermissionMenu
        permissionMode="default"
        permissionModes={['default', 'acceptEdits', 'bypassPermissions']}
        onSelectPermissionMode={(mode) => selections.push(mode)}
        collaborationMode={null}
        collaborationModes={[]}
        onSelectCollaborationMode={() => {}}
        provider="codex"
        providerLabel="Codex"
      />,
    );

    const trigger = host.querySelector<HTMLButtonElement>('button');
    assert.ok(trigger);
    const touchStart = new window.Event('touchstart', { bubbles: true, cancelable: true });
    Object.defineProperty(touchStart, 'touches', {
      value: [{ clientX: 40, clientY: 700 }],
    });
    await React.act(async () => {
      trigger.dispatchEvent(touchStart);
      await new Promise((resolve) => window.setTimeout(resolve, 550));
    });

    assert.ok(document.querySelector('[role="menu"]'), 'long press opens the complete picker');
    await React.act(async () => trigger.click());
    assert.deepEqual(selections, [], 'synthetic click after long press is swallowed');
    await React.act(async () => trigger.dispatchEvent(new window.Event('touchend', { bubbles: true })));
  });

  test('Codex access presets stay independent from Build and Plan collaboration', async () => {
    const permissionSelections: string[] = [];
    const collaborationSelections: string[] = [];
    const host = await mount(
      <ComposerPermissionMenu
        permissionMode="acceptEdits"
        permissionModes={['default', 'acceptEdits', 'bypassPermissions']}
        onSelectPermissionMode={(mode) => permissionSelections.push(mode)}
        collaborationMode="build"
        collaborationModes={['build', 'plan']}
        onSelectCollaborationMode={(mode) => collaborationSelections.push(mode)}
        provider="codex"
        providerLabel="Codex"
      />,
    );

    const menuTrigger = host.querySelector<HTMLButtonElement>('[aria-label="Show all access modes"]');
    assert.ok(menuTrigger);
    await React.act(async () => menuTrigger.click());

    const menu = document.querySelector('[role="menu"]');
    assert.match(menu?.textContent || '', /Permissions/);
    assert.match(menu?.textContent || '', /Ask When Needed/);
    assert.match(menu?.textContent || '', /Auto in Workspace/);
    assert.match(menu?.textContent || '', /Full Access/);
    assert.doesNotMatch(menu?.textContent || '', /Default Mode|Accept Edits|Bypass Permissions/);

    const desktopModes = host.querySelector<HTMLElement>('[role="radiogroup"]');
    assert.ok(desktopModes);
    assert.match(desktopModes.className, /sm:flex/, 'desktop keeps collaboration outside the access picker');
    const planButton = [...desktopModes.querySelectorAll<HTMLButtonElement>('[role="radio"]')]
      .find((button) => button.textContent?.includes('Plan'));
    assert.ok(planButton);
    await React.act(async () => planButton.click());

    assert.deepEqual(collaborationSelections, ['plan']);
    assert.deepEqual(permissionSelections, []);

    const mobileModeGroup = document.querySelector<HTMLElement>('[role="menu"] [role="group"]');
    assert.ok(mobileModeGroup);
    assert.match(mobileModeGroup.className, /sm:hidden/, 'mobile keeps collaboration in the complete picker');
  });
});

describe('NativeImageAttachmentPicker', () => {
  test('renders the real file input over the visible attachment control', () => {
    let requestedProps: Record<string, unknown> | undefined;
    const html = renderToStaticMarkup(
      React.createElement(NativeImageAttachmentPicker, {
        label: 'Attach images',
        getInputProps: (props: unknown) => {
          requestedProps = props as Record<string, unknown>;
          return { ...requestedProps, accept: 'image/*', multiple: true, type: 'file' };
        },
      }),
    );

    assert.equal(requestedProps?.['aria-label'], 'Attach images');
    assert.equal(requestedProps?.tabIndex, 0);
    assert.deepEqual(requestedProps?.style, {
      position: 'absolute',
      inset: 0,
      width: '100%',
      height: '100%',
      opacity: 0,
      cursor: 'pointer',
    });
    assert.match(html, /<input[^>]+type="file"/);
    assert.match(html, /<input[^>]+aria-label="Attach images"/);
    assert.doesNotMatch(html, /<button/);
    assert.match(html, /lucide-plus/);
    assert.doesNotMatch(html, /lucide-paperclip/);
  });
});
