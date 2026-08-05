/**
 * Minimal Convex HTTP client for the Loïc site (separate deployment).
 */
(function (global) {
  'use strict';

  function convexUrl() {
    return (global.LOIC_CONVEX_URL || '').replace(/\/$/, '');
  }

  async function call(kind, path, args) {
    const url = convexUrl();
    if (!url) throw new Error('Convex non configuré (LOIC_CONVEX_URL)');
    const res = await fetch(`${url}/api/${kind}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path, args: args || {}, format: 'json' }),
    });
    const data = await res.json();
    if (!res.ok || data.status === 'error' || data.errorMessage) {
      const msg =
        data.errorMessage ||
        data.message ||
        (typeof data.error === 'string' ? data.error : null) ||
        `${kind} failed: ${path}`;
      throw new Error(msg);
    }
    if (Object.prototype.hasOwnProperty.call(data, 'value')) return data.value;
    if (data.status === 'success') return data.value;
    return data;
  }

  global.LoicConvex = {
    url: convexUrl,
    query: (path, args) => call('query', path, args),
    mutation: (path, args) => call('mutation', path, args),
    action: (path, args) => call('action', path, args),
  };
})(window);
