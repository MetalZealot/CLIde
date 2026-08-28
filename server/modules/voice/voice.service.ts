import type {
  VoiceAudioUpload,
  VoiceCatalogOption,
  VoiceHealthPayload,
  VoiceRequestOverrides,
  VoiceService,
  VoiceServiceResult,
  VoiceSpeechPayload,
} from '@/shared/types.js';

type VoiceServiceDependencies = {
  defaults: {
    baseUrl: string;
    apiKey: string;
    sttModel: string;
    ttsModel: string;
    ttsVoice: string;
  };
  timeoutMs: number;
  fetchBackend(url: string, options: RequestInit): Promise<Response>;
};

type ResolvedVoiceConfig = VoiceServiceDependencies['defaults'] & {
  ttsFormat: string;
};

function resolveVoiceConfig(
  defaults: VoiceServiceDependencies['defaults'],
  overrides: VoiceRequestOverrides,
): ResolvedVoiceConfig {
  return {
    baseUrl: defaults.baseUrl,
    apiKey: overrides.apiKey || defaults.apiKey,
    sttModel: overrides.sttModel || defaults.sttModel,
    ttsModel: overrides.ttsModel || defaults.ttsModel,
    ttsVoice: overrides.ttsVoice || defaults.ttsVoice,
    ttsFormat: overrides.ttsFormat?.trim() ?? '',
  };
}

function validateBackendBaseUrl(baseUrl: string): boolean {
  try {
    const parsedUrl = new URL(baseUrl);
    if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
      return false;
    }

    // Local and private backends are supported intentionally. Only link-local
    // metadata addresses remain blocked as a defense in depth measure.
    return parsedUrl.hostname !== '169.254.169.254'
      && !parsedUrl.hostname.startsWith('169.254.');
  } catch {
    return false;
  }
}

function authorizationHeader(apiKey: string): Record<string, string> {
  return apiKey ? { Authorization: `Bearer ${apiKey}` } : {};
}

function backendFailure(status: number, responseText?: string): VoiceServiceResult<never> {
  if (status === 401 || status === 403) {
    return {
      ok: false,
      status: 502,
      error: 'Voice backend rejected the request (check the API key).',
    };
  }

  let error = responseText || 'voice backend error';
  if (responseText) {
    try {
      const parsed = JSON.parse(responseText) as { error?: unknown };
      if (typeof parsed.error === 'string' && parsed.error.trim()) {
        error = parsed.error;
      }
    } catch {
      // Plain-text backend errors are already suitable for the client.
    }
  }

  return {
    ok: false,
    status,
    error,
  };
}

function unreachableBackendFailure(error: unknown, timeoutMs: number): VoiceServiceResult<never> {
  if (error instanceof Error && error.name === 'AbortError') {
    return {
      ok: false,
      status: 504,
      error: `Voice backend timed out after ${Math.round(timeoutMs / 1000)}s. Check your voice backend.`,
    };
  }

  const message = error instanceof Error ? error.message : String(error);
  return {
    ok: false,
    status: 502,
    error: `Voice backend unreachable: ${message}`,
  };
}

function validateConfiguredBackend(config: ResolvedVoiceConfig): VoiceServiceResult<never> | null {
  if (!config.baseUrl) {
    return { ok: false, status: 503, error: 'No voice backend configured' };
  }

  if (!validateBackendBaseUrl(config.baseUrl)) {
    return { ok: false, status: 400, error: 'Invalid voice backend URL.' };
  }

  return null;
}

function createTranscriptionFormData(audio: VoiceAudioUpload, sttModel: string): FormData {
  const formData = new FormData();
  formData.append('file', new Blob([audio.bytes], { type: audio.mimeType }), audio.fileName);
  formData.append('model', sttModel);
  return formData;
}

const VOICE_GENDERS = new Set<VoiceCatalogOption['gender']>(['male', 'female']);
const VOICE_TIERS = new Set<VoiceCatalogOption['tier']>(['low', 'medium', 'medium-gb', 'bonus']);

function parseCatalogOption(value: unknown): VoiceCatalogOption | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  const candidate = value as Record<string, unknown>;
  if (
    typeof candidate.id !== 'string'
    || typeof candidate.label !== 'string'
    || typeof candidate.gender !== 'string'
    || typeof candidate.tier !== 'string'
    || typeof candidate.locale !== 'string'
    || !VOICE_GENDERS.has(candidate.gender as VoiceCatalogOption['gender'])
    || !VOICE_TIERS.has(candidate.tier as VoiceCatalogOption['tier'])
  ) {
    return null;
  }
  return {
    id: candidate.id,
    label: candidate.label,
    gender: candidate.gender as VoiceCatalogOption['gender'],
    tier: candidate.tier as VoiceCatalogOption['tier'],
    locale: candidate.locale,
  };
}

async function readBackendHealth(
  dependencies: VoiceServiceDependencies,
): Promise<VoiceHealthPayload> {
  if (!dependencies.defaults.baseUrl) {
    return { configured: false, defaultVoice: null, voices: [] };
  }

  try {
    const response = await dependencies.fetchBackend(
      `${dependencies.defaults.baseUrl}/api/health`,
      {
        method: 'GET',
        headers: authorizationHeader(dependencies.defaults.apiKey),
      },
    );
    if (!response.ok) {
      return { configured: true, defaultVoice: null, voices: [] };
    }
    const payload = JSON.parse(await response.text()) as Record<string, unknown>;
    const voices = Array.isArray(payload.tts_voices)
      ? payload.tts_voices
        .map(parseCatalogOption)
        .filter((voice): voice is VoiceCatalogOption => voice !== null)
      : [];
    const requestedDefault = typeof payload.tts_default_voice === 'string'
      ? payload.tts_default_voice
      : null;
    return {
      configured: payload.configured !== false,
      defaultVoice: voices.some((voice) => voice.id === requestedDefault)
        ? requestedDefault
        : null,
      voices,
    };
  } catch {
    // A generic OpenAI-compatible backend need not implement CLIde's optional
    // catalog endpoint; configuration remains usable with free-text settings.
    return { configured: true, defaultVoice: null, voices: [] };
  }
}

/**
 * Creates the Voice application service used by the Voice composition root and
 * its unit tests. The outbound request function and server configuration are
 * required so the service never reads globals or creates production defaults.
 */
export function createVoiceService(dependencies: VoiceServiceDependencies): VoiceService {
  return {
    getHealth: () => readBackendHealth(dependencies),

    async transcribe(input) {
      const config = resolveVoiceConfig(dependencies.defaults, input.overrides);
      const configurationFailure = validateConfiguredBackend(config);
      if (configurationFailure) {
        return configurationFailure;
      }

      try {
        const response = await dependencies.fetchBackend(
          `${config.baseUrl}/audio/transcriptions`,
          {
            method: 'POST',
            headers: authorizationHeader(config.apiKey),
            body: createTranscriptionFormData(input.audio, config.sttModel),
          },
        );
        const responseText = await response.text();
        if (!response.ok) {
          return backendFailure(response.status, responseText);
        }

        try {
          const parsed = JSON.parse(responseText) as { text?: unknown };
          return {
            ok: true,
            value: { text: typeof parsed.text === 'string' ? parsed.text : '' },
          };
        } catch {
          return { ok: true, value: { text: responseText } };
        }
      } catch (error) {
        return unreachableBackendFailure(error, dependencies.timeoutMs);
      }
    },

    async synthesizeSpeech(input) {
      const config = resolveVoiceConfig(dependencies.defaults, input.overrides);
      const configurationFailure = validateConfiguredBackend(config);
      if (configurationFailure) {
        return configurationFailure;
      }

      try {
        const response = await dependencies.fetchBackend(`${config.baseUrl}/audio/speech`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Voice-Job-ID': input.jobId,
            ...authorizationHeader(config.apiKey),
          },
          body: JSON.stringify({
            model: config.ttsModel,
            voice: config.ttsVoice,
            input: input.text,
            ...(config.ttsFormat ? { response_format: config.ttsFormat } : {}),
          }),
        });

        if (!response.ok) {
          const responseText = await response.text().catch(() => 'tts failed');
          return backendFailure(response.status, responseText);
        }

        const value: VoiceSpeechPayload = {
          contentType: response.headers.get('content-type') || 'audio/mpeg',
          body: response.body,
        };
        return { ok: true, value };
      } catch (error) {
        return unreachableBackendFailure(error, dependencies.timeoutMs);
      }
    },

    async cancelSpeech(input) {
      const config = resolveVoiceConfig(dependencies.defaults, input.overrides);
      const configurationFailure = validateConfiguredBackend(config);
      if (configurationFailure) {
        return configurationFailure;
      }

      try {
        const response = await dependencies.fetchBackend(
          `${config.baseUrl}/audio/speech/cancel`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...authorizationHeader(config.apiKey),
            },
            body: JSON.stringify({ job_id: input.jobId }),
          },
        );
        const responseText = await response.text();
        if (!response.ok) {
          return backendFailure(response.status, responseText);
        }

        try {
          const parsed = JSON.parse(responseText) as { cancelled?: unknown };
          return { ok: true, value: { cancelled: parsed.cancelled === true } };
        } catch {
          return { ok: false, status: 502, error: 'Voice backend returned an invalid cancellation response.' };
        }
      } catch (error) {
        return unreachableBackendFailure(error, dependencies.timeoutMs);
      }
    },
  };
}
