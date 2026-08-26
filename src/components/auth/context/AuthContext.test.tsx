import assert from 'node:assert/strict';
import test, { afterEach, beforeEach, describe } from 'node:test';

import React, { useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import { api, AUTH_TOKEN_REFRESHED_EVENT, isAuthTokenExpired, TOKEN_EXPIRY_SKEW_MS } from '../../../utils/api';
import { AUTH_TOKEN_STORAGE_KEY } from '../constants';

import { AuthProvider, useAuth } from './AuthContext';

describe('AuthContext', () => {
  /**
   * Mirror of the only branch of `ProtectedRoute` that matters here:
   *
   *   if (isLoading) return <AuthLoadingScreen />;
   *
   * The real component is not imported because its graph reaches Onboarding and the
   * shell terminal, making this an xterm/CJS interop exercise. The gate is the
   * contract under test, and ADR 0024 states it in terms of `isLoading`. Keep in
   * sync if that component's gating changes.
   */
  const ProtectedRouteGate = ({ children }: { children: React.ReactNode }) => {
    const { isLoading, user } = useAuth();

    if (isLoading) {
      harness.loadingScreenRenders += 1;
      return React.createElement('div', { 'data-testid': 'auth-loading' }, 'loading');
    }

    if (!user) {
      return React.createElement('div', { 'data-testid': 'login' }, 'login');
    }

    return React.createElement(React.Fragment, null, children);
  };

  const base64Url = (value: string) =>
    Buffer.from(value, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

  /**
   * `isValidRefreshedToken` and `getAuthTokenRefreshDelay` both parse the token, so
   * fixtures must be shaped like real JWTs. Issued now, expiring in a week —
   * well short of the half-life, so upstream's proactive refresh stays idle.
   */
  const makeToken = (label: string) => {
    const issuedAt = Math.floor(Date.now() / 1000);
    const payload = base64Url(
      JSON.stringify({ sub: label, iat: issuedAt, exp: issuedAt + 7 * 24 * 60 * 60 }),
    );
    return `${base64Url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))}.${payload}.${base64Url(label)}`;
  };

  const jsonResponse = (body: unknown, init: { ok?: boolean; status?: number } = {}) =>
    ({
      ok: init.ok ?? true,
      status: init.status ?? 200,
      json: async () => body,
    }) as unknown as Response;

  const flush = async () => {
    // Let the bootstrap's awaited chain (status -> user -> onboarding) settle.
    for (let i = 0; i < 8; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  };

  type Harness = {
    container: HTMLElement;
    root: Root;
    statusCalls: number;
    userCalls: number;
    workspaceMounts: number;
    workspaceUnmounts: number;
    loadingScreenRenders: number;
    currentToken: string | null;
  };

  let harness: Harness;
  let restoreApi: () => void;

  beforeEach(() => {
    localStorage.clear();

    const originalStatus = api.auth.status;
    const originalUser = api.auth.user;
    const originalOnboarding = api.user.onboardingStatus;
    restoreApi = () => {
      api.auth.status = originalStatus;
      api.auth.user = originalUser;
      api.user.onboardingStatus = originalOnboarding;
    };
  });

  afterEach(async () => {
    await React.act(async () => {
      harness?.root.unmount();
    });
    harness?.container.remove();
    restoreApi();
    localStorage.clear();
  });

  const renderWorkspace = async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);

    harness = {
      container,
      root: createRoot(container),
      statusCalls: 0,
      userCalls: 0,
      workspaceMounts: 0,
      workspaceUnmounts: 0,
      loadingScreenRenders: 0,
      currentToken: null,
    };

    api.auth.status = async () => {
      harness.statusCalls += 1;
      return jsonResponse({ needsSetup: false });
    };
    api.auth.user = async () => {
      harness.userCalls += 1;
      return jsonResponse({ user: { username: 'grayson' } });
    };
    api.user.onboardingStatus = async () => jsonResponse({ hasCompletedOnboarding: true });

    // Stands in for the app's workspace. Its mount/unmount counters are the
    // assertion that matters: the composer's file input lives in this tree, and
    // remounting it is what discarded the Android picker's result.
    const Workspace = () => {
      const { token } = useAuth();
      harness.currentToken = token;

      useEffect(() => {
        harness.workspaceMounts += 1;
        return () => {
          harness.workspaceUnmounts += 1;
        };
      }, []);

      return React.createElement('div', { 'data-testid': 'workspace' }, 'workspace');
    };

    await React.act(async () => {
      harness.root.render(
        React.createElement(
          AuthProvider,
          null,
          React.createElement(ProtectedRouteGate, null, React.createElement(Workspace, null)),
        ),
      );
    });
    await React.act(flush);

    // The loading screen legitimately renders during bootstrap. Zero the counter so
    // assertions read "it came back", not "it ever appeared".
    harness.loadingScreenRenders = 0;

    return harness;
  };

  test('bootstraps once and mounts the workspace', async () => {
    localStorage.setItem(AUTH_TOKEN_STORAGE_KEY, makeToken('initial'));

    const state = await renderWorkspace();

    assert.equal(state.statusCalls, 1);
    assert.equal(state.workspaceMounts, 1);
    assert.equal(state.workspaceUnmounts, 0);
    assert.match(state.container.innerHTML, /workspace/);
  });

  test('adopting a refreshed token does not re-run bootstrap or unmount the workspace', async () => {
    const initialToken = makeToken('initial');
    localStorage.setItem(AUTH_TOKEN_STORAGE_KEY, initialToken);

    const state = await renderWorkspace();
    assert.equal(state.workspaceMounts, 1, 'workspace should mount once during bootstrap');

    const bootstrapStatusCalls = state.statusCalls;
    const refreshedToken = makeToken('refreshed');

    await React.act(async () => {
      window.dispatchEvent(
        new CustomEvent(AUTH_TOKEN_REFRESHED_EVENT, { detail: refreshedToken }),
      );
    });
    await React.act(flush);

    // The regression: any of these failing means the workspace rebooted.
    assert.equal(
      state.statusCalls,
      bootstrapStatusCalls,
      'token rotation must not re-run the mount-time auth bootstrap',
    );
    assert.equal(state.workspaceUnmounts, 0, 'token rotation must not unmount the workspace');
    assert.equal(state.workspaceMounts, 1, 'token rotation must not remount the workspace');
    assert.equal(
      state.loadingScreenRenders,
      0,
      'token rotation must not return ProtectedRoute to its loading state',
    );

    // ...and the reason token adoption exists in the first place must survive:
    // WebSocketContext builds reconnect URLs from this value.
    assert.equal(state.currentToken, refreshedToken, 'refreshed token must still be adopted');
  });

  test('ignores a malformed refreshed token without disturbing the workspace', async () => {
    localStorage.setItem(AUTH_TOKEN_STORAGE_KEY, makeToken('initial'));

    const state = await renderWorkspace();
    const adoptedToken = state.currentToken;

    await React.act(async () => {
      window.dispatchEvent(
        new CustomEvent(AUTH_TOKEN_REFRESHED_EVENT, { detail: 'not-a-jwt' }),
      );
    });
    await React.act(flush);

    assert.equal(state.currentToken, adoptedToken);
    assert.equal(state.workspaceUnmounts, 0);
    assert.equal(state.workspaceMounts, 1);
  });
});

describe('api token expiry', () => {
  // Builds a JWT-shaped string (header.payload.signature, base64url segments) without
  // needing a real signing library — isAuthTokenExpired() never verifies the signature,
  // it only decodes the payload, so the header/signature segments are placeholders.
  const makeToken = (payload: Record<string, unknown>) => {
    const encode = (value: unknown) =>
      Buffer.from(JSON.stringify(value)).toString('base64url');
    return `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode(payload)}.signature`;
  };

  test('isAuthTokenExpired: a token well before its exp is not expired', () => {
    const now = Math.floor(Date.now() / 1000);
    const token = makeToken({ iat: now - 60, exp: now + 600 }); // 10 min from now
    assert.equal(isAuthTokenExpired(token), false);
  });

  test('isAuthTokenExpired: a token expired within the clock-skew tolerance is not treated as expired', () => {
    const now = Math.floor(Date.now() / 1000);
    const skewSeconds = TOKEN_EXPIRY_SKEW_MS / 1000;
    const token = makeToken({ iat: now - 600, exp: now - Math.floor(skewSeconds / 2) });
    assert.equal(isAuthTokenExpired(token), false);
  });

  test('isAuthTokenExpired: a token expired just past the clock-skew tolerance is expired', () => {
    const now = Math.floor(Date.now() / 1000);
    const skewSeconds = TOKEN_EXPIRY_SKEW_MS / 1000;
    const token = makeToken({ iat: now - 600, exp: now - skewSeconds - 5 });
    assert.equal(isAuthTokenExpired(token), true);
  });

  test('isAuthTokenExpired: a token expired well past the skew tolerance is expired', () => {
    const now = Math.floor(Date.now() / 1000);
    const token = makeToken({ iat: now - 600, exp: now - 600 }); // 10 min ago
    assert.equal(isAuthTokenExpired(token), true);
  });

  test('isAuthTokenExpired: a malformed/unreadable token is unaffected by the skew change', () => {
    // readTokenClaims() returns null for these, so isAuthTokenExpired() short-circuits
    // to false regardless of TOKEN_EXPIRY_SKEW_MS — behaviour unchanged by this fix.
    assert.equal(isAuthTokenExpired('not-a-jwt'), false);
    assert.equal(isAuthTokenExpired('only.two-segments'), false);
    assert.equal(isAuthTokenExpired(null), false);
  });
});
