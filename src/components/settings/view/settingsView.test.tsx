import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test, { after, afterEach, before, beforeEach, describe } from 'node:test';

import i18next from 'i18next';
import React, { useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { initReactI18next } from 'react-i18next';

import { api } from '../../../utils/api';
import type { VoiceRuntimeSettings } from '../../../lib/voiceApi';
import { AUTH_TOKEN_STORAGE_KEY } from '../../auth/constants';
import { AuthProvider } from '../../auth/context/AuthContext';
import type { ProviderRuntimeVersions } from '../../provider-auth/types';
import SidebarAccountMenu from '../../sidebar/view/subcomponents/SidebarAccountMenu';
import type { AuthStatus, NotificationPreferencesState } from '../types/types';

import SettingsChoicePopover from './primitives/SettingsChoicePopover';
import AccountScreen from './screens/AccountScreen';
import AgentProviderScreen from './screens/AgentProviderScreen';
import AgentSkillsScreen from './screens/AgentSkillsScreen';
import ChatVoiceBackendScreen from './screens/ChatVoiceBackendScreen';
import ChatVoiceLibraryScreen from './screens/ChatVoiceLibraryScreen';
import AgentAccountCard from './sections/agent/AgentAccountCard';
import AgentCodexRuntimeSection from './sections/agent/AgentCodexRuntimeSection';

describe('SettingsChoicePopover', () => {
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
});

describe('ChatVoiceBackendScreen', () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;
  const originalFetch = globalThis.fetch;

  before(async () => {
    const settingsTranslations = JSON.parse(readFileSync(
      new URL('../../../i18n/locales/en/settings.json', import.meta.url),
      'utf8',
    )) as Record<string, unknown>;
    await i18next.use(initReactI18next).init({
      lng: 'en',
      fallbackLng: false,
      defaultNS: 'settings',
      resources: { en: { settings: settingsTranslations } },
    });
  });

  afterEach(async () => {
    await React.act(async () => root?.unmount());
    container?.remove();
    document.querySelectorAll('[role="listbox"]').forEach((listbox) => listbox.parentElement?.parentElement?.remove());
    localStorage.clear();
    globalThis.fetch = originalFetch;
    root = null;
    container = null;
  });

  const render = async () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    await React.act(async () => root?.render(<ChatVoiceBackendScreen onOpenLibrary={() => {}} />));
    return container;
  };

  const renderLibrary = async () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    await React.act(async () => root?.render(<ChatVoiceLibraryScreen />));
    return container;
  };

  const flush = async () => {
    await React.act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  };

  const runtimeSettings = (
    selectedVoice: string | null,
    voiceSelection = true,
  ): VoiceRuntimeSettings => ({
    capabilities: {
      installedVoices: true,
      favorites: true,
      voiceSelection,
      voiceTuning: true,
      voiceDisplayNames: true,
      sttSettings: true,
    },
    tts: {
      defaultVoice: 'hfc-male-medium',
      selectedVoice,
      effectiveVoice: selectedVoice ?? 'hfc-male-medium',
      speechPace: 1,
      tuning: {
        voiceId: selectedVoice ?? 'hfc-male-medium',
        lengthScale: 0.9,
        sentenceSilenceSeconds: 0.1,
        structureSilenceSeconds: 0.2,
      },
      catalog: [
        { id: 'danny-low', label: 'Danny', gender: 'male', tier: 'low', locale: 'en-US' },
        { id: 'hfc-male-medium', label: 'HFC Male', gender: 'male', tier: 'medium', locale: 'en-US' },
      ],
      favorites: [{
        id: 'danny-low',
        sourceKey: 'en_US-danny-low',
        modelId: 'en_US-danny-low',
        speakerId: null,
        speakerName: null,
        label: 'Danny',
        gender: 'male',
        lengthScale: 1,
        notes: '',
      }],
      displayNames: {},
      installedModels: [
        {
          id: 'en_US-danny-low', numSpeakers: 1, speakers: [], language: 'en_US', region: 'US',
          quality: 'low', dataset: 'danny', lengthScale: 1, noiseScale: 0.667,
          noiseWScale: 0.8, normalizeAudio: true, volume: 1,
          sentenceSilenceSeconds: 0, structureSilenceSeconds: 0,
        },
        {
          id: 'en_US-kusal-medium', numSpeakers: 1, speakers: [], language: 'en_US', region: 'US',
          quality: 'medium', dataset: 'kusal', lengthScale: 1, noiseScale: 0.667,
          noiseWScale: 0.8, normalizeAudio: true, volume: 1,
          sentenceSilenceSeconds: 0, structureSilenceSeconds: 0,
        },
        {
          id: 'en_US-amy-low', numSpeakers: 1, speakers: [], language: 'en_US', region: 'US',
          quality: 'low', dataset: 'amy', lengthScale: 1, noiseScale: 0.667,
          noiseWScale: 0.8, normalizeAudio: true, volume: 1,
          sentenceSilenceSeconds: 0, structureSilenceSeconds: 0,
        },
        {
          id: 'en_US-amy-medium', numSpeakers: 1, speakers: [], language: 'en_US', region: 'US',
          quality: 'medium', dataset: 'amy', lengthScale: 1, noiseScale: 0.667,
          noiseWScale: 0.8, normalizeAudio: true, volume: 1,
          sentenceSilenceSeconds: 0, structureSilenceSeconds: 0,
        },
        {
          id: 'en_US-libritts_r-medium', numSpeakers: 904, speakers: [], language: 'en_US', region: 'US',
          quality: 'medium', dataset: 'libritts_r', lengthScale: 1, noiseScale: 0.667,
          noiseWScale: 0.8, normalizeAudio: true, volume: 1,
          sentenceSilenceSeconds: 0, structureSilenceSeconds: 0,
        },
      ],
    },
    stt: {
      models: [{ id: 'tiny.en', installed: true }],
      settings: {
        model: 'tiny.en', decoderPreset: 'standard', threads: 4, initialPrompt: '',
        capture: { echoCancellation: true, noiseSuppression: true, autoGainControl: false },
      },
    },
  });

  test('migrates the local selection and keeps Default and Favorites directly accessible', async () => {
    localStorage.setItem('voiceConfig', JSON.stringify({ ttsVoice: 'danny-low' }));
    let selectedVoice: string | null = null;
    const writes: Array<string | null> = [];
    globalThis.fetch = (async (_input, init) => {
      if (init?.method === 'PUT') {
        selectedVoice = (JSON.parse(String(init.body)) as { selectedVoice: string | null }).selectedVoice;
        writes.push(selectedVoice);
      }
      return new Response(JSON.stringify(runtimeSettings(selectedVoice)), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as typeof fetch;

    const host = await render();
    await flush();

    const picker = host.querySelector<HTMLButtonElement>('[role="combobox"]');
    assert.ok(picker);
    assert.equal(JSON.parse(localStorage.getItem('voiceConfig') ?? '{}').ttsVoice, '');
    assert.deepEqual(writes, ['danny-low']);
    assert.equal(picker.textContent?.replace(/\s+/g, ' ').trim(), 'Danny');
    assert.doesNotMatch(host.textContent ?? '', /Kusal|Installed voices|Training/);

    await React.act(async () => picker.click());
    const options = [...document.querySelectorAll<HTMLButtonElement>('[role="option"]')];
    assert.equal(options.length, 2);
    assert.match(options[0]?.textContent ?? '', /HFC Male.*Default/s);
    assert.match(options[1]?.textContent ?? '', /Danny.*en-US · low/s);
    assert.doesNotMatch(options[1]?.textContent ?? '', /Male/);
    await React.act(async () => options[0]?.click());
    await flush();

    assert.deepEqual(writes, ['danny-low', null]);
    assert.equal(JSON.parse(localStorage.getItem('voiceConfig') ?? '{}').ttsVoice, '');
    assert.ok(host.querySelector<HTMLTextAreaElement>('textarea[aria-label="Preview script"]')?.value);
    assert.equal(
      host.querySelector<HTMLSelectElement>('select[aria-label="Whisper model"]')?.value,
      'tiny.en',
    );
    assert.match(host.textContent ?? '', /Voice selection/);
    assert.match(host.textContent ?? '', /Browse voices and manage favorites/);
    assert.match(host.textContent ?? '', /Fast \(tiny\.en\)/);
    assert.match(host.textContent ?? '', /Careful searches more possibilities but is slower/);
    assert.equal(
      host.querySelector<HTMLTextAreaElement>('textarea[aria-label="Vocabulary hint"]')?.placeholder,
      'CLIde, Piper, Tailscale…',
    );
    assert.match(
      host.querySelector('summary')?.parentElement?.parentElement?.textContent ?? '',
      /Fine tuning.*HFC Male/s,
    );
  });

  test('shows a selected non-favorite without exposing installed inventory metadata', async () => {
    const current = runtimeSettings('en_US-kusal-medium');
    current.tts.displayNames['en_US-kusal-medium'] = 'Work narrator';
    current.tts.displayNames['en_US-danny-low'] = 'Classic Danny';
    globalThis.fetch = (async () => new Response(
      JSON.stringify(current),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    )) as typeof fetch;

    const host = await render();
    await flush();

    const picker = host.querySelector<HTMLButtonElement>('[role="combobox"]');
    assert.ok(picker);
    assert.equal(picker.textContent?.replace(/\s+/g, ' ').trim(), 'Work narrator');
    assert.doesNotMatch(host.textContent ?? '', /Training|AgentVibes|Installed voices/);

    await React.act(async () => picker.click());
    const listbox = document.querySelector('[role="listbox"]');
    assert.ok(listbox);
    assert.match(listbox.textContent ?? '', /Current voice.*Work narrator/s);
    assert.match(listbox.textContent ?? '', /Favorites.*Classic Danny.*Danny.*en-US · low/s);
    assert.equal(listbox.querySelectorAll('[role="option"]').length, 3);
    const classicDanny = [...listbox.querySelectorAll<HTMLElement>('[role="option"]')]
      .find((option) => option.textContent?.includes('Classic Danny'));
    const metadata = [...(classicDanny?.querySelectorAll<HTMLElement>('span') ?? [])]
      .find((span) => span.textContent === 'Danny · en-US · low');
    assert.match(metadata?.className ?? '', /\btext-xs\b/);
    assert.match(metadata?.className ?? '', /\btruncate\b/);
  });

  test('keeps the Voice screen usable when an older runtime rejects pace changes', async () => {
    const legacySettings = runtimeSettings('danny-low');
    delete (legacySettings.tts as Partial<typeof legacySettings.tts>).speechPace;
    delete (legacySettings.tts as Partial<typeof legacySettings.tts>).displayNames;
    let paceWrites = 0;
    globalThis.fetch = (async (_input, init) => {
      if (init?.method === 'PUT') {
        paceWrites += 1;
        return new Response(JSON.stringify({ error: 'Unsupported settings field' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify(legacySettings), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as typeof fetch;

    const host = await render();
    await flush();

    const slider = host.querySelector<HTMLInputElement>('input[aria-label="Playback speed"]');
    assert.ok(slider);
    assert.match(host.textContent ?? '', /1\.00×/);

    await React.act(async () => {
      const valueSetter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        'value',
      )?.set;
      valueSetter?.call(slider, '1.25');
      slider.dispatchEvent(new window.Event('input', { bubbles: true }));
      slider.dispatchEvent(new window.Event('pointerup', { bubbles: true }));
    });
    await flush();

    assert.equal(paceWrites, 1);
    assert.match(host.textContent ?? '', /1\.00×/);
    assert.match(host.textContent ?? '', /Speech pace failed \(400\)/);
  });

  test('keeps the Voice screen usable when an older runtime omits capabilities and STT', async () => {
    const legacySettings = runtimeSettings(null) as Partial<VoiceRuntimeSettings>;
    delete legacySettings.capabilities;
    delete legacySettings.stt;
    globalThis.fetch = (async () => new Response(JSON.stringify(legacySettings), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })) as typeof fetch;

    const host = await render();
    await flush();

    assert.equal(host.querySelector('[role="combobox"]'), null);
    assert.equal(host.querySelector('select[aria-label="Whisper model"]'), null);
  });

  test('keeps free-text voice input for a custom browser backend', async () => {
    let requests = 0;
    globalThis.fetch = (async () => {
      requests += 1;
      return new Response('{}', { status: 200 });
    }) as typeof fetch;
    localStorage.setItem('voiceConfig', JSON.stringify({
      baseUrl: 'https://voice.example/v1',
      ttsVoice: 'custom-voice',
    }));

    const host = await render();
    const voiceInput = host.querySelector<HTMLInputElement>('input[aria-label="Voice"]');
    assert.equal(voiceInput?.value, 'custom-voice');
    assert.equal(requests, 0);
  });

  test('keeps custom free-text fields available when runtime selection is unsupported', async () => {
    globalThis.fetch = (async () => new Response(JSON.stringify(runtimeSettings(null, false)), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })) as typeof fetch;
    localStorage.setItem('voiceConfig', JSON.stringify({ ttsVoice: 'legacy-voice' }));

    const host = await render();
    await flush();

    assert.equal(host.querySelector('[role="combobox"]'), null);
    assert.equal(
      host.querySelector<HTMLInputElement>('input[aria-label="Voice"]')?.value,
      'legacy-voice',
    );
  });

  test('groups size variants and selects a single-model voice without a speaker screen', async () => {
    let current = runtimeSettings(null);
    const writes: string[] = [];
    globalThis.fetch = (async (_input, init) => {
      if (init?.method === 'PUT') {
        const body = JSON.parse(String(init.body)) as { selectedVoice?: string };
        if (body.selectedVoice) {
          writes.push(body.selectedVoice);
          current = runtimeSettings(body.selectedVoice);
        }
      }
      return new Response(JSON.stringify(current), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as typeof fetch;

    const host = await renderLibrary();
    await flush();

    const amyRows = [...host.querySelectorAll<HTMLButtonElement>('button')]
      .filter((button) => button.textContent?.includes('Amy'));
    assert.equal(amyRows.length, 1);
    assert.match(amyRows[0]?.textContent ?? '', /Low \/ Medium/);

    const kusal = [...host.querySelectorAll<HTMLButtonElement>('button')]
      .find((button) => button.textContent?.includes('Kusal'));
    assert.ok(kusal);
    await React.act(async () => kusal.click());
    await flush();
    assert.ok(host.querySelector('input[aria-label="Search installed models"]'));
    assert.equal(host.querySelector('input[aria-label="Search speakers or enter a speaker number"]'), null);

    await React.act(async () => amyRows[0]?.click());
    assert.match(host.textContent ?? '', /Amy/);
    assert.equal(host.querySelector('input[aria-label="Search speakers or enter a speaker number"]'), null);
    const medium = [...host.querySelectorAll<HTMLButtonElement>('button')]
      .find((button) => button.textContent?.trim() === 'Medium');
    assert.ok(medium);
    await React.act(async () => medium.click());
    await flush();

    assert.deepEqual(writes, ['en_US-kusal-medium', 'en_US-amy-medium']);
  });

  test('pages a large speaker model and manages one speaker as selection, favorite, and default', async () => {
    let current = runtimeSettings(null);
    const writes: unknown[] = [];
    globalThis.fetch = (async (_input, init) => {
      if (init?.method === 'PUT') {
        const body = JSON.parse(String(init.body)) as Record<string, unknown>;
        writes.push(body);
        if (typeof body.selectedVoice === 'string') {
          current = runtimeSettings(body.selectedVoice);
        } else if (typeof body.defaultVoice === 'string') {
          current.tts.defaultVoice = body.defaultVoice;
          current.tts.effectiveVoice = current.tts.selectedVoice ?? body.defaultVoice;
        } else if (typeof body.id === 'string' && body.favorite === true) {
          current.tts.favorites.push({
            id: body.id,
            sourceKey: body.id,
            modelId: 'en_US-libritts_r-medium',
            speakerId: 546,
            speakerName: 'Speaker 546',
            label: 'LibriTTS R · Speaker 546',
            gender: null,
            lengthScale: null,
            notes: '',
          });
        }
      }
      return new Response(JSON.stringify(current), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as typeof fetch;

    const host = await renderLibrary();
    await flush();

    const modelButton = [...host.querySelectorAll<HTMLButtonElement>('button')]
      .find((button) => button.textContent?.includes('LibriTTS R'));
    assert.ok(modelButton);
    await React.act(async () => modelButton.click());

    assert.match(host.textContent ?? '', /1–32 of 904/);
    assert.match(host.textContent ?? '', /Speaker 0/);
    assert.doesNotMatch(host.textContent ?? '', /Speaker 546/);

    const search = host.querySelector<HTMLInputElement>('input[aria-label="Search speakers or enter a speaker number"]');
    assert.ok(search);
    await React.act(async () => {
      const valueSetter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        'value',
      )?.set;
      valueSetter?.call(search, '546');
      search.dispatchEvent(new window.Event('input', { bubbles: true }));
    });

    const speaker = [...host.querySelectorAll<HTMLButtonElement>('button')]
      .find((button) => button.textContent?.trim() === 'Speaker 546');
    assert.ok(speaker);
    await React.act(async () => speaker.click());
    await flush();

    const favorite = host.querySelector<HTMLButtonElement>('[aria-label="Favorite Speaker 546"]');
    assert.ok(favorite);
    await React.act(async () => favorite.click());
    await flush();

    const setDefault = [...host.querySelectorAll<HTMLButtonElement>('button')]
      .find((button) => button.textContent?.includes('Set selected voice as default'));
    assert.ok(setDefault);
    await React.act(async () => setDefault.click());
    await flush();

    assert.deepEqual(writes, [
      { selectedVoice: 'en_US-libritts_r-medium#546' },
      { id: 'en_US-libritts_r-medium#546', favorite: true },
      { defaultVoice: 'en_US-libritts_r-medium#546' },
    ]);
    assert.match(host.textContent ?? '', /Runtime default updated/);

    const favoritesView = host.querySelector<HTMLButtonElement>(
      '[role="radio"][aria-checked="false"]',
    );
    assert.match(favoritesView?.textContent ?? '', /1 favorite/);
    await React.act(async () => favoritesView?.click());
    assert.match(host.textContent ?? '', /Speaker 546/);
    assert.doesNotMatch(host.textContent ?? '', /1–32 of 904/);
  });

  test('renames the selected voice, searches both names, and restores the original', async () => {
    const current = runtimeSettings('en_US-libritts_r-medium#546');
    const writes: unknown[] = [];
    globalThis.fetch = (async (_input, init) => {
      if (init?.method === 'PUT') {
        const body = JSON.parse(String(init.body)) as {
          voiceDisplayName?: { id: string; displayName: string | null };
        };
        if (body.voiceDisplayName) {
          writes.push(body);
          const { id, displayName } = body.voiceDisplayName;
          if (displayName) current.tts.displayNames[id] = displayName;
          else delete current.tts.displayNames[id];
        }
      }
      return new Response(JSON.stringify(current), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as typeof fetch;

    const host = await renderLibrary();
    await flush();
    const modelButton = [
      ...host.querySelectorAll<HTMLButtonElement>('button'),
    ].find((button) => button.textContent?.includes('LibriTTS R'));
    assert.ok(modelButton);
    await React.act(async () => modelButton.click());

    const search = host.querySelector<HTMLInputElement>(
      'input[aria-label="Search speakers or enter a speaker number"]',
    );
    assert.ok(search);
    await React.act(async () => {
      const valueSetter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        'value',
      )?.set;
      valueSetter?.call(search, '546');
      search.dispatchEvent(new window.Event('input', { bubbles: true }));
    });

    const editName = [
      ...host.querySelectorAll<HTMLButtonElement>('button'),
    ].find((button) => button.textContent?.trim() === 'Edit friendly name');
    assert.ok(editName);
    await React.act(async () => editName.click());
    const nameInput = host.querySelector<HTMLInputElement>(
      'input[aria-label="Friendly name"]',
    );
    assert.equal(nameInput?.placeholder, 'LibriTTS R · Speaker 546');

    await React.act(async () => {
      const valueSetter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        'value',
      )?.set;
      valueSetter?.call(nameInput, 'Evening narrator');
      nameInput?.dispatchEvent(new window.Event('input', { bubbles: true }));
    });
    const save = [...host.querySelectorAll<HTMLButtonElement>('button')].find(
      (button) => button.textContent?.trim() === 'Save',
    );
    assert.ok(save);
    await React.act(async () => save.click());
    await flush();

    assert.match(host.textContent ?? '', /Evening narrator/);
    assert.match(host.textContent ?? '', /Speaker 546/);
    assert.match(host.textContent ?? '', /Friendly name saved/);

    await React.act(async () => {
      const valueSetter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        'value',
      )?.set;
      valueSetter?.call(search, 'Evening');
      search.dispatchEvent(new window.Event('input', { bubbles: true }));
    });
    assert.match(host.textContent ?? '', /Evening narrator/);
    await React.act(async () => {
      const valueSetter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        'value',
      )?.set;
      valueSetter?.call(search, '546');
      search.dispatchEvent(new window.Event('input', { bubbles: true }));
    });
    assert.match(host.textContent ?? '', /Evening narrator/);

    const editAgain = [
      ...host.querySelectorAll<HTMLButtonElement>('button'),
    ].find((button) => button.textContent?.trim() === 'Edit friendly name');
    assert.ok(editAgain);
    await React.act(async () => editAgain.click());
    const restore = [
      ...host.querySelectorAll<HTMLButtonElement>('button'),
    ].find((button) => button.textContent?.trim() === 'Use original name');
    assert.ok(restore);
    await React.act(async () => restore.click());
    await flush();

    assert.doesNotMatch(host.textContent ?? '', /Evening narrator/);
    assert.match(host.textContent ?? '', /Original name restored/);
    assert.deepEqual(writes, [
      {
        voiceDisplayName: {
          id: 'en_US-libritts_r-medium#546',
          displayName: 'Evening narrator',
        },
      },
      {
        voiceDisplayName: {
          id: 'en_US-libritts_r-medium#546',
          displayName: null,
        },
      },
    ]);
  });


  test('shows a speaker identity for legacy favorites and omits Voice Studio gender metadata', async () => {
    const current = runtimeSettings(null);
    current.tts.favorites.push({
      id: 'en_US-libritts_r-medium#3',
      sourceKey: 'en_US-libritts_r-medium#3',
      modelId: 'en_US-libritts_r-medium',
      speakerId: 3,
      speakerName: null,
      label: 'LibriTTS R',
      gender: 'female',
      lengthScale: null,
      notes: '',
    });
    globalThis.fetch = (async () => new Response(JSON.stringify(current), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })) as typeof fetch;

    const host = await render();
    await flush();
    const picker = host.querySelector<HTMLButtonElement>('[role="combobox"]');
    assert.ok(picker);
    await React.act(async () => picker.click());
    const listbox = document.querySelector('[role="listbox"]');
    assert.match(listbox?.textContent ?? '', /LibriTTS R · Speaker 3.*en-US · medium/s);
    assert.doesNotMatch(listbox?.textContent ?? '', /Female/);
  });
});

describe('AccountScreen', () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;

  const originalStatus = api.auth.status;
  const originalUser = api.auth.user;
  const originalOnboarding = api.user.onboardingStatus;

  const jsonResponse = (body: unknown) => ({
    ok: true,
    status: 200,
    json: async () => body,
  }) as Response;

  before(async () => {
    const loadTranslations = (filename: string) => JSON.parse(readFileSync(
      new URL(`../../../i18n/locales/en/${filename}.json`, import.meta.url),
      'utf8',
    )) as Record<string, unknown>;

    await i18next.use(initReactI18next).init({
      lng: 'en',
      fallbackLng: false,
      defaultNS: 'settings',
      resources: {
        en: {
          settings: loadTranslations('settings'),
          sidebar: loadTranslations('sidebar'),
          common: loadTranslations('common'),
        },
      },
    });
  });

  beforeEach(() => {
    localStorage.setItem(AUTH_TOKEN_STORAGE_KEY, 'test-token');
    api.auth.status = async () => jsonResponse({ needsSetup: false });
    api.auth.user = async () => jsonResponse({ user: { username: 'grayson' } });
    api.user.onboardingStatus = async () => jsonResponse({ hasCompletedOnboarding: true });
  });

  afterEach(async () => {
    await React.act(async () => root?.unmount());
    container?.remove();
    document.querySelectorAll('[role="menu"]').forEach((menu) => menu.parentElement?.remove());
    localStorage.clear();
    root = null;
    container = null;
  });

  after(() => {
    api.auth.status = originalStatus;
    api.auth.user = originalUser;
    api.user.onboardingStatus = originalOnboarding;
  });

  const render = async (children: React.ReactNode) => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    await React.act(async () => {
      root?.render(<AuthProvider>{children}</AuthProvider>);
    });

    return container;
  };

  test('the sidebar Account popover contains navigation only', async () => {
    const host = await render(
      <SidebarAccountMenu onShowSettings={() => {}} onShowUsage={() => {}} t={i18next.getFixedT('en', 'sidebar')} />,
    );

    const trigger = host.querySelector<HTMLButtonElement>('button[aria-label="Account menu"]');
    assert.ok(trigger);
    await React.act(async () => trigger.click());

    const menu = document.querySelector<HTMLElement>('[role="menu"][aria-label="Account menu"]');
    assert.ok(menu);
    assert.deepEqual(
      [...menu.querySelectorAll('[role="menuitem"]')].map((item) => item.textContent),
      ['Account', 'Usage', 'Settings'],
    );
  });

  test('the Account screen ends with the Log out action', async () => {
    const host = await render(<AccountScreen />);
    const groups = host.querySelectorAll('section');
    const lastGroup = groups.item(groups.length - 1);
    const logoutButton = lastGroup.querySelector<HTMLButtonElement>('button');

    assert.match(lastGroup.textContent ?? '', /Sign out of CLIde on this device/);
    assert.equal(logoutButton?.textContent?.trim(), 'Log out');

    await React.act(async () => logoutButton?.click());
    assert.equal(localStorage.getItem(AUTH_TOKEN_STORAGE_KEY), null);
  });
});

describe('AgentAccountCard', () => {
  /**
   * Covers the Runtime row only. Every case renders unauthenticated on purpose:
   * that disables the plan-usage fetch and the reset toggle, so the card's one
   * remaining request is the capability matrix and the row under test is the
   * only thing that varies.
   */

  let root: Root | null = null;
  let container: HTMLDivElement | null = null;
  const originalFetch = globalThis.fetch;

  const preferences: NotificationPreferencesState = {
    channels: { inApp: true, webPush: false, desktop: false, sound: false },
    events: { actionRequired: true, stop: true, error: true, usageReset: {} },
  };

  const authStatus = (versions: ProviderRuntimeVersions | null): AuthStatus => ({
    authenticated: false,
    email: null,
    method: null,
    error: null,
    loading: false,
    versions,
  });

  before(async () => {
    const settingsTranslations = JSON.parse(readFileSync(
      new URL('../../../i18n/locales/en/settings.json', import.meta.url),
      'utf8',
    )) as Record<string, unknown>;
    const commonTranslations = JSON.parse(readFileSync(
      new URL('../../../i18n/locales/en/common.json', import.meta.url),
      'utf8',
    )) as Record<string, unknown>;
    await i18next.use(initReactI18next).init({
      lng: 'en',
      fallbackLng: false,
      defaultNS: 'settings',
      resources: { en: { settings: settingsTranslations, common: commonTranslations } },
    });

    globalThis.fetch = (async () => new Response(
      JSON.stringify({ success: true, data: { providers: [] } }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    )) as typeof globalThis.fetch;
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

  const render = async (versions: ProviderRuntimeVersions | null): Promise<HTMLElement> => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    await React.act(async () => {
      root?.render(React.createElement(AgentAccountCard, {
        provider: 'claude',
        authStatus: authStatus(versions),
        onLogin: () => {},
        notificationPreferences: preferences,
        onNotificationPreferencesChange: () => {},
        onOpenNotifications: () => {},
      }));
    });

    return container;
  };

  test('the reported pair shows as one Runtime row', async () => {
    const host = await render({
      runtime: '2.1.233',
      sdk: '0.3.233',
      observedAt: new Date().toISOString(),
    });

    assert.match(host.textContent ?? '', /Runtime/);
    assert.match(host.textContent ?? '', /2\.1\.233 · SDK 0\.3\.233/);
    // A pair that has never moved says nothing more than the two numbers.
    assert.doesNotMatch(host.textContent ?? '', /moved/);
  });

  test('a recent move names the half that moved and how long ago it was seen', async () => {
    const host = await render({
      runtime: '2.1.233',
      sdk: '0.3.233',
      observedAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
      previous: {
        runtime: '2.1.229',
        sdk: '0.3.233',
        observedAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(),
      },
    });

    assert.match(host.textContent ?? '', /Claude runtime moved 2\.1\.229 → 2\.1\.233/);
    assert.match(host.textContent ?? '', /Seen 2h ago/);
    // The SDK half did not move, so it must not be mentioned.
    assert.doesNotMatch(host.textContent ?? '', /Agent SDK moved/);
  });

  test('a provider that reports no versions gets no Runtime row', async () => {
    const host = await render(null);

    assert.doesNotMatch(host.textContent ?? '', /Runtime/);
  });
});

describe('AgentCodexRuntimeSection', () => {
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
      new URL('../../../i18n/locales/en/settings.json', import.meta.url),
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
    assert.ok(button, `no button labelled "${label}"`);
    return button;
  };

  const hasButton = (host: HTMLElement, label: string): boolean => (
    [...host.querySelectorAll('button')].some((item) => item.textContent === label)
  );

  const installationRow = (host: HTMLElement, fullPath: string): HTMLElement => {
    const pathButton = host.querySelector<HTMLButtonElement>(`button[title="${fullPath}"]`);
    assert.ok(pathButton?.parentElement);
    return pathButton.parentElement;
  };

  test('runtime section expands in place, gates Use behind Check, and rolls back the previous install', async () => {
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
      if (url.endsWith('/capabilities')) {
        data = {
          chatTransport: {
            configured: 'app-server',
            actual: 'app-server',
            health: 'ready',
            sdkVersion: '0.147.0',
            bundledCliVersion: '0.147.0',
            lastError: null,
            lastStartupFallbackAt: null,
          },
        };
      } else if (url.endsWith('/check')) {
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
    await React.act(async () => root?.render(<AgentCodexRuntimeSection />));
    await flush();

    // Collapsed, it reads exactly like Claude's row: the version pair and nothing
    // else. The installation list only exists once the row is expanded.
    assert.match(container.textContent ?? '', /0\.147\.0 · SDK 0\.147\.0/);
    assert.equal(container.querySelectorAll('button').length, 1);

    const toggle = container.querySelector<HTMLButtonElement>('button[aria-expanded]');
    assert.ok(toggle);
    await React.act(async () => toggle.click());
    await flush();

    // Paths are compacted to version + binary, and no raw enum reaches the user.
    assert.doesNotMatch(container.textContent ?? '', /Projects\/CLIde/);
    assert.match(container.textContent ?? '', /…\/node_modules\/…\/bin\/codex/);
    assert.match(container.textContent ?? '', /…\/standalone\/releases\/…\/bin\/codex/);
    assert.doesNotMatch(container.textContent ?? '', /app-server/);
    assert.match(container.textContent ?? '', /App Server/);
    assert.match(container.textContent ?? '', /Ready/);

    // One state badge per row: no Candidate, no Live, and Bundled is a sentence.
    assert.doesNotMatch(container.textContent ?? '', /Candidate/);
    assert.match(container.textContent ?? '', /Bundled with CLIde/);

    const bundledRow = installationRow(container, bundledPath);
    const candidateRow = installationRow(container, candidatePath);
    const alternateRow = installationRow(container, alternatePath);

    assert.equal(hasButton(bundledRow, 'Check'), false);
    assert.equal(hasButton(bundledRow, 'Roll back'), false);
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
    assert.match(candidateRow.textContent ?? '', /\.codex\/packages\/standalone/);

    await React.act(async () => findButton(alternateRow, 'Use').click());
    await flush();
    assert.deepEqual(selectionRequests, [alternateId]);
    assert.match(container.textContent ?? '', /Switches after the current turn ends/);

    // Rollback is an action on the previous installation's own row, and replaces
    // the Check/Use pair there rather than sitting loose at the bottom.
    const previousRow = installationRow(container, bundledPath);
    assert.equal(hasButton(previousRow, 'Check'), false);
    await React.act(async () => findButton(previousRow, 'Roll back').click());
    await flush();
    assert.deepEqual(selectionRequests, [alternateId, bundledId]);
  });
});

describe('AgentSkillsScreen', () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;
  const originalFetch = globalThis.fetch;
  let skillsRequests: string[] = [];

  const PROJECTS = [
    { name: 'cloudcli', displayName: 'CLIde', fullPath: '/home/tester/Projects/cloudcli' },
    { name: 'cloudcli-wt-a', displayName: 'worktree-a', fullPath: '/home/tester/Projects/cloudcli-wt-a' },
    // Same checkout reached by a second saved row: one option, not two.
    { name: 'cloudcli-alias', displayName: 'CLIde alias', fullPath: '/home/tester/Projects/cloudcli' },
  ];

  const skill = (name: string, scope: string) => ({
    name,
    description: `${name} description`,
    command: `/${name}`,
    scope,
    sourcePath: `/skills/${name}/SKILL.md`,
  });

  beforeEach(() => {
    skillsRequests = [];
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (!url.includes('/skills')) {
        // Enough shape for the capability matrix and the MCP row the parent
        // Agent screen also mounts; only the skills calls are under test.
        return new Response(
          JSON.stringify({ success: true, data: { providers: [], servers: [] } }),
          { status: 200 },
        );
      }

      skillsRequests.push(url);
      const workspacePath = new URL(url, 'http://localhost').searchParams.get('workspacePath');
      const skills = workspacePath
        ? [skill('worktree-only', 'project'), skill('everywhere', 'user')]
        : [skill('everywhere', 'user')];
      return new Response(JSON.stringify({ success: true, data: { skills } }), { status: 200 });
    }) as typeof globalThis.fetch;
  });

  afterEach(async () => {
    await React.act(async () => root?.unmount());
    container?.remove();
    root = null;
    container = null;
    globalThis.fetch = originalFetch;
  });

  // Each test uses a different provider: the hook's skill cache is module-level
  // and keyed by provider and target, so a shared one would hide a request.
  const mount = async (provider: 'claude' | 'codex' | 'cursor') => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    await React.act(async () => root?.render(
      <AgentSkillsScreen provider={provider} projects={PROJECTS} />,
    ));
    return container;
  };

  const trigger = () => container?.querySelector<HTMLButtonElement>('[role="combobox"]');
  // Uppercasing is CSS, so the DOM keeps the source casing; the two spans are
  // read separately because nothing separates them in textContent.
  const groupHeadings = () => [...(container?.querySelectorAll('p.uppercase') ?? [])]
    .map((heading) => [...heading.querySelectorAll('span')]
      .map((span) => span.textContent?.trim())
      .join(' '));

  test('opens on Global, asks only for global skills, and lists each checkout once', async () => {
    const host = await mount('claude');

    assert.deepEqual(skillsRequests, ['/api/providers/claude/skills']);
    assert.match(trigger()?.textContent ?? '', /Global/);

    await React.act(async () => trigger()?.click());
    const options = [...document.querySelectorAll('[role="option"]')];
    // Global plus the two distinct checkouts; the aliased duplicate is dropped.
    assert.equal(options.length, 3);
    assert.equal(options[0]?.getAttribute('aria-selected'), 'true');
    assert.match(options[0]?.textContent ?? '', /Global/);

    // The path is what keeps a checkout apart from its worktrees, so it is shown
    // home-relative rather than truncated inside the shared home prefix.
    const worktree = options.find((option) => option.textContent?.includes('worktree-a'));
    assert.match(worktree?.textContent ?? '', /~\/Projects\/cloudcli-wt-a/);

    assert.deepEqual(groupHeadings(), ['Available everywhere 1']);
    assert.match(host.textContent ?? '', /Add Skill/);
  });

  test('selecting a checkout asks for that path alone and groups its skills under it', async () => {
    const host = await mount('codex');
    await React.act(async () => trigger()?.click());

    const worktree = [...document.querySelectorAll<HTMLButtonElement>('[role="option"]')]
      .find((option) => option.textContent?.includes('worktree-a'));
    await React.act(async () => worktree?.click());
    await React.act(async () => { await Promise.resolve(); });

    assert.deepEqual(skillsRequests, [
      '/api/providers/codex/skills',
      '/api/providers/codex/skills?workspacePath=%2Fhome%2Ftester%2FProjects%2Fcloudcli-wt-a',
    ]);
    // The checkout's own skills lead, under the name that was picked.
    assert.deepEqual(groupHeadings(), ['worktree-a 1', 'Available everywhere 1']);
    assert.match(host.textContent ?? '', /worktree-only/);
    // Installing still lands globally, and the button says so.
    assert.match(host.textContent ?? '', /Add to Global/);
  });

  test('returns to Global when the provider changes', async () => {
    await mount('cursor');
    await React.act(async () => trigger()?.click());
    const worktree = [...document.querySelectorAll<HTMLButtonElement>('[role="option"]')]
      .find((option) => option.textContent?.includes('worktree-a'));
    await React.act(async () => worktree?.click());
    assert.match(trigger()?.textContent ?? '', /worktree-a/);

    await React.act(async () => root?.render(
      <AgentSkillsScreen provider="claude" projects={PROJECTS} />,
    ));
    assert.match(trigger()?.textContent ?? '', /Global/);
    // Claude's global list is already cached, so the reset is proved by what is
    // never asked for rather than by a fresh request.
    assert.deepEqual(skillsRequests.filter((url) => url.includes('/claude/')), []);
  });

  test('bounds the picker so the row label stays on one line at 320px', async () => {
    await mount('claude');
    // Measured: the label needs 109px, and the row has 254px inside its padding
    // at 320px. Without both bounds the trigger takes the label's line.
    const className = trigger()?.className ?? '';
    assert.match(className, /min-w-28/);
    assert.match(className, /max-w-\[40vw\]/);

    // Search, Add and Refresh share one row at every width; a stacking variant
    // here is what made three full-width buttons on a phone.
    const search = container?.querySelector('input[aria-label="Search skills"]');
    const controls = search?.closest('div')?.parentElement;
    assert.equal(controls?.className.includes('flex-col'), false);
    assert.ok(container?.querySelector('button[aria-label="Refresh skills"]'));
  });

  test('the parent Skills row counts global skills without scanning any checkout', async () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    await React.act(async () => root?.render(
      <AgentProviderScreen
        provider="claude"
        authStatus={{
          authenticated: false, email: null, method: null, error: null, loading: false, versions: null,
        }}
        onLogin={() => {}}
        projects={PROJECTS}
        onOpenScreen={() => {}}
        notificationPreferences={{
          channels: { inApp: true, webPush: false, desktop: false, sound: false },
          events: { actionRequired: true, stop: true, error: true, usageReset: {} },
        }}
        onNotificationPreferencesChange={() => {}}
        onOpenNotifications={() => {}}
      />,
    ));

    // The row is a preview of the Global list, so no saved checkout may be
    // scanned to render it however many projects exist.
    assert.deepEqual(skillsRequests.filter((url) => url.includes('workspacePath')), []);

    const skillsRow = [...container.querySelectorAll('button')]
      .find((row) => row.textContent?.includes('Skills'));
    assert.match(skillsRow?.textContent ?? '', /1/);
  });
});
