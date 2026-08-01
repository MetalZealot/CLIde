import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

import { IS_PLATFORM } from '../../../constants/config';
import { api, AUTH_TOKEN_REFRESHED_EVENT } from '../../../utils/api';
import {
  isResumeProbeEnabled,
  recordLifecycleDiagnostic,
} from '../../../utils/lifecycleDiagnostics';
import { AUTH_ERROR_MESSAGES, AUTH_TOKEN_STORAGE_KEY } from '../constants';
import type {
  AuthContextValue,
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

// The server only mints a replacement token in response to an authenticated
// request made past the token's half-life. A tab sitting on an open WebSocket
// makes no such request, so ping an authenticated endpoint on this interval to
// keep the token from expiring underneath an idle-but-open client.
const TOKEN_KEEPALIVE_INTERVAL_MS = 60 * 60 * 1000;

const readStoredToken = (): string | null => localStorage.getItem(AUTH_TOKEN_STORAGE_KEY);

const persistToken = (token: string) => {
  localStorage.setItem(AUTH_TOKEN_STORAGE_KEY, token);
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

      if (!token) {
        return;
      }

      // Only 401/403 means "this token is no longer valid" — anything else
      // (server restarting, proxy 5xx, offline) is transient and must NOT drop
      // the stored token, or a badly timed reload logs the user out for good.
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
  }, [checkOnboardingStatus, clearSession, token]);

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

  // We still hold a token but never confirmed it (server was down / offline).
  // Re-check when the tab comes back or the network returns, so the session
  // restores itself instead of leaving a login form the user has to fill in.
  useEffect(() => {
    if (IS_PLATFORM || user || !token) {
      return;
    }

    const recheckIfVisible = () => {
      if (document.visibilityState === 'visible') {
        if (!isResumeProbeEnabled('auth')) {
          recordLifecycleDiagnostic('auth.resume-recheck-suppressed');
          return;
        }
        recordLifecycleDiagnostic('auth.resume-recheck');
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

  // Adopt tokens the server refreshes on ordinary requests; without this the
  // in-memory token stays pinned to whatever was stored at mount and consumers
  // that read it (WebSocketContext) keep reconnecting with a stale one.
  useEffect(() => {
    const handleRefreshedToken = (event: Event) => {
      const refreshed = (event as CustomEvent<string>).detail;
      if (typeof refreshed === 'string' && refreshed.length > 0) {
        setToken((current) => (current === refreshed ? current : refreshed));
      }
    };

    window.addEventListener(AUTH_TOKEN_REFRESHED_EVENT, handleRefreshedToken);
    return () => {
      window.removeEventListener(AUTH_TOKEN_REFRESHED_EVENT, handleRefreshedToken);
    };
  }, []);

  // Keep an idle-but-open client's token alive (see TOKEN_KEEPALIVE_INTERVAL_MS).
  useEffect(() => {
    if (IS_PLATFORM || !user || !token) {
      return;
    }

    const ping = (source: 'interval' | 'visibility') => {
      if (source === 'visibility') {
        recordLifecycleDiagnostic('auth.resume-ping-start');
      }
      void api.auth.user()
        .then((response) => {
          if (source === 'visibility') {
            recordLifecycleDiagnostic('auth.resume-ping-complete', {
              status: response.status,
            });
          }
        })
        .catch((caughtError: unknown) => {
          if (source === 'visibility') {
            recordLifecycleDiagnostic('auth.resume-ping-failed', {
              message: caughtError instanceof Error ? caughtError.message : String(caughtError),
            });
          }
          console.error('[Auth] Token keep-alive ping failed:', caughtError);
        });
    };

    const intervalId = window.setInterval(() => ping('interval'), TOKEN_KEEPALIVE_INTERVAL_MS);
    const pingIfVisible = () => {
      if (document.visibilityState === 'visible') {
        if (!isResumeProbeEnabled('auth')) {
          recordLifecycleDiagnostic('auth.resume-ping-suppressed');
          return;
        }
        ping('visibility');
      }
    };
    document.addEventListener('visibilitychange', pingIfVisible);

    return () => {
      window.clearInterval(intervalId);
      document.removeEventListener('visibilitychange', pingIfVisible);
    };
  }, [token, user]);

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
    const tokenToInvalidate = token;
    clearSession();

    if (tokenToInvalidate) {
      void api.auth.logout().catch((caughtError: unknown) => {
        console.error('Logout endpoint error:', caughtError);
      });
    }
  }, [clearSession, token]);

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
      refreshOnboardingStatus,
    }),
    [
      error,
      hasCompletedOnboarding,
      isLoading,
      login,
      logout,
      needsSetup,
      refreshOnboardingStatus,
      register,
      token,
      user,
    ],
  );

  return <AuthContext.Provider value={contextValue}>{children}</AuthContext.Provider>;
}
