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
};

let voiceHealthRequest: Promise<VoiceHealth> | null = null;

export function fetchVoiceHealth(): Promise<VoiceHealth> {
  if (voiceHealthRequest) return voiceHealthRequest;
  voiceHealthRequest = authenticatedFetch('/api/voice/health')
    .then(async (response) => {
      if (!response.ok) throw new Error(`Voice health check failed (${response.status})`);
      return response.json() as Promise<VoiceHealth>;
    })
    .finally(() => {
      voiceHealthRequest = null;
    });
  return voiceHealthRequest;
}

export function voiceConfigSignature(): string {
  return JSON.stringify(readVoiceConfig());
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
