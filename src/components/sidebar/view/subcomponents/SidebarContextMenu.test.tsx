import assert from 'node:assert/strict';
import test, { afterEach } from 'node:test';

import { ExternalLink } from 'lucide-react';
import React from 'react';
import { createRoot, type Root } from 'react-dom/client';

import SidebarContextMenu from './SidebarContextMenu';

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(async () => {
  await React.act(async () => root?.unmount());
  container?.remove();
  document.querySelectorAll('[role="menu"]').forEach((menu) => menu.parentElement?.remove());
  root = null;
  container = null;
});

test('renders a new-tab menu item as a protected link and closes on selection', async () => {
  let closeCount = 0;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);

  await React.act(async () => {
    root?.render(
      <SidebarContextMenu
        anchor={{ top: 20, bottom: 40, left: 20 }}
        items={[{
          key: 'open-new-tab',
          label: 'Open in new tab',
          icon: ExternalLink,
          href: '/session/session-1',
        }]}
        onClose={() => { closeCount += 1; }}
      />,
    );
  });

  const link = document.querySelector<HTMLAnchorElement>('[role="menuitem"]');
  assert.ok(link);
  assert.equal(link.getAttribute('href'), '/session/session-1');
  assert.equal(link.getAttribute('target'), '_blank');
  assert.equal(link.getAttribute('rel'), 'noopener noreferrer');

  await React.act(async () => link.click());
  assert.equal(closeCount, 1);
});
