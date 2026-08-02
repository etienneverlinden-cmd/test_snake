/**
 * Vanilla Convex Auth client for the static arcade.
 * Mirrors @convex-dev/auth/react token + signIn/signOut protocol over HTTP.
 */
(function (global) {
  'use strict';

  const JWT_KEY = '__convexAuthJWT';
  const REFRESH_KEY = '__convexAuthRefreshToken';
  const VERIFIER_KEY = '__convexAuthOAuthVerifier';

  function convexUrl() {
    return (global.STIJN_ARCADE_CONVEX_URL || '').replace(/\/$/, '');
  }

  function ns() {
    return convexUrl().replace(/[^a-zA-Z0-9]/g, '') || 'default';
  }

  function sk(key) {
    return `${key}_${ns()}`;
  }

  function storageGet(key) {
    try {
      return localStorage.getItem(sk(key));
    } catch {
      return null;
    }
  }

  function storageSet(key, value) {
    try {
      localStorage.setItem(sk(key), value);
    } catch {
      /* ignore */
    }
  }

  function storageRemove(key) {
    try {
      localStorage.removeItem(sk(key));
    } catch {
      /* ignore */
    }
  }

  let accessToken = storageGet(JWT_KEY);
  let readyPromise = null;
  const listeners = new Set();

  function notify() {
    for (const fn of listeners) {
      try {
        fn(!!accessToken);
      } catch {
        /* ignore */
      }
    }
  }

  function setTokens(tokens) {
    if (!tokens) {
      accessToken = null;
      storageRemove(JWT_KEY);
      storageRemove(REFRESH_KEY);
    } else {
      accessToken = tokens.token;
      storageSet(JWT_KEY, tokens.token);
      if (tokens.refreshToken) storageSet(REFRESH_KEY, tokens.refreshToken);
    }
    notify();
  }

  async function callAction(path, args, withAuth) {
    const url = convexUrl();
    if (!url) throw new Error('Convex URL not configured');
    const headers = { 'Content-Type': 'application/json' };
    if (withAuth && accessToken) {
      headers.Authorization = `Bearer ${accessToken}`;
    }
    const res = await fetch(`${url}/api/action`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ path, args, format: 'json' }),
    });
    const data = await res.json();
    if (!res.ok || data.status === 'error' || data.errorMessage) {
      const msg =
        data.errorMessage ||
        data.message ||
        (typeof data.error === 'string' ? data.error : null) ||
        'Auth request failed';
      throw new Error(msg);
    }
    if (Object.prototype.hasOwnProperty.call(data, 'value')) return data.value;
    if (data.status === 'success') return data.value;
    return data;
  }

  async function callQuery(path, args) {
    const url = convexUrl();
    if (!url) return null;
    const headers = { 'Content-Type': 'application/json' };
    if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
    const res = await fetch(`${url}/api/query`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ path, args, format: 'json' }),
    });
    const data = await res.json();
    if (!res.ok || data.status === 'error' || data.errorMessage) return null;
    if (Object.prototype.hasOwnProperty.call(data, 'value')) return data.value;
    if (data.status === 'success') return data.value;
    return data;
  }

  async function callMutation(path, args) {
    const url = convexUrl();
    if (!url) throw new Error('Convex URL not configured');
    const headers = { 'Content-Type': 'application/json' };
    if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
    const res = await fetch(`${url}/api/mutation`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ path, args, format: 'json' }),
    });
    const data = await res.json();
    if (!res.ok || data.status === 'error' || data.errorMessage) {
      const msg =
        data.errorMessage ||
        data.message ||
        (typeof data.error === 'string' ? data.error : null) ||
        `Mutation failed: ${path}`;
      console.error('[convex]', path, msg);
      throw new Error(msg);
    }
    if (Object.prototype.hasOwnProperty.call(data, 'value')) return data.value;
    if (data.status === 'success') return data.value;
    return data;
  }

  async function refreshAccessToken() {
    const refreshToken = storageGet(REFRESH_KEY);
    if (!refreshToken) {
      setTokens(null);
      return null;
    }
    try {
      const result = await callAction(
        'auth:signIn',
        { refreshToken },
        false,
      );
      const tokens = result?.tokens ?? null;
      setTokens(tokens);
      return accessToken;
    } catch (err) {
      console.warn('[auth] refresh failed', err);
      setTokens(null);
      return null;
    }
  }

  async function handleOAuthCodeFromUrl() {
    const params = new URLSearchParams(window.location.search);
    const code = params.get('code');
    if (!code) return false;
    const verifier = storageGet(VERIFIER_KEY) || undefined;
    storageRemove(VERIFIER_KEY);
    const url = new URL(window.location.href);
    url.searchParams.delete('code');
    window.history.replaceState({}, '', url.pathname + url.search + url.hash);
    const result = await callAction(
      'auth:signIn',
      { params: { code }, verifier },
      false,
    );
    setTokens(result?.tokens ?? null);
    return !!accessToken;
  }

  async function init() {
    if (readyPromise) return readyPromise;
    readyPromise = (async () => {
      if (!convexUrl()) return false;
      try {
        if (new URLSearchParams(window.location.search).get('code')) {
          await handleOAuthCodeFromUrl();
        } else if (accessToken) {
          // Keep stored token; refresh later if a call fails.
        } else if (storageGet(REFRESH_KEY)) {
          await refreshAccessToken();
        }
      } catch (err) {
        console.warn('[auth] init', err);
        setTokens(null);
      }
      return !!accessToken;
    })();
    return readyPromise;
  }

  /**
   * @param {string} provider e.g. "password" | "google"
   * @param {Record<string, string>|FormData} [params]
   * @returns {Promise<{ signingIn: boolean, needsVerification?: boolean, redirect?: string }>}
   */
  async function signIn(provider, params) {
    const plain =
      params instanceof FormData
        ? Object.fromEntries(
            Array.from(params.entries()).map(([k, v]) => [k, String(v)]),
          )
        : params || {};

    const verifier = storageGet(VERIFIER_KEY) || undefined;
    storageRemove(VERIFIER_KEY);

    const result = await callAction(
      'auth:signIn',
      { provider, params: plain, verifier },
      !!accessToken,
    );

    if (result?.redirect) {
      if (result.verifier) storageSet(VERIFIER_KEY, result.verifier);
      window.location.href = String(result.redirect);
      return { signingIn: false, redirect: String(result.redirect) };
    }

    if (result?.tokens !== undefined) {
      setTokens(result.tokens);
      return { signingIn: result.tokens !== null };
    }

    // Email verification step (Password + verify): no tokens yet
    return { signingIn: false, needsVerification: true };
  }

  async function signOut() {
    try {
      await callAction('auth:signOut', {}, true);
    } catch {
      /* already signed out is fine */
    }
    setTokens(null);
  }

  function isAuthenticated() {
    return !!accessToken;
  }

  function getToken() {
    return accessToken;
  }

  async function getViewer() {
    if (!accessToken) return null;
    let viewer = await callQuery('users:viewer', {});
    if (!viewer && storageGet(REFRESH_KEY)) {
      await refreshAccessToken();
      if (accessToken) viewer = await callQuery('users:viewer', {});
    }
    return viewer;
  }

  function onAuthChange(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  }

  global.ArcadeAuth = {
    init,
    signIn,
    signOut,
    isAuthenticated,
    getToken,
    getViewer,
    onAuthChange,
    callQuery,
    callMutation,
    refreshAccessToken,
  };
})(typeof window !== 'undefined' ? window : globalThis);
