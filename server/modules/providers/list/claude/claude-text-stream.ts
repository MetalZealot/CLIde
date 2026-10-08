/**
 * Turns a Claude turn's `stream_event` frames into coalesced text deltas, and
 * names the stream each block's final `assistant` row replaces.
 *
 * Measured frame order per text block: `content_block_start`, its deltas, the
 * `assistant` frame carrying the finished block, then `content_block_stop`.
 * Nothing here depends on that last frame or on `message_stop`, which a cut
 * stream may never send.
 */

/** Longest a delta waits for company before it is sent. */
export const CLAUDE_TEXT_DELTA_FLUSH_MS = 50;

export type ClaudeTextDelta = {
  /** API message id plus block index; the block's final row carries the same key. */
  streamKey: string;
  /** Characters of this block already sent, so a client can tell it missed one. */
  offset: number;
  text: string;
};

/** What a stream event meant to the turn: the API answering, or reply text arriving. */
export type ClaudeStreamSignal = 'message_start' | 'text' | null;

type OpenBlock = { key: string; sent: number; pending: string; claimed: boolean };

type RawFrame = {
  type?: unknown;
  parent_tool_use_id?: unknown;
  event?: {
    type?: unknown;
    index?: unknown;
    message?: { id?: unknown };
    content_block?: { type?: unknown };
    delta?: { type?: unknown; text?: unknown };
  };
  message?: { id?: unknown; content?: unknown };
};

const hasTextPart = (content: unknown): boolean => (
  Array.isArray(content) && content.some((part) => (part as { type?: unknown } | null)?.type === 'text')
);

export function createClaudeTextStream(
  emit: (delta: ClaudeTextDelta) => void,
  flushMs = CLAUDE_TEXT_DELTA_FLUSH_MS,
) {
  let messageId: string | null = null;
  let block: OpenBlock | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const cancelTimer = () => {
    if (timer) clearTimeout(timer);
    timer = null;
  };

  const flush = () => {
    cancelTimer();
    if (!block || block.claimed || !block.pending) return;
    const text = block.pending;
    block.pending = '';
    emit({ streamKey: block.key, offset: block.sent, text });
    block.sent += text.length;
  };

  return {
    /** Reads one `stream_event`; a subagent's are ignored, its text never renders live. */
    onStreamEvent(frame: RawFrame): ClaudeStreamSignal {
      if (frame.parent_tool_use_id) return null;
      const event = frame.event;
      if (!event) return null;
      if (event.type === 'message_start') {
        flush();
        block = null;
        messageId = typeof event.message?.id === 'string' ? event.message.id : null;
        return 'message_start';
      }
      if (event.type === 'content_block_start') {
        flush();
        block = messageId && event.content_block?.type === 'text' && typeof event.index === 'number'
          ? { key: `${messageId}:${event.index}`, sent: 0, pending: '', claimed: false }
          : null;
        return null;
      }
      if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
        const text = typeof event.delta.text === 'string' ? event.delta.text : '';
        if (!block || block.claimed || !text) return null;
        block.pending += text;
        if (!timer) timer = setTimeout(flush, flushMs);
        return 'text';
      }
      return null;
    },

    /**
     * The stream an `assistant` frame finishes, if any. Its first text row
     * takes the key; deltas still waiting are dropped, the row holds them.
     */
    claim(frame: RawFrame): string | null {
      if (frame.parent_tool_use_id || !block || block.claimed) return null;
      if (frame.message?.id !== messageId || !hasTextPart(frame.message?.content)) return null;
      cancelTimer();
      block.claimed = true;
      block.pending = '';
      return block.key;
    },

    /** Sends what is waiting, so a frame that follows cannot overtake it. */
    flush,

    /** Turn end: what an interrupted block streamed stays on screen. */
    close() {
      flush();
      block = null;
      messageId = null;
    },
  };
}
