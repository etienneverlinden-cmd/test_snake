(async function () {
  'use strict';

  if (!window.ArcadeAuthGuard?.ready) {
    window.location.replace('login.html?next=arcade.html');
    return;
  }
  const allowed = await window.ArcadeAuthGuard.ready;
  if (!allowed) return;

  const statusEl = document.getElementById('dbStatus');
  const userEl = document.getElementById('userBar');
  const signOutBtn = document.getElementById('signOutBtn');

  if (window.ArcadeDB?.convexEnabled()) {
    statusEl.textContent = 'Scores synced with Convex';
  } else {
    statusEl.textContent = 'Convex not configured — using local scores only';
  }

  const viewer = await window.ArcadeAuth?.getViewer?.();
  if (userEl && viewer) {
    const label = viewer.name || viewer.email || 'Player';
    userEl.textContent = label;
  }

  if (signOutBtn) {
    signOutBtn.addEventListener('click', async () => {
      await window.ArcadeAuth.signOut();
      window.location.href = 'index.html';
    });
  }

  async function fillBoard(game, el) {
    const rows = await window.ArcadeDB.getTopScores(game, 5);
    if (!rows.length) {
      el.innerHTML = '<li class="board-empty">No scores yet — be the first</li>';
      return;
    }
    el.innerHTML = rows
      .map(
        (r, i) =>
          `<li><span class="rank">${i + 1}</span><span class="name">${escapeHtml(
            r.playerName || 'Anonymous',
          )}</span><span class="pts">${r.score}</span></li>`,
      )
      .join('');
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  await Promise.all([
    fillBoard('snake', document.getElementById('snakeBoard')),
    fillBoard('frogger', document.getElementById('froggerBoard')),
  ]);
})();
