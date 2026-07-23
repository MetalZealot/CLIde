import type { ChatMessage } from '../types/types';

const TRANSCRIPT_UUID_PREFIX_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

/**
 * Normalized ids are the provider transcript uuid plus an optional part
 * suffix (`_text_0`, `_tr_<toolUseId>`, ...). Returns the bare uuid, or null
 * for ids that are not transcript-backed (optimistic messages, the server's
 * `claude_<uuid>` fallbacks) — those cannot anchor a rewind.
 */
export const getTranscriptMessageUuid = (messageId: unknown): string | null => {
  if (typeof messageId !== 'string') {
    return null;
  }
  const match = messageId.match(TRANSCRIPT_UUID_PREFIX_RE);
  return match ? match[0].toLowerCase() : null;
};

const toMessageKeyPart = (value: unknown): string | null => {
  if (typeof value !== 'string' && typeof value !== 'number') {
    return null;
  }

  const normalized = String(value).trim();
  return normalized.length > 0 ? normalized : null;
};

export const getIntrinsicMessageKey = (message: ChatMessage): string | null => {
  const candidates = [
    message.id,
    message.messageId,
    message.toolId,
    message.toolCallId,
    message.blobId,
    message.rowid,
    message.sequence,
  ];

  for (const candidate of candidates) {
    const keyPart = toMessageKeyPart(candidate);
    if (keyPart) {
      return `message-${message.type}-${keyPart}`;
    }
  }

  const timestamp = new Date(message.timestamp).getTime();
  if (!Number.isFinite(timestamp)) {
    return null;
  }

  const contentPreview = typeof message.content === 'string' ? message.content.slice(0, 48) : '';
  const toolName = typeof message.toolName === 'string' ? message.toolName : '';
  return `message-${message.type}-${timestamp}-${toolName}-${contentPreview}`;
};
