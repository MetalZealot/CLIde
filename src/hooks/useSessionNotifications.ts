import { useEffect, useRef } from 'react';

const clearSessionNotifications = async (sessionId: string): Promise<void> => {
  if (!('serviceWorker' in navigator)) return;
  try {
    const registration = await navigator.serviceWorker.getRegistration();
    const notifications = await registration?.getNotifications();
    notifications?.forEach((notification) => {
      if (notification.data?.sessionId === sessionId) notification.close();
    });
  } catch {
    // Closing is a courtesy; a browser without the API keeps its notifications.
  }
};

/**
 * Dismisses the on-screen session's notifications whenever it is visible, and
 * answers the service worker's "which session are you showing?". The worker
 * asks because the window URL is not reliable: on Android it read `/` with a
 * session open.
 */
export function useSessionNotifications(viewedSessionId: string | null): void {
  const viewedRef = useRef(viewedSessionId);
  viewedRef.current = viewedSessionId;

  useEffect(() => {
    if (!viewedSessionId) return undefined;
    const clearIfVisible = () => {
      if (document.visibilityState === 'visible') void clearSessionNotifications(viewedSessionId);
    };
    clearIfVisible();
    document.addEventListener('visibilitychange', clearIfVisible);
    return () => document.removeEventListener('visibilitychange', clearIfVisible);
  }, [viewedSessionId]);

  useEffect(() => {
    if (!('serviceWorker' in navigator)) return undefined;
    const answer = (event: MessageEvent) => {
      if (event.data?.type !== 'notification:viewing') return;
      event.ports[0]?.postMessage({
        sessionId: document.visibilityState === 'visible' ? viewedRef.current : null,
      });
    };
    navigator.serviceWorker.addEventListener('message', answer);
    return () => navigator.serviceWorker.removeEventListener('message', answer);
  }, []);
}
