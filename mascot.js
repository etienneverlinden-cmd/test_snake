(() => {
  'use strict';

  const quoteEl = document.getElementById('mascotQuote');
  if (!quoteEl) return;

  const quotes = [
    'Ssssssup? Ready to slither?',
    'I believe in you! 🍎',
    'Fruit is my love language.',
    'No wall can stop us. Actually…',
    'My legs are purely decorative.',
    'Hat stays on during game over.',
    'One more apple? Yes please!',
    'I am speed. I am grace.',
    'Do NOT look at my tail.',
    'Professional snake. Amateur dancer.',
  ];

  let index = 0;

  function cycleQuote() {
    index = (index + 1) % quotes.length;
    quoteEl.textContent = quotes[index];
    quoteEl.closest('.speech-bubble').style.animation = 'none';
    quoteEl.offsetHeight;
    quoteEl.closest('.speech-bubble').style.animation = '';
  }

  setInterval(cycleQuote, 4000);

  window.addEventListener('serpent:gameStart', () => {
    quoteEl.textContent = 'Go go go! Eat everything! 🍊';
  });

  window.addEventListener('serpent:gameOver', (e) => {
    const score = e.detail?.score ?? 0;
    if (score >= 50) {
      quoteEl.textContent = 'Legendary slither! I\'m impressed.';
    } else if (score >= 20) {
      quoteEl.textContent = 'Not bad! My hat is proud.';
    } else {
      quoteEl.textContent = 'Ouch! Even my legs felt that.';
    }
  });

  window.addEventListener('serpent:score', (e) => {
    const score = e.detail?.score ?? 0;
    if (score > 0 && score % 30 === 0) {
      quoteEl.textContent = `${score} points?! You're on fire! 🔥`;
    }
  });
})();
