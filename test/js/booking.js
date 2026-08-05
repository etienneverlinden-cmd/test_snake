(function () {
  'use strict';

  const DAY_NAMES = ['dim.', 'lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.'];
  const state = {
    types: [],
    typeId: null,
    typeName: '',
    durationMinutes: 30,
    weekStart: startOfWeek(new Date()),
    slotMs: null,
    days: [],
  };

  const el = {
    typeGrid: document.getElementById('typeGrid'),
    stepType: document.getElementById('stepType'),
    stepSlots: document.getElementById('stepSlots'),
    stepForm: document.getElementById('stepForm'),
    stepDone: document.getElementById('stepDone'),
    dayCols: document.getElementById('dayCols'),
    weekLabel: document.getElementById('weekLabel'),
    bookingSummary: document.getElementById('bookingSummary'),
    bookingForm: document.getElementById('bookingForm'),
    confirmDetails: document.getElementById('confirmDetails'),
    errorMsg: document.getElementById('errorMsg'),
    setupMsg: document.getElementById('setupMsg'),
    submitBtn: document.getElementById('submitBtn'),
  };

  function startOfWeek(d) {
    const x = new Date(d);
    const day = (x.getDay() + 6) % 7; // Monday = 0
    x.setHours(0, 0, 0, 0);
    x.setDate(x.getDate() - day);
    return x;
  }

  function addDays(d, n) {
    const x = new Date(d);
    x.setDate(x.getDate() + n);
    return x;
  }

  function ymd(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  function formatTime(ms) {
    return new Intl.DateTimeFormat('fr-BE', {
      timeZone: 'Europe/Brussels',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(ms));
  }

  function formatDateLong(ms) {
    return new Intl.DateTimeFormat('fr-BE', {
      timeZone: 'Europe/Brussels',
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(ms));
  }

  function showError(msg) {
    el.errorMsg.textContent = msg || '';
    el.errorMsg.classList.toggle('hidden', !msg);
  }

  function setStep(n) {
    document.querySelectorAll('.step-pill').forEach((p) => {
      const s = Number(p.dataset.step);
      p.classList.toggle('is-active', s === n);
      p.classList.toggle('is-done', s < n);
    });
    el.stepType.classList.toggle('hidden', n !== 1);
    el.stepSlots.classList.toggle('hidden', n !== 2);
    el.stepForm.classList.toggle('hidden', n !== 3);
    el.stepDone.classList.toggle('hidden', n !== 4);
  }

  async function ensureSeeded() {
    try {
      await window.LoicConvex.mutation('seed:seedDefaults', {});
    } catch {
      /* ignore — may already be seeded or admin-only force */
    }
  }

  async function loadTypes() {
    showError('');
    if (!window.LOIC_CONVEX_URL) {
      el.setupMsg.textContent =
        'Base Convex non configurée. Lancez `cd test && npx convex dev` puis renseignez js/convex-config.js.';
      el.setupMsg.classList.remove('hidden');
      el.typeGrid.innerHTML = '<p class="slot-empty">Configuration manquante.</p>';
      return;
    }
    await ensureSeeded();
    const types = await window.LoicConvex.query('appointments:listTypes', {});
    state.types = types || [];
    if (!state.types.length) {
      el.typeGrid.innerHTML =
        '<p class="slot-empty">Aucun type de séance. Ouvrez l’espace praticien pour initialiser.</p>';
      return;
    }
    el.typeGrid.innerHTML = '';
    for (const t of state.types) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'type-card';
      btn.innerHTML = `<strong>${escapeHtml(t.name)}</strong><span>${t.durationMinutes} minutes</span>`;
      btn.addEventListener('click', () => selectType(t, btn));
      el.typeGrid.appendChild(btn);
    }
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function selectType(t, btn) {
    state.typeId = t._id;
    state.typeName = t.name;
    state.durationMinutes = t.durationMinutes;
    state.slotMs = null;
    el.typeGrid.querySelectorAll('.type-card').forEach((c) => c.classList.remove('is-selected'));
    btn.classList.add('is-selected');
    setStep(2);
    loadSlots();
  }

  async function loadSlots() {
    showError('');
    el.dayCols.innerHTML = '<p class="slot-empty">Chargement des créneaux…</p>';
    const fromDate = ymd(state.weekStart);
    const end = addDays(state.weekStart, 6);
    el.weekLabel.textContent = `${state.weekStart.toLocaleDateString('fr-BE', {
      day: 'numeric',
      month: 'short',
    })} – ${end.toLocaleDateString('fr-BE', { day: 'numeric', month: 'short', year: 'numeric' })}`;

    try {
      const days = await window.LoicConvex.query('appointments:listSlots', {
        typeId: state.typeId,
        fromDate,
        days: 7,
      });
      state.days = days || [];
      renderDays();
    } catch (err) {
      showError(err.message || 'Impossible de charger les créneaux');
      el.dayCols.innerHTML = '';
    }
  }

  function renderDays() {
    el.dayCols.innerHTML = '';
    for (let i = 0; i < 7; i++) {
      const dateObj = addDays(state.weekStart, i);
      const dateStr = ymd(dateObj);
      const dayData = state.days.find((d) => d.date === dateStr) || { slots: [] };
      const col = document.createElement('div');
      col.className = 'day-col';
      const h = document.createElement('h3');
      h.innerHTML = `${DAY_NAMES[dateObj.getDay()]}<em>${dateObj.getDate()}</em>`;
      col.appendChild(h);
      if (!dayData.slots.length) {
        const empty = document.createElement('p');
        empty.className = 'slot-empty';
        empty.textContent = '—';
        col.appendChild(empty);
      } else {
        for (const ms of dayData.slots) {
          const b = document.createElement('button');
          b.type = 'button';
          b.className = 'slot' + (state.slotMs === ms ? ' is-selected' : '');
          b.textContent = formatTime(ms);
          b.addEventListener('click', () => selectSlot(ms));
          col.appendChild(b);
        }
      }
      el.dayCols.appendChild(col);
    }
  }

  function selectSlot(ms) {
    state.slotMs = ms;
    el.bookingSummary.innerHTML = `
      <p><strong>${escapeHtml(state.typeName)}</strong> · ${state.durationMinutes} min</p>
      <p>${escapeHtml(formatDateLong(ms))}</p>
    `;
    setStep(3);
  }

  document.getElementById('prevWeek').addEventListener('click', () => {
    state.weekStart = addDays(state.weekStart, -7);
    loadSlots();
  });
  document.getElementById('nextWeek').addEventListener('click', () => {
    state.weekStart = addDays(state.weekStart, 7);
    loadSlots();
  });
  document.getElementById('backToType').addEventListener('click', () => setStep(1));
  document.getElementById('backToSlots').addEventListener('click', () => {
    setStep(2);
    renderDays();
  });

  el.bookingForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    showError('');
    if (!state.typeId || !state.slotMs) {
      showError('Sélectionnez un créneau');
      return;
    }
    el.submitBtn.disabled = true;
    try {
      const result = await window.LoicConvex.mutation('appointments:book', {
        typeId: state.typeId,
        startMs: state.slotMs,
        patientFirstName: document.getElementById('firstName').value,
        patientLastName: document.getElementById('lastName').value,
        patientEmail: document.getElementById('email').value,
        patientPhone: document.getElementById('phone').value,
        note: document.getElementById('note').value || undefined,
      });
      el.confirmDetails.innerHTML = `
        <p><strong>${escapeHtml(result.typeName)}</strong></p>
        <p>${escapeHtml(formatDateLong(result.startMs))}</p>
        <p>${escapeHtml(result.patientFirstName)} ${escapeHtml(result.patientLastName)}</p>
        <p style="color:var(--ink-soft);font-size:0.9rem;margin-top:0.8rem">
          Un email de confirmation vous a été envoyé. Un rappel suivra 24&nbsp;h avant le rendez-vous.
          Pour modifier, contactez le cabinet.
        </p>
      `;
      setStep(4);
    } catch (err) {
      showError(err.message || 'Réservation impossible');
    } finally {
      el.submitBtn.disabled = false;
    }
  });

  loadTypes();
})();
