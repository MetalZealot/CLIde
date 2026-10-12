import { useEffect } from 'react';

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

/** Dismisses a session's OS notifications whenever that session is on screen. */
export function useClearSessionNotifications(sessionId: string | undefined): void {
  useEffect(() => {
    if (!sessionId) return undefined;
    const clearIfVisible = () => {
      if (document.visibilityState === 'visible') void clearSessionNotifications(sessionId);
    };
    clearIfVisible();
    document.addEventListener('visibilitychange', clearIfVisible);
    return () => document.removeEventListener('visibilitychange', clearIfVisible);
  }, [sessionId]);
}
