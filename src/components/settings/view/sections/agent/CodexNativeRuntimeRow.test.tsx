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
const alternateId = 'runtime_333333333333333333333333';
const bundledPath = '~/Projects/CLIde/node_modules/@openai/codex/vendor/bin/codex';
const candidatePath = '~/.codex/packages/standalone/releases/0.147.0-arm64/bin/codex';
const alternatePath = '~/.local/node_modules/@openai/codex/bin/codex';
const installations = [
  {
    id: bundledId,
    version: '0.147.0',
    displayPath: bundledPath,
    sources: ['bundled'],
    bundled: true,
  },
  {
    id: candidateId,
    version: '0.147.0',
    displayPath: candidatePath,
    sources: ['path'],
    bundled: false,
  },
  {
    id: alternateId,
    version: '0.147.0',
    displayPath: alternatePath,
    sources: ['known'],
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

const installationRow = (host: HTMLElement, fullPath: string): HTMLElement => {
  const pathButton = host.querySelector<HTMLButtonElement>(`button[title="${fullPath}"]`);
  assert.ok(pathButton?.parentElement);
  return pathButton.parentElement;
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
      const body = JSON.parse(String(init?.body)) as { installationId: string };
      data = {
        installationId: body.installationId,
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

  assert.doesNotMatch(container.textContent ?? '', /Projects\/CLIde/);
  assert.match(container.textContent ?? '', /…\/node_modules\/…\/bin\/codex/);
  assert.match(container.textContent ?? '', /…\/standalone\/releases\/…\/bin\/codex/);
  const candidateRow = installationRow(container, candidatePath);
  const alternateRow = installationRow(container, alternatePath);
  assert.equal(findButton(candidateRow, 'Use').disabled, true);
  assert.equal(findButton(alternateRow, 'Use').disabled, true);

  await React.act(async () => findButton(alternateRow, 'Check').click());
  await flush();
  assert.match(alternateRow.textContent ?? '', /Structural check passed/);
  assert.doesNotMatch(candidateRow.textContent ?? '', /Structural check passed/);
  assert.equal(findButton(candidateRow, 'Use').disabled, true);
  assert.equal(findButton(alternateRow, 'Use').disabled, false);

  const candidatePathButton = candidateRow.querySelector<HTMLButtonElement>(`button[title="${candidatePath}"]`);
  assert.ok(candidatePathButton);
  await React.act(async () => candidatePathButton.click());
  assert.match(candidateRow.textContent ?? '', /.codex\/packages\/standalone/);

  await React.act(async () => findButton(alternateRow, 'Use').click());
  await flush();
  assert.deepEqual(selectionRequests, [alternateId]);
  assert.match(container.textContent ?? '', /switch after current turn/);

  await React.act(async () => findButton(container as HTMLDivElement, 'Roll back').click());
  await flush();
  assert.deepEqual(selectionRequests, [alternateId, bundledId]);
});
