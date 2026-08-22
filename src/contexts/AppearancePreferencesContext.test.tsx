import assert from 'node:assert/strict';
import test, { afterEach } from 'node:test';

import React from 'react';
import { createRoot, type Root } from 'react-dom/client';

import {
  APPEARANCE_STORAGE_KEY,
  AppearancePreferencesProvider,
  parseAppearancePreferences,
  useAppearancePreferences,
  useTheme,
} from './AppearancePreferencesContext';

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(async () => {
  await React.act(async () => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  localStorage.clear();
  document.documentElement.classList.remove('dark');
  delete document.documentElement.dataset.chatReadingSize;
});

const mount = async () => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);

  const Probe = () => {
    const { chatReadingSize, setChatReadingSize } = useAppearancePreferences();
    const { theme, setTheme } = useTheme();
    return (
      <div>
        <output data-reading-size>{chatReadingSize}</output>
        <output data-theme>{theme}</output>
        <button type="button" onClick={() => setChatReadingSize('large')}>Large</button>
        <button type="button" onClick={() => setTheme('dark')}>Dark</button>
      </div>
    );
  };

  await React.act(async () => {
    root?.render(
      <AppearancePreferencesProvider>
        <Probe />
      </AppearancePreferencesProvider>,
    );
  });

  return container;
};

test('parser validates each stored field independently', () => {
  assert.deepEqual(
    parseAppearancePreferences({ version: 99, theme: 'dark', chatReadingSize: 'huge' }, 'light'),
    { version: 1, theme: 'dark', chatReadingSize: 'default' },
  );
  assert.deepEqual(
    parseAppearancePreferences({ theme: 'sepia', chatReadingSize: 'compact' }, 'light'),
    { version: 1, theme: 'light', chatReadingSize: 'compact' },
  );
});

test('provider migrates the legacy theme and applies the default reading size', async () => {
  localStorage.setItem('theme', 'dark');
  const host = await mount();

  assert.equal(host.querySelector('[data-theme]')?.textContent, 'dark');
  assert.equal(host.querySelector('[data-reading-size]')?.textContent, 'default');
  assert.equal(document.documentElement.dataset.chatReadingSize, 'default');
  assert.equal(document.documentElement.classList.contains('dark'), true);
  assert.deepEqual(JSON.parse(localStorage.getItem(APPEARANCE_STORAGE_KEY) || 'null'), {
    version: 1,
    theme: 'dark',
    chatReadingSize: 'default',
  });
});

test('reading size and theme update immediately and persist together', async () => {
  const host = await mount();
  const [largeButton, darkButton] = host.querySelectorAll<HTMLButtonElement>('button');

  await React.act(async () => largeButton?.click());
  assert.equal(document.documentElement.dataset.chatReadingSize, 'large');
  assert.equal(host.querySelector('[data-reading-size]')?.textContent, 'large');

  await React.act(async () => darkButton?.click());
  assert.equal(document.documentElement.classList.contains('dark'), true);
  assert.deepEqual(JSON.parse(localStorage.getItem(APPEARANCE_STORAGE_KEY) || 'null'), {
    version: 1,
    theme: 'dark',
    chatReadingSize: 'large',
  });
});

test('a storage event applies valid preferences from another tab', async () => {
  const host = await mount();

  await React.act(async () => {
    window.dispatchEvent(new window.StorageEvent('storage', {
      key: APPEARANCE_STORAGE_KEY,
      newValue: JSON.stringify({ version: 1, theme: 'light', chatReadingSize: 'compact' }),
    }));
  });

  assert.equal(host.querySelector('[data-theme]')?.textContent, 'light');
  assert.equal(host.querySelector('[data-reading-size]')?.textContent, 'compact');
  assert.equal(document.documentElement.dataset.chatReadingSize, 'compact');
});
