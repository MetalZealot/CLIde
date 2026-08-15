import assert from 'node:assert/strict';
import test, { afterEach } from 'node:test';

import type { TFunction } from 'i18next';
import React from 'react';
import { createRoot, type Root } from 'react-dom/client';

import {
  DEFAULT_BROWSE_SESSION_VIEW_OPTIONS,
  DEFAULT_PROJECT_VIEW_OPTIONS,
} from '../../utils/utils';

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
  'browseView.filter': 'Sort',
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
        projectView={DEFAULT_PROJECT_VIEW_OPTIONS}
        browseSessionView={DEFAULT_BROWSE_SESSION_VIEW_OPTIONS}
        onProjectViewChange={() => {}}
        onBrowseSessionViewChange={() => {}}
        onProjectViewReset={() => {}}
        onBrowseSessionViewReset={() => {}}
        onCollapseSidebar={() => {}}
        onOpenNewSession={() => {}}
        t={t}
        {...overrides}
      />,
    );
  });
};

test('search stays visible and only offers Clear for a non-empty query', async () => {
  let clearCount = 0;
  await renderHeader({ onClearSearchFilter: () => { clearCount += 1; } });

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
  assert.equal(container?.querySelectorAll('button[aria-label="Sort"]').length, 1);
  assert.equal(container?.querySelector('button[aria-label="Clear search"]'), null);

  await renderHeader({
    searchFilter: 'review',
    onClearSearchFilter: () => { clearCount += 1; },
  });
  const clearButton = container?.querySelector<HTMLButtonElement>('button[aria-label="Clear search"]');
  assert.ok(clearButton);
  await React.act(async () => clearButton.click());

  assert.equal(clearCount, 1);
  assert.ok(container?.querySelector('input'));
});

test('the compact selector owns Projects, Sessions, and Archive', async () => {
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

  await React.act(async () => selector.click());
  const archiveItem = [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')]
    .find((item) => item.textContent?.includes('Archive'));
  assert.ok(archiveItem);
  await React.act(async () => archiveItem.click());
  assert.equal(chosenSearchMode, 'archived');
});

test('Archive hides the contextual Sort control', async () => {
  await renderHeader({ searchMode: 'archived' });

  assert.ok(container?.querySelector<HTMLButtonElement>('button[aria-label="Archive"]'));
  assert.equal(container?.querySelector('button[aria-label="Sort"]'), null);
});

test('Sort changes the active view without touching the browse mode', async () => {
  let nextProjectView = DEFAULT_PROJECT_VIEW_OPTIONS;
  await renderHeader({ onProjectViewChange: (options) => { nextProjectView = options; } });

  const filterButton = container?.querySelector<HTMLButtonElement>('button[aria-label="Sort"]');
  assert.ok(filterButton);
  await React.act(async () => filterButton.click());

  const dateChoice = [...document.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]')]
    .find((item) => item.textContent?.includes('Date'));
  assert.ok(dateChoice);
  await React.act(async () => dateChoice.click());

  assert.deepEqual(nextProjectView, { sort: 'date', direction: 'desc' });
});

test('Sessions Sort offers only the three global sort choices', async () => {
  await renderHeader({ browseMode: 'sessions' });

  const sortButton = container?.querySelector<HTMLButtonElement>('button[aria-label="Sort"]');
  assert.ok(sortButton);
  await React.act(async () => sortButton.click());

  const menu = document.querySelector<HTMLElement>('[role="menu"][aria-label="Sort sessions"]');
  assert.ok(menu);
  assert.equal(menu.querySelectorAll('[role="menuitemradio"]').length, 3);
  assert.equal(menu.querySelectorAll('[role="menuitemcheckbox"]').length, 0);
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
