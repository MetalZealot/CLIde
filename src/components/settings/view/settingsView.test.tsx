import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test, { after, afterEach, before, beforeEach, describe } from 'node:test';

import i18next from 'i18next';
import React, { useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { initReactI18next } from 'react-i18next';

import { api } from '../../../utils/api';
import { AUTH_TOKEN_STORAGE_KEY } from '../../auth/constants';
import { AuthProvider } from '../../auth/context/AuthContext';
import type { ProviderRuntimeVersions } from '../../provider-auth/types';
import SidebarAccountMenu from '../../sidebar/view/subcomponents/SidebarAccountMenu';
import type { AuthStatus, NotificationPreferencesState } from '../types/types';

import SettingsChoicePopover from './primitives/SettingsChoicePopover';
import AccountScreen from './screens/AccountScreen';
import ChatVoiceBackendScreen from './screens/ChatVoiceBackendScreen';
import AgentAccountCard from './sections/agent/AgentAccountCard';
import AgentCodexRuntimeSection from './sections/agent/AgentCodexRuntimeSection';

describe('SettingsChoicePopover', () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;

  afterEach(async () => {
    await React.act(async () => root?.unmount());
    container?.remove();
    root = null;
    container = null;
  });

  const options = [
    { value: 'smallest', label: 'Smallest', detail: '14 px' },
    { value: 'small', label: 'Small', detail: '15 px' },
    { value: 'default', label: 'Default', detail: '16 px' },
    { value: 'large', label: 'Large', detail: '17 px' },
  ] as const;

  const mount = async () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    const Harness = () => {
      const [value, setValue] = useState<(typeof options)[number]['value']>('default');
      return (
        <div>
          <output>{value}</output>
          <SettingsChoicePopover
            value={value}
            options={[...options]}
            onChange={setValue}
            ariaLabel="Reading size"
          />
        </div>
      );
    };

    await React.act(async () => root?.render(<Harness />));
    return container;
  };

  test('shows the selected label and faded metric, then saves a tapped option', async () => {
    const host = await mount();
    const trigger = host.querySelector<HTMLButtonElement>('[role="combobox"]');
    assert.equal(trigger?.textContent?.replace(/\s+/g, ' ').trim(), 'Default16 px');

    await React.act(async () => trigger?.click());
    const listbox = document.querySelector('[role="listbox"]');
    assert.ok(listbox);
    assert.equal(listbox.querySelectorAll('[role="option"]').length, 4);
    assert.equal(listbox.querySelector('[aria-selected="true"]')?.textContent?.replace(/\s+/g, ' ').trim(), 'Default16 px');

    const large = [...listbox.querySelectorAll<HTMLButtonElement>('[role="option"]')]
      .find((option) => option.textContent?.includes('Large'));
    await React.act(async () => large?.click());

    assert.equal(host.querySelector('output')?.textContent, 'large');
    assert.equal(document.querySelector('[role="listbox"]'), null);
  });

  test('supports arrow navigation, selection, and Escape without moving DOM focus', async () => {
    const host = await mount();
    const trigger = host.querySelector<HTMLButtonElement>('[role="combobox"]');
    assert.ok(trigger);
    trigger.focus();

    await React.act(async () => trigger.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })));
    assert.equal(trigger.getAttribute('aria-expanded'), 'true');
    assert.match(trigger.getAttribute('aria-activedescendant') ?? '', /option-2$/);

    await React.act(async () => trigger.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })));
    assert.match(trigger.getAttribute('aria-activedescendant') ?? '', /option-3$/);
    await React.act(async () => trigger.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
    assert.equal(host.querySelector('output')?.textContent, 'large');

    await React.act(async () => trigger.click());
    await React.act(async () => trigger.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    assert.equal(trigger.getAttribute('aria-expanded'), 'false');
    assert.equal(document.activeElement, trigger);
  });

  test('supports type-ahead for longer option lists', async () => {
    const host = await mount();
    const trigger = host.querySelector<HTMLButtonElement>('[role="combobox"]');
    assert.ok(trigger);

    await React.act(async () => trigger.click());
    await React.act(async () => trigger.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'l', bubbles: true })));
    assert.match(trigger.getAttribute('aria-activedescendant') ?? '', /option-3$/);
    await React.act(async () => trigger.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
    assert.equal(host.querySelector('output')?.textContent, 'large');
  });
});

describe('ChatVoiceBackendScreen', () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;
  const originalFetch = globalThis.fetch;

  before(async () => {
    const settingsTranslations = JSON.parse(readFileSync(
      new URL('../../../i18n/locales/en/settings.json', import.meta.url),
      'utf8',
    )) as Record<string, unknown>;
    await i18next.use(initReactI18next).init({
      lng: 'en',
      fallbackLng: false,
      defaultNS: 'settings',
      resources: { en: { settings: settingsTranslations } },
    });
  });

  afterEach(async () => {
    await React.act(async () => root?.unmount());
    container?.remove();
    document.querySelectorAll('[role="listbox"]').forEach((listbox) => listbox.parentElement?.parentElement?.remove());
    localStorage.clear();
    globalThis.fetch = originalFetch;
    root = null;
    container = null;
  });

  const render = async () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    await React.act(async () => root?.render(<ChatVoiceBackendScreen />));
    return container;
  };

  const flush = async () => {
    await React.act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  };

  test('uses the server catalog, resolves its default, and saves a selected voice', async () => {
    localStorage.setItem('voiceConfig', JSON.stringify({ ttsVoice: 'libritts_r-id10340' }));
    globalThis.fetch = (async () => new Response(JSON.stringify({
      configured: true,
      defaultVoice: 'hfc-male-medium',
      voices: [
        { id: 'danny-low', label: 'Danny', gender: 'male', tier: 'low', locale: 'en-US' },
        { id: 'hfc-male-medium', label: 'HFC Male', gender: 'male', tier: 'medium', locale: 'en-US' },
        { id: 'cori-medium', label: 'Cori', gender: 'female', tier: 'medium-gb', locale: 'en-GB' },
      ],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })) as typeof fetch;

    const host = await render();
    await flush();

    const trigger = host.querySelector<HTMLButtonElement>('[role="combobox"][aria-label^="Voice"]');
    assert.ok(trigger);
    assert.match(trigger.textContent ?? '', /HFC Male.*Male · Medium/);
    assert.equal(JSON.parse(localStorage.getItem('voiceConfig') ?? '{}').ttsVoice, '');

    await React.act(async () => trigger.click());
    const options = [...document.querySelectorAll<HTMLButtonElement>('[role="option"]')];
    assert.deepEqual(options.map((option) => option.textContent?.replace(/\s+/g, ' ').trim()), [
      'DannyMale · Low',
      'HFC MaleMale · Medium',
      'CoriFemale · Medium GB',
    ]);
    await React.act(async () => options[2]?.click());
    assert.equal(JSON.parse(localStorage.getItem('voiceConfig') ?? '{}').ttsVoice, 'cori-medium');
  });

  test('keeps free-text voice input for a custom browser backend', async () => {
    let requests = 0;
    globalThis.fetch = (async () => {
      requests += 1;
      return new Response('{}', { status: 200 });
    }) as typeof fetch;
    localStorage.setItem('voiceConfig', JSON.stringify({
      baseUrl: 'https://voice.example/v1',
      ttsVoice: 'custom-voice',
    }));

    const host = await render();
    const voiceInput = host.querySelector<HTMLInputElement>('input[aria-label="Voice"]');
    assert.equal(voiceInput?.value, 'custom-voice');
    assert.equal(requests, 0);
  });
});

describe('AccountScreen', () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;

  const originalStatus = api.auth.status;
  const originalUser = api.auth.user;
  const originalOnboarding = api.user.onboardingStatus;

  const jsonResponse = (body: unknown) => ({
    ok: true,
    status: 200,
    json: async () => body,
  }) as Response;

  before(async () => {
    const loadTranslations = (filename: string) => JSON.parse(readFileSync(
      new URL(`../../../i18n/locales/en/${filename}.json`, import.meta.url),
      'utf8',
    )) as Record<string, unknown>;

    await i18next.use(initReactI18next).init({
      lng: 'en',
      fallbackLng: false,
      defaultNS: 'settings',
      resources: {
        en: {
          settings: loadTranslations('settings'),
          sidebar: loadTranslations('sidebar'),
          common: loadTranslations('common'),
        },
      },
    });
  });

  beforeEach(() => {
    localStorage.setItem(AUTH_TOKEN_STORAGE_KEY, 'test-token');
    api.auth.status = async () => jsonResponse({ needsSetup: false });
    api.auth.user = async () => jsonResponse({ user: { username: 'grayson' } });
    api.user.onboardingStatus = async () => jsonResponse({ hasCompletedOnboarding: true });
  });

  afterEach(async () => {
    await React.act(async () => root?.unmount());
    container?.remove();
    document.querySelectorAll('[role="menu"]').forEach((menu) => menu.parentElement?.remove());
    localStorage.clear();
    root = null;
    container = null;
  });

  after(() => {
    api.auth.status = originalStatus;
    api.auth.user = originalUser;
    api.user.onboardingStatus = originalOnboarding;
  });

  const render = async (children: React.ReactNode) => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    await React.act(async () => {
      root?.render(<AuthProvider>{children}</AuthProvider>);
    });

    return container;
  };

  test('the sidebar Account popover contains navigation only', async () => {
    const host = await render(
      <SidebarAccountMenu onShowSettings={() => {}} onShowUsage={() => {}} t={i18next.getFixedT('en', 'sidebar')} />,
    );

    const trigger = host.querySelector<HTMLButtonElement>('button[aria-label="Account menu"]');
    assert.ok(trigger);
    await React.act(async () => trigger.click());

    const menu = document.querySelector<HTMLElement>('[role="menu"][aria-label="Account menu"]');
    assert.ok(menu);
    assert.deepEqual(
      [...menu.querySelectorAll('[role="menuitem"]')].map((item) => item.textContent),
      ['Account', 'Usage', 'Settings'],
    );
  });

  test('the Account screen ends with the Log out action', async () => {
    const host = await render(<AccountScreen />);
    const groups = host.querySelectorAll('section');
    const lastGroup = groups.item(groups.length - 1);
    const logoutButton = lastGroup.querySelector<HTMLButtonElement>('button');

    assert.match(lastGroup.textContent ?? '', /Sign out of CLIde on this device/);
    assert.equal(logoutButton?.textContent?.trim(), 'Log out');

    await React.act(async () => logoutButton?.click());
    assert.equal(localStorage.getItem(AUTH_TOKEN_STORAGE_KEY), null);
  });
});

describe('AgentAccountCard', () => {
  /**
   * Covers the Runtime row only. Every case renders unauthenticated on purpose:
   * that disables the plan-usage fetch and the reset toggle, so the card's one
   * remaining request is the capability matrix and the row under test is the
   * only thing that varies.
   */

  let root: Root | null = null;
  let container: HTMLDivElement | null = null;
  const originalFetch = globalThis.fetch;

  const preferences: NotificationPreferencesState = {
    channels: { inApp: true, webPush: false, desktop: false, sound: false },
    events: { actionRequired: true, stop: true, error: true, usageReset: {} },
  };

  const authStatus = (versions: ProviderRuntimeVersions | null): AuthStatus => ({
    authenticated: false,
    email: null,
    method: null,
    error: null,
    loading: false,
    versions,
  });

  before(async () => {
    const settingsTranslations = JSON.parse(readFileSync(
      new URL('../../../i18n/locales/en/settings.json', import.meta.url),
      'utf8',
    )) as Record<string, unknown>;
    const commonTranslations = JSON.parse(readFileSync(
      new URL('../../../i18n/locales/en/common.json', import.meta.url),
      'utf8',
    )) as Record<string, unknown>;
    await i18next.use(initReactI18next).init({
      lng: 'en',
      fallbackLng: false,
      defaultNS: 'settings',
      resources: { en: { settings: settingsTranslations, common: commonTranslations } },
    });

    globalThis.fetch = (async () => new Response(
      JSON.stringify({ success: true, data: { providers: [] } }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    )) as typeof globalThis.fetch;
  });

  after(() => {
    globalThis.fetch = originalFetch;
  });

  afterEach(async () => {
    await React.act(async () => root?.unmount());
    container?.remove();
    root = null;
    container = null;
  });

  const render = async (versions: ProviderRuntimeVersions | null): Promise<HTMLElement> => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    await React.act(async () => {
      root?.render(React.createElement(AgentAccountCard, {
        provider: 'claude',
        authStatus: authStatus(versions),
        onLogin: () => {},
        notificationPreferences: preferences,
        onNotificationPreferencesChange: () => {},
        onOpenNotifications: () => {},
      }));
    });

    return container;
  };

  test('the reported pair shows as one Runtime row', async () => {
    const host = await render({
      runtime: '2.1.233',
      sdk: '0.3.233',
      observedAt: new Date().toISOString(),
    });

    assert.match(host.textContent ?? '', /Runtime/);
    assert.match(host.textContent ?? '', /2\.1\.233 · SDK 0\.3\.233/);
    // A pair that has never moved says nothing more than the two numbers.
    assert.doesNotMatch(host.textContent ?? '', /moved/);
  });

  test('a recent move names the half that moved and how long ago it was seen', async () => {
    const host = await render({
      runtime: '2.1.233',
      sdk: '0.3.233',
      observedAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
      previous: {
        runtime: '2.1.229',
        sdk: '0.3.233',
        observedAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(),
      },
    });

    assert.match(host.textContent ?? '', /Claude runtime moved 2\.1\.229 → 2\.1\.233/);
    assert.match(host.textContent ?? '', /Seen 2h ago/);
    // The SDK half did not move, so it must not be mentioned.
    assert.doesNotMatch(host.textContent ?? '', /Agent SDK moved/);
  });

  test('a provider that reports no versions gets no Runtime row', async () => {
    const host = await render(null);

    assert.doesNotMatch(host.textContent ?? '', /Runtime/);
  });
});

describe('AgentCodexRuntimeSection', () => {
  const bundledId = 'runtime_111111111111111111111111';
  const candidateId = 'runtime_222222222222222222222222';
  const alternateId = 'runtime_333333333333333333333333';
  const bundledPath = '~/Projects/CLIde/node_modules/@openai/codex/vendor/bin/codex';
  const candidatePath = '~/.codex/packages/standalone/releases/0.147.0-arm64/bin/codex';
  const alternatePath = '~/.local/node_modules/@openai/codex/bin/codex';
  const installations = [
    {
      id: bundledId,
      version: '0.147.0',
      displayPath: bundledPath,
      sources: ['bundled'],
      bundled: true,
    },
    {
      id: candidateId,
      version: '0.147.0',
      displayPath: candidatePath,
      sources: ['path'],
      bundled: false,
    },
    {
      id: alternateId,
      version: '0.147.0',
      displayPath: alternatePath,
      sources: ['known'],
      bundled: false,
    },
  ];

  let root: Root | null = null;
  let container: HTMLDivElement | null = null;
  const originalFetch = globalThis.fetch;

  before(async () => {
    const settingsTranslations = JSON.parse(readFileSync(
      new URL('../../../i18n/locales/en/settings.json', import.meta.url),
      'utf8',
    )) as Record<string, unknown>;
    await i18next.use(initReactI18next).init({
      lng: 'en',
      fallbackLng: false,
      defaultNS: 'settings',
      resources: { en: { settings: settingsTranslations } },
    });
  });

  after(() => {
    globalThis.fetch = originalFetch;
  });

  afterEach(async () => {
    await React.act(async () => root?.unmount());
    container?.remove();
    root = null;
    container = null;
  });

  const flush = async () => {
    await React.act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 0));
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });
  };

  const findButton = (host: HTMLElement, label: string): HTMLButtonElement => {
    const button = [...host.querySelectorAll('button')].find((item) => item.textContent === label);
    assert.ok(button, `no button labelled "${label}"`);
    return button;
  };

  const hasButton = (host: HTMLElement, label: string): boolean => (
    [...host.querySelectorAll('button')].some((item) => item.textContent === label)
  );

  const installationRow = (host: HTMLElement, fullPath: string): HTMLElement => {
    const pathButton = host.querySelector<HTMLButtonElement>(`button[title="${fullPath}"]`);
    assert.ok(pathButton?.parentElement);
    return pathButton.parentElement;
  };

  test('runtime section expands in place, gates Use behind Check, and rolls back the previous install', async () => {
    let activeInstallationId = bundledId;
    let previousInstallationId: string | null = null;
    const selectionRequests: string[] = [];
    const status = () => ({
      installations,
      activeInstallationId,
      previousInstallationId,
      liveProcessInstallationId: bundledId,
      sdkVersion: '0.147.0',
      liveProcessVersion: '0.147.0',
      updatePending: activeInstallationId !== bundledId,
      activeError: null,
    });

    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      let data: unknown;
      if (url.endsWith('/capabilities')) {
        data = {
          chatTransport: {
            configured: 'app-server',
            actual: 'app-server',
            health: 'ready',
            sdkVersion: '0.147.0',
            bundledCliVersion: '0.147.0',
            lastError: null,
            lastStartupFallbackAt: null,
          },
        };
      } else if (url.endsWith('/check')) {
        const body = JSON.parse(String(init?.body)) as { installationId: string };
        data = {
          installationId: body.installationId,
          compatibility: 'compatible',
          detail: null,
        };
      } else if (url.endsWith('/selection')) {
        const body = JSON.parse(String(init?.body)) as { installationId: string };
        selectionRequests.push(body.installationId);
        previousInstallationId = activeInstallationId;
        activeInstallationId = body.installationId;
        data = status();
      } else {
        data = status();
      }
      return new Response(JSON.stringify({ success: true, data }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch;

    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    await React.act(async () => root?.render(<AgentCodexRuntimeSection />));
    await flush();

    // Collapsed, it reads exactly like Claude's row: the version pair and nothing
    // else. The installation list only exists once the row is expanded.
    assert.match(container.textContent ?? '', /0\.147\.0 · SDK 0\.147\.0/);
    assert.equal(container.querySelectorAll('button').length, 1);

    const toggle = container.querySelector<HTMLButtonElement>('button[aria-expanded]');
    assert.ok(toggle);
    await React.act(async () => toggle.click());
    await flush();

    // Paths are compacted to version + binary, and no raw enum reaches the user.
    assert.doesNotMatch(container.textContent ?? '', /Projects\/CLIde/);
    assert.match(container.textContent ?? '', /…\/node_modules\/…\/bin\/codex/);
    assert.match(container.textContent ?? '', /…\/standalone\/releases\/…\/bin\/codex/);
    assert.doesNotMatch(container.textContent ?? '', /app-server/);
    assert.match(container.textContent ?? '', /App Server/);
    assert.match(container.textContent ?? '', /Ready/);

    // One state badge per row: no Candidate, no Live, and Bundled is a sentence.
    assert.doesNotMatch(container.textContent ?? '', /Candidate/);
    assert.match(container.textContent ?? '', /Bundled with CLIde/);

    const bundledRow = installationRow(container, bundledPath);
    const candidateRow = installationRow(container, candidatePath);
    const alternateRow = installationRow(container, alternatePath);

    assert.equal(hasButton(bundledRow, 'Check'), false);
    assert.equal(hasButton(bundledRow, 'Roll back'), false);
    assert.equal(findButton(candidateRow, 'Use').disabled, true);
    assert.equal(findButton(alternateRow, 'Use').disabled, true);

    await React.act(async () => findButton(alternateRow, 'Check').click());
    await flush();
    assert.match(alternateRow.textContent ?? '', /Structural check passed/);
    assert.doesNotMatch(candidateRow.textContent ?? '', /Structural check passed/);
    assert.equal(findButton(candidateRow, 'Use').disabled, true);
    assert.equal(findButton(alternateRow, 'Use').disabled, false);

    const candidatePathButton = candidateRow.querySelector<HTMLButtonElement>(`button[title="${candidatePath}"]`);
    assert.ok(candidatePathButton);
    await React.act(async () => candidatePathButton.click());
    assert.match(candidateRow.textContent ?? '', /\.codex\/packages\/standalone/);

    await React.act(async () => findButton(alternateRow, 'Use').click());
    await flush();
    assert.deepEqual(selectionRequests, [alternateId]);
    assert.match(container.textContent ?? '', /Switches after the current turn ends/);

    // Rollback is an action on the previous installation's own row, and replaces
    // the Check/Use pair there rather than sitting loose at the bottom.
    const previousRow = installationRow(container, bundledPath);
    assert.equal(hasButton(previousRow, 'Check'), false);
    await React.act(async () => findButton(previousRow, 'Roll back').click());
    await flush();
    assert.deepEqual(selectionRequests, [alternateId, bundledId]);
  });
});
