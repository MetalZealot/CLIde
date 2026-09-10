import { useCallback, useEffect, useRef, useState } from 'react';

export const THINKING_MESSAGES_STORAGE_KEY = 'thinkingMessages';
export const THINKING_MESSAGE_CYCLE_STORAGE_KEY = 'thinkingMessageCycle';
export const THINKING_MESSAGE_ORDER_STORAGE_KEY = 'thinkingMessageOrder';
export const MAX_THINKING_MESSAGES = 24;
export const MAX_THINKING_MESSAGE_LENGTH = 80;
export const THINKING_MESSAGE_CYCLE_MODES = ['never', 'turn', '2', '3', '4', '5'] as const;
export type ThinkingMessageCycleMode = (typeof THINKING_MESSAGE_CYCLE_MODES)[number];
export const DEFAULT_THINKING_MESSAGE_CYCLE_MODE: ThinkingMessageCycleMode = '4';
export const THINKING_MESSAGE_ORDERS = ['listed', 'random'] as const;
export type ThinkingMessageOrder = (typeof THINKING_MESSAGE_ORDERS)[number];
export const DEFAULT_THINKING_MESSAGE_ORDER: ThinkingMessageOrder = 'listed';
export const THINKING_MESSAGE_TRANSLATION_KEYS = [
  'claudeStatus.actions.thinking',
  'claudeStatus.actions.processing',
  'claudeStatus.actions.analyzing',
  'claudeStatus.actions.working',
  'claudeStatus.actions.computing',
  'claudeStatus.actions.reasoning',
];
export const DEFAULT_THINKING_MESSAGES = [
  'Thinking',
  'Processing',
  'Analyzing',
  'Working',
  'Computing',
  'Reasoning',
];

export const shuffleThinkingMessageIndices = (
  count: number,
  previousIndex: number | null = null,
  random: () => number = Math.random,
): number[] => {
  const indices = Array.from({ length: count }, (_, index) => index);
  for (let index = indices.length - 1; index > 0; index -= 1) {
    const destination = Math.floor(random() * (index + 1));
    [indices[index], indices[destination]] = [indices[destination], indices[index]];
  }

  if (indices.length > 1 && indices[0] === previousIndex) {
    const replacementIndex = indices.findIndex((index) => index !== previousIndex);
    [indices[0], indices[replacementIndex]] = [indices[replacementIndex], indices[0]];
  }

  return indices;
};

const SYNC_EVENT = 'thinking-messages:sync';

type SyncEventDetail =
  | { sourceId: string; kind: 'messages'; value: string[] | null }
  | { sourceId: string; kind: 'cycle'; value: ThinkingMessageCycleMode }
  | { sourceId: string; kind: 'order'; value: ThinkingMessageOrder };

const messagesMatch = (left: string[] | null, right: string[] | null): boolean => (
  left === right
  || (left !== null
    && right !== null
    && left.length === right.length
    && left.every((message, index) => message === right[index]))
);

export const parseThinkingMessages = (value: unknown): string[] | null => {
  if (!Array.isArray(value)) return null;

  return value
    .filter((message): message is string => typeof message === 'string')
    .slice(0, MAX_THINKING_MESSAGES)
    .map((message) => message.slice(0, MAX_THINKING_MESSAGE_LENGTH));
};

export const parseThinkingMessageCycleMode = (value: unknown): ThinkingMessageCycleMode | null => (
  typeof value === 'string'
  && THINKING_MESSAGE_CYCLE_MODES.some((mode) => mode === value)
    ? value as ThinkingMessageCycleMode
    : null
);

export const parseThinkingMessageOrder = (value: unknown): ThinkingMessageOrder | null => (
  typeof value === 'string'
  && THINKING_MESSAGE_ORDERS.some((order) => order === value)
    ? value as ThinkingMessageOrder
    : null
);

const readInitialMessages = (): string[] | null => {
  if (typeof window === 'undefined') return null;

  try {
    const stored = localStorage.getItem(THINKING_MESSAGES_STORAGE_KEY);
    return stored === null ? null : parseThinkingMessages(JSON.parse(stored));
  } catch {
    return null;
  }
};

const readInitialCycleMode = (): ThinkingMessageCycleMode => {
  if (typeof window === 'undefined') return DEFAULT_THINKING_MESSAGE_CYCLE_MODE;

  try {
    return parseThinkingMessageCycleMode(
      localStorage.getItem(THINKING_MESSAGE_CYCLE_STORAGE_KEY),
    ) ?? DEFAULT_THINKING_MESSAGE_CYCLE_MODE;
  } catch {
    return DEFAULT_THINKING_MESSAGE_CYCLE_MODE;
  }
};

const readInitialMessageOrder = (): ThinkingMessageOrder => {
  if (typeof window === 'undefined') return DEFAULT_THINKING_MESSAGE_ORDER;

  try {
    return parseThinkingMessageOrder(
      localStorage.getItem(THINKING_MESSAGE_ORDER_STORAGE_KEY),
    ) ?? DEFAULT_THINKING_MESSAGE_ORDER;
  } catch {
    return DEFAULT_THINKING_MESSAGE_ORDER;
  }
};

export function useThinkingMessages() {
  const sourceIdRef = useRef(`thinking-messages-${Math.random().toString(36).slice(2)}`);
  const [customMessages, setStoredMessages] = useState<string[] | null>(readInitialMessages);
  const [cycleMode, setStoredCycleMode] = useState<ThinkingMessageCycleMode>(readInitialCycleMode);
  const [messageOrder, setStoredMessageOrder] = useState<ThinkingMessageOrder>(readInitialMessageOrder);

  useEffect(() => {
    try {
      if (customMessages === null) {
        localStorage.removeItem(THINKING_MESSAGES_STORAGE_KEY);
      } else {
        localStorage.setItem(THINKING_MESSAGES_STORAGE_KEY, JSON.stringify(customMessages));
      }
    } catch {
      // Private mode or full storage still permits an in-memory preference.
    }

    window.dispatchEvent(new CustomEvent<SyncEventDetail>(SYNC_EVENT, {
      detail: { sourceId: sourceIdRef.current, kind: 'messages', value: customMessages },
    }));
  }, [customMessages]);

  useEffect(() => {
    try {
      if (cycleMode === DEFAULT_THINKING_MESSAGE_CYCLE_MODE) {
        localStorage.removeItem(THINKING_MESSAGE_CYCLE_STORAGE_KEY);
      } else {
        localStorage.setItem(THINKING_MESSAGE_CYCLE_STORAGE_KEY, cycleMode);
      }
    } catch {
      // Private mode or full storage still permits an in-memory preference.
    }

    window.dispatchEvent(new CustomEvent<SyncEventDetail>(SYNC_EVENT, {
      detail: { sourceId: sourceIdRef.current, kind: 'cycle', value: cycleMode },
    }));
  }, [cycleMode]);

  useEffect(() => {
    try {
      if (messageOrder === DEFAULT_THINKING_MESSAGE_ORDER) {
        localStorage.removeItem(THINKING_MESSAGE_ORDER_STORAGE_KEY);
      } else {
        localStorage.setItem(THINKING_MESSAGE_ORDER_STORAGE_KEY, messageOrder);
      }
    } catch {
      // Private mode or full storage still permits an in-memory preference.
    }

    window.dispatchEvent(new CustomEvent<SyncEventDetail>(SYNC_EVENT, {
      detail: { sourceId: sourceIdRef.current, kind: 'order', value: messageOrder },
    }));
  }, [messageOrder]);

  useEffect(() => {
    const applyExternalUpdate = (value: unknown) => {
      const nextMessages = value === null ? null : parseThinkingMessages(value);
      setStoredMessages((current) => messagesMatch(current, nextMessages) ? current : nextMessages);
    };

    const handleStorageChange = (event: StorageEvent) => {
      if (event.key === THINKING_MESSAGE_ORDER_STORAGE_KEY) {
        setStoredMessageOrder(
          parseThinkingMessageOrder(event.newValue) ?? DEFAULT_THINKING_MESSAGE_ORDER,
        );
        return;
      }

      if (event.key === THINKING_MESSAGE_CYCLE_STORAGE_KEY) {
        setStoredCycleMode(
          parseThinkingMessageCycleMode(event.newValue) ?? DEFAULT_THINKING_MESSAGE_CYCLE_MODE,
        );
        return;
      }

      if (event.key !== THINKING_MESSAGES_STORAGE_KEY) return;

      if (event.newValue === null) {
        applyExternalUpdate(null);
        return;
      }

      try {
        applyExternalUpdate(JSON.parse(event.newValue));
      } catch {
        // Ignore malformed writes from another tab.
      }
    };

    const handleSyncEvent = (event: Event) => {
      const detail = (event as CustomEvent<SyncEventDetail>).detail;
      if (!detail || detail.sourceId === sourceIdRef.current) return;
      if (detail.kind === 'messages') {
        applyExternalUpdate(detail.value);
      } else if (detail.kind === 'cycle') {
        setStoredCycleMode(detail.value);
      } else {
        setStoredMessageOrder(detail.value);
      }
    };

    window.addEventListener('storage', handleStorageChange);
    window.addEventListener(SYNC_EVENT, handleSyncEvent as EventListener);
    return () => {
      window.removeEventListener('storage', handleStorageChange);
      window.removeEventListener(SYNC_EVENT, handleSyncEvent as EventListener);
    };
  }, []);

  const setCustomMessages = useCallback((messages: string[]) => {
    const parsed = parseThinkingMessages(messages) ?? [];
    setStoredMessages((current) => messagesMatch(current, parsed) ? current : parsed);
  }, []);

  const setCycleMode = useCallback((mode: ThinkingMessageCycleMode) => {
    setStoredCycleMode(mode);
  }, []);

  const setMessageOrder = useCallback((order: ThinkingMessageOrder) => {
    setStoredMessageOrder(order);
  }, []);

  const resetThinkingMessages = useCallback(() => {
    setStoredMessages(null);
    setStoredCycleMode(DEFAULT_THINKING_MESSAGE_CYCLE_MODE);
    setStoredMessageOrder(DEFAULT_THINKING_MESSAGE_ORDER);
  }, []);

  return {
    customMessages,
    cycleMode,
    messageOrder,
    setCustomMessages,
    setCycleMode,
    setMessageOrder,
    resetThinkingMessages,
  };
}
