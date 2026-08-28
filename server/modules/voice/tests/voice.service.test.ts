import assert from 'node:assert/strict';
import test from 'node:test';

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
  });
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
