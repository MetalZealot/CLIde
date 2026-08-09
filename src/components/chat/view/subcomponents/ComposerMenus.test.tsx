import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test, { afterEach, before } from 'node:test';

import i18next from 'i18next';
import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { initReactI18next } from 'react-i18next';

import { getNextRoutinePermissionMode } from '../../utils/chatPermissions';

import ComposerModelMenu from './ComposerModelMenu';
import ComposerPermissionMenu from './ComposerPermissionMenu';

let root: Root | null = null;
let container: HTMLDivElement | null = null;

before(async () => {
  const chatTranslations = JSON.parse(readFileSync(
    new URL('../../../../i18n/locales/en/chat.json', import.meta.url),
    'utf8',
  )) as Record<string, unknown>;
  await i18next.use(initReactI18next).init({
    lng: 'en',
    fallbackLng: false,
    defaultNS: 'chat',
    resources: { en: { chat: chatTranslations } },
  });
});

afterEach(async () => {
  await React.act(async () => root?.unmount());
  container?.remove();
  document.querySelectorAll('[role="menu"]').forEach((menu) => menu.remove());
  root = null;
  container = null;
});

const mount = async (element: React.ReactNode) => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await React.act(async () => root?.render(element));
  return container;
};

test('routine permission toggle includes provider Auto but excludes elevated and special modes', () => {
  const modes = ['default', 'auto', 'acceptEdits', 'bypassPermissions', 'plan'];
  assert.equal(getNextRoutinePermissionMode('default', modes), 'auto');
  assert.equal(getNextRoutinePermissionMode('auto', modes), 'acceptEdits');
  assert.equal(getNextRoutinePermissionMode('acceptEdits', modes), 'default');
  assert.equal(getNextRoutinePermissionMode('plan', modes), 'default');
  assert.equal(getNextRoutinePermissionMode('bypassPermissions', modes), 'default');
  assert.equal(
    getNextRoutinePermissionMode('default', ['default', 'acceptEdits', 'bypassPermissions']),
    'acceptEdits',
  );
});

test('model trigger opens one menu containing reasoning and model choices', async () => {
  const effortSelections: string[] = [];
  const modelSelections: string[] = [];
  let refreshes = 0;
  const host = await mount(
    <ComposerModelMenu
      effort="high"
      effortOptions={[{ value: 'low' }, { value: 'high' }]}
      onSelectEffort={(value) => effortSelections.push(value)}
      model="model-b"
      modelOptions={[
        { value: 'model-a', label: 'Model A', description: 'A long model description' },
        { value: 'model-b', label: 'Model B', description: 'Another long model description' },
      ]}
      onSelectModel={async (value) => { modelSelections.push(value); }}
      modelsLoading={false}
      modelsRefreshing={false}
      onRefreshModels={async () => { refreshes += 1; }}
      openRequest={0}
    />,
  );

  const trigger = host.querySelector('button');
  assert.ok(trigger);
  trigger.getBoundingClientRect = () => ({
    x: 16,
    y: 700,
    left: 16,
    right: 176,
    top: 700,
    bottom: 732,
    width: 160,
    height: 32,
    toJSON: () => ({}),
  });
  Object.defineProperty(window, 'innerWidth', { value: 384, configurable: true });
  assert.match(trigger.textContent || '', /Model B/);
  assert.match(trigger.textContent || '', /high/);

  await React.act(async () => trigger.click());
  const menu = document.querySelector('[role="menu"]');
  assert.match(menu?.textContent || '', /Model A/);
  assert.match(menu?.textContent || '', /Effort/);
  assert.match(menu?.textContent || '', /high/);
  assert.doesNotMatch(menu?.textContent || '', /long model description/);
  const refreshButton = document.querySelector<HTMLButtonElement>('[aria-label="Refresh model list"]');
  assert.ok(refreshButton);
  await React.act(async () => refreshButton.click());
  assert.equal(refreshes, 1);
  const menuRight = Number.parseFloat((menu as HTMLElement).style.right);
  const menuMaxWidth = Number.parseFloat((menu as HTMLElement).style.maxWidth);
  assert.ok(window.innerWidth - menuRight - menuMaxWidth >= 8, 'menu stays inside the left viewport edge');

  const effortTrack = document.querySelector<HTMLElement>('[role="radiogroup"]');
  assert.ok(effortTrack);
  effortTrack.getBoundingClientRect = () => ({
    x: 0,
    y: 0,
    left: 0,
    right: 208,
    top: 0,
    bottom: 32,
    width: 208,
    height: 32,
    toJSON: () => ({}),
  });
  await React.act(async () => {
    effortTrack.dispatchEvent(new window.MouseEvent('pointerdown', { bubbles: true, button: 0, clientX: 190 }));
    effortTrack.dispatchEvent(new window.MouseEvent('pointermove', { bubbles: true, button: 0, clientX: 10 }));
    effortTrack.dispatchEvent(new window.MouseEvent('pointerup', { bubbles: true, button: 0, clientX: 10 }));
  });
  assert.deepEqual(effortSelections, ['default']);

  const lowEffortButton = document.querySelector<HTMLButtonElement>('[role="radio"][aria-label="low"]');
  assert.ok(lowEffortButton);
  await React.act(async () => lowEffortButton.click());
  assert.deepEqual(effortSelections, ['default', 'low']);
  assert.ok(document.querySelector('[role="menu"]'), 'effort selection keeps the combined menu open');

  const modelAButton = [...document.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]')]
    .find((button) => button.textContent?.includes('Model A'));
  assert.ok(modelAButton);
  await React.act(async () => modelAButton.click());
  assert.deepEqual(modelSelections, ['model-a']);
});

test('model selection stays open and reports a failed session update', async () => {
  const host = await mount(
    <ComposerModelMenu
      effort="default"
      effortOptions={[]}
      onSelectEffort={() => {}}
      model="model-a"
      modelOptions={[
        { value: 'model-a', label: 'Model A' },
        { value: 'model-b', label: 'Model B' },
      ]}
      onSelectModel={async () => {
        throw new Error('Unable to change the active model for this session.');
      }}
      modelsLoading={false}
      modelsRefreshing={false}
      onRefreshModels={async () => {}}
      openRequest={0}
    />,
  );

  const trigger = host.querySelector<HTMLButtonElement>('button');
  assert.ok(trigger);
  await React.act(async () => trigger.click());
  const modelBButton = [...document.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]')]
    .find((button) => button.textContent?.includes('Model B'));
  assert.ok(modelBButton);

  await React.act(async () => modelBButton.click());

  assert.ok(document.querySelector('[role="menu"]'), 'failed selection leaves the menu open');
  assert.match(
    document.querySelector('[role="alert"]')?.textContent || '',
    /Unable to change the active model for this session/,
  );
});

test('permission trigger toggles routine access while the chevron opens every mode', async () => {
  const selections: string[] = [];
  const host = await mount(
    <ComposerPermissionMenu
      permissionMode="default"
      permissionModes={['default', 'auto', 'acceptEdits', 'bypassPermissions']}
      onSelectPermissionMode={(mode) => selections.push(mode)}
      collaborationMode={null}
      collaborationModes={[]}
      onSelectCollaborationMode={() => {}}
      provider="claude"
      providerLabel="Claude"
    />,
  );

  const trigger = host.querySelector<HTMLButtonElement>('button');
  assert.ok(trigger);
  await React.act(async () => trigger.click());
  assert.deepEqual(selections, ['auto']);
  assert.equal(document.querySelector('[role="menu"]'), null, 'quick toggle does not open the full picker');

  const menuTrigger = host.querySelector<HTMLButtonElement>('[aria-label="Show all access modes"]');
  assert.ok(menuTrigger);
  await React.act(async () => menuTrigger.click());

  const menu = document.querySelector('[role="menu"]');
  assert.match(menu?.textContent || '', /Ask Before Tools/);
  assert.doesNotMatch(menu?.textContent || '', /Default Mode/);

  const bypassButton = [...document.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]')]
    .find((button) => button.textContent?.toLowerCase().includes('bypass'));
  assert.ok(bypassButton);
  await React.act(async () => bypassButton.click());
  assert.deepEqual(selections, ['auto', 'bypassPermissions']);
});

test('long press opens every permission mode and suppresses the following quick toggle', async () => {
  const selections: string[] = [];
  const host = await mount(
    <ComposerPermissionMenu
      permissionMode="default"
      permissionModes={['default', 'acceptEdits', 'bypassPermissions']}
      onSelectPermissionMode={(mode) => selections.push(mode)}
      collaborationMode={null}
      collaborationModes={[]}
      onSelectCollaborationMode={() => {}}
      provider="codex"
      providerLabel="Codex"
    />,
  );

  const trigger = host.querySelector<HTMLButtonElement>('button');
  assert.ok(trigger);
  const touchStart = new window.Event('touchstart', { bubbles: true, cancelable: true });
  Object.defineProperty(touchStart, 'touches', {
    value: [{ clientX: 40, clientY: 700 }],
  });
  await React.act(async () => {
    trigger.dispatchEvent(touchStart);
    await new Promise((resolve) => window.setTimeout(resolve, 550));
  });

  assert.ok(document.querySelector('[role="menu"]'), 'long press opens the complete picker');
  await React.act(async () => trigger.click());
  assert.deepEqual(selections, [], 'synthetic click after long press is swallowed');
  await React.act(async () => trigger.dispatchEvent(new window.Event('touchend', { bubbles: true })));
});

test('Codex access presets stay independent from Build and Plan collaboration', async () => {
  const permissionSelections: string[] = [];
  const collaborationSelections: string[] = [];
  const host = await mount(
    <ComposerPermissionMenu
      permissionMode="acceptEdits"
      permissionModes={['default', 'acceptEdits', 'bypassPermissions']}
      onSelectPermissionMode={(mode) => permissionSelections.push(mode)}
      collaborationMode="build"
      collaborationModes={['build', 'plan']}
      onSelectCollaborationMode={(mode) => collaborationSelections.push(mode)}
      provider="codex"
      providerLabel="Codex"
    />,
  );

  const menuTrigger = host.querySelector<HTMLButtonElement>('[aria-label="Show all access modes"]');
  assert.ok(menuTrigger);
  await React.act(async () => menuTrigger.click());

  const menu = document.querySelector('[role="menu"]');
  assert.match(menu?.textContent || '', /Ask When Needed/);
  assert.match(menu?.textContent || '', /Auto in Workspace/);
  assert.match(menu?.textContent || '', /Full Access/);
  assert.doesNotMatch(menu?.textContent || '', /Default Mode|Accept Edits|Bypass Permissions/);

  const desktopModes = host.querySelector<HTMLElement>('[role="radiogroup"]');
  assert.ok(desktopModes);
  assert.match(desktopModes.className, /sm:flex/, 'desktop keeps collaboration outside the access picker');
  const planButton = [...desktopModes.querySelectorAll<HTMLButtonElement>('[role="radio"]')]
    .find((button) => button.textContent?.includes('Plan'));
  assert.ok(planButton);
  await React.act(async () => planButton.click());

  assert.deepEqual(collaborationSelections, ['plan']);
  assert.deepEqual(permissionSelections, []);

  const mobileModeGroup = document.querySelector<HTMLElement>('[role="menu"] [role="group"]');
  assert.ok(mobileModeGroup);
  assert.match(mobileModeGroup.className, /sm:hidden/, 'mobile keeps collaboration in the complete picker');
});
