(() => {
  'use strict';

  const COLS = 12;
  const ROWS = 14;
  const CELL = 40;
  const START_LIVES = 3;
  const ROUND_TIME = 40;

  const canvas = document.getElementById('gameCanvas');
  const ctx = canvas.getContext('2d');
  const scoreEl = document.getElementById('score');
  const livesEl = document.getElementById('lives');
  const highScoreEl = document.getElementById('highScore');
  const timeEl = document.getElementById('timeLeft');
  const startOverlay = document.getElementById('startOverlay');
  const pauseOverlay = document.getElementById('pauseOverlay');
  const gameOverOverlay = document.getElementById('gameOverOverlay');
  const newRecordEl = document.getElementById('newRecord');
  const finalScoreEl = document.getElementById('finalScore');
  const endTitle = document.getElementById('endTitle');
  const startBtn = document.getElementById('startBtn');
  const resumeBtn = document.getElementById('resumeBtn');
  const restartBtn = document.getElementById('restartBtn');
  const mobileControls = document.getElementById('mobileControls');

  const headImg = new Image();
  headImg.src = 'assets/snake-head.png';
  let headReady = false;
  headImg.onload = () => { headReady = true; };

  let state = 'idle';
  let score = 0;
  let lives = START_LIVES;
  let highScore = loadHigh();
  let timeLeft = ROUND_TIME;
  let frog;
  let farthestRow;
  let homes;
  let vehicles = [];
  let logs = [];
  let lastTs = 0;
  let timeAcc = 0;
  let hopCooldown = 0;
  let invuln = 0;

  highScoreEl.textContent = highScore;

  // Row types from top (0) to bottom (13)
  // 0: home bank, 1-5: river, 6: mid grass, 7-10: road, 11-12: shoulder/start grass, 13: start
  const HOME_ROW = 0;
  const RIVER_ROWS = [1, 2, 3, 4, 5];
  const ROAD_ROWS = [7, 8, 9, 10];

  function loadHigh() {
    if (window.ArcadeDB) return window.ArcadeDB.localBest('frogger');
    return parseInt(localStorage.getItem('frogger-highscore') || '0', 10);
  }

  function saveHigh(v) {
    if (window.ArcadeDB) return;
    localStorage.setItem('frogger-highscore', String(v));
  }

  async function refreshHighScore() {
    if (window.ArcadeDB) {
      highScore = await window.ArcadeDB.getBestScore('frogger');
    } else {
      highScore = loadHigh();
    }
    highScoreEl.textContent = highScore;
  }

  function show(el) { el.classList.remove('overlay--hidden'); }
  function hide(el) { el.classList.add('overlay--hidden'); }

  function resetFrog() {
    frog = {
      col: Math.floor(COLS / 2),
      row: ROWS - 1,
      x: Math.floor(COLS / 2) * CELL,
      y: (ROWS - 1) * CELL,
      onLog: null,
    };
    farthestRow = frog.row;
    timeLeft = ROUND_TIME;
    timeEl.textContent = timeLeft;
    timeAcc = 0;
    invuln = 0.6;
  }

  function buildTraffic(level) {
    const speedBoost = 1 + (level - 1) * 0.15;
    vehicles = [];
    logs = [];

    const roadSpecs = [
      { row: 7, dir: 1, speed: 55 * speedBoost, w: 2, gap: 3, color: '#e74c3c', count: 3 },
      { row: 8, dir: -1, speed: 70 * speedBoost, w: 1.4, gap: 2.5, color: '#f1c40f', count: 4 },
      { row: 9, dir: 1, speed: 48 * speedBoost, w: 2.5, gap: 3.5, color: '#3498db', count: 3 },
      { row: 10, dir: -1, speed: 90 * speedBoost, w: 1.2, gap: 2.2, color: '#9b59b6', count: 4 },
    ];

    roadSpecs.forEach((spec) => {
      const period = (spec.w + spec.gap) * CELL;
      for (let i = 0; i < spec.count; i++) {
        vehicles.push({
          row: spec.row,
          x: i * period + (spec.dir < 0 ? COLS * CELL * 0.3 : 0),
          w: spec.w * CELL,
          h: CELL * 0.7,
          speed: spec.speed * spec.dir,
          color: spec.color,
        });
      }
    });

    const logSpecs = [
      { row: 1, dir: 1, speed: 40 * speedBoost, w: 3, gap: 3, count: 3 },
      { row: 2, dir: -1, speed: 55 * speedBoost, w: 2, gap: 2.5, count: 4 },
      { row: 3, dir: 1, speed: 35 * speedBoost, w: 3.5, gap: 2.8, count: 3 },
      { row: 4, dir: -1, speed: 48 * speedBoost, w: 2.2, gap: 2.4, count: 4 },
      { row: 5, dir: 1, speed: 42 * speedBoost, w: 2.8, gap: 3, count: 3 },
    ];

    logSpecs.forEach((spec) => {
      const period = (spec.w + spec.gap) * CELL;
      for (let i = 0; i < spec.count; i++) {
        logs.push({
          row: spec.row,
          x: i * period,
          w: spec.w * CELL,
          h: CELL * 0.75,
          speed: spec.speed * spec.dir,
        });
      }
    });
  }

  function levelNumber() {
    return homes.filter(Boolean).length + 1;
  }

  function startGame() {
    const startName = document.getElementById('playerNameStart');
    if (window.ArcadeDB && startName) {
      window.ArcadeDB.setPlayerName(startName.value || 'Anonymous');
    }
    score = 0;
    lives = START_LIVES;
    homes = [false, false, false, false, false];
    scoreEl.textContent = '0';
    livesEl.textContent = lives;
    buildTraffic(1);
    resetFrog();
    state = 'playing';
    hide(startOverlay);
    hide(gameOverOverlay);
    lastTs = performance.now();
    requestAnimationFrame(loop);
  }

  function pauseGame() {
    if (state !== 'playing') return;
    state = 'paused';
    show(pauseOverlay);
  }

  function resumeGame() {
    if (state !== 'paused') return;
    state = 'playing';
    hide(pauseOverlay);
    lastTs = performance.now();
    requestAnimationFrame(loop);
  }

  function endGame(won) {
    state = 'gameover';
    endTitle.textContent = won ? 'You made it!' : 'Game Over';
    finalScoreEl.textContent = score;

    const nameInput = document.getElementById('playerName');
    const startName = document.getElementById('playerNameStart');
    const playerName =
      nameInput?.value ||
      startName?.value ||
      (window.ArcadeDB && window.ArcadeDB.getPlayerName()) ||
      'Anonymous';

    const applyResult = (best) => {
      if (score > highScore) {
        highScore = score;
        highScoreEl.textContent = highScore;
      }
      if (score > 0 && score >= best) {
        newRecordEl.classList.remove('overlay--hidden');
      } else {
        newRecordEl.classList.add('overlay--hidden');
      }
      show(gameOverOverlay);
    };

    if (window.ArcadeDB) {
      window.ArcadeDB.submitScore('frogger', score, playerName).then(async () => {
        const best = await window.ArcadeDB.getBestScore('frogger');
        highScore = best;
        highScoreEl.textContent = highScore;
        applyResult(best);
      });
    } else {
      if (score > highScore) {
        highScore = score;
        saveHigh(highScore);
        highScoreEl.textContent = highScore;
        newRecordEl.classList.remove('overlay--hidden');
      } else {
        newRecordEl.classList.add('overlay--hidden');
      }
      show(gameOverOverlay);
    }
  }

  function loseLife() {
    lives -= 1;
    livesEl.textContent = lives;
    if (lives <= 0) {
      endGame(false);
      return;
    }
    resetFrog();
  }

  function tryHop(dx, dy) {
    if (state !== 'playing' || hopCooldown > 0 || invuln > 0) return;

    const nextCol = frog.col + dx;
    const nextRow = frog.row + dy;
    if (nextCol < 0 || nextCol >= COLS || nextRow < 0 || nextRow >= ROWS) return;

    frog.col = nextCol;
    frog.row = nextRow;
    frog.x = frog.col * CELL;
    frog.y = frog.row * CELL;
    frog.onLog = null;
    hopCooldown = 0.12;

    if (frog.row < farthestRow) {
      const gained = (farthestRow - frog.row) * 10;
      score += gained;
      farthestRow = frog.row;
      scoreEl.textContent = score;
    }

    checkHome();
  }

  function homeSlotForCol(col) {
    // Five pads centered in gaps across 12 columns: roughly cols 1, 3, 5, 7, 9
    const pads = [1, 3, 5, 7, 9];
    for (let i = 0; i < pads.length; i++) {
      if (col === pads[i] || col === pads[i] + 1) return i;
    }
    return -1;
  }

  function checkHome() {
    if (frog.row !== HOME_ROW) return;
    const slot = homeSlotForCol(frog.col);
    if (slot < 0 || homes[slot]) {
      loseLife();
      return;
    }
    homes[slot] = true;
    score += 50 + timeLeft * 2;
    scoreEl.textContent = score;

    if (homes.every(Boolean)) {
      score += 200;
      scoreEl.textContent = score;
      endGame(true);
      return;
    }

    buildTraffic(levelNumber());
    resetFrog();
  }

  function rectsOverlap(ax, ay, aw, ah, bx, by, bw, bh) {
    return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
  }

  function update(dt) {
    hopCooldown = Math.max(0, hopCooldown - dt);
    invuln = Math.max(0, invuln - dt);

    vehicles.forEach((v) => {
      v.x += v.speed * dt;
      if (v.speed > 0 && v.x > COLS * CELL) v.x = -v.w;
      if (v.speed < 0 && v.x + v.w < 0) v.x = COLS * CELL;
    });

    logs.forEach((l) => {
      l.x += l.speed * dt;
      if (l.speed > 0 && l.x > COLS * CELL) l.x = -l.w;
      if (l.speed < 0 && l.x + l.w < 0) l.x = COLS * CELL;
    });

    const frogPad = CELL * 0.7;
    const fx = frog.x + (CELL - frogPad) / 2;
    const fy = frog.y + (CELL - frogPad) / 2;

    if (ROAD_ROWS.includes(frog.row) && invuln <= 0) {
      for (const v of vehicles) {
        if (v.row !== frog.row) continue;
        const vy = v.row * CELL + (CELL - v.h) / 2;
        if (rectsOverlap(fx, fy, frogPad, frogPad, v.x, vy, v.w, v.h)) {
          loseLife();
          return;
        }
      }
    }

    if (RIVER_ROWS.includes(frog.row)) {
      let riding = null;
      for (const l of logs) {
        if (l.row !== frog.row) continue;
        const ly = l.row * CELL + (CELL - l.h) / 2;
        if (rectsOverlap(fx, fy, frogPad, frogPad, l.x, ly, l.w, l.h)) {
          riding = l;
          break;
        }
      }
      if (!riding) {
        if (invuln <= 0) loseLife();
        return;
      }
      frog.onLog = riding;
      frog.x += riding.speed * dt;
      frog.col = Math.round(frog.x / CELL);
      if (frog.x < -CELL * 0.2 || frog.x > (COLS - 0.8) * CELL) {
        loseLife();
        return;
      }
    } else {
      frog.onLog = null;
      frog.x = frog.col * CELL;
    }

    timeAcc += dt;
    if (timeAcc >= 1) {
      timeAcc = 0;
      timeLeft -= 1;
      timeEl.textContent = timeLeft;
      if (timeLeft <= 0) loseLife();
    }
  }

  function drawBackground() {
    for (let r = 0; r < ROWS; r++) {
      const y = r * CELL;
      if (r === HOME_ROW) {
        ctx.fillStyle = '#0a2e1b';
        ctx.fillRect(0, y, canvas.width, CELL);
        const pads = [1, 3, 5, 7, 9];
        pads.forEach((c, i) => {
          const x = c * CELL;
          ctx.fillStyle = homes[i] ? '#1fe3a0' : '#2d8f5a';
          ctx.beginPath();
          ctx.ellipse(x + CELL, y + CELL / 2, CELL * 0.85, CELL * 0.35, 0, 0, Math.PI * 2);
          ctx.fill();
          if (homes[i] && headReady) {
            ctx.save();
            ctx.beginPath();
            ctx.arc(x + CELL, y + CELL / 2, 14, 0, Math.PI * 2);
            ctx.clip();
            ctx.drawImage(headImg, x + CELL - 14, y + CELL / 2 - 14, 28, 28);
            ctx.restore();
          }
        });
      } else if (RIVER_ROWS.includes(r)) {
        const g = ctx.createLinearGradient(0, y, 0, y + CELL);
        g.addColorStop(0, '#1a4a6e');
        g.addColorStop(1, '#123652');
        ctx.fillStyle = g;
        ctx.fillRect(0, y, canvas.width, CELL);
        ctx.fillStyle = 'rgba(255,255,255,0.06)';
        for (let i = 0; i < 6; i++) {
          ctx.fillRect((i * 97 + r * 30) % canvas.width, y + 10 + (i % 3) * 8, 28, 2);
        }
      } else if (r === 6 || r >= 11) {
        ctx.fillStyle = r === 6 ? '#2a6b3c' : '#3d8f52';
        ctx.fillRect(0, y, canvas.width, CELL);
        ctx.fillStyle = 'rgba(0,0,0,0.08)';
        for (let c = 0; c < COLS; c += 2) {
          ctx.fillRect(c * CELL, y, CELL, CELL);
        }
      } else if (ROAD_ROWS.includes(r)) {
        ctx.fillStyle = '#2a2a2e';
        ctx.fillRect(0, y, canvas.width, CELL);
        ctx.strokeStyle = 'rgba(255,255,255,0.25)';
        ctx.setLineDash([8, 10]);
        ctx.beginPath();
        ctx.moveTo(0, y + CELL / 2);
        ctx.lineTo(canvas.width, y + CELL / 2);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }
  }

  function drawVehicles() {
    vehicles.forEach((v) => {
      const y = v.row * CELL + (CELL - v.h) / 2;
      roundRect(v.x, y, v.w, v.h, 6);
      ctx.fillStyle = v.color;
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      ctx.fillRect(v.x + 4, y + 4, Math.min(16, v.w * 0.3), v.h * 0.35);
    });
  }

  function drawLogs() {
    logs.forEach((l) => {
      const y = l.row * CELL + (CELL - l.h) / 2;
      roundRect(l.x, y, l.w, l.h, 8);
      ctx.fillStyle = '#8b5a2b';
      ctx.fill();
      ctx.fillStyle = '#a67238';
      ctx.fillRect(l.x + 6, y + 4, l.w - 12, 4);
      ctx.strokeStyle = 'rgba(0,0,0,0.2)';
      ctx.beginPath();
      ctx.moveTo(l.x + l.w * 0.33, y);
      ctx.lineTo(l.x + l.w * 0.33, y + l.h);
      ctx.moveTo(l.x + l.w * 0.66, y);
      ctx.lineTo(l.x + l.w * 0.66, y + l.h);
      ctx.stroke();
    });
  }

  function drawFrog() {
    if (!frog) return;
    const cx = frog.x + CELL / 2;
    const cy = frog.y + CELL / 2;
    const r = CELL * 0.38;

    // tiny frog body hint
    ctx.fillStyle = '#1fe3a0';
    ctx.beginPath();
    ctx.ellipse(cx, cy + 8, 12, 7, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy - 2, r, 0, Math.PI * 2);
    ctx.closePath();
    ctx.clip();
    if (headReady) {
      ctx.drawImage(headImg, cx - r, cy - r - 2, r * 2, r * 2);
    } else {
      ctx.fillStyle = '#1fe3a0';
      ctx.fill();
    }
    ctx.restore();

    ctx.strokeStyle = 'rgba(31, 227, 160, 0.9)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(cx, cy - 2, r, 0, Math.PI * 2);
    ctx.stroke();

    if (invuln > 0) {
      ctx.strokeStyle = `rgba(255,255,255,${0.3 + Math.sin(performance.now() / 50) * 0.3})`;
      ctx.beginPath();
      ctx.arc(cx, cy - 2, r + 3, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  function roundRect(x, y, w, h, rad) {
    ctx.beginPath();
    ctx.moveTo(x + rad, y);
    ctx.lineTo(x + w - rad, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + rad);
    ctx.lineTo(x + w, y + h - rad);
    ctx.quadraticCurveTo(x + w, y + h, x + w - rad, y + h);
    ctx.lineTo(x + rad, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - rad);
    ctx.lineTo(x, y + rad);
    ctx.quadraticCurveTo(x, y, x + rad, y);
    ctx.closePath();
  }

  function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    drawBackground();
    drawLogs();
    drawVehicles();
    if (state === 'playing' || state === 'paused' || state === 'gameover') {
      drawFrog();
    } else {
      // idle preview frog at start
      frog = frog || { col: Math.floor(COLS / 2), row: ROWS - 1, x: Math.floor(COLS / 2) * CELL, y: (ROWS - 1) * CELL };
      drawFrog();
    }
  }

  function loop(ts) {
    if (state !== 'playing') {
      draw();
      return;
    }
    const dt = Math.min(0.05, (ts - lastTs) / 1000);
    lastTs = ts;
    update(dt);
    draw();
    if (state === 'playing') requestAnimationFrame(loop);
  }

  function handleKey(e) {
    const map = {
      ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0],
      w: [0, -1], s: [0, 1], a: [-1, 0], d: [1, 0],
      W: [0, -1], S: [0, 1], A: [-1, 0], D: [1, 0],
    };

    if (e.key === ' ' || e.code === 'Space') {
      e.preventDefault();
      if (state === 'playing') pauseGame();
      else if (state === 'paused') resumeGame();
      return;
    }

    if (map[e.key]) {
      e.preventDefault();
      if (state === 'idle' || state === 'gameover') startGame();
      else tryHop(...map[e.key]);
    }
  }

  startBtn.addEventListener('click', startGame);
  resumeBtn.addEventListener('click', resumeGame);
  restartBtn.addEventListener('click', startGame);
  mobileControls.querySelectorAll('.d-pad-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const d = btn.dataset.dir;
      const map = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
      if (state === 'idle' || state === 'gameover') startGame();
      tryHop(...map[d]);
    });
  });
  document.addEventListener('keydown', handleKey);

  // idle attract screen
  homes = [false, false, false, false, false];
  buildTraffic(1);
  resetFrog();
  state = 'idle';
  show(startOverlay);
  hide(pauseOverlay);
  hide(gameOverOverlay);
  refreshHighScore();
  const nameInput = document.getElementById('playerName');
  const startName = document.getElementById('playerNameStart');
  if (window.ArcadeDB) {
    const saved = window.ArcadeDB.getPlayerName();
    if (nameInput) nameInput.value = saved;
    if (startName) startName.value = saved;
  }

  function idleAnim() {
    if (state === 'idle') {
      const dt = 0.016;
      vehicles.forEach((v) => {
        v.x += v.speed * dt;
        if (v.speed > 0 && v.x > COLS * CELL) v.x = -v.w;
        if (v.speed < 0 && v.x + v.w < 0) v.x = COLS * CELL;
      });
      logs.forEach((l) => {
        l.x += l.speed * dt;
        if (l.speed > 0 && l.x > COLS * CELL) l.x = -l.w;
        if (l.speed < 0 && l.x + l.w < 0) l.x = COLS * CELL;
      });
      draw();
    }
    requestAnimationFrame(idleAnim);
  }
  requestAnimationFrame(idleAnim);
})();
