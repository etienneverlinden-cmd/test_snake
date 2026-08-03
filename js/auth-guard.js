/**
 * Redirect unauthenticated / unapproved visitors.
 * Include on every protected page after convex-config.js + auth.js.
 * Hides the page until membership is confirmed approved (no fail-open flash).
 */
(function () {
  'use strict';

  const loginPath = 'login.html';
  const here = window.location.pathname.split('/').pop() || 'arcade.html';
  const accessPages = new Set([
    'access-pending.html',
    'access-denied.html',
    'access-blocked.html',
  ]);

  function go(path) {
    window.location.replace(path);
  }

  function ensureGateStyle() {
    if (document.getElementById('access-gate-style')) return;
    const style = document.createElement('style');
    style.id = 'access-gate-style';
    // Keep a white canvas while hiding protected UI (visibility:hidden alone
    // can flash the browser's default dark page background).
    style.textContent =
      'html.access-checking,html.access-checking body{background:#ffffff!important}' +
      'html.access-checking body{visibility:hidden!important;pointer-events:none!important}';
    document.head.appendChild(style);
  }

  function hideUntilResolved() {
    ensureGateStyle();
    document.documentElement.classList.add('access-checking');
  }

  function reveal() {
    document.documentElement.classList.remove('access-checking');
  }

  async function guard() {
    // Hide protected UI immediately so content cannot be used before the gate.
    if (!accessPages.has(here)) {
      hideUntilResolved();
    }

    if (!window.ArcadeAuth) {
      go(loginPath);
      return false;
    }
    await window.ArcadeAuth.init();
    if (!window.ArcadeAuth.isAuthenticated()) {
      go(`${loginPath}?next=${encodeURIComponent(here)}`);
      return false;
    }

    let status = null;
    try {
      let result = await window.ArcadeAuth.callMutation(
        'access:ensureAndGet',
        {},
      );
      status = result && result.status;
    } catch (err) {
      // First call can fail right after sign-in (stale JWT). Refresh once, then
      // retry — do not bounce to login while a session may still be valid.
      console.warn('[access] ensureAndGet failed, refreshing token', err);
      try {
        await window.ArcadeAuth.refreshAccessToken();
        if (!window.ArcadeAuth.isAuthenticated()) {
          reveal();
          go(`${loginPath}?next=${encodeURIComponent(here)}`);
          return false;
        }
        const result = await window.ArcadeAuth.callMutation(
          'access:ensureAndGet',
          {},
        );
        status = result && result.status;
      } catch (err2) {
        console.error('[access]', err2);
        reveal();
        go(`${loginPath}?next=${encodeURIComponent(here)}`);
        return false;
      }
    }

    if (status === 'approved') {
      reveal();
      if (accessPages.has(here)) {
        go('arcade.html');
      }
      return true;
    }
    if (status === 'pending') {
      reveal();
      if (here !== 'access-pending.html') go('access-pending.html');
      return false;
    }
    if (status === 'denied') {
      reveal();
      if (here !== 'access-denied.html') go('access-denied.html');
      return false;
    }
    if (status === 'unauthorized') {
      reveal();
      if (here !== 'access-blocked.html') go('access-blocked.html');
      return false;
    }

    // Unknown / missing status — fail closed to pending gate
    reveal();
    if (here !== 'access-pending.html') go('access-pending.html');
    return false;
  }

  window.ArcadeAuthGuard = { ready: guard() };
})();
