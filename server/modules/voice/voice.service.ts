import type {
  VoiceAudioUpload,
  VoiceCatalogOption,
  VoiceDictationCaptureSettings,
  VoiceFavoriteOption,
  VoiceFavoriteUpdate,
  VoiceHealthPayload,
  VoiceInstalledModel,
  VoiceRequestOverrides,
  VoiceRuntimeSettingsPayload,
  VoiceRuntimeSettingsUpdate,
  VoiceService,
  VoiceServiceResult,
  VoiceSpeechPayload,
  VoiceSttSettings,
} from '@/shared/types.js';

const DEFAULT_DICTATION_CAPTURE: VoiceDictationCaptureSettings = {
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: false,
};

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
const SAFE_VOICE_ID_PATTERN = /^[A-Za-z0-9_.-]{1,80}(?:#\d{1,4})?$/;

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

function parseDictationCapture(payload: Record<string, unknown>): VoiceDictationCaptureSettings {
  const sttSettings = payload.stt_settings;
  if (!sttSettings || typeof sttSettings !== 'object' || Array.isArray(sttSettings)) {
    return { ...DEFAULT_DICTATION_CAPTURE };
  }
  const capture = (sttSettings as Record<string, unknown>).capture;
  if (!capture || typeof capture !== 'object' || Array.isArray(capture)) {
    return { ...DEFAULT_DICTATION_CAPTURE };
  }
  const candidate = capture as Record<string, unknown>;
  return {
    echoCancellation: typeof candidate.echo_cancellation === 'boolean'
      ? candidate.echo_cancellation
      : DEFAULT_DICTATION_CAPTURE.echoCancellation,
    noiseSuppression: typeof candidate.noise_suppression === 'boolean'
      ? candidate.noise_suppression
      : DEFAULT_DICTATION_CAPTURE.noiseSuppression,
    autoGainControl: typeof candidate.auto_gain_control === 'boolean'
      ? candidate.auto_gain_control
      : DEFAULT_DICTATION_CAPTURE.autoGainControl,
  };
}

function parseCaptureValue(value: unknown): VoiceDictationCaptureSettings {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { ...DEFAULT_DICTATION_CAPTURE };
  }
  const candidate = value as Record<string, unknown>;
  return {
    echoCancellation: typeof candidate.echo_cancellation === 'boolean'
      ? candidate.echo_cancellation
      : DEFAULT_DICTATION_CAPTURE.echoCancellation,
    noiseSuppression: typeof candidate.noise_suppression === 'boolean'
      ? candidate.noise_suppression
      : DEFAULT_DICTATION_CAPTURE.noiseSuppression,
    autoGainControl: typeof candidate.auto_gain_control === 'boolean'
      ? candidate.auto_gain_control
      : DEFAULT_DICTATION_CAPTURE.autoGainControl,
  };
}

function parseInstalledModel(value: unknown): VoiceInstalledModel | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.id !== 'string'
    || typeof candidate.num_speakers !== 'number'
    || candidate.num_speakers < 1) {
    return null;
  }
  const numberValue = (key: string, fallback: number) => (
    typeof candidate[key] === 'number' ? candidate[key] : fallback
  );
  const stringValue = (key: string) => (
    typeof candidate[key] === 'string' ? candidate[key] : ''
  );
  return {
    id: candidate.id,
    numSpeakers: Math.floor(candidate.num_speakers),
    speakers: Array.isArray(candidate.speakers)
      ? candidate.speakers.filter((speaker): speaker is string => typeof speaker === 'string')
      : [],
    language: stringValue('language'),
    region: stringValue('region'),
    quality: stringValue('quality'),
    dataset: stringValue('dataset'),
    lengthScale: numberValue('length_scale', 1),
    noiseScale: numberValue('noise_scale', 0.667),
    noiseWScale: numberValue('noise_w_scale', 0.8),
    normalizeAudio: candidate.normalize_audio !== false,
    volume: numberValue('volume', 1),
    sentenceSilenceSeconds: numberValue('sentence_silence_seconds', 0),
    structureSilenceSeconds: numberValue('structure_silence_seconds', 0),
  };
}

function parseFavorite(value: unknown): VoiceFavoriteOption | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.id !== 'string'
    || typeof candidate.source_key !== 'string'
    || typeof candidate.model_id !== 'string'
    || typeof candidate.label !== 'string') {
    return null;
  }
  const gender = candidate.gender;
  return {
    id: candidate.id,
    sourceKey: candidate.source_key,
    modelId: candidate.model_id,
    speakerId: typeof candidate.speaker_id === 'number' ? candidate.speaker_id : null,
    speakerName: typeof candidate.speaker_name === 'string' ? candidate.speaker_name : null,
    label: candidate.label,
    gender: gender === 'male' || gender === 'female' || gender === 'neutral' ? gender : null,
    lengthScale: typeof candidate.length_scale === 'number' ? candidate.length_scale : null,
    notes: typeof candidate.notes === 'string' ? candidate.notes : '',
  };
}

function parseSttSettings(value: unknown): VoiceSttSettings {
  const candidate = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  return {
    model: typeof candidate.model === 'string' ? candidate.model : '',
    decoderPreset: candidate.decoder_preset === 'careful' ? 'careful' : 'standard',
    threads: typeof candidate.threads === 'number' ? candidate.threads : 4,
    initialPrompt: typeof candidate.initial_prompt === 'string' ? candidate.initial_prompt : '',
    capture: parseCaptureValue(candidate.capture),
  };
}

function unsupportedRuntimeSettings(): VoiceRuntimeSettingsPayload {
  return {
    capabilities: {
      installedVoices: false,
      favorites: false,
      voiceSelection: false,
      voiceTuning: false,
      voiceDisplayNames: false,
      sttSettings: false,
    },
    tts: {
      defaultVoice: null,
      selectedVoice: null,
      effectiveVoice: null,
      speechPace: 1,
      tuning: null,
      catalog: [],
      installedModels: [],
      favorites: [],
      displayNames: {},
    },
    stt: {
      models: [],
      settings: {
        model: '',
        decoderPreset: 'standard',
        threads: 4,
        initialPrompt: '',
        capture: { ...DEFAULT_DICTATION_CAPTURE },
      },
    },
  };
}

function parseRuntimeSettings(payload: unknown): VoiceRuntimeSettingsPayload {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return unsupportedRuntimeSettings();
  }
  const candidate = payload as Record<string, unknown>;
  const capabilities = candidate.capabilities && typeof candidate.capabilities === 'object'
    && !Array.isArray(candidate.capabilities)
    ? candidate.capabilities as Record<string, unknown>
    : {};
  const tts = candidate.tts && typeof candidate.tts === 'object' && !Array.isArray(candidate.tts)
    ? candidate.tts as Record<string, unknown>
    : {};
  const stt = candidate.stt && typeof candidate.stt === 'object' && !Array.isArray(candidate.stt)
    ? candidate.stt as Record<string, unknown>
    : {};
  const tuning = tts.tuning && typeof tts.tuning === 'object' && !Array.isArray(tts.tuning)
    ? tts.tuning as Record<string, unknown>
    : null;
  const stringOrNull = (value: unknown) => typeof value === 'string' ? value : null;
  return {
    capabilities: {
      installedVoices: capabilities.installed_voices === true,
      favorites: capabilities.favorites === true,
      voiceSelection: capabilities.voice_selection === true,
      voiceTuning: capabilities.voice_tuning === true,
      voiceDisplayNames: capabilities.voice_display_names === true,
      sttSettings: capabilities.stt_settings === true,
    },
    tts: {
      defaultVoice: stringOrNull(tts.default_voice),
      selectedVoice: stringOrNull(tts.selected_voice),
      effectiveVoice: stringOrNull(tts.effective_voice),
      speechPace: typeof tts.speech_pace === 'number'
        && tts.speech_pace >= 0.75 && tts.speech_pace <= 1.5
        ? tts.speech_pace
        : 1,
      tuning: tuning
        && typeof tuning.voice_id === 'string'
        && typeof tuning.length_scale === 'number'
        && typeof tuning.sentence_silence_seconds === 'number'
        && typeof tuning.structure_silence_seconds === 'number'
        ? {
          voiceId: tuning.voice_id,
          lengthScale: tuning.length_scale,
          sentenceSilenceSeconds: tuning.sentence_silence_seconds,
          structureSilenceSeconds: tuning.structure_silence_seconds,
        }
        : null,
      catalog: Array.isArray(tts.catalog)
        ? tts.catalog.map(parseCatalogOption).filter((voice): voice is VoiceCatalogOption => voice !== null)
        : [],
      installedModels: Array.isArray(tts.installed_models)
        ? tts.installed_models.map(parseInstalledModel)
          .filter((model): model is VoiceInstalledModel => model !== null)
        : [],
      favorites: Array.isArray(tts.favorites)
        ? tts.favorites.map(parseFavorite)
          .filter((favorite): favorite is VoiceFavoriteOption => favorite !== null)
        : [],
      displayNames: tts.display_names && typeof tts.display_names === 'object'
        && !Array.isArray(tts.display_names)
        ? Object.fromEntries(Object.entries(tts.display_names).flatMap(([id, name]) => (
          SAFE_VOICE_ID_PATTERN.test(id) && typeof name === 'string'
            && name.trim() && name.trim().length <= 80
            ? [[id, name.trim()]]
            : []
        )))
        : {},
    },
    stt: {
      models: Array.isArray(stt.models)
        ? stt.models.flatMap((model) => {
          if (!model || typeof model !== 'object' || Array.isArray(model)) return [];
          const item = model as Record<string, unknown>;
          return typeof item.id === 'string'
            ? [{ id: item.id, installed: item.installed === true }]
            : [];
        })
        : [],
      settings: parseSttSettings(stt.settings),
    },
  };
}

async function readRuntimeSettings(
  dependencies: VoiceServiceDependencies,
): Promise<VoiceServiceResult<VoiceRuntimeSettingsPayload>> {
  const config = resolveVoiceConfig(dependencies.defaults, {});
  if (!config.baseUrl) {
    return { ok: true, value: unsupportedRuntimeSettings() };
  }
  const configurationFailure = validateConfiguredBackend(config);
  if (configurationFailure) return configurationFailure;
  try {
    const response = await dependencies.fetchBackend(`${config.baseUrl}/api/voice-settings`, {
      method: 'GET',
      headers: authorizationHeader(config.apiKey),
    });
    if (response.status === 404) {
      return { ok: true, value: unsupportedRuntimeSettings() };
    }
    const responseText = await response.text();
    if (!response.ok) return backendFailure(response.status, responseText);
    return { ok: true, value: parseRuntimeSettings(JSON.parse(responseText)) };
  } catch (error) {
    return unreachableBackendFailure(error, dependencies.timeoutMs);
  }
}

async function writeRuntimeSettings(
  dependencies: VoiceServiceDependencies,
  input: VoiceRuntimeSettingsUpdate,
): Promise<VoiceServiceResult<VoiceRuntimeSettingsPayload>> {
  const config = resolveVoiceConfig(dependencies.defaults, {});
  const configurationFailure = validateConfiguredBackend(config);
  if (configurationFailure) return configurationFailure;
  try {
    const response = await dependencies.fetchBackend(`${config.baseUrl}/api/voice-settings`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        ...authorizationHeader(config.apiKey),
      },
      body: JSON.stringify({
        ...(input.defaultVoice !== undefined ? { default_voice: input.defaultVoice } : {}),
        ...(input.selectedVoice !== undefined ? { selected_voice: input.selectedVoice } : {}),
        ...(input.speechPace !== undefined ? { speech_pace: input.speechPace } : {}),
        ...(input.voiceTuning !== undefined ? {
          voice_tuning: input.voiceTuning === null ? null : {
            length_scale: input.voiceTuning.lengthScale,
            sentence_silence_seconds: input.voiceTuning.sentenceSilenceSeconds,
            structure_silence_seconds: input.voiceTuning.structureSilenceSeconds,
          },
        } : {}),
        ...(input.voiceDisplayName !== undefined ? {
          voice_display_name: {
            id: input.voiceDisplayName.id,
            display_name: input.voiceDisplayName.displayName,
          },
        } : {}),
        ...(input.sttSettings !== undefined ? {
          stt_settings: {
            model: input.sttSettings.model,
            decoder_preset: input.sttSettings.decoderPreset,
            threads: input.sttSettings.threads,
            initial_prompt: input.sttSettings.initialPrompt,
            capture: {
              echo_cancellation: input.sttSettings.capture.echoCancellation,
              noise_suppression: input.sttSettings.capture.noiseSuppression,
              auto_gain_control: input.sttSettings.capture.autoGainControl,
            },
          },
        } : {}),
      }),
    });
    const responseText = await response.text();
    if (!response.ok) return backendFailure(response.status, responseText);
    return { ok: true, value: parseRuntimeSettings(JSON.parse(responseText)) };
  } catch (error) {
    return unreachableBackendFailure(error, dependencies.timeoutMs);
  }
}

async function writeRuntimeFavorite(
  dependencies: VoiceServiceDependencies,
  input: VoiceFavoriteUpdate,
): Promise<VoiceServiceResult<{ id: string; favorite: boolean }>> {
  const config = resolveVoiceConfig(dependencies.defaults, {});
  const configurationFailure = validateConfiguredBackend(config);
  if (configurationFailure) return configurationFailure;
  try {
    const response = await dependencies.fetchBackend(`${config.baseUrl}/api/voice-labels`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        ...authorizationHeader(config.apiKey),
      },
      body: JSON.stringify({ key: input.id, favorite: input.favorite }),
    });
    const responseText = await response.text();
    if (!response.ok) return backendFailure(response.status, responseText);
    return { ok: true, value: input };
  } catch (error) {
    return unreachableBackendFailure(error, dependencies.timeoutMs);
  }
}

async function readBackendHealth(
  dependencies: VoiceServiceDependencies,
): Promise<VoiceHealthPayload> {
  if (!dependencies.defaults.baseUrl) {
    return {
      configured: false,
      defaultVoice: null,
      voices: [],
      dictationCapture: { ...DEFAULT_DICTATION_CAPTURE },
    };
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
      return {
        configured: true,
        defaultVoice: null,
        voices: [],
        dictationCapture: { ...DEFAULT_DICTATION_CAPTURE },
      };
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
      dictationCapture: parseDictationCapture(payload),
    };
  } catch {
    // A generic OpenAI-compatible backend need not implement CLIde's optional
    // catalog endpoint; configuration remains usable with free-text settings.
    return {
      configured: true,
      defaultVoice: null,
      voices: [],
      dictationCapture: { ...DEFAULT_DICTATION_CAPTURE },
    };
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
    getSettings: () => readRuntimeSettings(dependencies),
    updateSettings: (input) => writeRuntimeSettings(dependencies, input),
    updateFavorite: (input) => writeRuntimeFavorite(dependencies, input),

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
