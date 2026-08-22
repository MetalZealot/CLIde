import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test, { after, afterEach, before, beforeEach } from 'node:test';

import i18next from 'i18next';
import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { initReactI18next } from 'react-i18next';

import { AUTH_TOKEN_STORAGE_KEY } from '../../../auth/constants';
import { AuthProvider } from '../../../auth/context/AuthContext';
import SidebarAccountMenu from '../../../sidebar/view/subcomponents/SidebarAccountMenu';
import { api } from '../../../../utils/api';

import AccountScreen from './AccountScreen';

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
    new URL(`../../../../i18n/locales/en/${filename}.json`, import.meta.url),
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
