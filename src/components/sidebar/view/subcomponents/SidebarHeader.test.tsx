import assert from 'node:assert/strict';
import test, { afterEach } from 'node:test';

import type { TFunction } from 'i18next';
import React from 'react';
import { createRoot, type Root } from 'react-dom/client';

import SidebarHeader from './SidebarHeader';

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(async () => {
  await React.act(async () => root?.unmount());
  container?.remove();
  document.querySelectorAll('[role="menu"]').forEach((menu) => menu.parentElement?.remove());
  root = null;
  container = null;
});

const translations: Record<string, string> = {
  'app.title': 'CLIde',
  'actions.archive': 'Archive',
  'search.modeProjects': 'Projects',
  'search.modeConversations': 'Sessions',
  'search.searchContents': 'Search inside messages',
  'search.backToSessionNames': 'Search session names instead',
  'search.sessionsPlaceholder': 'Search session names...',
  'search.archivedPlaceholder': 'Search archived sessions...',
  'sessions.newSession': 'New Session',
  'tooltips.clearSearch': 'Clear search',
  'tooltips.hideSidebar': 'Hide sidebar',
  'tooltips.toggleSearch': 'Search',
};

const t = ((key: string, fallback?: string) => translations[key] ?? fallback ?? key) as TFunction;

const renderHeader = async (
  overrides: Partial<React.ComponentProps<typeof SidebarHeader>> = {},
) => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);

  await React.act(async () => {
    root?.render(
      <SidebarHeader
        browseMode="projects"
        onBrowseModeChange={() => {}}
        searchFilter=""
        onSearchFilterChange={() => {}}
        onClearSearchFilter={() => {}}
        searchMode="projects"
        onSearchModeChange={() => {}}
        onCollapseSidebar={() => {}}
        onOpenNewSession={() => {}}
        t={t}
        {...overrides}
      />,
    );
  });
};

test('search expands inline while the view selector and Archive stay visible', async () => {
  let clearCount = 0;
  await renderHeader({ onClearSearchFilter: () => { clearCount += 1; } });

  const searchButton = container?.querySelector<HTMLButtonElement>('button[aria-label="Search"]');
  assert.ok(searchButton);
  assert.equal(
    container?.querySelectorAll('.sidebar-utility-hit-target').length,
    3,
    'the visible 32px controls must fill the utility row with their hit areas',
  );
  await React.act(async () => searchButton.click());

  const input = container?.querySelector<HTMLInputElement>('input[placeholder="Search session names..."]');
  const selector = container?.querySelector<HTMLButtonElement>('button[aria-haspopup="menu"]');
  assert.ok(input);
  assert.ok(selector);
  assert.equal(input.classList.contains('nav-search-input'), true);
  assert.equal(input.classList.contains('pr-9'), true);
  assert.equal(selector.classList.contains('md:w-8'), true);
  assert.equal(selector.parentElement?.classList.contains('nav-search-input'), false);
  assert.equal(selector.parentElement?.classList.contains('pt-1'), true);
  assert.equal(selector.parentElement?.classList.contains('pb-2'), true);
  assert.equal(selector.parentElement?.classList.contains('mb-2'), false);
  assert.equal(container?.querySelectorAll('button[aria-label="Archive"]').length, 1);

  const closeButton = container?.querySelector<HTMLButtonElement>('button[aria-label="Clear search"]');
  assert.ok(closeButton);
  await React.act(async () => closeButton.click());

  assert.equal(clearCount, 1);
  assert.equal(container?.querySelector('input'), null);
});

test('the compact selector changes browse mode and Archive remains a separate body mode', async () => {
  let chosenMode = '';
  let chosenSearchMode = '';
  await renderHeader({
    onBrowseModeChange: (mode) => { chosenMode = mode; },
    onSearchModeChange: (mode) => { chosenSearchMode = mode; },
  });

  const selector = container?.querySelector<HTMLButtonElement>('button[aria-haspopup="menu"]');
  assert.ok(selector);
  await React.act(async () => selector.click());

  const sessionsItem = [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')]
    .find((item) => item.textContent?.includes('Sessions'));
  assert.ok(sessionsItem);
  await React.act(async () => sessionsItem.click());
  assert.equal(chosenMode, 'sessions');

  const archiveButton = container?.querySelector<HTMLButtonElement>('button[aria-label="Archive"]');
  assert.ok(archiveButton);
  await React.act(async () => archiveButton.click());
  assert.equal(chosenSearchMode, 'archived');
});

test('message-content search is an inline refinement of an expanded query', async () => {
  let chosenSearchMode = '';
  await renderHeader({
    searchFilter: 'review',
    onSearchModeChange: (mode) => { chosenSearchMode = mode; },
  });

  const contentSearch = container?.querySelector<HTMLButtonElement>('button[aria-label="Search inside messages"]');
  const input = container?.querySelector<HTMLInputElement>('input[placeholder="Search session names..."]');
  assert.ok(contentSearch);
  assert.ok(input);
  assert.equal(input.classList.contains('pr-14'), true);
  await React.act(async () => contentSearch.click());

  assert.equal(chosenSearchMode, 'conversations');
});
