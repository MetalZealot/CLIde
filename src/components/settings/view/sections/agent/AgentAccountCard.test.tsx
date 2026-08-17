import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test, { after, afterEach, before } from 'node:test';

import i18next from 'i18next';
import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { initReactI18next } from 'react-i18next';

import type { ProviderRuntimeVersions } from '../../../../provider-auth/types';
import type { AuthStatus, NotificationPreferencesState } from '../../../types/types';

import AgentAccountCard from './AgentAccountCard';

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
    new URL('../../../../../i18n/locales/en/settings.json', import.meta.url),
    'utf8',
  )) as Record<string, unknown>;
  const commonTranslations = JSON.parse(readFileSync(
    new URL('../../../../../i18n/locales/en/common.json', import.meta.url),
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
