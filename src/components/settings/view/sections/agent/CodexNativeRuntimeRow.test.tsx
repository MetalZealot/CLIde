import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test, { after, afterEach, before } from 'node:test';

import i18next from 'i18next';
import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { initReactI18next } from 'react-i18next';

import CodexNativeRuntimeRow from './CodexNativeRuntimeRow';

const bundledId = 'runtime_111111111111111111111111';
const candidateId = 'runtime_222222222222222222222222';
const installations = [
  {
    id: bundledId,
    version: '0.147.0',
    displayPath: '~/Projects/CLIde/node_modules/@openai/codex/vendor/codex',
    sources: ['bundled'],
    bundled: true,
  },
  {
    id: candidateId,
    version: '0.147.0',
    displayPath: '~/.local/lib/node_modules/@openai/codex/vendor/codex',
    sources: ['path'],
    bundled: false,
  },
];

let root: Root | null = null;
let container: HTMLDivElement | null = null;
const originalFetch = globalThis.fetch;

before(async () => {
  const settingsTranslations = JSON.parse(readFileSync(
    new URL('../../../../../i18n/locales/en/settings.json', import.meta.url),
    'utf8',
  )) as Record<string, unknown>;
  await i18next.use(initReactI18next).init({
    lng: 'en',
    fallbackLng: false,
    defaultNS: 'settings',
    resources: { en: { settings: settingsTranslations } },
  });
});

after(() => {
  globalThis.fetch = originalFetch;
});

afterEach(async () => {
  await React.act(async () => root?.unmount());
  container?.remove();
  root = null;
  container = null;
});

const flush = async () => {
  await React.act(async () => {
    await new Promise((resolve) => window.setTimeout(resolve, 0));
    await new Promise((resolve) => window.setTimeout(resolve, 0));
  });
};

const findButton = (host: HTMLElement, label: string): HTMLButtonElement => {
  const button = [...host.querySelectorAll('button')].find((item) => item.textContent === label);
  assert.ok(button);
  return button;
};

test('Codex runtime row uses paths as identity and gates Use behind Check', async () => {
  let activeInstallationId = bundledId;
  let previousInstallationId: string | null = null;
  const selectionRequests: string[] = [];
  const status = () => ({
    installations,
    activeInstallationId,
    previousInstallationId,
    liveProcessInstallationId: bundledId,
    sdkVersion: '0.147.0',
    liveProcessVersion: '0.147.0',
    updatePending: activeInstallationId !== bundledId,
    activeError: null,
  });

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    let data: unknown;
    if (url.endsWith('/check')) {
      data = {
        installationId: candidateId,
        compatibility: 'compatible',
        detail: null,
      };
    } else if (url.endsWith('/selection')) {
      const body = JSON.parse(String(init?.body)) as { installationId: string };
      selectionRequests.push(body.installationId);
      previousInstallationId = activeInstallationId;
      activeInstallationId = body.installationId;
      data = status();
    } else {
      data = status();
    }
    return new Response(JSON.stringify({ success: true, data }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;

  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await React.act(async () => root?.render(<CodexNativeRuntimeRow />));
  await flush();

  assert.match(container.textContent ?? '', /Projects\/CLIde\/node_modules/);
  assert.match(container.textContent ?? '', /.local\/lib\/node_modules/);
  const useButton = findButton(container, 'Use');
  assert.equal(useButton.disabled, true);

  await React.act(async () => findButton(container as HTMLDivElement, 'Check').click());
  await flush();
  assert.match(container.textContent ?? '', /Structural check passed/);
  assert.equal(findButton(container, 'Use').disabled, false);

  await React.act(async () => findButton(container as HTMLDivElement, 'Use').click());
  await flush();
  assert.deepEqual(selectionRequests, [candidateId]);
  assert.match(container.textContent ?? '', /switch after current turn/);

  await React.act(async () => findButton(container as HTMLDivElement, 'Roll back').click());
  await flush();
  assert.deepEqual(selectionRequests, [candidateId, bundledId]);
});
