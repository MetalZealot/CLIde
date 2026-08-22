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
  delete document.documentElement.dataset.chatLineSpacing;
  delete document.documentElement.dataset.fontFamily;
});

const mount = async () => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);

  const Probe = () => {
    const {
      chatReadingSize,
      chatLineSpacing,
      fontFamily,
      setChatReadingSize,
      setChatLineSpacing,
      setFontFamily,
    } = useAppearancePreferences();
    const { theme, setTheme } = useTheme();
    return (
      <div>
        <output data-reading-size>{chatReadingSize}</output>
        <output data-line-spacing>{chatLineSpacing}</output>
        <output data-font-family>{fontFamily}</output>
        <output data-theme>{theme}</output>
        <button type="button" onClick={() => setChatReadingSize('large')}>Large</button>
        <button type="button" onClick={() => setChatLineSpacing('spacious')}>Spacious</button>
        <button type="button" onClick={() => setFontFamily('system')}>System font</button>
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
    parseAppearancePreferences({
      version: 99,
      theme: 'dark',
      chatReadingSize: 'huge',
      chatLineSpacing: 'cramped',
      fontFamily: 'comic-sans',
    }, 'light'),
    {
      version: 3,
      theme: 'dark',
      chatReadingSize: 'default',
      chatLineSpacing: 'standard',
      fontFamily: 'clide',
    },
  );
  assert.deepEqual(
    parseAppearancePreferences({
      version: 1,
      theme: 'sepia',
      chatReadingSize: 'compact',
      fontFamily: 'system',
    }, 'light'),
    {
      version: 3,
      theme: 'light',
      chatReadingSize: 'smallest',
      chatLineSpacing: 'standard',
      fontFamily: 'system',
    },
  );
});

test('provider migrates legacy preferences and applies typography defaults', async () => {
  localStorage.setItem('theme', 'dark');
  const host = await mount();

  assert.equal(host.querySelector('[data-theme]')?.textContent, 'dark');
  assert.equal(host.querySelector('[data-reading-size]')?.textContent, 'default');
  assert.equal(host.querySelector('[data-line-spacing]')?.textContent, 'standard');
  assert.equal(host.querySelector('[data-font-family]')?.textContent, 'clide');
  assert.equal(document.documentElement.dataset.chatReadingSize, 'default');
  assert.equal(document.documentElement.dataset.chatLineSpacing, 'standard');
  assert.equal(document.documentElement.dataset.fontFamily, 'clide');
  assert.equal(document.documentElement.classList.contains('dark'), true);
  assert.deepEqual(JSON.parse(localStorage.getItem(APPEARANCE_STORAGE_KEY) || 'null'), {
    version: 3,
    theme: 'dark',
    chatReadingSize: 'default',
    chatLineSpacing: 'standard',
    fontFamily: 'clide',
  });
});

test('typography and theme update immediately and persist together', async () => {
  const host = await mount();
  const [largeButton, spaciousButton, systemFontButton, darkButton] = host.querySelectorAll<HTMLButtonElement>('button');

  await React.act(async () => largeButton?.click());
  assert.equal(document.documentElement.dataset.chatReadingSize, 'large');
  assert.equal(host.querySelector('[data-reading-size]')?.textContent, 'large');

  await React.act(async () => spaciousButton?.click());
  assert.equal(document.documentElement.dataset.chatLineSpacing, 'spacious');
  assert.equal(host.querySelector('[data-line-spacing]')?.textContent, 'spacious');

  await React.act(async () => systemFontButton?.click());
  assert.equal(document.documentElement.dataset.fontFamily, 'system');
  assert.equal(host.querySelector('[data-font-family]')?.textContent, 'system');

  await React.act(async () => darkButton?.click());
  assert.equal(document.documentElement.classList.contains('dark'), true);
  assert.deepEqual(JSON.parse(localStorage.getItem(APPEARANCE_STORAGE_KEY) || 'null'), {
    version: 3,
    theme: 'dark',
    chatReadingSize: 'large',
    chatLineSpacing: 'spacious',
    fontFamily: 'system',
  });
});

test('a storage event applies valid preferences from another tab', async () => {
  const host = await mount();

  await React.act(async () => {
    window.dispatchEvent(new window.StorageEvent('storage', {
      key: APPEARANCE_STORAGE_KEY,
      newValue: JSON.stringify({
        version: 3,
        theme: 'light',
        chatReadingSize: 'small',
        chatLineSpacing: 'condensed',
        fontFamily: 'system',
      }),
    }));
  });

  assert.equal(host.querySelector('[data-theme]')?.textContent, 'light');
  assert.equal(host.querySelector('[data-reading-size]')?.textContent, 'small');
  assert.equal(host.querySelector('[data-line-spacing]')?.textContent, 'condensed');
  assert.equal(host.querySelector('[data-font-family]')?.textContent, 'system');
  assert.equal(document.documentElement.dataset.chatReadingSize, 'small');
  assert.equal(document.documentElement.dataset.chatLineSpacing, 'condensed');
  assert.equal(document.documentElement.dataset.fontFamily, 'system');
});
