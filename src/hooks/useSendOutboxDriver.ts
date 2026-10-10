import { useEffect, useRef } from 'react';

import type { ServerEvent } from '../contexts/WebSocketContext';
import {
  SEND_GIVE_UP_MS,
  dispatchSend,
  failSend,
  getSend,
  listSends,
  setSendDispatcher,
  settleSend,
  subscribeOutbox,
  updateSend,
} from '../stores/sendOutbox';
import { flightRecorder } from '../utils/flightRecorder';

import type { MarkSessionIdle, MarkSessionProcessing } from './useSessionProtection';

/** A receipt this late is worth saying "Sending…" for. */
const SLOW_RECEIPT_MS = 1_000;
/** A receipt this late gets a liveness probe, which reconnects a dead socket in ≤10 s. */
const PROBE_RECEIPT_MS = 3_000;
const TICK_MS = 500;

type UseSendOutboxDriverArgs = {
  sendMessage: (message: unknown) => boolean;
  subscribe: (listener: (event: ServerEvent) => void) => () => void;
  probeConnection: () => void;
  isConnected: boolean;
  markSessionProcessing: MarkSessionProcessing;
  markSessionIdle: MarkSessionIdle;
};

/**
 * Delivers composer sends and watches for their receipts. Mounted once, above
 * every chat view, so a send keeps going while you look at another session.
 */
export function useSendOutboxDriver({
  sendMessage,
  subscribe,
  probeConnection,
  isConnected,
  markSessionProcessing,
  markSessionIdle,
}: UseSendOutboxDriverArgs) {
  const isConnectedRef = useRef(isConnected);
  isConnectedRef.current = isConnected;

  useEffect(() => {
    const dispatch = (requestId: string) => {
      const entry = getSend(requestId);
      if (!entry?.frame || entry.stage === 'failed') return;
      // Marked before the receipt so a message typed meanwhile queues behind this one.
      markSessionProcessing(entry.frame.sessionId, { statusText: null, canInterrupt: true });
      const handedOver = sendMessage(entry.frame);
      updateSend(requestId, handedOver
        ? { stage: 'sending', sentAt: Date.now(), slow: false, probed: false }
        : { stage: 'waiting', sentAt: null, slow: false, probed: false });
      flightRecorder()?.event('outbox', { kind: handedOver ? 'dispatch' : 'waiting', sessionId: entry.frame.sessionId });
    };
    setSendDispatcher(dispatch);

    const unsubscribe = subscribe((event) => {
      if (event.kind === 'websocket_reconnected') {
        for (const entry of listSends()) {
          if (entry.frame && (entry.stage === 'sending' || entry.stage === 'waiting')) {
            flightRecorder()?.event('outbox', { kind: 'resend', sessionId: entry.frame.sessionId });
            dispatch(entry.requestId);
          }
        }
        return;
      }
      const requestId = typeof event.requestId === 'string' ? event.requestId : '';
      const entry = requestId ? getSend(requestId) : undefined;
      if (!entry) return;

      if (event.kind === 'chat_input_accepted') {
        settleSend(requestId);
        // Also covers a receipt that beat the give-up by a moment: the run is on.
        if (entry.sessionId) markSessionProcessing(entry.sessionId, { canInterrupt: true });
        flightRecorder()?.event('outbox', { kind: 'accepted', sessionId: entry.sessionId ?? undefined });
      } else if (event.kind === 'protocol_error' || event.kind === 'chat_input_rejected') {
        failSend(requestId, typeof event.error === 'string' ? event.error : null);
        flightRecorder()?.event('outbox', {
          kind: `refused:${typeof event.code === 'string' ? event.code : 'unknown'}`,
          sessionId: entry.sessionId ?? undefined,
        });
      }
    });

    return () => {
      unsubscribe();
      setSendDispatcher(null);
    };
  }, [markSessionProcessing, sendMessage, subscribe]);

  // A clock only while something is in flight.
  useEffect(() => {
    let timer: number | null = null;

    const tick = () => {
      const now = Date.now();
      for (const entry of listSends()) {
        if (entry.stage === 'failed') continue;
        if (now - entry.startedAt >= SEND_GIVE_UP_MS) {
          failSend(entry.requestId);
          if (entry.sessionId) markSessionIdle(entry.sessionId);
          flightRecorder()?.event('outbox', { kind: `gave-up:${entry.stage}`, sessionId: entry.sessionId ?? undefined });
          continue;
        }
        if (entry.stage === 'waiting' && isConnectedRef.current) {
          dispatchSend(entry.requestId);
          continue;
        }
        if (entry.stage !== 'sending' || entry.sentAt === null) continue;
        const waited = now - entry.sentAt;
        if (waited >= PROBE_RECEIPT_MS && !entry.probed) {
          updateSend(entry.requestId, { probed: true, slow: true });
          probeConnection();
          flightRecorder()?.event('outbox', { kind: 'probe', sessionId: entry.sessionId ?? undefined });
        } else if (waited >= SLOW_RECEIPT_MS && !entry.slow) {
          updateSend(entry.requestId, { slow: true });
        }
      }
    };

    const sync = () => {
      const active = listSends().some((entry) => entry.stage !== 'failed');
      if (active && timer === null) {
        timer = window.setInterval(tick, TICK_MS);
      } else if (!active && timer !== null) {
        window.clearInterval(timer);
        timer = null;
      }
    };

    sync();
    const unsubscribe = subscribeOutbox(sync);
    return () => {
      unsubscribe();
      if (timer !== null) window.clearInterval(timer);
    };
  }, [markSessionIdle, probeConnection]);
}
