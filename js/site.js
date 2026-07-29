(async function () {
  'use strict';

  const links = [
    document.getElementById('myPragmatictLink'),
    document.getElementById('myPragmatictCta'),
  ].filter(Boolean);

  if (!window.ArcadeAuth || !links.length) return;

  await window.ArcadeAuth.init();
  if (window.ArcadeAuth.isAuthenticated()) {
    for (const el of links) {
      el.href = 'arcade.html';
    }
  }
})();
