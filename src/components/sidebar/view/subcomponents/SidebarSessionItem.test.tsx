import assert from 'node:assert/strict';
import test, { afterEach } from 'node:test';

import type { TFunction } from 'i18next';
import React from 'react';
import { createRoot, type Root } from 'react-dom/client';

import type { Project } from '../../../../types/app';
import type { ContextMenuAnchor } from '../../../../shared/view/ui';
import type { SessionWithProvider } from '../../types/types';

import SidebarSessionItem from './SidebarSessionItem';

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
