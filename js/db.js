/**
 * Browser Convex client — auth-aware (Bearer token via ArcadeAuth).
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

  async function tryConvexQuery(path, args) {
    if (!convexEnabled() || !global.ArcadeAuth) return null;
    return global.ArcadeAuth.callQuery(path, args);
  }

  async function tryConvexMutation(path, args) {
    if (!convexEnabled() || !global.ArcadeAuth) return null;
    return global.ArcadeAuth.callMutation(path, args);
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

  async function getBestScore(game) {
    const remote = await tryConvexQuery('scores:getBestScore', { game });
    if (remote && typeof remote.score === 'number') {
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

  async function submitScore(game, score, playerName) {
    const name = setPlayerName(playerName || getPlayerName() || 'Player');
    saveLocalBest(game, score);
    const remote = await tryConvexMutation('scores:submitScore', {
      game,
      playerName: name,
      score,
    });
    return {
      ok: true,
      savedRemote: remote !== null,
      playerName: remote?.playerName || name,
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
