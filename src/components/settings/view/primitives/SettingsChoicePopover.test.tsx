import assert from 'node:assert/strict';
import test, { afterEach } from 'node:test';

import React, { useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import SettingsChoicePopover from './SettingsChoicePopover';

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(async () => {
  await React.act(async () => root?.unmount());
  container?.remove();
  root = null;
  container = null;
});

const options = [
  { value: 'smallest', label: 'Smallest', detail: '14 px' },
  { value: 'small', label: 'Small', detail: '15 px' },
  { value: 'default', label: 'Default', detail: '16 px' },
  { value: 'large', label: 'Large', detail: '17 px' },
] as const;

const mount = async () => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);

  const Harness = () => {
    const [value, setValue] = useState<(typeof options)[number]['value']>('default');
    return (
      <div>
        <output>{value}</output>
        <SettingsChoicePopover
          value={value}
          options={[...options]}
          onChange={setValue}
          ariaLabel="Reading size"
        />
      </div>
    );
  };

  await React.act(async () => root?.render(<Harness />));
  return container;
};

test('shows the selected label and faded metric, then saves a tapped option', async () => {
  const host = await mount();
  const trigger = host.querySelector<HTMLButtonElement>('[role="combobox"]');
  assert.equal(trigger?.textContent?.replace(/\s+/g, ' ').trim(), 'Default16 px');

  await React.act(async () => trigger?.click());
  const listbox = document.querySelector('[role="listbox"]');
  assert.ok(listbox);
  assert.equal(listbox.querySelectorAll('[role="option"]').length, 4);
  assert.equal(listbox.querySelector('[aria-selected="true"]')?.textContent?.replace(/\s+/g, ' ').trim(), 'Default16 px');

  const large = [...listbox.querySelectorAll<HTMLButtonElement>('[role="option"]')]
    .find((option) => option.textContent?.includes('Large'));
  await React.act(async () => large?.click());

  assert.equal(host.querySelector('output')?.textContent, 'large');
  assert.equal(document.querySelector('[role="listbox"]'), null);
});

test('supports arrow navigation, selection, and Escape without moving DOM focus', async () => {
  const host = await mount();
  const trigger = host.querySelector<HTMLButtonElement>('[role="combobox"]');
  assert.ok(trigger);
  trigger.focus();

  await React.act(async () => trigger.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })));
  assert.equal(trigger.getAttribute('aria-expanded'), 'true');
  assert.match(trigger.getAttribute('aria-activedescendant') ?? '', /option-2$/);

  await React.act(async () => trigger.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })));
  assert.match(trigger.getAttribute('aria-activedescendant') ?? '', /option-3$/);
  await React.act(async () => trigger.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
  assert.equal(host.querySelector('output')?.textContent, 'large');

  await React.act(async () => trigger.click());
  await React.act(async () => trigger.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
  assert.equal(trigger.getAttribute('aria-expanded'), 'false');
  assert.equal(document.activeElement, trigger);
});

test('supports type-ahead for longer option lists', async () => {
  const host = await mount();
  const trigger = host.querySelector<HTMLButtonElement>('[role="combobox"]');
  assert.ok(trigger);

  await React.act(async () => trigger.click());
  await React.act(async () => trigger.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'l', bubbles: true })));
  assert.match(trigger.getAttribute('aria-activedescendant') ?? '', /option-3$/);
  await React.act(async () => trigger.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
  assert.equal(host.querySelector('output')?.textContent, 'large');
});
