/**
 * Browser Convex client — same idea as pawnie's lib/convex-server.ts:
 * - talk to Convex when configured
 * - return null / fall back to localStorage when not
 *
 * Static arcade: the browser calls Convex directly (public queries/mutations).
 * Pawnie keeps a server secret because Next.js can hide it; we can't put
 * CONVEX_API_SECRET in the browser, so score functions are public + validated.
 */
(function (global) {
  'use strict';

  const STORAGE_KEYS = {
    snake: 'serpent-highscore',
    frogger: 'frogger-highscore',
    playerName: 'stijn-arcade-player',
  };

  function convexUrl() {
    return (global.STIJN_ARCADE_CONVEX_URL || '').replace(/\/$/, '');
  }

  function convexEnabled() {
    return !!convexUrl();
  }

  async function convexFetch(kind, path, args) {
    if (!convexEnabled()) return null;
    try {
      const res = await fetch(`${convexUrl()}/api/${kind}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path, args, format: 'json' }),
      });
      const data = await res.json();
      if (!res.ok || data.status === 'error' || data.errorMessage) {
        console.error('[convex]', path, data.errorMessage || data);
        return null;
      }
      // Convex HTTP may return { status: "success", value } or bare value
      if (Object.prototype.hasOwnProperty.call(data, 'value')) return data.value;
      if (data.status === 'success') return data.value;
      return data;
    } catch (err) {
      console.error('[convex] failed:', path, err.message || err);
      return null;
    }
  }

  async function tryConvexQuery(path, args) {
    return convexFetch('query', path, args);
  }

  async function tryConvexMutation(path, args) {
    return convexFetch('mutation', path, args);
  }

  function localBest(game) {
    const key = STORAGE_KEYS[game];
    if (!key) return 0;
    return parseInt(localStorage.getItem(key) || '0', 10) || 0;
  }

  function saveLocalBest(game, score) {
    const key = STORAGE_KEYS[game];
    if (!key) return;
    const prev = localBest(game);
    if (score > prev) localStorage.setItem(key, String(score));
  }

  function getPlayerName() {
    return localStorage.getItem(STORAGE_KEYS.playerName) || '';
  }

  function setPlayerName(name) {
    const cleaned = String(name || '').trim().slice(0, 24);
    if (cleaned) localStorage.setItem(STORAGE_KEYS.playerName, cleaned);
    return cleaned;
  }

  /**
   * Best score for UI: prefer Convex global best, else localStorage.
   */
  async function getBestScore(game) {
    const remote = await tryConvexQuery('scores:getBestScore', { game });
    if (remote && typeof remote.score === 'number') {
      // Keep local cache roughly in sync for offline UI
      saveLocalBest(game, remote.score);
      return remote.score;
    }
    return localBest(game);
  }

  async function getTopScores(game, limit) {
    const remote = await tryConvexQuery('scores:getTopScores', {
      game,
      limit: limit || 10,
    });
    if (Array.isArray(remote)) return remote;
    const local = localBest(game);
    return local > 0
      ? [{ score: local, playerName: getPlayerName() || 'You', createdAt: Date.now() }]
      : [];
  }

  /**
   * Persist a run. Always updates local best; pushes to Convex when enabled.
   */
  async function submitScore(game, score, playerName) {
    const name = setPlayerName(playerName || getPlayerName() || 'Anonymous');
    saveLocalBest(game, score);
    const remote = await tryConvexMutation('scores:submitScore', {
      game,
      playerName: name,
      score,
    });
    return {
      ok: true,
      savedRemote: remote !== null,
      playerName: name,
      score,
      remote,
    };
  }

  global.ArcadeDB = {
    convexEnabled,
    getPlayerName,
    setPlayerName,
    getBestScore,
    getTopScores,
    submitScore,
    localBest,
  };
})(typeof window !== 'undefined' ? window : globalThis);
