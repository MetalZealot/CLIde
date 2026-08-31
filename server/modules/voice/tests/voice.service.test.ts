import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import test from 'node:test';

import express from 'express';

import { createVoiceRouter } from '../voice.routes.js';
import { createVoiceService } from '../voice.service.js';

const defaults = {
  baseUrl: 'https://voice.example/v1',
  apiKey: 'server-key',
  sttModel: 'whisper-1',
  ttsModel: 'tts-1',
  ttsVoice: 'alloy',
};

test('reports when no server-controlled backend is configured', async () => {
  const service = createVoiceService({
    defaults: { ...defaults, baseUrl: '' },
    timeoutMs: 1_000,
    fetchBackend: async () => {
      throw new Error('fetch should not run');
    },
  });

  assert.deepEqual(await service.getHealth(), {
    configured: false,
    defaultVoice: null,
    voices: [],
    dictationCapture: {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: false,
    },
  });
});

test('relays a backend-authorized voice catalog through health', async () => {
  let requestedUrl = '';
  const service = createVoiceService({
    defaults,
    timeoutMs: 1_000,
    fetchBackend: async (url) => {
      requestedUrl = url;
      return new Response(JSON.stringify({
        configured: true,
        tts_default_voice: 'hfc-male-medium',
        stt_settings: {
          capture: {
            echo_cancellation: false,
            noise_suppression: true,
            auto_gain_control: true,
          },
        },
        tts_voices: [
          {
            id: 'hfc-male-medium',
            label: 'HFC Male',
            gender: 'male',
            tier: 'medium',
            locale: 'en-US',
          },
          { id: 'bad', label: 'Bad', gender: 'unknown', tier: 'medium', locale: 'en-US' },
        ],
      }));
    },
  });

  assert.deepEqual(await service.getHealth(), {
    configured: true,
    defaultVoice: 'hfc-male-medium',
    voices: [{
      id: 'hfc-male-medium',
      label: 'HFC Male',
      gender: 'male',
      tier: 'medium',
      locale: 'en-US',
    }],
    dictationCapture: {
      echoCancellation: false,
      noiseSuppression: true,
      autoGainControl: true,
    },
  });
  assert.equal(requestedUrl, 'https://voice.example/v1/api/health');
});

test('keeps generic configured backends usable when they publish no catalog', async () => {
  const service = createVoiceService({
    defaults,
    timeoutMs: 1_000,
    fetchBackend: async () => new Response('not found', { status: 404 }),
  });

  assert.deepEqual(await service.getHealth(), {
    configured: true,
    defaultVoice: null,
    voices: [],
    dictationCapture: {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: false,
    },
  });
});

test('relays the CLIde-aware runtime settings contract with safe camel-case fields', async () => {
  const service = createVoiceService({
    defaults,
    timeoutMs: 1_000,
    fetchBackend: async () => new Response(JSON.stringify({
      capabilities: {
        installed_voices: true,
        favorites: true,
        voice_selection: true,
        voice_tuning: true,
        voice_display_names: true,
        stt_settings: true,
      },
      tts: {
        default_voice: 'hfc-male-medium',
        selected_voice: null,
        effective_voice: 'hfc-male-medium',
        speech_pace: 1.2,
        tuning: {
          voice_id: 'hfc-male-medium', length_scale: 0.9,
          sentence_silence_seconds: 0.1, structure_silence_seconds: 0.2,
        },
        catalog: [{
          id: 'hfc-male-medium', label: 'HFC Male', gender: 'male',
          tier: 'medium', locale: 'en-US',
        }],
        installed_models: [{
          id: 'en_US-hfc_male-medium', num_speakers: 1, speakers: [],
          language: 'en', region: 'US', quality: 'medium', dataset: 'hfc',
          length_scale: 1, noise_scale: 0.667, noise_w_scale: 0.8,
          normalize_audio: true, volume: 1,
          sentence_silence_seconds: 0, structure_silence_seconds: 0,
        }],
        favorites: [{
          id: 'hfc-male-medium', source_key: 'en_US-hfc_male-medium',
          model_id: 'en_US-hfc_male-medium', speaker_id: null,
          speaker_name: null, label: 'HFC Male', gender: 'male',
          length_scale: 0.8, notes: '',
        }],
        display_names: {
          'en_US-hfc_male-medium': 'Daily narrator',
          '../unsafe': 'Ignored',
        },
      },
      stt: {
        models: [{ id: 'tiny.en', installed: true }],
        settings: {
          model: 'tiny.en', decoder_preset: 'careful', threads: 2,
          initial_prompt: 'CLIde', capture: {
            echo_cancellation: false,
            noise_suppression: true,
            auto_gain_control: true,
          },
        },
      },
    })),
  });

  const result = await service.getSettings();
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.capabilities.voiceSelection, true);
  assert.equal(result.value.capabilities.voiceDisplayNames, true);
  assert.equal(result.value.tts.installedModels[0]?.numSpeakers, 1);
  assert.equal(result.value.tts.favorites[0]?.sourceKey, 'en_US-hfc_male-medium');
  assert.deepEqual(result.value.tts.displayNames, {
    'en_US-hfc_male-medium': 'Daily narrator',
  });
  assert.equal(result.value.tts.speechPace, 1.2);
  assert.deepEqual(result.value.tts.tuning, {
    voiceId: 'hfc-male-medium',
    lengthScale: 0.9,
    sentenceSilenceSeconds: 0.1,
    structureSilenceSeconds: 0.2,
  });
  assert.equal(result.value.stt.settings.decoderPreset, 'careful');
  assert.deepEqual(result.value.stt.settings.capture, {
    echoCancellation: false,
    noiseSuppression: true,
    autoGainControl: true,
  });
});

test('treats a generic backend without the settings endpoint as unsupported', async () => {
  const service = createVoiceService({
    defaults,
    timeoutMs: 1_000,
    fetchBackend: async () => new Response('not found', { status: 404 }),
  });

  const result = await service.getSettings();
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.capabilities.voiceSelection, false);
  assert.deepEqual(result.value.tts.installedModels, []);
});

test('writes selection, pace, and favorite changes only to the configured runtime', async () => {
  const requests: Array<{ url: string; method: string; body: unknown }> = [];
  const service = createVoiceService({
    defaults,
    timeoutMs: 1_000,
    fetchBackend: async (url, options) => {
      requests.push({
        url,
        method: options.method || 'GET',
        body: options.body ? JSON.parse(String(options.body)) : null,
      });
      if (url.endsWith('/api/voice-labels')) {
        return new Response(JSON.stringify({ key: 'en_US-amy-medium', entry: {} }));
      }
      return new Response(JSON.stringify({ capabilities: {}, tts: {}, stt: {} }));
    },
  });

  const runtimeDefault = await service.updateSettings({ defaultVoice: 'en_US-amy-medium' });
  const selection = await service.updateSettings({ selectedVoice: 'en_US-amy-medium' });
  const pace = await service.updateSettings({ speechPace: 1.25 });
  const tuning = await service.updateSettings({
    voiceTuning: {
      lengthScale: 0.8,
      sentenceSilenceSeconds: 0.15,
      structureSilenceSeconds: 0.3,
    },
  });
  const displayName = await service.updateSettings({
    voiceDisplayName: { id: 'en_US-amy-medium', displayName: 'Work narrator' },
  });
  const sttSettings = await service.updateSettings({
    sttSettings: {
      model: 'base.en',
      decoderPreset: 'careful',
      threads: 2,
      initialPrompt: 'CLIde',
      capture: {
        echoCancellation: false,
        noiseSuppression: true,
        autoGainControl: false,
      },
    },
  });
  const favorite = await service.updateFavorite({ id: 'en_US-amy-medium', favorite: true });

  assert.equal(runtimeDefault.ok, true);
  assert.equal(selection.ok, true);
  assert.equal(pace.ok, true);
  assert.equal(tuning.ok, true);
  assert.equal(displayName.ok, true);
  assert.equal(sttSettings.ok, true);
  assert.deepEqual(favorite, {
    ok: true,
    value: { id: 'en_US-amy-medium', favorite: true },
  });
  assert.deepEqual(requests, [
    {
      url: 'https://voice.example/v1/api/voice-settings',
      method: 'PUT',
      body: { default_voice: 'en_US-amy-medium' },
    },
    {
      url: 'https://voice.example/v1/api/voice-settings',
      method: 'PUT',
      body: { selected_voice: 'en_US-amy-medium' },
    },
    {
      url: 'https://voice.example/v1/api/voice-settings',
      method: 'PUT',
      body: { speech_pace: 1.25 },
    },
    {
      url: 'https://voice.example/v1/api/voice-settings',
      method: 'PUT',
      body: {
        voice_tuning: {
          length_scale: 0.8,
          sentence_silence_seconds: 0.15,
          structure_silence_seconds: 0.3,
        },
      },
    },
    {
      url: 'https://voice.example/v1/api/voice-settings',
      method: 'PUT',
      body: {
        voice_display_name: {
          id: 'en_US-amy-medium',
          display_name: 'Work narrator',
        },
      },
    },
    {
      url: 'https://voice.example/v1/api/voice-settings',
      method: 'PUT',
      body: {
        stt_settings: {
          model: 'base.en',
          decoder_preset: 'careful',
          threads: 2,
          initial_prompt: 'CLIde',
          capture: {
            echo_cancellation: false,
            noise_suppression: true,
            auto_gain_control: false,
          },
        },
      },
    },
    {
      url: 'https://voice.example/v1/api/voice-labels',
      method: 'PUT',
      body: { key: 'en_US-amy-medium', favorite: true },
    },
  ]);
});

test('transcribes with injected fetch and request-level credential/model overrides', async () => {
  let requestedUrl = '';
  let requestedOptions: RequestInit | undefined;
  const service = createVoiceService({
    defaults,
    timeoutMs: 1_000,
    fetchBackend: async (url, options) => {
      requestedUrl = url;
      requestedOptions = options;
      return new Response(JSON.stringify({ text: 'hello' }), { status: 200 });
    },
  });

  const result = await service.transcribe({
    audio: {
      bytes: Buffer.from('audio'),
      mimeType: 'audio/webm',
      fileName: 'recording.webm',
    },
    overrides: { apiKey: 'request-key', sttModel: 'custom-whisper' },
  });

  assert.deepEqual(result, { ok: true, value: { text: 'hello' } });
  assert.equal(requestedUrl, 'https://voice.example/v1/audio/transcriptions');
  assert.equal((requestedOptions?.headers as Record<string, string>).Authorization, 'Bearer request-key');
  assert.equal((requestedOptions?.body as FormData).get('model'), 'custom-whisper');
});

test('forwards the explicit TTS format and maps backend authentication failures', async () => {
  let requestBody = '';
  let requestHeaders: RequestInit['headers'];
  const service = createVoiceService({
    defaults,
    timeoutMs: 1_000,
    fetchBackend: async (_url, options) => {
      requestBody = String(options.body);
      requestHeaders = options.headers;
      return new Response('unauthorized', { status: 401 });
    },
  });

  const result = await service.synthesizeSpeech({
    jobId: 'speech-job-1',
    text: 'Read this',
    overrides: { ttsFormat: 'wav' },
  });

  assert.deepEqual(JSON.parse(requestBody), {
    model: 'tts-1',
    voice: 'alloy',
    input: 'Read this',
    response_format: 'wav',
  });
  assert.equal((requestHeaders as Record<string, string>)['X-Voice-Job-ID'], 'speech-job-1');
  assert.deepEqual(result, {
    ok: false,
    status: 502,
    error: 'Voice backend rejected the request (check the API key).',
  });
});

test('blocks link-local metadata destinations before calling the fetch adapter', async () => {
  let fetchCalls = 0;
  const service = createVoiceService({
    defaults: { ...defaults, baseUrl: 'http://169.254.169.254/latest' },
    timeoutMs: 1_000,
    fetchBackend: async () => {
      fetchCalls += 1;
      return new Response();
    },
  });

  const result = await service.synthesizeSpeech({
    jobId: 'speech-job-2',
    text: 'hello',
    overrides: {},
  });

  assert.deepEqual(result, { ok: false, status: 400, error: 'Invalid voice backend URL.' });
  assert.equal(fetchCalls, 0);
});

test('extracts a readable backend error instead of forwarding raw JSON', async () => {
  const service = createVoiceService({
    defaults,
    timeoutMs: 1_000,
    fetchBackend: async () => new Response(
      JSON.stringify({ error: 'Another local voice job is running; try again shortly' }),
      { status: 429 },
    ),
  });

  const result = await service.synthesizeSpeech({
    jobId: 'speech-job-3',
    text: 'hello',
    overrides: {},
  });

  assert.deepEqual(result, {
    ok: false,
    status: 429,
    error: 'Another local voice job is running; try again shortly',
  });
});

test('cancels the matching backend speech job', async () => {
  let requestedUrl = '';
  let requestBody = '';
  const service = createVoiceService({
    defaults,
    timeoutMs: 1_000,
    fetchBackend: async (url, options) => {
      requestedUrl = url;
      requestBody = String(options.body);
      return new Response(JSON.stringify({ cancelled: true, released: true }), { status: 200 });
    },
  });

  const result = await service.cancelSpeech({ jobId: 'speech-job-4', overrides: {} });

  assert.equal(requestedUrl, 'https://voice.example/v1/audio/speech/cancel');
  assert.deepEqual(JSON.parse(requestBody), { job_id: 'speech-job-4' });
  assert.deepEqual(result, { ok: true, value: { cancelled: true } });
});

test('settings routes reject unsafe IDs before forwarding valid runtime changes', async () => {
  const backendBodies: unknown[] = [];
  const service = createVoiceService({
    defaults,
    timeoutMs: 1_000,
    fetchBackend: async (url, options) => {
      backendBodies.push(options.body ? JSON.parse(String(options.body)) : null);
      return url.endsWith('/api/voice-labels')
        ? new Response(JSON.stringify({ key: 'en_US-amy-medium', entry: {} }))
        : new Response(JSON.stringify({ capabilities: {}, tts: {}, stt: {} }));
    },
  });
  const application = express();
  application.use(express.json());
  application.use('/api/voice', createVoiceRouter({
    voiceService: service,
    parseAudioUpload: (_request, _response, next) => next(),
  }));
  const server = application.listen(0);
  await once(server, 'listening');
  const port = (server.address() as AddressInfo).port;

  try {
    const invalid = await fetch(`http://127.0.0.1:${port}/api/voice/settings`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ selectedVoice: '../../etc/passwd' }),
    });
    const invalidPace = await fetch(`http://127.0.0.1:${port}/api/voice/settings`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ speechPace: 2 }),
    });
    const invalidDefault = await fetch(`http://127.0.0.1:${port}/api/voice/settings`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ defaultVoice: '../../etc/passwd' }),
    });
    const invalidDisplayName = await fetch(`http://127.0.0.1:${port}/api/voice/settings`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        voiceDisplayName: { id: 'en_US-amy-medium', displayName: 'x'.repeat(81) },
      }),
    });
    const validDefault = await fetch(`http://127.0.0.1:${port}/api/voice/settings`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ defaultVoice: 'en_US-amy-medium' }),
    });
    const validPace = await fetch(`http://127.0.0.1:${port}/api/voice/settings`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ speechPace: 1.25 }),
    });
    const validDisplayName = await fetch(`http://127.0.0.1:${port}/api/voice/settings`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        voiceDisplayName: { id: 'en_US-amy-medium', displayName: 'Work narrator' },
      }),
    });
    const valid = await fetch(`http://127.0.0.1:${port}/api/voice/favorites`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 'en_US-amy-medium', favorite: true }),
    });

    assert.equal(invalid.status, 400);
    assert.equal(invalidPace.status, 400);
    assert.equal(invalidDefault.status, 400);
    assert.equal(invalidDisplayName.status, 400);
    assert.equal(validDefault.status, 200);
    assert.equal(validPace.status, 200);
    assert.equal(validDisplayName.status, 200);
    assert.equal(valid.status, 200);
    assert.deepEqual(backendBodies, [
      { default_voice: 'en_US-amy-medium' },
      { speech_pace: 1.25 },
      {
        voice_display_name: {
          id: 'en_US-amy-medium',
          display_name: 'Work narrator',
        },
      },
      { key: 'en_US-amy-medium', favorite: true },
    ]);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }
});
