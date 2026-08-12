import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

import { IS_PLATFORM } from '../../../constants/config';
import {
  api,
  AUTH_SESSION_EXPIRED_EVENT,
  AUTH_TOKEN_REFRESHED_EVENT,
  getAuthTokenRefreshDelay,
  isValidRefreshedToken,
  storeAuthToken,
} from '../../../utils/api';
import { AUTH_ERROR_MESSAGES, AUTH_TOKEN_STORAGE_KEY } from '../constants';
import type {
  ApiErrorPayload,
  AuthActionResult,
  AuthContextValue,
  AuthProfileChanges,
  AuthProviderProps,
  AuthSessionPayload,
  AuthStatusPayload,
  AuthUser,
  AuthUserPayload,
  OnboardingStatusPayload,
} from '../types';
import { parseJsonSafely, resolveApiErrorMessage } from '../utils';

const AuthContext = createContext<AuthContextValue | null>(null);

// Backoff between retries when /api/auth/user fails for a reason that is not the
// server rejecting the token (server restarting, proxy 502, phone offline).
const AUTH_RETRY_DELAYS_MS = [1000, 2000, 4000];

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

// The server only mints a replacement token on an authenticated request past the
// token's half-life. A tab sitting on an open WebSocket makes none, so ping an
// authenticated endpoint on this interval to keep the token alive.
const TOKEN_KEEPALIVE_INTERVAL_MS = 60 * 60 * 1000;

const readStoredToken = (): string | null => localStorage.getItem(AUTH_TOKEN_STORAGE_KEY);

const persistToken = (token: string) => {
  storeAuthToken(token);
};

const clearStoredToken = () => {
  localStorage.removeItem(AUTH_TOKEN_STORAGE_KEY);
};

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }

  return context;
}

export function AuthProvider({ children }: AuthProviderProps) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [token, setToken] = useState<string | null>(() => readStoredToken());
  const [isLoading, setIsLoading] = useState(true);
  const [needsSetup, setNeedsSetup] = useState(false);
  const [hasCompletedOnboarding, setHasCompletedOnboarding] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const checkInFlightRef = useRef(false);

  const setSession = useCallback((nextUser: AuthUser, nextToken: string) => {
    setUser(nextUser);
    setToken(nextToken);
    persistToken(nextToken);
  }, []);

  const clearSession = useCallback(() => {
    setUser(null);
    setToken(null);
    clearStoredToken();
  }, []);

  const checkOnboardingStatus = useCallback(async () => {
    try {
      const response = await api.user.onboardingStatus();
      if (!response.ok) {
        return;
      }

      const payload = await parseJsonSafely<OnboardingStatusPayload>(response);
      setHasCompletedOnboarding(Boolean(payload?.hasCompletedOnboarding));
    } catch (caughtError) {
      console.error('Error checking onboarding status:', caughtError);
      // Fail open to avoid blocking access on transient onboarding status errors.
      setHasCompletedOnboarding(true);
    }
  }, []);

  const refreshOnboardingStatus = useCallback(async () => {
    await checkOnboardingStatus();
  }, [checkOnboardingStatus]);

  const refreshSession = useCallback(async () => {
    if (IS_PLATFORM || !token || !user) {
      return;
    }

    try {
      const response = await api.auth.refresh();
      if (!response.ok) {
        return;
      }

      const payload = await parseJsonSafely<AuthSessionPayload>(response);
      if (isValidRefreshedToken(payload?.token)) {
        setToken(payload.token);
        persistToken(payload.token);
      }
    } catch (caughtError) {
      // A transient network failure must not sign the user out. Focus/visibility
      // and the next scheduled refresh will retry while the token remains valid.
      console.warn('[Auth] Session refresh failed:', caughtError);
    }
  }, [token, user]);

  // Adopt tokens the server refreshes on ordinary requests; otherwise the
  // in-memory token stays pinned to whatever was stored at mount and consumers
  // (WebSocketContext) reconnect with a stale one. Per ADR 0024 this updates
  // credentials only — never re-runs bootstrap.
  useEffect(() => {
    const handleTokenRefreshed = (event: Event) => {
      const nextToken = (event as CustomEvent<unknown>).detail;
      if (isValidRefreshedToken(nextToken)) {
        setToken((current) => (current === nextToken ? current : nextToken));
      }
    };
    const handleSessionExpired = () => {
      clearSession();
      setError(AUTH_ERROR_MESSAGES.sessionExpired);
    };

    window.addEventListener(AUTH_TOKEN_REFRESHED_EVENT, handleTokenRefreshed);
    window.addEventListener(AUTH_SESSION_EXPIRED_EVENT, handleSessionExpired);
    return () => {
      window.removeEventListener(AUTH_TOKEN_REFRESHED_EVENT, handleTokenRefreshed);
      window.removeEventListener(AUTH_SESSION_EXPIRED_EVENT, handleSessionExpired);
    };
  }, [clearSession]);

  const checkAuthStatus = useCallback(async () => {
    if (checkInFlightRef.current) {
      return;
    }
    checkInFlightRef.current = true;

    try {
      setIsLoading(true);
      setError(null);

      const statusResponse = await api.auth.status();
      const statusPayload = await parseJsonSafely<AuthStatusPayload>(statusResponse);

      if (statusPayload?.needsSetup) {
        setNeedsSetup(true);
        return;
      }

      setNeedsSetup(false);

      // Read storage at call time rather than closing over the token state: a
      // successful request may rotate the token mid-check. If `checkAuthStatus`
      // changed identity on every rotation, the mount effect below would re-run,
      // return ProtectedRoute to its loading screen, and unmount the workspace
      // (including a file input awaiting an Android picker result).
      if (!readStoredToken()) {
        return;
      }

      // Only 401/403 means the token is invalid. Anything else (server
      // restarting, proxy 5xx, offline) is transient and must NOT drop the stored
      // token, or a badly timed reload logs the user out for good.
      for (let attempt = 0; attempt <= AUTH_RETRY_DELAYS_MS.length; attempt += 1) {
        if (attempt > 0) {
          await delay(AUTH_RETRY_DELAYS_MS[attempt - 1]);
        }

        try {
          const userResponse = await api.auth.user();

          if (userResponse.status === 401 || userResponse.status === 403) {
            clearSession();
            return;
          }

          if (userResponse.ok) {
            const userPayload = await parseJsonSafely<AuthUserPayload>(userResponse);
            if (userPayload?.user) {
              setUser(userPayload.user);
              await checkOnboardingStatus();
              return;
            }
          }
        } catch (caughtError) {
          console.error('[Auth] User check failed, retrying:', caughtError);
        }
      }

      // Retries exhausted: keep the token so the session comes back on its own
      // once the server is reachable again.
      setError(AUTH_ERROR_MESSAGES.authStatusCheckFailed);
    } catch (caughtError) {
      console.error('[Auth] Auth status check failed:', caughtError);
      setError(AUTH_ERROR_MESSAGES.authStatusCheckFailed);
    } finally {
      checkInFlightRef.current = false;
      setIsLoading(false);
    }
  }, [checkOnboardingStatus, clearSession]);

  useEffect(() => {
    if (IS_PLATFORM) {
      setUser({ username: 'platform-user' });
      setNeedsSetup(false);
      void checkOnboardingStatus().finally(() => {
        setIsLoading(false);
      });
      return;
    }

    void checkAuthStatus();
  }, [checkAuthStatus, checkOnboardingStatus]);

  // Token held but never confirmed (server down / offline). Re-check when the
  // tab returns or the network comes back, so the session restores itself rather
  // than leaving a login form.
  useEffect(() => {
    if (IS_PLATFORM || user || !token) {
      return;
    }

    const recheckIfVisible = () => {
      if (document.visibilityState === 'visible') {
        void checkAuthStatus();
      }
    };
    const recheck = () => {
      void checkAuthStatus();
    };

    document.addEventListener('visibilitychange', recheckIfVisible);
    window.addEventListener('online', recheck);

    return () => {
      document.removeEventListener('visibilitychange', recheckIfVisible);
      window.removeEventListener('online', recheck);
    };
  }, [checkAuthStatus, token, user]);

  // Keep an idle-but-open client's token alive (see TOKEN_KEEPALIVE_INTERVAL_MS).
  useEffect(() => {
    if (IS_PLATFORM || !user || !token) {
      return;
    }

    const ping = () => {
      void api.auth.user().catch((caughtError: unknown) => {
        console.error('[Auth] Token keep-alive ping failed:', caughtError);
      });
    };

    const intervalId = window.setInterval(ping, TOKEN_KEEPALIVE_INTERVAL_MS);
    const pingIfVisible = () => {
      if (document.visibilityState === 'visible') {
        ping();
      }
    };
    document.addEventListener('visibilitychange', pingIfVisible);

    return () => {
      window.clearInterval(intervalId);
      document.removeEventListener('visibilitychange', pingIfVisible);
    };
  }, [token, user]);

  // Proactive refresh at the token's half-life (upstream 1.37). Complements the
  // keep-alive rather than replacing it: this renews outright, the ping only
  // picks up whatever X-Refreshed-Token an ordinary request returns.
  useEffect(() => {
    if (IS_PLATFORM || !token || !user) {
      return undefined;
    }

    const refreshIfNeeded = () => {
      const refreshDelay = getAuthTokenRefreshDelay(token);
      if (refreshDelay !== null && refreshDelay <= 0) {
        void refreshSession();
      }
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        refreshIfNeeded();
      }
    };

    const refreshDelay = getAuthTokenRefreshDelay(token);
    const refreshTimer = refreshDelay === null
      ? null
      : window.setTimeout(() => void refreshSession(), refreshDelay);

    window.addEventListener('focus', refreshIfNeeded);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      if (refreshTimer !== null) {
        window.clearTimeout(refreshTimer);
      }
      window.removeEventListener('focus', refreshIfNeeded);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [refreshSession, token, user]);

  const login = useCallback<AuthContextValue['login']>(
    async (username, password) => {
      try {
        setError(null);
        const response = await api.auth.login(username, password);
        const payload = await parseJsonSafely<AuthSessionPayload>(response);

        if (!response.ok || !payload?.token || !payload.user) {
          const message = resolveApiErrorMessage(payload, AUTH_ERROR_MESSAGES.loginFailed);
          setError(message);
          return { success: false, error: message };
        }

        setSession(payload.user, payload.token);
        setNeedsSetup(false);
        await checkOnboardingStatus();
        return { success: true };
      } catch (caughtError) {
        console.error('Login error:', caughtError);
        setError(AUTH_ERROR_MESSAGES.networkError);
        return { success: false, error: AUTH_ERROR_MESSAGES.networkError };
      }
    },
    [checkOnboardingStatus, setSession],
  );

  const register = useCallback<AuthContextValue['register']>(
    async (username, password) => {
      try {
        setError(null);
        const response = await api.auth.register(username, password);
        const payload = await parseJsonSafely<AuthSessionPayload>(response);

        if (!response.ok || !payload?.token || !payload.user) {
          const message = resolveApiErrorMessage(payload, AUTH_ERROR_MESSAGES.registrationFailed);
          setError(message);
          return { success: false, error: message };
        }

        setSession(payload.user, payload.token);
        setNeedsSetup(false);
        await checkOnboardingStatus();
        return { success: true };
      } catch (caughtError) {
        console.error('Registration error:', caughtError);
        setError(AUTH_ERROR_MESSAGES.networkError);
        return { success: false, error: AUTH_ERROR_MESSAGES.networkError };
      }
    },
    [checkOnboardingStatus, setSession],
  );

  const logout = useCallback(() => {
    // JWT logout is client-side: the server endpoint does not maintain a
    // revocation list, so clearing the session is the complete operation.
    clearSession();
  }, [clearSession]);

  /**
   * Applies a name and/or picture change, then adopts the row the server stored
   * rather than the values sent — a rename can be trimmed or refused, and every
   * surface reading `user` should show the truth.
   */
  const updateProfile = useCallback(async (changes: AuthProfileChanges): Promise<AuthActionResult> => {
    try {
      const response = await api.auth.updateProfile(changes);
      // The route returns the stored row on success and an error body on
      // failure, so parse as both rather than guessing from the status.
      const data = await parseJsonSafely<AuthUserPayload & ApiErrorPayload>(response);

      if (!response.ok || !data?.user) {
        return { success: false, error: resolveApiErrorMessage(data, AUTH_ERROR_MESSAGES.networkError) };
      }

      setUser(data.user);
      return { success: true };
    } catch (caughtError) {
      console.error('Profile update error:', caughtError);
      return { success: false, error: AUTH_ERROR_MESSAGES.networkError };
    }
  }, []);

  /**
   * Does not touch the stored token. The server keeps no revocation list, so the
   * existing session stays valid — logging out here would imply a guarantee the
   * backend cannot make.
   */
  const changePassword = useCallback(async (
    currentPassword: string,
    newPassword: string,
  ): Promise<AuthActionResult> => {
    try {
      const response = await api.auth.changePassword(currentPassword, newPassword);
      const data = await parseJsonSafely<ApiErrorPayload>(response);

      if (!response.ok) {
        return { success: false, error: resolveApiErrorMessage(data, AUTH_ERROR_MESSAGES.networkError) };
      }

      return { success: true };
    } catch (caughtError) {
      console.error('Password change error:', caughtError);
      return { success: false, error: AUTH_ERROR_MESSAGES.networkError };
    }
  }, []);

  const contextValue = useMemo<AuthContextValue>(
    () => ({
      user,
      token,
      isLoading,
      needsSetup,
      hasCompletedOnboarding,
      error,
      login,
      register,
      logout,
      updateProfile,
      changePassword,
      refreshOnboardingStatus,
    }),
    [
      changePassword,
      error,
      hasCompletedOnboarding,
      isLoading,
      login,
      logout,
      needsSetup,
      refreshOnboardingStatus,
      register,
      token,
      updateProfile,
      user,
    ],
  );

  return <AuthContext.Provider value={contextValue}>{children}</AuthContext.Provider>;
}
