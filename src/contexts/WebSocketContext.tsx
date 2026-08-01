import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '../components/auth/context/AuthContext';
import { IS_PLATFORM } from '../constants/config';

/**
 * One frame received from the chat websocket. The server guarantees every
 * frame carries a `kind` (provider message kinds plus gateway kinds such as
 * `chat_subscribed`, `session_upserted`, `loading_progress`,
 * `protocol_error`, `chat_pong`). The synthetic `websocket_reconnected` kind
 * is injected client-side when the socket re-opens after a drop.
 */
export type ServerEvent = {
  kind?: string;
  type?: string;
  sessionId?: string;
  seq?: number;
  runId?: string;
  [key: string]: unknown;
};

type ServerEventListener = (event: ServerEvent) => void;

/**
 * How far into a run's sequenced live events this client has processed.
 * `seq` restarts at 1 for every run, so the counter is only meaningful
 * together with the `runId` it was recorded against.
 */
export type ReplayProgress = { runId: string | null; seq: number };

type WebSocketContextType = {
  ws: WebSocket | null;
  /**
   * Sends one frame. Returns false when the socket is not open (or the send
   * throws) so callers with user-visible actions (Stop, permission answers)
   * can react instead of silently dropping the message.
   *
   * Caveat: `true` means "handed to the socket", not "delivered" — a
   * half-open connection buffers sends until the liveness watchdog notices
   * and forces a reconnect. Pair with `isConnected` for UI decisions.
   */
  sendMessage: (message: unknown) => boolean;
  /**
   * Subscribes to every websocket frame. Returns an unsubscribe function.
   *
   * This is the primary consumption API: events are dispatched synchronously
   * to every listener, so rapid back-to-back frames can never be coalesced or
   * dropped the way a single "latest message" state slot could.
   */
  subscribe: (listener: ServerEventListener) => () => void;
  /**
   * Legacy state-based access to the most recent frame.
   *
   * Kept only for low-frequency consumers (TaskMaster broadcasts). High-rate
   * chat streams must use `subscribe` — React may batch state updates, which
   * makes `latestMessage` lossy under load.
   */
  latestMessage: ServerEvent | null;
  isConnected: boolean;
  /**
   * Fires one liveness probe immediately (no-op while disconnected). Callers
   * with delivery-critical sends (Stop) use this to shrink half-open
   * detection from the next heartbeat tick (≤40s) to PONG_TIMEOUT_MS.
   */
  probeConnection: () => void;
  /**
   * Replay progress for a session's sequenced live events, for `chat.subscribe`
   * (`lastSeq` + `runId`) so the server replays only what this client missed.
   * Tracked here — not in chat components — because the dedup guard in
   * `onmessage` is what keeps it exact, and because it must survive chat-view
   * remounts (a reset counter would make the server replay the whole buffer).
   */
  getReplayProgress: (sessionId: string) => ReplayProgress | null;
};

/**
 * Liveness heartbeat. Server-side WS protocol pings are answered inside the
 * browser's network stack — page JS never sees them — so a silently dead TCP
 * path (wifi power-save, PWA screen-lock wake, Tailscale path change) leaves
 * the socket reporting OPEN forever while every server frame vanishes:
 * permission prompts never render, Stop no-ops, and the UI looks alive.
 * The fix is an app-level echo: send `chat.ping` every HEARTBEAT_INTERVAL_MS;
 * if no frame at all (pong or otherwise) arrives within PONG_TIMEOUT_MS, the
 * connection is dead — force a reconnect, which triggers the server's
 * existing `chat.subscribe` replay + pending-permission recovery.
 */
const HEARTBEAT_INTERVAL_MS = 30_000;
const PONG_TIMEOUT_MS = 10_000;

const WebSocketContext = createContext<WebSocketContextType | null>(null);

export const useWebSocket = () => {
  const context = useContext(WebSocketContext);
  if (!context) {
    throw new Error('useWebSocket must be used within a WebSocketProvider');
  }
  return context;
};

const buildWebSocketUrl = (token: string | null) => {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  if (IS_PLATFORM) return `${protocol}//${window.location.host}/ws`; // Platform mode: Use same domain as the page (goes through proxy)
  if (!token) return null;
  return `${protocol}//${window.location.host}/ws?token=${encodeURIComponent(token)}`; // OSS mode: Use same host:port that served the page
};

const useWebSocketProviderState = (): WebSocketContextType => {
  const wsRef = useRef<WebSocket | null>(null);
  const unmountedRef = useRef(false); // Track if component is unmounted
  const hasConnectedRef = useRef(false); // Track if we've ever connected (to detect reconnects)
  /**
   * Listener registry for the subscribe API. A ref (not state) because the
   * set must be readable synchronously inside `onmessage` and never trigger
   * re-renders of the provider tree.
   */
  const listenersRef = useRef(new Set<ServerEventListener>());
  const [latestMessage, setLatestMessage] = useState<ServerEvent | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const heartbeatIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const watchdogTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  /**
   * Per-session replay progress (see ReplayProgress). Written by the dedup
   * guard in `onmessage`, read by `chat.subscribe` senders. Bounded by the
   * sessions viewed this page lifetime; entries are tiny and never stale —
   * a new run's frames carry a new runId and reset their entry.
   */
  const replayProgressRef = useRef(new Map<string, ReplayProgress>());
  /**
   * Self-reference so timer callbacks created inside `connect` (watchdog,
   * wake probe) can trigger a fresh connection without a circular
   * useCallback dependency.
   */
  const connectRef = useRef<() => void>(() => {});
  const { token } = useAuth();

  const dispatch = useCallback((event: ServerEvent) => {
    for (const listener of listenersRef.current) {
      try {
        listener(event);
      } catch (error) {
        console.error('WebSocket listener error:', error);
      }
    }
    setLatestMessage(event);
  }, []);

  const clearWatchdog = useCallback(() => {
    if (watchdogTimeoutRef.current) {
      clearTimeout(watchdogTimeoutRef.current);
      watchdogTimeoutRef.current = null;
    }
  }, []);

  const stopHeartbeat = useCallback(() => {
    if (heartbeatIntervalRef.current) {
      clearInterval(heartbeatIntervalRef.current);
      heartbeatIntervalRef.current = null;
    }
    clearWatchdog();
  }, [clearWatchdog]);

  /**
   * Arms the dead-connection watchdog (idempotent while already armed —
   * only the oldest unanswered ping counts). Any received frame disarms it;
   * expiry means the connection is half-open, so force a reconnect. The old
   * socket cannot be trusted to fire `onclose` (that needs a close handshake
   * over the very TCP path that is dead), so `connect` tears it down
   * explicitly and starts fresh.
   */
  const armWatchdog = useCallback(() => {
    if (watchdogTimeoutRef.current) return;
    watchdogTimeoutRef.current = setTimeout(() => {
      watchdogTimeoutRef.current = null;
      if (unmountedRef.current) return;
      console.warn('[WS] No response to liveness ping — forcing reconnect');
      setIsConnected(false);
      connectRef.current();
    }, PONG_TIMEOUT_MS);
  }, []);

  /** Sends one liveness probe and starts the watchdog waiting on its echo. */
  const sendPing = useCallback((socket: WebSocket) => {
    if (socket.readyState !== WebSocket.OPEN) return;
    try {
      socket.send(JSON.stringify({ type: 'chat.ping', ts: Date.now() }));
      armWatchdog();
    } catch {
      // Send can throw during teardown races; the watchdog/onclose path recovers.
    }
  }, [armWatchdog]);

  const connect = useCallback(() => {
    if (unmountedRef.current) return; // Prevent connection if unmounted
    try {
      // Construct WebSocket URL
      const wsUrl = buildWebSocketUrl(token);

      if (!wsUrl) return console.warn('No authentication token found for WebSocket connection');

      // Tear down any previous socket (half-open zombie, token change, or a
      // reconnect racing a wake probe) so two live connections never coexist
      // — a leaked second socket would double-dispatch every frame.
      const previous = wsRef.current;
      if (previous) {
        previous.onopen = null;
        previous.onmessage = null;
        previous.onclose = null;
        previous.onerror = null;
        try {
          previous.close();
        } catch {
          // already closing/closed
        }
      }
      stopHeartbeat();

      const websocket = new WebSocket(wsUrl);
      wsRef.current = websocket;

      websocket.onopen = () => {
        if (wsRef.current !== websocket) return; // superseded while connecting
        setIsConnected(true);
        if (hasConnectedRef.current) {
          // This is a reconnect — signal so components can catch up on missed messages
          dispatch({ kind: 'websocket_reconnected', timestamp: Date.now() });
        }
        hasConnectedRef.current = true;

        // App-level heartbeat (see HEARTBEAT_INTERVAL_MS doc). Note that
        // background tabs throttle timers, so the interval may stretch while
        // hidden — the visibilitychange probe covers the wake-up moment.
        heartbeatIntervalRef.current = setInterval(() => {
          if (wsRef.current !== websocket) return;
          sendPing(websocket);
        }, HEARTBEAT_INTERVAL_MS);
      };

      websocket.onmessage = (event) => {
        if (wsRef.current !== websocket) return;
        // Any frame proves the connection is alive, even if the matching
        // pong was interleaved away.
        clearWatchdog();
        try {
          const data = JSON.parse(event.data) as ServerEvent;
          if (data.kind === 'chat_pong') return; // liveness echo — not for listeners

          // Exactly-once dispatch for sequenced run frames: `chat.subscribe`
          // replay can overlap frames that raced in live, and `seq` restarts
          // per run, so progress only compares within the same runId. A frame
          // at or below the recorded seq for its run was already dispatched —
          // drop it here so no listener ever sees a duplicate. Frames without
          // a runId (server predating it) are never dropped: with no way to
          // tell "replay overlap" from "new run restarting at 1", dropping
          // could eat legitimate frames.
          if (typeof data.seq === 'number' && typeof data.sessionId === 'string' && data.sessionId) {
            const runId = typeof data.runId === 'string' ? data.runId : null;
            const known = replayProgressRef.current.get(data.sessionId);
            if (runId !== null && known && known.runId === runId && data.seq <= known.seq) {
              return;
            }
            replayProgressRef.current.set(data.sessionId, { runId, seq: data.seq });
          }

          dispatch(data);
        } catch (error) {
          console.error('Error parsing WebSocket message:', error);
        }
      };

      websocket.onclose = () => {
        if (wsRef.current !== websocket) return; // stale socket — already replaced
        wsRef.current = null;
        setIsConnected(false);
        stopHeartbeat();
        if (unmountedRef.current) return;

        // Attempt to reconnect after 3 seconds
        reconnectTimeoutRef.current = setTimeout(() => {
          if (unmountedRef.current) return; // Prevent reconnection if unmounted
          connect();
        }, 3000);
      };

      websocket.onerror = (error) => {
        console.error('WebSocket error:', error);
      };

    } catch (error) {
      console.error('Error creating WebSocket connection:', error);
    }
  }, [token, dispatch, sendPing, stopHeartbeat, clearWatchdog]); // everytime token changes, we reconnect

  useEffect(() => {
    connectRef.current = connect;
  }, [connect]);

  useEffect(() => {
    // The cleanup below sets unmountedRef = true. Without this reset, every
    // re-run of the effect (e.g. on token refresh) would short-circuit connect()
    // at its unmounted guard and leave the socket permanently disconnected.
    unmountedRef.current = false;
    connect();

    return () => {
      unmountedRef.current = true;
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      stopHeartbeat();
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, [token]); // everytime token changes, we reconnect

  /**
   * Immediate liveness re-check when the app comes back to life — PWA wake
   * from screen lock and network flaps are the two main ways the connection
   * dies while the page still believes it is OPEN. Don't wait up to a full
   * heartbeat interval to find out: probe now, and if the socket is already
   * known-down, reconnect now instead of waiting out a (possibly throttled)
   * backoff timer.
   */
  useEffect(() => {
    const probe = () => {
      if (unmountedRef.current) return;
      const socket = wsRef.current;
      if (socket && socket.readyState === WebSocket.OPEN) {
        sendPing(socket);
        return;
      }
      if (socket && socket.readyState === WebSocket.CONNECTING) return; // attempt already underway
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }
      connectRef.current();
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') probe();
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('online', probe);
    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('online', probe);
    };
  }, [sendPing]);

  const sendMessage = useCallback((message: unknown): boolean => {
    const socket = wsRef.current;
    if (socket && socket.readyState === WebSocket.OPEN) {
      try {
        socket.send(JSON.stringify(message));
        return true;
      } catch (error) {
        console.warn('WebSocket send failed:', error);
        return false;
      }
    }
    console.warn('WebSocket not connected');
    return false;
  }, []);

  const probeConnection = useCallback(() => {
    const socket = wsRef.current;
    if (socket && socket.readyState === WebSocket.OPEN) {
      sendPing(socket);
    }
  }, [sendPing]);

  const subscribe = useCallback((listener: ServerEventListener) => {
    listenersRef.current.add(listener);
    return () => {
      listenersRef.current.delete(listener);
    };
  }, []);

  const getReplayProgress = useCallback((sessionId: string): ReplayProgress | null => {
    return replayProgressRef.current.get(sessionId) ?? null;
  }, []);

  const value: WebSocketContextType = useMemo(() =>
  ({
    ws: wsRef.current,
    sendMessage,
    subscribe,
    latestMessage,
    isConnected,
    probeConnection,
    getReplayProgress
  }), [sendMessage, subscribe, latestMessage, isConnected, probeConnection, getReplayProgress]);

  return value;
};

export const WebSocketProvider = ({ children }: { children: React.ReactNode }) => {
  const webSocketData = useWebSocketProviderState();

  return (
    <WebSocketContext.Provider value={webSocketData}>
      {children}
    </WebSocketContext.Provider>
  );
};

export default WebSocketContext;
