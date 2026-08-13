import assert from 'node:assert/strict';
import test, { afterEach } from 'node:test';

import { Archive, Pencil } from 'lucide-react';
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
