import { useEffect, useState } from 'react';

import { readUiPreferences } from '../../../hooks/useUiPreferences';
import { readVoiceConfig, VOICE_CONFIG_SYNC_EVENT } from '../../../hooks/useVoiceConfig';
import { fetchVoiceHealth } from '../../../lib/voiceApi';

// Read aloud and dictation are gated independently (`ttsEnabled` / `sttEnabled`,
// toggled in the Settings modal) but share one backend, so availability is the
// same question for both.
const SYNC_EVENT = 'ui-preferences:sync';

function useVoiceFeatureAvailable(key: 'ttsEnabled' | 'sttEnabled'): boolean {
  const [enabled, setEnabled] = useState<boolean>(() =>
    typeof window === 'undefined' ? false : readUiPreferences()[key],
  );
  const [available, setAvailable] = useState(false);

  useEffect(() => {
    const update = () => setEnabled(readUiPreferences()[key]);
    update();
    window.addEventListener('storage', update);
    window.addEventListener(SYNC_EVENT, update as EventListener);
    return () => {
      window.removeEventListener('storage', update);
      window.removeEventListener(SYNC_EVENT, update as EventListener);
    };
  }, [key]);

  useEffect(() => {
    let active = true;
    let requestId = 0;

    const check = async () => {
      // Claimed before the early exits too: a configured baseUrl answers without
      // a request, and an in-flight health check must not overwrite that answer.
      const id = ++requestId;
      if (!enabled) {
        setAvailable(false);
        return;
      }
      if (readVoiceConfig().baseUrl.trim()) {
        setAvailable(true);
        return;
      }
      try {
        const result = await fetchVoiceHealth();
        if (active && id === requestId) setAvailable(result.configured);
      } catch {
        if (active && id === requestId) setAvailable(false);
      }
    };

    void check();
    window.addEventListener(VOICE_CONFIG_SYNC_EVENT, check);
    return () => {
      active = false;
      window.removeEventListener(VOICE_CONFIG_SYNC_EVENT, check);
    };
  }, [enabled]);

  return enabled && available;
}

/** Read-aloud button on agent messages. */
export function useTtsAvailable(): boolean {
  return useVoiceFeatureAvailable('ttsEnabled');
}

/** Mic button in the composer. */
export function useSttAvailable(): boolean {
  return useVoiceFeatureAvailable('sttEnabled');
}
