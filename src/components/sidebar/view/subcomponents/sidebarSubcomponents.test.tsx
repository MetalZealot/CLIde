// Sidebar view subcomponents. Each component's tests live in their own
// `describe` so per-component helpers and unmount hooks stay scoped to it.
import assert from 'node:assert/strict';
import test, { afterEach, describe } from 'node:test';

import type { TFunction } from 'i18next';
import { Archive, Pencil } from 'lucide-react';
import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';

import type { ContextMenuAnchor } from '../../../../shared/view/ui';
import type { Project } from '../../../../types/app';
import type {
  CheckoutSession,
  RepositoryEntry,
  SessionSelectionScope,
  SessionWithProvider,
} from '../../types/types';
import {
  DEFAULT_BROWSE_SESSION_VIEW_OPTIONS,
  DEFAULT_PROJECT_VIEW_OPTIONS,
} from '../../utils/utils';

import SidebarContextMenu from './SidebarContextMenu';
import SidebarHeader from './SidebarHeader';
import SidebarProjectList from './SidebarProjectList';
import SidebarProjectSessions from './SidebarProjectSessions';
import SidebarSessionItem from './SidebarSessionItem';
import SidebarStatusIndicator from './SidebarStatusIndicator';


describe('SidebarHeader', () => {
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
});


describe('SidebarProjectList', () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;

  afterEach(async () => {
    await React.act(async () => root?.unmount());
    container?.remove();
    root = null;
    container = null;
  });

  const t = ((_: string, fallback?: string) => fallback ?? '') as TFunction;

  test('Sessions view gives flat rows the global batch-selection scope', async () => {
    const project: Project = {
      projectId: 'project-1',
      displayName: 'Project',
      fullPath: '/project',
      accentColor: 'blue',
    };
    const session: SessionWithProvider = {
      id: 'session-1',
      summary: 'Session one',
      createdAt: '2026-08-14T12:00:00.000Z',
      __provider: 'claude',
    };
    let openedScope: SessionSelectionScope | undefined;

    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    await React.act(async () => {
      root?.render(
        <SidebarProjectList
          projects={[project]}
          filteredProjects={[project]}
          repositoryEntries={[{
            key: 'repository-1',
            repositoryId: null,
            displayName: 'Project',
            leadCheckout: project,
            checkouts: [project],
          }]}
          browseMode="sessions"
          browseSessions={[{
            session,
            checkout: project,
            branchLabel: null,
            repositoryName: 'Project',
            repositoryAccentColor: 'blue',
          }]}
          selectedProject={null}
          selectedSession={null}
          isLoading={false}
          loadingProgress={null}
          expandedProjects={new Set()}
          editingProject={null}
          editingName=""
          initialSessionsLoaded={new Set(['project-1'])}
          currentTime={new Date('2026-08-14T12:05:00.000Z')}
          editingSession={null}
          editingSessionName=""
          deletingProjects={new Set()}
          getRepositorySessions={() => []}
          getVisibleSessionCount={() => 5}
          onShowAllSessions={() => {}}
          onCollapseSessions={() => {}}
          loadingMoreProjects={new Set()}
          activeSessions={new Map()}
          attentionSessionIds={new Set()}
          unreadSessionIds={new Set()}
          onEditingNameChange={() => {}}
          onToggleProject={() => {}}
          onProjectSelect={() => {}}
          onCancelEditingProject={() => {}}
          onSaveProjectName={() => {}}
          onSessionSelect={() => {}}
          getRepositoryView={() => ({ sort: 'date', direction: 'desc', worktreeProjectIds: null })}
          onEditingSessionNameChange={() => {}}
          onCancelEditingSession={() => {}}
          onSaveEditingSession={() => {}}
          onCreateProject={() => {}}
          onOpenSessionActionsMenu={(
            _openedSession: SessionWithProvider,
            _anchor: ContextMenuAnchor,
            scope?: SessionSelectionScope,
          ) => {
            openedScope = scope;
          }}
          sessionSelection={null}
          onToggleBatchSelected={() => {}}
          t={t}
        />,
      );
    });

    const desktopLink = container.querySelector<HTMLAnchorElement>('a[href="/session/session-1"]');
    assert.ok(desktopLink);
    assert.equal(
      container.querySelectorAll('span[style*="--project-accent-blue"]').length,
      2,
      'the flat row carries the repository strip in its mobile and desktop renderings',
    );
    await React.act(async () => desktopLink.dispatchEvent(new window.MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
    })));

    assert.deepEqual(openedScope, { kind: 'sessions' });
  });
});


describe('SidebarProjectSessions', () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;

  afterEach(async () => {
    await React.act(async () => root?.unmount());
    container?.remove();
    root = null;
    container = null;
  });

  const t = ((key: string, fallbackOrOptions?: string | { count?: number; defaultValue?: string }) => {
    if (key === 'sessions.showAllCount' && typeof fallbackOrOptions === 'object') {
      return `Show all (${fallbackOrOptions.count} more)`;
    }

    return typeof fallbackOrOptions === 'string'
      ? fallbackOrOptions
      : fallbackOrOptions?.defaultValue ?? key;
  }) as TFunction;

  const project: Project = {
    projectId: 'project-1',
    displayName: 'Project',
    fullPath: '/project',
  };

  const entry: RepositoryEntry = {
    key: 'repository-1',
    repositoryId: null,
    displayName: 'Project',
    leadCheckout: project,
    checkouts: [project],
  };

  function createSessions(count: number): CheckoutSession[] {
    return Array.from({ length: count }, (_, index) => ({
      session: {
        id: `session-${index + 1}`,
        summary: `Session ${index + 1}`,
        createdAt: '2026-08-14T12:00:00.000Z',
        __provider: 'claude',
      } satisfies SessionWithProvider,
      checkout: project,
      branchLabel: null,
    }));
  }

  function sessionsView(visibleSessionCount: number) {
    return (
      <SidebarProjectSessions
        entry={entry}
        accentColor={null}
        isExpanded
        sessions={createSessions(6)}
        selectedSession={null}
        initialSessionsLoaded
        hasMoreSessions={false}
        isLoadingMoreSessions={false}
        activeSessions={new Map()}
        attentionSessionIds={new Set()}
        unreadSessionIds={new Set()}
        currentTime={new Date('2026-08-14T12:05:00.000Z')}
        editingSession={null}
        editingSessionName=""
        onEditingSessionNameChange={() => {}}
        onCancelEditingSession={() => {}}
        onSaveEditingSession={() => {}}
        onProjectSelect={() => {}}
        onSessionSelect={() => {}}
        visibleSessionCount={visibleSessionCount}
        onShowAllSessions={() => {}}
        onCollapseSessions={() => {}}
        batchSelectedIds={null}
        onToggleBatchSelected={() => {}}
        t={t}
      />
    );
  }

  async function renderSessions(visibleSessionCount: number) {
    if (!container) {
      container = document.createElement('div');
      document.body.appendChild(container);
      root = createRoot(container);
    }

    await React.act(async () => root?.render(sessionsView(visibleSessionCount)));
  }

  test('only Show less sticks to the bottom of the visible session list', async () => {
    await renderSessions(5);

    const showMore = [...container!.querySelectorAll('button')]
      .find((button) => button.textContent === 'Show all (1 more)');
    assert.ok(showMore);
    assert.equal(showMore.classList.contains('sticky'), false);

    await renderSessions(6);

    const showLess = [...container!.querySelectorAll('button')]
      .find((button) => button.textContent === 'Show less');
    assert.ok(showLess);
    assert.equal(showLess.classList.contains('sticky'), true);
    assert.equal(showLess.classList.contains('bottom-0'), true);
    assert.equal(showLess.classList.contains('bg-background'), true);
  });
});


describe('SidebarSessionItem', () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;

  afterEach(async () => {
    await React.act(async () => root?.unmount());
    container?.remove();
    root = null;
    container = null;
  });

  const t = ((_: string, fallback?: string) => fallback ?? '') as TFunction;

  test('opens the desktop session action menu at the right-click position', async () => {
    const project: Project = {
      projectId: 'project-1',
      displayName: 'Project',
      fullPath: '/project',
    };
    const session: SessionWithProvider = {
      id: 'session-1',
      summary: 'Session one',
      createdAt: '2026-08-11T12:00:00.000Z',
      __provider: 'claude',
    };
    let opened: { session: SessionWithProvider; anchor: ContextMenuAnchor } | null = null;

    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    await React.act(async () => {
      root?.render(
        <SidebarSessionItem
          project={project}
          session={session}
          selectedSession={null}
          isProcessing={false}
          needsAttention={false}
          isUnread={false}
          currentTime={new Date('2026-08-11T12:05:00.000Z')}
          editingSession={null}
          editingSessionName=""
          onEditingSessionNameChange={() => {}}
          onCancelEditingSession={() => {}}
          onSaveEditingSession={() => {}}
          onProjectSelect={() => {}}
          onSessionSelect={() => {}}
          onOpenActionsMenu={(openedSession, anchor) => {
            opened = { session: openedSession, anchor };
          }}
          t={t}
        />,
      );
    });

    const desktopLink = container.querySelector<HTMLAnchorElement>('a[href="/session/session-1"]');
    assert.ok(desktopLink);
    const event = new window.MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      clientX: 120,
      clientY: 240,
    });

    await React.act(async () => desktopLink.dispatchEvent(event));

    assert.equal(event.defaultPrevented, true);
    assert.deepEqual(opened, {
      session,
      anchor: { top: 240, bottom: 240, left: 120 },
    });
  });
});


describe('SidebarContextMenu', () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;

  afterEach(async () => {
    await React.act(async () => root?.unmount());
    container?.remove();
    document.querySelectorAll('[role="menu"]').forEach((menu) => menu.parentElement?.remove());
    root = null;
    container = null;
  });

  const renderMenu = async (
    items: React.ComponentProps<typeof SidebarContextMenu>['items'],
    onClose: () => void,
  ) => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    await React.act(async () => {
      root?.render(
        <SidebarContextMenu
          anchor={{ top: 20, bottom: 40, left: 20 }}
          items={items}
          onClose={onClose}
        />,
      );
    });
  };

  test('selecting an item runs its action and closes the menu', async () => {
    let closeCount = 0;
    let selectCount = 0;

    await renderMenu(
      [{ key: 'rename', label: 'Rename', icon: Pencil, onSelect: () => { selectCount += 1; } }],
      () => { closeCount += 1; },
    );

    const item = document.querySelector<HTMLButtonElement>('[role="menuitem"]');
    assert.ok(item);
    await React.act(async () => item.click());

    assert.equal(selectCount, 1);
    assert.equal(closeCount, 1);
  });

  test('a keepOpen item leaves the menu up so it can replace its own contents', async () => {
    let closeCount = 0;

    await renderMenu(
      [{ key: 'archive', label: 'Archive', icon: Archive, keepOpen: true, onSelect: () => {} }],
      () => { closeCount += 1; },
    );

    const item = document.querySelector<HTMLButtonElement>('[role="menuitem"]');
    assert.ok(item);
    await React.act(async () => item.click());

    assert.equal(closeCount, 0);
  });
});


describe('SidebarStatusIndicator', () => {
  const t = ((_: string, fallback?: string) => fallback ?? '') as TFunction;

  const renderStatus = (status: 'blocked' | 'running' | 'unread') =>
    renderToStaticMarkup(
      React.createElement(SidebarStatusIndicator, {
        status,
        t,
        labelPrefix: 'Activity',
      }),
    );

  test('renders attention as an amber alert with a non-colour label', () => {
    const html = renderStatus('blocked');

    assert.match(html, /aria-label="Activity: Blocked"/);
    assert.match(html, /text-status-attention/);
    assert.match(html, /lucide-circle-alert/);
  });

  test('renders a running session as a neutral spinner', () => {
    const html = renderStatus('running');

    assert.match(html, /aria-label="Activity: Running"/);
    assert.match(html, /animate-spin text-status-running/);
    assert.match(html, /lucide-loader-circle/);
  });

  test('renders unread finished output as a green dot', () => {
    const html = renderStatus('unread');

    assert.match(html, /aria-label="Activity: Unread finished"/);
    assert.match(html, /rounded-full bg-status-unread/);
  });
});
