import assert from 'node:assert/strict';
import test, { afterEach } from 'node:test';

import type { TFunction } from 'i18next';
import React from 'react';
import { createRoot, type Root } from 'react-dom/client';

import type { Project } from '../../../../types/app';
import type { ContextMenuAnchor } from '../../../../shared/view/ui';
import type { SessionSelectionScope, SessionWithProvider } from '../../types/types';

import SidebarProjectList from './SidebarProjectList';

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
  await React.act(async () => desktopLink.dispatchEvent(new window.MouseEvent('contextmenu', {
    bubbles: true,
    cancelable: true,
  })));

  assert.deepEqual(openedScope, { kind: 'sessions' });
});
