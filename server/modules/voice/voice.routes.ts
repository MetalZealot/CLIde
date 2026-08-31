import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';

import express from 'express';

import type {
  VoiceRequestOverrides,
  VoiceService,
  VoiceServiceResult,
  VoiceSttSettings,
} from '@/shared/types.js';
import { asyncHandler } from '@/shared/utils.js';

type VoiceRouterDependencies = {
  voiceService: VoiceService;
  parseAudioUpload: express.RequestHandler;
};

function readHeaderValue(value: string | string[] | undefined): string | undefined {
  const normalizedValue = Array.isArray(value) ? value[0] : value;
  const trimmedValue = normalizedValue?.trim();
  return trimmedValue || undefined;
}

function parseVoiceOverrides(request: express.Request): VoiceRequestOverrides {
  return {
    apiKey: readHeaderValue(request.headers['x-voice-api-key']),
    sttModel: readHeaderValue(request.headers['x-voice-stt-model']),
    ttsModel: readHeaderValue(request.headers['x-voice-tts-model']),
    ttsVoice: readHeaderValue(request.headers['x-voice-tts-voice']),
    ttsFormat: readHeaderValue(request.headers['x-voice-tts-format']),
  };
}

const VOICE_JOB_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const VOICE_SELECTION_ID_PATTERN = /^[A-Za-z0-9_.-]{1,80}(?:#\d{1,4})?$/;
const STT_MODEL_ID_PATTERN = /^[A-Za-z0-9_.-]{1,80}$/;

function isValidSttSettings(value: unknown): value is VoiceSttSettings {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const settings = value as Record<string, unknown>;
  const capture = settings.capture;
  if (!capture || typeof capture !== 'object' || Array.isArray(capture)) return false;
  const captureSettings = capture as Record<string, unknown>;
  return typeof settings.model === 'string' && STT_MODEL_ID_PATTERN.test(settings.model)
    && (settings.decoderPreset === 'standard' || settings.decoderPreset === 'careful')
    && typeof settings.threads === 'number' && Number.isInteger(settings.threads)
    && settings.threads >= 1 && settings.threads <= 4
    && typeof settings.initialPrompt === 'string' && settings.initialPrompt.length <= 400
    && typeof captureSettings.echoCancellation === 'boolean'
    && typeof captureSettings.noiseSuppression === 'boolean'
    && typeof captureSettings.autoGainControl === 'boolean';
}

function readVoiceJobId(request: express.Request): string | null {
  const suppliedId = readHeaderValue(request.headers['x-voice-job-id']);
  if (!suppliedId) {
    return randomUUID();
  }
  return VOICE_JOB_ID_PATTERN.test(suppliedId) ? suppliedId : null;
}

function sendFailure<TValue>(
  response: express.Response,
  result: VoiceServiceResult<TValue>,
): result is Extract<VoiceServiceResult<TValue>, { ok: false }> {
  if (result.ok) {
    return false;
  }

  response.status(result.status).json({ error: result.error });
  return true;
}

/**
 * Creates the transport-only router used by the Voice composition root. It is
 * exported for Voice route tests; other modules consume only the composed
 * router exposed from the Voice barrel.
 */
export function createVoiceRouter(dependencies: VoiceRouterDependencies): express.Router {
  const router = express.Router();

  router.get('/health', asyncHandler(async (_request, response) => {
    response.json(await dependencies.voiceService.getHealth());
  }));

  router.get('/settings', asyncHandler(async (_request, response) => {
    const result = await dependencies.voiceService.getSettings();
    if (!sendFailure(response, result)) response.json(result.value);
  }));

  router.put('/settings', asyncHandler(async (request, response) => {
    const defaultVoice = request.body?.defaultVoice;
    const selectedVoice = request.body?.selectedVoice;
    const speechPace = request.body?.speechPace;
    const voiceTuning = request.body?.voiceTuning;
    const voiceDisplayName = request.body?.voiceDisplayName;
    const sttSettings = request.body?.sttSettings;
    const keys = request.body && typeof request.body === 'object' && !Array.isArray(request.body)
      ? Object.keys(request.body)
      : [];
    if (keys.length === 0
      || keys.some((key) => ![
        'defaultVoice', 'selectedVoice', 'speechPace', 'voiceTuning', 'voiceDisplayName',
        'sttSettings',
      ].includes(key))) {
      response.status(400).json({
        error: 'Expected a supported voice setting',
      });
      return;
    }
    if (defaultVoice !== undefined
      && (typeof defaultVoice !== 'string' || !VOICE_SELECTION_ID_PATTERN.test(defaultVoice))) {
      response.status(400).json({ error: 'defaultVoice must be a safe voice ID' });
      return;
    }
    if (selectedVoice !== undefined && selectedVoice !== null
      && (typeof selectedVoice !== 'string' || !VOICE_SELECTION_ID_PATTERN.test(selectedVoice))) {
      response.status(400).json({ error: 'selectedVoice must be a safe voice ID or null' });
      return;
    }
    if (speechPace !== undefined && (
      typeof speechPace !== 'number' || !Number.isFinite(speechPace)
      || speechPace < 0.75 || speechPace > 1.5
    )) {
      response.status(400).json({ error: 'speechPace must be between 0.75 and 1.5' });
      return;
    }
    if (voiceTuning !== undefined && voiceTuning !== null) {
      const tuningKeys = typeof voiceTuning === 'object' && !Array.isArray(voiceTuning)
        ? Object.keys(voiceTuning)
        : [];
      const validNumber = (value: unknown, minimum: number, maximum: number) => (
        typeof value === 'number' && Number.isFinite(value) && value >= minimum && value <= maximum
      );
      if (tuningKeys.length !== 3
        || !['lengthScale', 'sentenceSilenceSeconds', 'structureSilenceSeconds']
          .every((key) => tuningKeys.includes(key))
        || !validNumber(voiceTuning.lengthScale, 0.35, 2.5)
        || !validNumber(voiceTuning.sentenceSilenceSeconds, 0, 1.5)
        || !validNumber(voiceTuning.structureSilenceSeconds, 0, 2)) {
        response.status(400).json({ error: 'voiceTuning contains invalid timing values' });
        return;
      }
    }
    if (voiceDisplayName !== undefined) {
      const displayNameKeys = typeof voiceDisplayName === 'object'
        && voiceDisplayName !== null && !Array.isArray(voiceDisplayName)
        ? Object.keys(voiceDisplayName)
        : [];
      const displayName = voiceDisplayName?.displayName;
      if (displayNameKeys.length !== 2
        || !displayNameKeys.includes('id')
        || !displayNameKeys.includes('displayName')
        || typeof voiceDisplayName?.id !== 'string'
        || !VOICE_SELECTION_ID_PATTERN.test(voiceDisplayName.id)
        || (displayName !== null && (typeof displayName !== 'string'
          || displayName.trim().length === 0 || displayName.trim().length > 80))) {
        response.status(400).json({
          error: 'voiceDisplayName requires a safe voice ID and a name up to 80 characters or null',
        });
        return;
      }
    }
    if (sttSettings !== undefined && !isValidSttSettings(sttSettings)) {
      response.status(400).json({ error: 'sttSettings contains invalid dictation values' });
      return;
    }
    const result = await dependencies.voiceService.updateSettings({
      defaultVoice,
      selectedVoice,
      speechPace,
      voiceTuning,
      voiceDisplayName,
      sttSettings,
    });
    if (!sendFailure(response, result)) response.json(result.value);
  }));

  router.put('/favorites', asyncHandler(async (request, response) => {
    const id = request.body?.id;
    const favorite = request.body?.favorite;
    if (typeof id !== 'string' || !VOICE_SELECTION_ID_PATTERN.test(id)
      || typeof favorite !== 'boolean') {
      response.status(400).json({ error: 'Expected a safe voice id and favorite boolean' });
      return;
    }
    const result = await dependencies.voiceService.updateFavorite({ id, favorite });
    if (!sendFailure(response, result)) response.json(result.value);
  }));

  router.post('/transcribe', (request, response, next) => {
    dependencies.parseAudioUpload(request, response, (uploadError?: unknown) => {
      if (uploadError) {
        const message = uploadError instanceof Error ? uploadError.message : String(uploadError);
        response.status(400).json({ error: message });
        return;
      }

      // Multer uses a callback API, so bridge its parsed request into the async
      // service call and forward unexpected rejections to Express middleware.
      void (async () => {
        if (!request.file) {
          response.status(400).json({ error: 'No audio uploaded' });
          return;
        }

        const result = await dependencies.voiceService.transcribe({
          audio: {
            bytes: request.file.buffer,
            mimeType: request.file.mimetype || 'audio/webm',
            fileName: request.file.originalname || 'recording.webm',
          },
          overrides: parseVoiceOverrides(request),
        });

        if (sendFailure(response, result)) {
          return;
        }

        response.json(result.value);
      })().catch(next);
    });
  });

  router.post('/tts', asyncHandler(async (request, response) => {
    const text = request.body?.text;
    if (typeof text !== 'string' || !text.trim()) {
      response.status(400).json({ error: 'text required' });
      return;
    }

    const jobId = readVoiceJobId(request);
    if (!jobId) {
      response.status(400).json({ error: 'Invalid voice job ID' });
      return;
    }
    const overrides = parseVoiceOverrides(request);
    let generationFinished = false;
    const cancelOnDisconnect = () => {
      if (generationFinished || response.writableEnded) {
        return;
      }
      void dependencies.voiceService.cancelSpeech({ jobId, overrides });
    };
    response.once('close', cancelOnDisconnect);

    const result = await dependencies.voiceService.synthesizeSpeech({
      jobId,
      text,
      overrides,
    });
    generationFinished = true;
    response.off('close', cancelOnDisconnect);
    if (response.destroyed) {
      return;
    }
    if (sendFailure(response, result)) {
      return;
    }

    response.setHeader('Content-Type', result.value.contentType);
    response.setHeader('Cache-Control', 'no-store');
    if (!result.value.body) {
      response.end();
      return;
    }

    Readable.fromWeb(result.value.body).on('error', (error) => response.destroy(error)).pipe(response);
  }));

  router.post('/tts/cancel', asyncHandler(async (request, response) => {
    const jobId = request.body?.jobId;
    if (typeof jobId !== 'string' || !VOICE_JOB_ID_PATTERN.test(jobId)) {
      response.status(400).json({ error: 'Invalid voice job ID' });
      return;
    }

    const result = await dependencies.voiceService.cancelSpeech({
      jobId,
      overrides: parseVoiceOverrides(request),
    });
    if (sendFailure(response, result)) {
      return;
    }
    response.json(result.value);
  }));

  return router;
}
