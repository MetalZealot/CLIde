import { authenticatedFetch } from '../utils/api';
import { readVoiceConfig, voiceConfigHeaders } from '../hooks/useVoiceConfig';

function directUrl(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/$/, '')}${path}`;
}

export type VoiceCatalogOption = {
  id: string;
  label: string;
  gender: 'male' | 'female';
  tier: 'low' | 'medium' | 'medium-gb' | 'bonus';
  locale: string;
};

export type VoiceHealth = {
  configured: boolean;
  defaultVoice: string | null;
  voices: VoiceCatalogOption[];
  dictationCapture: VoiceDictationCaptureSettings;
};

export type VoiceDictationCaptureSettings = {
  echoCancellation: boolean;
  noiseSuppression: boolean;
  autoGainControl: boolean;
};

export type VoiceRuntimeSettings = {
  capabilities: {
    installedVoices: boolean;
    favorites: boolean;
    voiceSelection: boolean;
    voiceTuning: boolean;
    sttSettings: boolean;
  };
  tts: {
    defaultVoice: string | null;
    selectedVoice: string | null;
    effectiveVoice: string | null;
    speechPace: number;
    tuning: {
      voiceId: string;
      lengthScale: number;
      sentenceSilenceSeconds: number;
      structureSilenceSeconds: number;
    } | null;
    catalog: VoiceCatalogOption[];
    installedModels: Array<{
      id: string;
      numSpeakers: number;
      speakers: string[];
      language: string;
      region: string;
      quality: string;
      dataset: string;
      lengthScale: number;
      noiseScale: number;
      noiseWScale: number;
      normalizeAudio: boolean;
      volume: number;
      sentenceSilenceSeconds: number;
      structureSilenceSeconds: number;
    }>;
    favorites: Array<{
      id: string;
      sourceKey: string;
      modelId: string;
      speakerId: number | null;
      speakerName: string | null;
      label: string;
      gender: 'male' | 'female' | 'neutral' | null;
      lengthScale: number | null;
      notes: string;
    }>;
  };
  stt: {
    models: Array<{ id: string; installed: boolean }>;
    settings: {
      model: string;
      decoderPreset: 'standard' | 'careful';
      threads: number;
      initialPrompt: string;
      capture: VoiceDictationCaptureSettings;
    };
  };
};

const DEFAULT_DICTATION_CAPTURE: VoiceDictationCaptureSettings = {
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: false,
};

let voiceHealthRequest: Promise<VoiceHealth> | null = null;
const RUNTIME_VOICE_SIGNATURE_KEY = 'voiceRuntimeSelection';

function rememberRuntimeVoice(settings: VoiceRuntimeSettings): VoiceRuntimeSettings {
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(RUNTIME_VOICE_SIGNATURE_KEY, JSON.stringify({
      selectedVoice: settings.tts.selectedVoice,
      effectiveVoice: settings.tts.effectiveVoice,
      speechPace: settings.tts.speechPace,
      tuning: settings.tts.tuning,
    }));
  }
  return settings;
}

function parseVoiceRuntimeSettings(payload: unknown): VoiceRuntimeSettings {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('Voice settings response is invalid');
  }
  const candidate = payload as Partial<VoiceRuntimeSettings>;
  if (!candidate.tts || typeof candidate.tts !== 'object') {
    throw new Error('Voice settings response is invalid');
  }
  const speechPace = candidate.tts.speechPace;
  return {
    ...candidate,
    tts: {
      ...candidate.tts,
      // Missing pace in a mixed-version deployment is the neutral multiplier.
      speechPace: typeof speechPace === 'number' && Number.isFinite(speechPace)
        ? speechPace
        : 1,
    },
  } as VoiceRuntimeSettings;
}

async function readVoiceRuntimeSettings(response: Response): Promise<VoiceRuntimeSettings> {
  return rememberRuntimeVoice(parseVoiceRuntimeSettings(await response.json()));
}

function parseVoiceHealth(payload: unknown): VoiceHealth {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return {
      configured: false,
      defaultVoice: null,
      voices: [],
      dictationCapture: { ...DEFAULT_DICTATION_CAPTURE },
    };
  }
  const candidate = payload as Partial<VoiceHealth>;
  const capture = candidate.dictationCapture;
  return {
    configured: candidate.configured === true,
    defaultVoice: typeof candidate.defaultVoice === 'string' ? candidate.defaultVoice : null,
    // Older CLIde servers report only `configured`; keep their free-text field
    // usable while a freshly built client waits for the server to restart.
    voices: Array.isArray(candidate.voices) ? candidate.voices : [],
    dictationCapture: {
      echoCancellation: typeof capture?.echoCancellation === 'boolean'
        ? capture.echoCancellation
        : DEFAULT_DICTATION_CAPTURE.echoCancellation,
      noiseSuppression: typeof capture?.noiseSuppression === 'boolean'
        ? capture.noiseSuppression
        : DEFAULT_DICTATION_CAPTURE.noiseSuppression,
      autoGainControl: typeof capture?.autoGainControl === 'boolean'
        ? capture.autoGainControl
        : DEFAULT_DICTATION_CAPTURE.autoGainControl,
    },
  };
}

export function fetchVoiceHealth(): Promise<VoiceHealth> {
  if (voiceHealthRequest) return voiceHealthRequest;
  voiceHealthRequest = authenticatedFetch('/api/voice/health')
    .then(async (response) => {
      if (!response.ok) throw new Error(`Voice health check failed (${response.status})`);
      return parseVoiceHealth(await response.json());
    })
    .finally(() => {
      voiceHealthRequest = null;
    });
  return voiceHealthRequest;
}

export async function fetchDictationCaptureSettings(): Promise<VoiceDictationCaptureSettings> {
  if (readVoiceConfig().baseUrl.trim()) {
    return { ...DEFAULT_DICTATION_CAPTURE };
  }
  try {
    return (await fetchVoiceHealth()).dictationCapture;
  } catch {
    return { ...DEFAULT_DICTATION_CAPTURE };
  }
}

export async function fetchVoiceSettings(): Promise<VoiceRuntimeSettings> {
  const response = await authenticatedFetch('/api/voice/settings');
  if (!response.ok) throw new Error(`Voice settings failed (${response.status})`);
  return readVoiceRuntimeSettings(response);
}

export async function updateVoiceSelection(selectedVoice: string | null): Promise<VoiceRuntimeSettings> {
  const response = await authenticatedFetch('/api/voice/settings', {
    method: 'PUT',
    body: JSON.stringify({ selectedVoice }),
  });
  if (!response.ok) throw new Error(`Voice selection failed (${response.status})`);
  return readVoiceRuntimeSettings(response);
}

export async function updateVoiceDefault(defaultVoice: string): Promise<VoiceRuntimeSettings> {
  const response = await authenticatedFetch('/api/voice/settings', {
    method: 'PUT',
    body: JSON.stringify({ defaultVoice }),
  });
  if (!response.ok) throw new Error(`Default voice failed (${response.status})`);
  return readVoiceRuntimeSettings(response);
}

export async function updateSpeechPace(speechPace: number): Promise<VoiceRuntimeSettings> {
  const response = await authenticatedFetch('/api/voice/settings', {
    method: 'PUT',
    body: JSON.stringify({ speechPace }),
  });
  if (!response.ok) throw new Error(`Speech pace failed (${response.status})`);
  return readVoiceRuntimeSettings(response);
}

export async function updateVoiceTuning(voiceTuning: {
  lengthScale: number;
  sentenceSilenceSeconds: number;
  structureSilenceSeconds: number;
} | null): Promise<VoiceRuntimeSettings> {
  const response = await authenticatedFetch('/api/voice/settings', {
    method: 'PUT',
    body: JSON.stringify({ voiceTuning }),
  });
  if (!response.ok) throw new Error(`Voice tuning failed (${response.status})`);
  return readVoiceRuntimeSettings(response);
}

export async function updateVoiceSttSettings(
  sttSettings: VoiceRuntimeSettings['stt']['settings'],
): Promise<VoiceRuntimeSettings> {
  const response = await authenticatedFetch('/api/voice/settings', {
    method: 'PUT',
    body: JSON.stringify({ sttSettings }),
  });
  if (!response.ok) throw new Error(`Dictation settings failed (${response.status})`);
  return readVoiceRuntimeSettings(response);
}

export async function updateVoiceFavorite(id: string, favorite: boolean): Promise<void> {
  const response = await authenticatedFetch('/api/voice/favorites', {
    method: 'PUT',
    body: JSON.stringify({ id, favorite }),
  });
  if (!response.ok) throw new Error(`Voice favorite failed (${response.status})`);
}

export function voiceConfigSignature(): string {
  return JSON.stringify([
    readVoiceConfig(),
    typeof localStorage === 'undefined' ? null : localStorage.getItem(RUNTIME_VOICE_SIGNATURE_KEY),
  ]);
}

export function transcribeVoice(blob: Blob, filename: string): Promise<Response> {
  const config = readVoiceConfig();
  const body = new FormData();

  if (config.baseUrl.trim()) {
    body.append('file', blob, filename);
    body.append('model', config.sttModel || 'whisper-1');
    return fetch(directUrl(config.baseUrl.trim(), '/audio/transcriptions'), {
      method: 'POST',
      headers: config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {},
      body,
    });
  }

  body.append('audio', blob, filename);
  return authenticatedFetch('/api/voice/transcribe', {
    method: 'POST',
    headers: voiceConfigHeaders(),
    body,
  });
}

export function synthesizeVoice(
  text: string,
  signal: AbortSignal,
  jobId: string,
): Promise<Response> {
  const config = readVoiceConfig();

  if (config.baseUrl.trim()) {
    return fetch(directUrl(config.baseUrl.trim(), '/audio/speech'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Voice-Job-ID': jobId,
        ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}),
      },
      body: JSON.stringify({
        model: config.ttsModel || 'tts-1',
        voice: config.ttsVoice || 'alloy',
        input: text,
        ...(config.ttsFormat.trim() ? { response_format: config.ttsFormat.trim() } : {}),
      }),
      signal,
    });
  }

  return authenticatedFetch('/api/voice/tts', {
    method: 'POST',
    body: JSON.stringify({ text }),
    headers: {
      ...voiceConfigHeaders(),
      'X-Voice-Job-ID': jobId,
    },
    signal,
  });
}

export async function cancelVoiceSynthesis(jobId: string): Promise<void> {
  const config = readVoiceConfig();
  if (config.baseUrl.trim()) {
    return;
  }

  const response = await authenticatedFetch('/api/voice/tts/cancel', {
    method: 'POST',
    body: JSON.stringify({ jobId }),
    headers: voiceConfigHeaders(),
  });
  if (!response.ok) {
    throw new Error(`Voice cancellation failed (${response.status})`);
  }
}
