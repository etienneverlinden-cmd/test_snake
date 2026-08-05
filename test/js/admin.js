(function () {
  'use strict';

  const TOKEN_KEY = 'loicAdminToken';
  const DAY_LABELS = [
    'Dimanche',
    'Lundi',
    'Mardi',
    'Mercredi',
    'Jeudi',
    'Vendredi',
    'Samedi',
  ];

  const state = {
    token: localStorage.getItem(TOKEN_KEY) || '',
    weekStart: startOfWeek(new Date()),
  };

  const el = {
    loginPanel: document.getElementById('loginPanel'),
    adminApp: document.getElementById('adminApp'),
    errorMsg: document.getElementById('errorMsg'),
    okMsg: document.getElementById('okMsg'),
    weekLabel: document.getElementById('weekLabel'),
    apptList: document.getElementById('apptList'),
    hoursGrid: document.getElementById('hoursGrid'),
    blockedList: document.getElementById('blockedList'),
  };

  function startOfWeek(d) {
    const x = new Date(d);
    const day = (x.getDay() + 6) % 7;
    x.setHours(0, 0, 0, 0);
    x.setDate(x.getDate() - day);
    return x;
  }

  function addDays(d, n) {
    const x = new Date(d);
    x.setDate(x.getDate() + n);
    return x;
  }

  function showError(msg) {
    el.errorMsg.textContent = msg || '';
    el.errorMsg.classList.toggle('hidden', !msg);
  }

  function showOk(msg) {
    el.okMsg.textContent = msg || '';
    el.okMsg.classList.toggle('hidden', !msg);
  }

  function formatRange(startMs, endMs) {
    const d = new Intl.DateTimeFormat('fr-BE', {
      timeZone: 'Europe/Brussels',
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(startMs));
    const t = new Intl.DateTimeFormat('fr-BE', {
      timeZone: 'Europe/Brussels',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(endMs));
    return `${d} → ${t}`;
  }

  function minutesToInput(m) {
    const h = Math.floor(m / 60);
    const min = m % 60;
    return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
  }

  function inputToMinutes(s) {
    if (!s) return null;
    const [h, m] = s.split(':').map(Number);
    return h * 60 + m;
  }

  async function refreshSession() {
    if (!window.LOIC_CONVEX_URL) {
      showError('Convex non configuré (js/convex-config.js).');
      return false;
    }
    if (!state.token) {
      showLogin();
      return false;
    }
    const me = await window.LoicConvex.query('admin:me', { token: state.token });
    if (!me?.ok) {
      state.token = '';
      localStorage.removeItem(TOKEN_KEY);
      showLogin();
      return false;
    }
    showApp();
    await loadAll();
    return true;
  }

  function showLogin() {
    el.loginPanel.classList.remove('hidden');
    el.adminApp.classList.add('hidden');
  }

  function showApp() {
    el.loginPanel.classList.add('hidden');
    el.adminApp.classList.remove('hidden');
  }

  async function loadAll() {
    showError('');
    const fromMs = state.weekStart.getTime();
    const toMs = addDays(state.weekStart, 7).getTime();
    const end = addDays(state.weekStart, 6);
    el.weekLabel.textContent = `${state.weekStart.toLocaleDateString('fr-BE', {
      day: 'numeric',
      month: 'short',
    })} – ${end.toLocaleDateString('fr-BE', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    })}`;

    const [appts, hours, blocked, google] = await Promise.all([
      window.LoicConvex.query('admin:listAppointments', {
        token: state.token,
        fromMs,
        toMs,
      }),
      window.LoicConvex.query('availability:listHours', { token: state.token }),
      window.LoicConvex.query('availability:listBlocked', {
        token: state.token,
        fromMs,
        toMs,
      }),
      window.LoicConvex.query('google:getConnection', { token: state.token }),
    ]);

    renderAppts(appts || []);
    renderHours(hours || []);
    renderBlocked(blocked || []);
    renderGoogle(google);
  }

  function renderGoogle(conn) {
    const status = document.getElementById('googleStatus');
    const disconnectBtn = document.getElementById('googleDisconnectBtn');
    const emailInput = document.getElementById('googleEmail');
    if (!conn) {
      status.className = 'msg msg-info';
      status.textContent =
        'Aucun calendrier connecté. Entrez l’adresse Google du cabinet puis connectez.';
      disconnectBtn.classList.add('hidden');
      return;
    }
    if (conn.status === 'connected') {
      status.className = 'msg msg-ok';
      status.textContent = `Connecté : ${conn.email}`;
      emailInput.value = conn.email;
      disconnectBtn.classList.remove('hidden');
    } else if (conn.status === 'pending') {
      status.className = 'msg msg-info';
      status.textContent = `Connexion en cours pour ${conn.email}… Terminez l’autorisation Google.`;
      emailInput.value = conn.email;
      disconnectBtn.classList.remove('hidden');
    } else {
      status.className = 'msg msg-error';
      status.textContent = `Erreur : ${conn.lastError || 'connexion Google échouée'}`;
      emailInput.value = conn.email || '';
      disconnectBtn.classList.remove('hidden');
    }
  }

  function handleGoogleReturn() {
    const params = new URLSearchParams(window.location.search);
    const g = params.get('google');
    if (!g) return;
    if (g === 'ok') {
      const linked = params.get('linked');
      showOk(
        linked
          ? `Google Calendar connecté (${linked})`
          : 'Google Calendar connecté',
      );
    } else if (g === 'error') {
      showError(params.get('msg') || 'Erreur Google Calendar');
    }
    const url = new URL(window.location.href);
    url.search = '';
    window.history.replaceState({}, '', url.pathname);
  }

  function renderAppts(appts) {
    el.apptList.innerHTML = '';
    if (!appts.length) {
      el.apptList.innerHTML = '<li class="slot-empty">Aucun rendez-vous cette semaine.</li>';
      return;
    }
    for (const a of appts) {
      const li = document.createElement('li');
      li.className = 'appt-item' + (a.status === 'cancelled' ? ' is-cancelled' : '');
      li.innerHTML = `
        <div>
          <strong>${escapeHtml(a.patientFirstName)} ${escapeHtml(a.patientLastName)}</strong>
          <div class="appt-meta">
            ${escapeHtml(formatRange(a.startMs, a.endMs))} · ${escapeHtml(a.typeName)}
            ${a.status === 'cancelled' ? ' · annulé' : ''}
            <br>${escapeHtml(a.patientEmail)} · ${escapeHtml(a.patientPhone)}
            ${a.note ? `<br>${escapeHtml(a.note)}` : ''}
          </div>
        </div>
      `;
      if (a.status === 'confirmed') {
        const actions = document.createElement('div');
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'btn btn-danger btn-sm';
        btn.textContent = 'Annuler';
        btn.addEventListener('click', async () => {
          if (!confirm('Annuler ce rendez-vous ?')) return;
          try {
            await window.LoicConvex.mutation('admin:cancelAppointment', {
              token: state.token,
              id: a._id,
            });
            showOk('Rendez-vous annulé');
            await loadAll();
          } catch (err) {
            showError(err.message);
          }
        });
        actions.appendChild(btn);
        li.appendChild(actions);
      }
      el.apptList.appendChild(li);
    }
  }

  function renderHours(hours) {
    el.hoursGrid.innerHTML = '';
    const byDay = {};
    for (const h of hours) {
      if (!byDay[h.dayOfWeek]) byDay[h.dayOfWeek] = [];
      byDay[h.dayOfWeek].push(h);
    }
    for (let d = 1; d <= 6; d++) {
      const list = (byDay[d] || []).sort((a, b) => a.startMinutes - b.startMinutes);
      const morning = list[0];
      const afternoon = list[1];
      const row = document.createElement('div');
      row.className = 'hours-row';
      row.innerHTML = `
        <div class="day-label"><strong>${DAY_LABELS[d]}</strong></div>
        <input type="time" data-day="${d}" data-part="am-start" value="${morning ? minutesToInput(morning.startMinutes) : ''}" title="Début matin">
        <input type="time" data-day="${d}" data-part="am-end" value="${morning ? minutesToInput(morning.endMinutes) : ''}" title="Fin matin">
        <input type="time" data-day="${d}" data-part="pm-start" value="${afternoon ? minutesToInput(afternoon.startMinutes) : ''}" title="Début après-midi">
        <input type="time" data-day="${d}" data-part="pm-end" value="${afternoon ? minutesToInput(afternoon.endMinutes) : ''}" title="Fin après-midi">
        <button type="button" class="btn btn-outline btn-sm" data-save="${d}">Sauver</button>
      `;
      // Fix grid: day + 4 times + button — adjust layout via wrapping
      row.style.gridTemplateColumns = '7rem repeat(4, 1fr) auto';
      el.hoursGrid.appendChild(row);
    }

    el.hoursGrid.querySelectorAll('[data-save]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const day = Number(btn.getAttribute('data-save'));
        const vals = (part) =>
          inputToMinutes(
            el.hoursGrid.querySelector(`[data-day="${day}"][data-part="${part}"]`).value,
          );
        const amS = vals('am-start');
        const amE = vals('am-end');
        const pmS = vals('pm-start');
        const pmE = vals('pm-end');
        try {
          showError('');
          await saveDayHours(day, [
            amS != null && amE != null && amE > amS
              ? { startMinutes: amS, endMinutes: amE }
              : null,
            pmS != null && pmE != null && pmE > pmS
              ? { startMinutes: pmS, endMinutes: pmE }
              : null,
          ].filter(Boolean));
          showOk(`${DAY_LABELS[day]} mis à jour`);
          await loadAll();
        } catch (err) {
          showError(err.message);
        }
      });
    });
  }

  async function saveDayHours(dayOfWeek, windows) {
    await window.LoicConvex.mutation('availability:clearDayHours', {
      token: state.token,
      dayOfWeek,
    });
    for (const w of windows) {
      await window.LoicConvex.mutation('availability:addHours', {
        token: state.token,
        dayOfWeek,
        startMinutes: w.startMinutes,
        endMinutes: w.endMinutes,
      });
    }
  }

  function renderBlocked(blocked) {
    el.blockedList.innerHTML = '';
    if (!blocked.length) {
      el.blockedList.innerHTML = '<li class="slot-empty">Aucune plage bloquée cette semaine.</li>';
      return;
    }
    for (const b of blocked) {
      const li = document.createElement('li');
      li.className = 'appt-item';
      li.innerHTML = `
        <div>
          <strong>${escapeHtml(formatRange(b.startMs, b.endMs))}</strong>
          <div class="appt-meta">${escapeHtml(b.reason || 'Bloqué')}</div>
        </div>
      `;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn btn-outline btn-sm';
      btn.textContent = 'Libérer';
      btn.addEventListener('click', async () => {
        try {
          await window.LoicConvex.mutation('availability:unblockSlot', {
            token: state.token,
            id: b._id,
          });
          showOk('Plage libérée');
          await loadAll();
        } catch (err) {
          showError(err.message);
        }
      });
      li.appendChild(btn);
      el.blockedList.appendChild(li);
    }
  }

  function escapeHtml(s) {
    return String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  document.getElementById('loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    showError('');
    const password = document.getElementById('password').value;
    try {
      const res = await window.LoicConvex.mutation('admin:login', { password });
      state.token = res.token;
      localStorage.setItem(TOKEN_KEY, res.token);
      showOk('Connecté');
      await refreshSession();
    } catch (err) {
      showError(err.message || 'Connexion impossible');
    }
  });

  document.getElementById('logoutBtn').addEventListener('click', async () => {
    try {
      if (state.token) {
        await window.LoicConvex.mutation('admin:logout', { token: state.token });
      }
    } catch {
      /* ignore */
    }
    state.token = '';
    localStorage.removeItem(TOKEN_KEY);
    showLogin();
  });

  document.getElementById('prevWeek').addEventListener('click', async () => {
    state.weekStart = addDays(state.weekStart, -7);
    await loadAll();
  });
  document.getElementById('nextWeek').addEventListener('click', async () => {
    state.weekStart = addDays(state.weekStart, 7);
    await loadAll();
  });

  document.getElementById('seedBtn').addEventListener('click', async () => {
    try {
      const res = await window.LoicConvex.mutation('seed:seedDefaults', {
        token: state.token,
        force: true,
      });
      showOk(res.seeded ? 'Types et horaires réinitialisés' : 'Déjà initialisé');
      await loadAll();
    } catch (err) {
      showError(err.message);
    }
  });

  document.getElementById('blockForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const start = document.getElementById('blockStart').value;
    const end = document.getElementById('blockEnd').value;
    const reason = document.getElementById('blockReason').value;
    try {
      await window.LoicConvex.mutation('availability:blockSlot', {
        token: state.token,
        startMs: new Date(start).getTime(),
        endMs: new Date(end).getTime(),
        reason: reason || undefined,
      });
      showOk('Plage bloquée');
      e.target.reset();
      await loadAll();
    } catch (err) {
      showError(err.message);
    }
  });

  document.getElementById('googleForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    showError('');
    const email = document.getElementById('googleEmail').value;
    const btn = document.getElementById('googleConnectBtn');
    btn.disabled = true;
    try {
      const res = await window.LoicConvex.mutation('google:startConnect', {
        token: state.token,
        email,
      });
      window.location.href = res.authorizeUrl;
    } catch (err) {
      showError(err.message || 'Connexion Google impossible');
      btn.disabled = false;
    }
  });

  document.getElementById('googleDisconnectBtn').addEventListener('click', async () => {
    if (!confirm('Déconnecter Google Calendar ?')) return;
    try {
      await window.LoicConvex.mutation('google:disconnect', { token: state.token });
      showOk('Google Calendar déconnecté');
      await loadAll();
    } catch (err) {
      showError(err.message);
    }
  });

  handleGoogleReturn();
  refreshSession();
})();
