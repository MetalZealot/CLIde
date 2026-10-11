import type { ChatMessage } from '../../components/chat/types/types';

export function userMessage(content: string, id: string): ChatMessage {
  return { type: 'user', id, content, timestamp: '2026-10-11T09:00:00Z' };
}

export function assistantMessage(content: string, id: string): ChatMessage {
  return { type: 'assistant', id, content, timestamp: '2026-10-11T09:00:05Z' };
}
