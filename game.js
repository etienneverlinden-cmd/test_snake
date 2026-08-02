(async () => {
  'use strict';

  if (!window.ArcadeAuthGuard?.ready) {
    window.location.replace('login.html?next=snake.html');
    return;
  }
  const allowed = await window.ArcadeAuthGuard.ready;
  if (!allowed) return;

  const GRID_SIZE = 20;
  const CELL = 20;
  const SPEED_INCREMENT = 2;
  const MIN_SPEED = 50;

  const SPEED_PRESETS = {
    1: { label: 'Very Slow', ms: 200 },
    2: { label: 'Slow', ms: 160 },
    3: { label: 'Normal', ms: 120 },
    4: { label: 'Fast', ms: 90 },
    5: { label: 'Blazing', ms: 60 },
  };

  const canvas = document.getElementById('gameCanvas');
  const ctx = canvas.getContext('2d');
  const scoreEl = document.getElementById('score');
  const highScoreEl = document.getElementById('highScore');
  const finalScoreEl = document.getElementById('finalScore');
  const startOverlay = document.getElementById('startOverlay');
  const pauseOverlay = document.getElementById('pauseOverlay');
  const gameOverOverlay = document.getElementById('gameOverOverlay');
  const newRecordEl = document.getElementById('newRecord');
  const startBtn = document.getElementById('startBtn');
  const resumeBtn = document.getElementById('resumeBtn');
  const restartBtn = document.getElementById('restartBtn');
  const mobileControls = document.getElementById('mobileControls');
  const speedSlider = document.getElementById('speedSlider');
  const speedValueEl = document.getElementById('speedValue');
  const speedControl = document.querySelector('.speed-control');

  const headImage = new Image();
  headImage.src = 'assets/snake-head.png';

  let snake, direction, nextDirection, food, score, highScore;
  let gameLoop, speed, baseSpeed, state;
  let touchStartX, touchStartY;
  let headImageReady = false;

  headImage.onload = () => {
    headImageReady = true;
    draw();
  };

  const DIRECTIONS = {
    up:    { x: 0, y: -1 },
    down:  { x: 0, y: 1 },
    left:  { x: -1, y: 0 },
    right: { x: 1, y: 0 },
  };

  const OPPOSITE = {
    up: 'down', down: 'up', left: 'right', right: 'left',
  };

  function loadHighScore() {
    if (window.ArcadeDB) return window.ArcadeDB.localBest('snake');
    return parseInt(localStorage.getItem('serpent-highscore') || '0', 10);
  }

  function saveHighScore(value) {
    if (window.ArcadeDB) {
      // local cache is updated inside submitScore / getBestScore
      return;
    }
    localStorage.setItem('serpent-highscore', String(value));
  }

  async function refreshHighScore() {
    if (window.ArcadeDB) {
      highScore = await window.ArcadeDB.getBestScore('snake');
    } else {
      highScore = loadHighScore();
    }
    highScoreEl.textContent = highScore;
  }

  function getSelectedSpeed() {
    const preset = SPEED_PRESETS[speedSlider.value];
    return preset ? preset.ms : SPEED_PRESETS[3].ms;
  }

  function updateSpeedLabel() {
    const preset = SPEED_PRESETS[speedSlider.value];
    speedValueEl.textContent = preset ? preset.label : 'Normal';
  }

  function setSpeedControlEnabled(enabled) {
    speedControl.classList.toggle('speed-control--disabled', !enabled);
    speedSlider.disabled = !enabled;
  }

  function init() {
    highScore = loadHighScore();
    highScoreEl.textContent = highScore;
    state = 'idle';
    setSpeedControlEnabled(true);
    showOverlay(startOverlay);
    hideOverlay(pauseOverlay);
    hideOverlay(gameOverOverlay);
    refreshHighScore();
    const nameInput = document.getElementById('playerName');
    const startName = document.getElementById('playerNameStart');
    if (window.ArcadeDB) {
      const saved = window.ArcadeDB.getPlayerName();
      if (nameInput) nameInput.value = saved;
      if (startName) startName.value = saved;
    }
  }

  function resetGame() {
    const mid = Math.floor(GRID_SIZE / 2);
    snake = [
      { x: mid, y: mid },
      { x: mid - 1, y: mid },
      { x: mid - 2, y: mid },
    ];
    direction = 'right';
    nextDirection = 'right';
    score = 0;
    baseSpeed = getSelectedSpeed();
    speed = baseSpeed;
    scoreEl.textContent = '0';
    spawnFood();
  }

  function spawnFood() {
    const occupied = new Set(snake.map(s => `${s.x},${s.y}`));
    let pos;
    do {
      pos = {
        x: Math.floor(Math.random() * GRID_SIZE),
        y: Math.floor(Math.random() * GRID_SIZE),
      };
    } while (occupied.has(`${pos.x},${pos.y}`));
    food = pos;
  }

  function setDirection(dir) {
    if (state !== 'playing') return;
    if (dir === OPPOSITE[direction]) return;
    nextDirection = dir;
  }

  function startGame() {
    const startName = document.getElementById('playerNameStart');
    if (window.ArcadeDB && startName) {
      window.ArcadeDB.setPlayerName(startName.value || 'Anonymous');
    }
    resetGame();
    state = 'playing';
    setSpeedControlEnabled(false);
    hideOverlay(startOverlay);
    hideOverlay(gameOverOverlay);
    clearInterval(gameLoop);
    gameLoop = setInterval(tick, speed);
    draw();
    window.dispatchEvent(new CustomEvent('serpent:gameStart'));
  }

  function pauseGame() {
    if (state !== 'playing') return;
    state = 'paused';
    clearInterval(gameLoop);
    showOverlay(pauseOverlay);
  }

  function resumeGame() {
    if (state !== 'paused') return;
    state = 'playing';
    hideOverlay(pauseOverlay);
    gameLoop = setInterval(tick, speed);
  }

  function gameOver() {
    state = 'gameover';
    clearInterval(gameLoop);
    setSpeedControlEnabled(true);
    finalScoreEl.textContent = score;

    const nameInput = document.getElementById('playerName');
    const startName = document.getElementById('playerNameStart');
    const playerName =
      nameInput?.value ||
      startName?.value ||
      (window.ArcadeDB && window.ArcadeDB.getPlayerName()) ||
      'Anonymous';

    const finish = (best) => {
      const isNewRecord = score > 0 && score >= best && score >= highScore;
      if (score > highScore) {
        highScore = score;
        highScoreEl.textContent = highScore;
      }
      if (isNewRecord || score > best) {
        newRecordEl.classList.remove('overlay--hidden');
      } else {
        newRecordEl.classList.add('overlay--hidden');
      }
      showOverlay(gameOverOverlay);
      window.dispatchEvent(new CustomEvent('serpent:gameOver', { detail: { score } }));
    };

    if (window.ArcadeDB) {
      window.ArcadeDB.submitScore('snake', score, playerName).then(async () => {
        const best = await window.ArcadeDB.getBestScore('snake');
        highScore = best;
        highScoreEl.textContent = highScore;
        finish(best);
      });
    } else {
      const isNewRecord = score > highScore;
      if (isNewRecord) {
        highScore = score;
        saveHighScore(highScore);
        highScoreEl.textContent = highScore;
        newRecordEl.classList.remove('overlay--hidden');
      } else {
        newRecordEl.classList.add('overlay--hidden');
      }
      showOverlay(gameOverOverlay);
      window.dispatchEvent(new CustomEvent('serpent:gameOver', { detail: { score } }));
    }
  }

  function tick() {
    direction = nextDirection;
    const head = snake[0];
    const dir = DIRECTIONS[direction];
    const newHead = { x: head.x + dir.x, y: head.y + dir.y };

    if (
      newHead.x < 0 || newHead.x >= GRID_SIZE ||
      newHead.y < 0 || newHead.y >= GRID_SIZE
    ) {
      gameOver();
      return;
    }

    if (snake.some(s => s.x === newHead.x && s.y === newHead.y)) {
      gameOver();
      return;
    }

    snake.unshift(newHead);

    if (newHead.x === food.x && newHead.y === food.y) {
      score += 10;
      scoreEl.textContent = score;
      spawnFood();
      increaseSpeed();
      window.dispatchEvent(new CustomEvent('serpent:score', { detail: { score } }));
    } else {
      snake.pop();
    }

    draw();
  }

  function increaseSpeed() {
    speed = Math.max(MIN_SPEED, speed - SPEED_INCREMENT);
    clearInterval(gameLoop);
    if (state === 'playing') {
      gameLoop = setInterval(tick, speed);
    }
  }

  function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    drawGrid();
    drawFood();
    drawSnake();
  }

  function drawGrid() {
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.03)';
    ctx.lineWidth = 0.5;
    for (let i = 0; i <= GRID_SIZE; i++) {
      ctx.beginPath();
      ctx.moveTo(i * CELL, 0);
      ctx.lineTo(i * CELL, canvas.height);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, i * CELL);
      ctx.lineTo(canvas.width, i * CELL);
      ctx.stroke();
    }
  }

  function drawSnake() {
    snake.forEach((segment, i) => {
      const x = segment.x * CELL;
      const y = segment.y * CELL;

      if (i === 0) {
        drawSnakeHead(x, y);
        return;
      }

      const padding = 2;
      const size = CELL - padding * 2;
      const alpha = 1 - (i / snake.length) * 0.5;
      const gradient = ctx.createLinearGradient(x, y, x + CELL, y + CELL);
      gradient.addColorStop(0, `rgba(0, 229, 160, ${alpha})`);
      gradient.addColorStop(1, `rgba(0, 196, 140, ${alpha * 0.8})`);

      ctx.fillStyle = gradient;
      roundRect(ctx, x + padding, y + padding, size, size, 4);
      ctx.fill();
    });
  }

  function drawSnakeHead(x, y) {
    const cx = x + CELL / 2;
    const cy = y + CELL / 2;
    const radius = CELL / 2 - 1;

    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.closePath();
    ctx.clip();

    if (headImageReady) {
      ctx.drawImage(headImage, cx - radius, cy - radius, radius * 2, radius * 2);
    } else {
      ctx.fillStyle = '#00e5a0';
      ctx.fill();
    }

    ctx.restore();

    ctx.strokeStyle = 'rgba(0, 229, 160, 0.8)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.stroke();
  }

  function drawFood() {
    const x = food.x * CELL;
    const y = food.y * CELL;
    const cx = x + CELL / 2;
    const cy = y + CELL / 2;
    const pulse = 0.85 + Math.sin(Date.now() / 200) * 0.15;
    const r = (CELL / 2 - 3) * pulse;

    const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
    gradient.addColorStop(0, '#ff8c5a');
    gradient.addColorStop(0.7, '#ff6b35');
    gradient.addColorStop(1, '#e04e1a');

    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = 'rgba(255, 200, 100, 0.6)';
    ctx.beginPath();
    ctx.arc(cx - 2, cy - 2, r * 0.25, 0, Math.PI * 2);
    ctx.fill();
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }

  function showOverlay(el) {
    el.classList.remove('overlay--hidden');
  }

  function hideOverlay(el) {
    el.classList.add('overlay--hidden');
  }

  function handleKey(e) {
    const keyMap = {
      ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
      w: 'up', s: 'down', a: 'left', d: 'right',
      W: 'up', S: 'down', A: 'left', D: 'right',
    };

    if (e.key === ' ' || e.code === 'Space') {
      e.preventDefault();
      if (state === 'playing') pauseGame();
      else if (state === 'paused') resumeGame();
      return;
    }

    if (keyMap[e.key]) {
      e.preventDefault();
      if (state === 'idle' || state === 'gameover') {
        startGame();
        setDirection(keyMap[e.key]);
      } else {
        setDirection(keyMap[e.key]);
      }
    }
  }

  function handleTouchStart(e) {
    touchStartX = e.touches[0].clientX;
    touchStartY = e.touches[0].clientY;
  }

  function handleTouchEnd(e) {
    if (state !== 'playing') return;
    const dx = e.changedTouches[0].clientX - touchStartX;
    const dy = e.changedTouches[0].clientY - touchStartY;
    const absDx = Math.abs(dx);
    const absDy = Math.abs(dy);
    if (Math.max(absDx, absDy) < 30) return;

    if (absDx > absDy) {
      setDirection(dx > 0 ? 'right' : 'left');
    } else {
      setDirection(dy > 0 ? 'down' : 'up');
    }
  }

  function animateFood() {
    if (state === 'playing' || state === 'idle') {
      draw();
    }
    requestAnimationFrame(animateFood);
  }

  speedSlider.addEventListener('input', updateSpeedLabel);

  startBtn.addEventListener('click', startGame);
  resumeBtn.addEventListener('click', resumeGame);
  restartBtn.addEventListener('click', startGame);

  mobileControls.querySelectorAll('.d-pad-btn').forEach(btn => {
    btn.addEventListener('click', () => setDirection(btn.dataset.dir));
  });

  canvas.addEventListener('touchstart', handleTouchStart, { passive: true });
  canvas.addEventListener('touchend', handleTouchEnd, { passive: true });
  document.addEventListener('keydown', handleKey);

  init();
  updateSpeedLabel();
  resetGame();
  draw();
  requestAnimationFrame(animateFood);
})();
