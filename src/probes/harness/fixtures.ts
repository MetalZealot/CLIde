import type { ChatMessage } from '../../components/chat/types/types';

export function userMessage(content: string, id: string): ChatMessage {
  return { type: 'user', id, content, timestamp: '2026-10-11T09:00:00Z' };
}

export function assistantMessage(content: string, id: string): ChatMessage {
  return { type: 'assistant', id, content, timestamp: '2026-10-11T09:00:05Z' };
}

/** A finished tool call; consecutive calls group into one activity row. Pass `result: null` for one still running. */
export function toolCall(
  toolName: string,
  input: Record<string, unknown>,
  id: string,
  result: { content: string; isError?: boolean } | null = { content: '' },
): ChatMessage {
  return {
    type: 'assistant',
    id,
    content: '',
    timestamp: '2026-10-11T09:00:02Z',
    isToolUse: true,
    toolName,
    toolId: id,
    toolInput: JSON.stringify(input),
    toolResult: result && { isError: false, ...result },
  };
}
