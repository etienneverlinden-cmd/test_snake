/**
 * Redirect unauthenticated visitors to login.html.
 * Include on every protected page after convex-config.js + auth.js.
 */
(function () {
  'use strict';

  const loginPath = 'login.html';
  const here = window.location.pathname.split('/').pop() || 'arcade.html';

  async function guard() {
    if (!window.ArcadeAuth) {
      window.location.replace(loginPath);
      return;
    }
    await window.ArcadeAuth.init();
    if (!window.ArcadeAuth.isAuthenticated()) {
      const next = encodeURIComponent(here);
      window.location.replace(`${loginPath}?next=${next}`);
    }
  }

  window.ArcadeAuthGuard = { ready: guard() };
})();
