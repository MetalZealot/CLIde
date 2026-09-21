import assert from 'node:assert/strict';
import test, { afterEach } from 'node:test';

import React from 'react';
import { createRoot, type Root } from 'react-dom/client';

import { getClockFormat, setClockFormat as resetClockFormat } from '../utils/formatTime';

import {
  APPEARANCE_STORAGE_KEY,
  applyRemoteAppearancePreferences,
  AppearancePreferencesProvider,
  parseAppearancePreferences,
  readSyncedAppearancePreferences,
  subscribeToAppearanceChanges,
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
  resetClockFormat('12h');
});

const mount = async () => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);

  const Probe = () => {
    const {
      chatReadingSize,
      chatLineSpacing,
      clockFormat,
      fontFamily,
      setChatReadingSize,
      setChatLineSpacing,
      setClockFormat,
      setFontFamily,
    } = useAppearancePreferences();
    const { theme, setTheme } = useTheme();
    return (
      <div>
        <output data-reading-size>{chatReadingSize}</output>
        <output data-line-spacing>{chatLineSpacing}</output>
        <output data-font-family>{fontFamily}</output>
        <output data-theme>{theme}</output>
        <output data-clock-format>{clockFormat}</output>
        <button type="button" onClick={() => setChatReadingSize('large')}>Large</button>
        <button type="button" onClick={() => setChatLineSpacing('spacious')}>Spacious</button>
        <button type="button" onClick={() => setFontFamily('system')}>System font</button>
        <button type="button" onClick={() => setTheme('dark')}>Dark</button>
        <button type="button" onClick={() => setClockFormat('24h')}>24-hour</button>
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
      clockFormat: '48h',
    }, 'light'),
    {
      version: 4,
      theme: 'dark',
      chatReadingSize: 'default',
      chatLineSpacing: 'standard',
      fontFamily: 'clide',
      clockFormat: '12h',
    },
  );
  assert.deepEqual(
    parseAppearancePreferences({
      version: 1,
      theme: 'sepia',
      chatReadingSize: 'compact',
      fontFamily: 'system',
      clockFormat: '24h',
    }, 'light'),
    {
      version: 4,
      theme: 'light',
      chatReadingSize: 'smallest',
      chatLineSpacing: 'standard',
      fontFamily: 'system',
      clockFormat: '24h',
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
    version: 4,
    theme: 'dark',
    chatReadingSize: 'default',
    chatLineSpacing: 'standard',
    fontFamily: 'clide',
    clockFormat: '12h',
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
    version: 4,
    theme: 'dark',
    chatReadingSize: 'large',
    chatLineSpacing: 'spacious',
    fontFamily: 'system',
    clockFormat: '12h',
  });
});

test('a storage event applies valid preferences from another tab', async () => {
  const host = await mount();

  await React.act(async () => {
    window.dispatchEvent(new window.StorageEvent('storage', {
      key: APPEARANCE_STORAGE_KEY,
      newValue: JSON.stringify({
        version: 4,
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

test('the clock format reaches the shared formatters and travels between devices', async () => {
  const host = await mount();
  const changes: unknown[] = [];
  const unsubscribe = subscribeToAppearanceChanges((change) => changes.push(change));
  const buttons = host.querySelectorAll<HTMLButtonElement>('button');
  const clockButton = buttons[buttons.length - 1];

  assert.equal(getClockFormat(), '12h');
  await React.act(async () => clockButton?.click());

  assert.equal(host.querySelector('[data-clock-format]')?.textContent, '24h');
  assert.equal(getClockFormat(), '24h', 'the formatters read it from their own store');
  assert.deepEqual(changes.at(-1), {
    [APPEARANCE_STORAGE_KEY]: { theme: 'system', fontFamily: 'clide', clockFormat: '24h' },
  });

  await React.act(async () => applyRemoteAppearancePreferences({
    [APPEARANCE_STORAGE_KEY]: { clockFormat: '12h' },
  }));
  assert.equal(host.querySelector('[data-clock-format]')?.textContent, '12h');
  assert.equal(getClockFormat(), '12h');

  unsubscribe();
});

test('a synced appearance change carries theme and font but not the sizing', async () => {
  const host = await mount();
  const changes: unknown[] = [];
  const unsubscribe = subscribeToAppearanceChanges((change) => changes.push(change));
  const [largeButton, , systemFontButton] = host.querySelectorAll<HTMLButtonElement>('button');

  const synced = { theme: 'system', fontFamily: 'system', clockFormat: '12h' };

  await React.act(async () => systemFontButton?.click());
  assert.deepEqual(changes.at(-1), { [APPEARANCE_STORAGE_KEY]: synced });

  await React.act(async () => largeButton?.click());
  assert.deepEqual(
    changes.at(-1),
    { [APPEARANCE_STORAGE_KEY]: synced },
    'reading size is set for the screen in front of you, so it never leaves it',
  );
  assert.deepEqual(readSyncedAppearancePreferences(), { [APPEARANCE_STORAGE_KEY]: synced });

  unsubscribe();
});

test("another device's theme applies without disturbing this screen's sizing", async () => {
  const host = await mount();
  const [largeButton] = host.querySelectorAll<HTMLButtonElement>('button');
  await React.act(async () => largeButton?.click());

  await React.act(async () => applyRemoteAppearancePreferences({
    [APPEARANCE_STORAGE_KEY]: { theme: 'dark', fontFamily: 'system', chatReadingSize: 'smallest' },
  }));

  assert.equal(host.querySelector('[data-theme]')?.textContent, 'dark');
  assert.equal(host.querySelector('[data-font-family]')?.textContent, 'system');
  assert.equal(
    host.querySelector('[data-reading-size]')?.textContent,
    'large',
    'a synced blob cannot smuggle a per-device field',
  );
});
