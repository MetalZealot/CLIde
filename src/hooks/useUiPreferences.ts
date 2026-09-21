import { useEffect, useReducer, useRef } from 'react';

export const COPY_MESSAGE_FORMATS = ['markdown', 'text'] as const;
export type CopyMessageFormat = (typeof COPY_MESSAGE_FORMATS)[number];

type UiPreferences = {
  showRawParameters: boolean;
  showThinking: boolean;
  sendByCtrlEnter: boolean;
  enterToSend: boolean;
  sidebarVisible: boolean;
  ttsEnabled: boolean;
  sttEnabled: boolean;
  copyMessageFormat: CopyMessageFormat;
};

type UiPreferenceKey = keyof UiPreferences;

type SetPreferenceAction = {
  type: 'set';
  key: UiPreferenceKey;
  value: unknown;
};

type SetManyPreferencesAction = {
  type: 'set_many';
  value?: Partial<Record<UiPreferenceKey, unknown>>;
};

type ResetPreferencesAction = {
  type: 'reset';
  value?: Partial<UiPreferences>;
};

type UiPreferencesAction =
  | SetPreferenceAction
  | SetManyPreferencesAction
  | ResetPreferencesAction;

const DEFAULTS: UiPreferences = {
  showRawParameters: false,
  showThinking: true,
  sendByCtrlEnter: false,
  enterToSend: false,
  sidebarVisible: true,
  ttsEnabled: false,
  sttEnabled: false,
  copyMessageFormat: 'markdown',
};

const PREFERENCE_KEYS = Object.keys(DEFAULTS) as UiPreferenceKey[];
/** The pre-split single switch seeds both halves when neither split key is stored. */
const LEGACY_VOICE_KEY = 'voiceEnabled';
const VOICE_KEYS = new Set<UiPreferenceKey>(['ttsEnabled', 'sttEnabled']);
const VALID_KEYS = new Set<UiPreferenceKey>(PREFERENCE_KEYS); // prevents unknown keys from being written
const SYNC_EVENT = 'ui-preferences:sync';

type SyncEventDetail = {
  storageKey: string;
  sourceId: string;
  value: Partial<Record<UiPreferenceKey, unknown>>;
};

const parseBoolean = (value: unknown, fallback: boolean): boolean => {
  if (typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'string') {
    if (value === 'true') return true;
    if (value === 'false') return false;
  }

  return fallback;
};

const parseCopyMessageFormat = (value: unknown, fallback: CopyMessageFormat): CopyMessageFormat => (
  COPY_MESSAGE_FORMATS.includes(value as CopyMessageFormat) ? value as CopyMessageFormat : fallback
);

const parsePreference = <K extends UiPreferenceKey>(
  key: K,
  value: unknown,
  fallback: UiPreferences[K],
): UiPreferences[K] => (
  key === 'copyMessageFormat'
    ? parseCopyMessageFormat(value, fallback as CopyMessageFormat) as UiPreferences[K]
    : parseBoolean(value, fallback as boolean) as UiPreferences[K]
);

// Generic in the key so each preference keeps its own value type through the write.
const assignPreference = <K extends UiPreferenceKey>(
  target: UiPreferences,
  key: K,
  value: unknown,
  fallback: UiPreferences[K],
): void => {
  target[key] = parsePreference(key, value, fallback);
};

// Supports values written by both JSON.stringify and plain strings.
const readLegacyValue = (key: string): unknown => {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return undefined;
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
};

const readLegacyPreference = (key: string, fallback: boolean): boolean => (
  parseBoolean(readLegacyValue(key), fallback)
);

const readInitialPreferences = (storageKey: string): UiPreferences => {
  if (typeof window === 'undefined') {
    return DEFAULTS;
  }

  try {
    const raw = localStorage.getItem(storageKey);

    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        const parsedRecord = parsed as Record<string, unknown>;

        return PREFERENCE_KEYS.reduce((acc, key) => {
          const fallback = VOICE_KEYS.has(key) && !(key in parsedRecord)
            ? parseBoolean(parsedRecord[LEGACY_VOICE_KEY], DEFAULTS[key] as boolean)
            : DEFAULTS[key];
          assignPreference(acc, key, parsedRecord[key], fallback);
          return acc;
        }, { ...DEFAULTS });
      }
    }
  } catch {
    // Fall back to legacy keys when unified key is missing or invalid.
  }

  return PREFERENCE_KEYS.reduce((acc, key) => {
    const fallback = VOICE_KEYS.has(key)
      ? readLegacyPreference(LEGACY_VOICE_KEY, DEFAULTS[key] as boolean)
      : DEFAULTS[key];
    assignPreference(acc, key, readLegacyValue(key), fallback);
    return acc;
  }, { ...DEFAULTS });
};

/** Same migrated view of the stored prefs, for readers outside React state. */
export const readUiPreferences = (storageKey = 'uiPreferences'): UiPreferences =>
  readInitialPreferences(storageKey);

function reducer(state: UiPreferences, action: UiPreferencesAction): UiPreferences {
  switch (action.type) {
    case 'set': {
      const { key, value } = action;
      if (!VALID_KEYS.has(key)) {
        return state;
      }

      const nextValue = parsePreference(key, value, state[key]);
      if (state[key] === nextValue) {
        return state;
      }

      return { ...state, [key]: nextValue };
    }
    case 'set_many': {
      const updates = action.value || {};
      let changed = false;
      const nextState = { ...state };

      for (const key of PREFERENCE_KEYS) {
        if (!(key in updates)) continue;

        const value = updates[key];
        const nextValue = parsePreference(key, value, state[key]);
        if (nextState[key] !== nextValue) {
          assignPreference(nextState, key, value, state[key]);
          changed = true;
        }
      }

      return changed ? nextState : state;
    }
    case 'reset':
      return { ...DEFAULTS, ...(action.value || {}) };
    default:
      return state;
  }
}

export function useUiPreferences(storageKey = 'uiPreferences') {
  const instanceIdRef = useRef(`ui-preferences-${Math.random().toString(36).slice(2)}`);
  const [state, dispatch] = useReducer(
    reducer,
    storageKey,
    readInitialPreferences
  );

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    localStorage.setItem(storageKey, JSON.stringify(state));

    window.dispatchEvent(
      new CustomEvent<SyncEventDetail>(SYNC_EVENT, {
        detail: {
          storageKey,
          sourceId: instanceIdRef.current,
          value: state,
        },
      })
    );
  }, [state, storageKey]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const applyExternalUpdate = (value: unknown) => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return;
      }
      dispatch({ type: 'set_many', value: value as Partial<Record<UiPreferenceKey, unknown>> });
    };

    const handleStorageChange = (event: StorageEvent) => {
      if (event.key !== storageKey || event.newValue === null) {
        return;
      }

      try {
        const parsed = JSON.parse(event.newValue);
        applyExternalUpdate(parsed);
      } catch {
        // Ignore malformed storage updates.
      }
    };

    const handleSyncEvent = (event: Event) => {
      const syncEvent = event as CustomEvent<SyncEventDetail>;
      const detail = syncEvent.detail;
      if (!detail || detail.storageKey !== storageKey || detail.sourceId === instanceIdRef.current) {
        return;
      }

      applyExternalUpdate(detail.value);
    };

    window.addEventListener('storage', handleStorageChange);
    window.addEventListener(SYNC_EVENT, handleSyncEvent as EventListener);

    return () => {
      window.removeEventListener('storage', handleStorageChange);
      window.removeEventListener(SYNC_EVENT, handleSyncEvent as EventListener);
    };
  }, [storageKey]);

  const setPreference = (key: UiPreferenceKey, value: unknown) => {
    dispatch({ type: 'set', key, value });
  };

  const setPreferences = (value: Partial<Record<UiPreferenceKey, unknown>>) => {
    dispatch({ type: 'set_many', value });
  };

  const resetPreferences = (value?: Partial<UiPreferences>) => {
    dispatch({ type: 'reset', value });
  };

  return {
    preferences: state,
    setPreference,
    setPreferences,
    resetPreferences,
    dispatch,
  };
}
