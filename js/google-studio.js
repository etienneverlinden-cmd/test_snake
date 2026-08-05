(async function () {
  'use strict';

  if (!window.ArcadeAuthGuard?.ready) {
    window.location.replace('login.html?next=google-studio.html');
    return;
  }
  const allowed = await window.ArcadeAuthGuard.ready;
  if (!allowed) return;

  const userBar = document.getElementById('userBar');
  const signOutBtn = document.getElementById('signOutBtn');
  const pageError = document.getElementById('pageError');
  const pageOk = document.getElementById('pageOk');
  const connectBtn = document.getElementById('connectBtn');
  const emptyList = document.getElementById('emptyList');
  const connectionList = document.getElementById('connectionList');
  const detailPanel = document.getElementById('detailPanel');
  const detailTitle = document.getElementById('detailTitle');
  const detailMeta = document.getElementById('detailMeta');
  const detailError = document.getElementById('detailError');
  const detailOk = document.getElementById('detailOk');
  const closeDetailBtn = document.getElementById('closeDetailBtn');
  const testBtn = document.getElementById('testBtn');
  const listCalendarsBtn = document.getElementById('listCalendarsBtn');
  const clearCalendarBtn = document.getElementById('clearCalendarBtn');
  const disconnectBtn = document.getElementById('disconnectBtn');
  const calendarBlock = document.getElementById('calendarBlock');
  const calendarResults = document.getElementById('calendarResults');

  /** @type {any[]} */
  let connections = [];
  /** @type {any | null} */
  let active = null;

  const viewer = await window.ArcadeAuth.getViewer();
  if (userBar && viewer) {
    userBar.textContent = viewer.name || viewer.email || 'Member';
  }
  if (signOutBtn) {
    signOutBtn.addEventListener('click', async () => {
      await window.ArcadeAuth.signOut();
      window.location.href = 'index.html';
    });
  }

  function show(el, msg) {
    if (!el) return;
    el.textContent = msg || '';
    el.hidden = !msg;
  }

  function clearFlash() {
    show(pageError, '');
    show(pageOk, '');
    show(detailError, '');
    show(detailOk, '');
  }

  function statusLabel(status) {
    if (status === 'connected') return 'Connected';
    if (status === 'pending_oauth') return 'Waiting for Google';
    if (status === 'error') return 'Error';
    return status;
  }

  function displayName(c) {
    if (c.label && c.label !== 'Connecting…') return c.label;
    return c.accountName || c.accountEmail || 'Connection';
  }

  function formatMeta(c) {
    const lines = [];
    lines.push(`Status: ${statusLabel(c.status)}`);
    if (c.accountEmail || c.accountName) {
      lines.push(
        `Signed in as: ${c.accountName || ''}${c.accountName && c.accountEmail ? ' · ' : ''}${c.accountEmail || ''}`,
      );
    }
    if (c.hasCalendar) {
      lines.push(`Calendar: ${c.calendarSummary || c.calendarId}`);
    } else if (c.status === 'connected') {
      lines.push('Calendar: not selected — choose one below (defaults to primary after connect).');
    }
    if (c.lastError) lines.push(`Last error: ${c.lastError}`);
    return lines.join('\n');
  }

  function renderList() {
    connectionList.innerHTML = '';
    emptyList.hidden = connections.length > 0;
    for (const c of connections) {
      const li = document.createElement('li');
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className =
        'm365-card' + (active && active.id === c.id ? ' is-active' : '');
      btn.innerHTML =
        `<span><span class="m365-card-name"></span><span class="m365-card-sub"></span></span>` +
        `<span class="m365-status is-${c.status}"></span>`;
      btn.querySelector('.m365-card-name').textContent = displayName(c);
      const subParts = [];
      if (c.accountEmail) subParts.push(c.accountEmail);
      if (c.hasCalendar) subParts.push(c.calendarSummary || c.calendarId);
      btn.querySelector('.m365-card-sub').textContent = subParts.join(' · ');
      btn.querySelector('.m365-status').textContent = statusLabel(c.status);
      btn.addEventListener('click', () => openDetail(c.id));
      li.appendChild(btn);
      connectionList.appendChild(li);
    }
  }

  function renderDetail() {
    if (!active) {
      detailPanel.hidden = true;
      return;
    }
    detailPanel.hidden = false;
    detailTitle.textContent = displayName(active);
    detailMeta.textContent = formatMeta(active);
    calendarBlock.hidden = true;
    calendarResults.innerHTML = '';
  }

  async function refresh() {
    connections = (await window.ArcadeAuth.callQuery(
      'googleConnect:listConnections',
      {},
    )) || [];
    if (active) {
      active = connections.find((c) => c.id === active.id) || null;
    }
    renderList();
    renderDetail();
  }

  async function openDetail(id) {
    clearFlash();
    active =
      connections.find((c) => c.id === id) ||
      (await window.ArcadeAuth.callQuery('googleConnect:getConnection', {
        connectionId: id,
      }));
    renderList();
    renderDetail();
  }

  connectBtn.addEventListener('click', async () => {
    clearFlash();
    connectBtn.disabled = true;
    try {
      const res = await window.ArcadeAuth.callMutation(
        'googleConnect:startConnect',
        {},
      );
      window.location.href = res.authorizeUrl;
    } catch (err) {
      show(pageError, err.message || 'Could not start Google connect');
      connectBtn.disabled = false;
    }
  });

  closeDetailBtn.addEventListener('click', () => {
    active = null;
    renderList();
    renderDetail();
  });

  testBtn.addEventListener('click', async () => {
    if (!active) return;
    clearFlash();
    testBtn.disabled = true;
    try {
      const result = await window.ArcadeAuth.callAction(
        'googleConnect:testAccess',
        { connectionId: active.id },
        true,
      );
      show(
        detailOk,
        `OK — ${result.calendarSummary} (${result.calendarId}). ${result.upcomingCount} upcoming event(s) visible.`,
      );
    } catch (err) {
      show(detailError, err.message || 'Test failed');
    } finally {
      testBtn.disabled = false;
    }
  });

  listCalendarsBtn.addEventListener('click', async () => {
    if (!active) return;
    clearFlash();
    listCalendarsBtn.disabled = true;
    try {
      const cals = await window.ArcadeAuth.callAction(
        'googleConnect:listCalendars',
        { connectionId: active.id },
        true,
      );
      calendarBlock.hidden = false;
      calendarResults.innerHTML = '';
      if (!cals.length) {
        calendarResults.innerHTML = '<li class="m365-empty">No writable calendars.</li>';
        return;
      }
      for (const cal of cals) {
        const li = document.createElement('li');
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.innerHTML = `<span></span>`;
        btn.querySelector('span').textContent =
          `${cal.summary}${cal.primary ? ' (primary)' : ''} · ${cal.accessRole}`;
        btn.addEventListener('click', async () => {
          try {
            await window.ArcadeAuth.callMutation('googleConnect:selectCalendar', {
              connectionId: active.id,
              calendarId: cal.id,
              calendarSummary: cal.summary,
            });
            show(detailOk, `Calendar set to ${cal.summary}`);
            await refresh();
          } catch (err) {
            show(detailError, err.message);
          }
        });
        li.appendChild(btn);
        calendarResults.appendChild(li);
      }
    } catch (err) {
      show(detailError, err.message || 'Could not list calendars');
    } finally {
      listCalendarsBtn.disabled = false;
    }
  });

  clearCalendarBtn.addEventListener('click', async () => {
    if (!active) return;
    try {
      await window.ArcadeAuth.callMutation('googleConnect:clearCalendar', {
        connectionId: active.id,
      });
      show(detailOk, 'Calendar cleared');
      await refresh();
    } catch (err) {
      show(detailError, err.message);
    }
  });

  disconnectBtn.addEventListener('click', async () => {
    if (!active) return;
    if (!confirm('Disconnect this Google Calendar?')) return;
    try {
      await window.ArcadeAuth.callMutation('googleConnect:disconnect', {
        connectionId: active.id,
      });
      active = null;
      show(pageOk, 'Disconnected');
      await refresh();
    } catch (err) {
      show(detailError, err.message);
    }
  });

  const params = new URLSearchParams(window.location.search);
  if (params.get('error')) {
    show(pageError, params.get('error'));
  }
  if (params.get('connected')) {
    show(pageOk, 'Google Calendar connected');
    await refresh();
    await openDetail(params.get('connected'));
  } else {
    await refresh();
  }
  if (params.get('error') || params.get('connected')) {
    const url = new URL(window.location.href);
    url.search = '';
    window.history.replaceState({}, '', url.pathname);
  }
})();
