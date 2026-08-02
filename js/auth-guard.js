/**
 * Redirect unauthenticated / unapproved visitors.
 * Include on every protected page after convex-config.js + auth.js.
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

  async function guard() {
    if (!window.ArcadeAuth) {
      go(loginPath);
      return;
    }
    await window.ArcadeAuth.init();
    if (!window.ArcadeAuth.isAuthenticated()) {
      go(`${loginPath}?next=${encodeURIComponent(here)}`);
      return;
    }

    // Already on an access status page — still refresh membership record.
    let status = null;
    try {
      const result = await window.ArcadeAuth.callMutation(
        'access:ensureAndGet',
        {},
      );
      status = result && result.status;
    } catch (err) {
      console.error('[access]', err);
      go(`${loginPath}?next=${encodeURIComponent(here)}`);
      return;
    }

    if (status === 'approved') {
      if (accessPages.has(here)) {
        go('arcade.html');
      }
      return;
    }
    if (status === 'pending') {
      if (here !== 'access-pending.html') go('access-pending.html');
      return;
    }
    if (status === 'denied') {
      if (here !== 'access-denied.html') go('access-denied.html');
      return;
    }
    if (status === 'unauthorized') {
      if (here !== 'access-blocked.html') go('access-blocked.html');
      return;
    }

    // Unknown — treat as pending gate
    if (here !== 'access-pending.html') go('access-pending.html');
  }

  window.ArcadeAuthGuard = { ready: guard() };
})();
