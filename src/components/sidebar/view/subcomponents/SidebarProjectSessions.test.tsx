import assert from 'node:assert/strict';
import test, { afterEach } from 'node:test';

import type { TFunction } from 'i18next';
import React from 'react';
import { createRoot, type Root } from 'react-dom/client';

import type { Project } from '../../../../types/app';
import type { CheckoutSession, RepositoryEntry, SessionWithProvider } from '../../types/types';

import SidebarProjectSessions from './SidebarProjectSessions';

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
