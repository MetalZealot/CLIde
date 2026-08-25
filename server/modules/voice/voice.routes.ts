import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';

import express from 'express';

import type { VoiceRequestOverrides, VoiceService, VoiceServiceResult } from '@/shared/types.js';
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

  router.get('/health', (_request, response) => {
    response.json(dependencies.voiceService.getHealth());
  });

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
