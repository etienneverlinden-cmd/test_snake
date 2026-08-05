(async function () {
  'use strict';

  if (!window.ArcadeAuthGuard?.ready) {
    window.location.replace('login.html?next=onedrive-studio.html');
    return;
  }
  const allowed = await window.ArcadeAuthGuard.ready;
  if (!allowed) return;

  const userBar = document.getElementById('userBar');
  const signOutBtn = document.getElementById('signOutBtn');
  const pageError = document.getElementById('pageError');
  const customerSearch = document.getElementById('customerSearch');
  const customerMenu = document.getElementById('customerMenu');
  const customerPickList = document.getElementById('customerPickList');
  const selectedLabel = document.getElementById('selectedLabel');
  const browser = document.getElementById('browser');
  const folderNav = document.getElementById('folderNav');
  const sidebarTitle = document.getElementById('sidebarTitle');
  const crumbs = document.getElementById('crumbs');
  const upBtn = document.getElementById('upBtn');
  const refreshBtn = document.getElementById('refreshBtn');
  const fileBody = document.getElementById('fileBody');

  /** @type {any[]} */
  let connections = [];
  /** @type {any | null} */
  let selected = null;
  /** @type {{ id: string, name: string }[]} */
  let stack = [];
  /** @type {any[]} */
  let currentItems = [];
  let menuOpen = false;

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

  function showError(msg) {
    pageError.textContent = msg || '';
    pageError.hidden = !msg;
  }

  function formatSize(bytes) {
    if (bytes == null || Number.isNaN(bytes)) return '—';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  }

  function formatDate(iso) {
    if (!iso) return '—';
    try {
      const d = new Date(iso);
      if (Number.isNaN(d.getTime())) return '—';
      return d.toLocaleString(undefined, {
        year: '2-digit',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return '—';
    }
  }

  function connectionSub(c) {
    const parts = [];
    if (c.tenantName) parts.push(c.tenantName);
    if (c.hasLocation) {
      parts.push(c.itemName || c.siteName || 'folder saved');
    } else {
      parts.push('connected — opens OneDrive root');
    }
    if (c.locationKind) parts.push(c.locationKind);
    return parts.join(' · ');
  }

  function filteredConnections(q) {
    const needle = (q || '').trim().toLowerCase();
    if (!needle) return connections.slice(0, 30);
    return connections
      .filter((c) => {
        const hay = [
          c.label,
          c.tenantName,
          c.accountEmail,
          c.itemName,
          c.siteName,
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        return hay.includes(needle);
      })
      .slice(0, 30);
  }

  function renderPickList() {
    if (!customerPickList) return;
    customerPickList.innerHTML = '';
    if (!connections.length) return;

    for (const c of connections) {
      const li = document.createElement('li');
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.innerHTML = `<span></span><span class="od-menu-sub"></span>`;
      btn.querySelector('span').textContent = c.label;
      btn.querySelector('.od-menu-sub').textContent =
        connectionSub(c) || 'Connected';
      btn.addEventListener('click', async () => {
        await selectCustomer(c);
      });
      li.appendChild(btn);
      customerPickList.appendChild(li);
    }
  }

  function renderMenu() {
    const list = filteredConnections(customerSearch.value);
    customerMenu.innerHTML = '';
    if (!menuOpen) {
      customerMenu.hidden = true;
      return;
    }
    if (list.length === 0) {
      const li = document.createElement('li');
      li.innerHTML =
        '<button type="button" disabled>No connected customers match your search.</button>';
      customerMenu.appendChild(li);
      customerMenu.hidden = false;
      return;
    }
    for (const c of list) {
      const li = document.createElement('li');
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.innerHTML =
        `<span></span><span class="od-menu-sub"></span>`;
      btn.querySelector('span').textContent = c.label;
      btn.querySelector('.od-menu-sub').textContent = connectionSub(c) || 'Connected';
      btn.addEventListener('click', async () => {
        await selectCustomer(c);
        menuOpen = false;
        renderMenu();
      });
      li.appendChild(btn);
      customerMenu.appendChild(li);
    }
    customerMenu.hidden = false;
  }

  function renderCrumbs() {
    crumbs.innerHTML = '';
    stack.forEach((part, index) => {
      const li = document.createElement('li');
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = part.name;
      btn.addEventListener('click', () => {
        if (index === stack.length - 1) return;
        stack = stack.slice(0, index + 1);
        loadFolder();
      });
      li.appendChild(btn);
      crumbs.appendChild(li);
    });
    upBtn.hidden = stack.length <= 1;
  }

  function renderSidebar() {
    folderNav.innerHTML = '';
    sidebarTitle.textContent = selected
      ? selected.label
      : 'Folders';

    const rootBtn = document.createElement('button');
    rootBtn.type = 'button';
    rootBtn.textContent = selected?.itemName || 'Root';
    rootBtn.className = stack.length === 1 ? 'is-active' : '';
    rootBtn.addEventListener('click', () => {
      if (!selected) return;
      stack = [{ id: selected.itemId, name: selected.itemName || 'Root' }];
      loadFolder();
    });
    folderNav.appendChild(rootBtn);

    const folders = currentItems.filter((i) => i.isFolder);
    for (const folder of folders) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = folder.name;
      const isCurrent =
        stack.length > 1 && stack[stack.length - 1].id === folder.id;
      if (isCurrent) btn.className = 'is-active';
      btn.addEventListener('click', () => {
        openFolder(folder);
      });
      folderNav.appendChild(btn);
    }
  }

  function iconLabel(item) {
    if (item.isFolder) return 'DIR';
    const t = (item.typeLabel || '').slice(0, 3);
    return t || 'DOC';
  }

  function renderTable() {
    fileBody.innerHTML = '';
    if (!currentItems.length) {
      const tr = document.createElement('tr');
      tr.innerHTML = '<td colspan="4" class="od-empty">This folder is empty.</td>';
      fileBody.appendChild(tr);
      return;
    }

    const sorted = currentItems.slice().sort((a, b) => {
      if (a.isFolder !== b.isFolder) return a.isFolder ? -1 : 1;
      return String(a.name).localeCompare(String(b.name), undefined, {
        sensitivity: 'base',
      });
    });

    for (const item of sorted) {
      const tr = document.createElement('tr');
      if (item.isFolder) tr.classList.add('is-folder');

      const nameTd = document.createElement('td');
      const nameWrap = document.createElement('div');
      nameWrap.className = 'od-name';
      const icon = document.createElement('span');
      icon.className = 'od-icon' + (item.isFolder ? ' is-folder' : '');
      icon.textContent = iconLabel(item);
      const text = document.createElement('span');
      text.className = 'od-name-text';
      if (item.isFolder) {
        text.textContent = item.name;
      } else if (item.webUrl) {
        const a = document.createElement('a');
        a.href = item.webUrl;
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        a.textContent = item.name;
        text.appendChild(a);
      } else {
        text.textContent = item.name;
      }
      nameWrap.appendChild(icon);
      nameWrap.appendChild(text);
      nameTd.appendChild(nameWrap);

      const modTd = document.createElement('td');
      modTd.textContent = formatDate(item.lastModifiedDateTime);

      const typeTd = document.createElement('td');
      typeTd.textContent = item.typeLabel || (item.isFolder ? 'Folder' : 'File');

      const sizeTd = document.createElement('td');
      sizeTd.textContent = item.isFolder ? '—' : formatSize(item.size);

      tr.appendChild(nameTd);
      tr.appendChild(modTd);
      tr.appendChild(typeTd);
      tr.appendChild(sizeTd);

      tr.addEventListener('click', () => {
        fileBody.querySelectorAll('tr.is-selected').forEach((el) => {
          el.classList.remove('is-selected');
        });
        tr.classList.add('is-selected');
      });

      tr.addEventListener('dblclick', () => {
        if (item.isFolder) openFolder(item);
        else if (item.webUrl) window.open(item.webUrl, '_blank', 'noopener');
      });

      fileBody.appendChild(tr);
    }
  }

  async function loadFolder() {
    if (!selected) return;
    showError('');
    renderCrumbs();
    fileBody.innerHTML =
      '<tr><td colspan="4" class="od-empty">Loading…</td></tr>';
    const current = stack[stack.length - 1];
    try {
      currentItems =
        (await window.ArcadeAuth.callAction(
          'm365:listChildren',
          {
            connectionId: selected.id,
            driveId: selected.driveId,
            itemId: current.id,
          },
          true,
        )) || [];
      renderTable();
      renderSidebar();
    } catch (err) {
      currentItems = [];
      renderTable();
      renderSidebar();
      showError(err.message || String(err));
    }
  }

  function openFolder(folder) {
    stack.push({ id: folder.id, name: folder.name });
    loadFolder();
  }

  async function selectCustomer(c) {
    selected = c;
    customerSearch.value = c.label;
    showError('');
    browser.hidden = false;
    fileBody.innerHTML =
      '<tr><td colspan="4" class="od-empty">Loading…</td></tr>';

    let driveId = c.driveId;
    let itemId = c.itemId;
    let itemName = c.itemName || 'Root';

    if (!driveId || !itemId) {
      try {
        const root = await window.ArcadeAuth.callAction(
          'm365:getMyDriveRoot',
          { connectionId: c.id },
          true,
        );
        driveId = root.driveId;
        itemId = root.itemId;
        itemName = root.itemName || root.driveName || 'OneDrive';
        selectedLabel.textContent = `${c.label}${c.tenantName ? ` · ${c.tenantName}` : ''} — ${itemName} (OneDrive root)`;
      } catch (err) {
        browser.hidden = true;
        showError(
          `${c.label} is connected but browsing failed. In M365 Connect, open this customer → Pick SharePoint site or Use their OneDrive → Use this folder. (${err.message || err})`,
        );
        selectedLabel.textContent = `${c.label} — connected, folder not set`;
        return;
      }
    } else {
      selectedLabel.textContent = `${c.label}${c.tenantName ? ` · ${c.tenantName}` : ''} — ${itemName}`;
    }

    selected = { ...c, driveId, itemId, itemName };
    stack = [{ id: itemId, name: itemName }];
    await loadFolder();
  }

  async function refreshConnections() {
    showError('');
    selectedLabel.textContent = 'Loading customers…';

    if (!window.ArcadeAuth.getToken() && window.ArcadeAuth.refreshAccessToken) {
      await window.ArcadeAuth.refreshAccessToken();
    }

    let all = await window.ArcadeAuth.callQuery('m365:listConnections', {});
    if (all === null && window.ArcadeAuth.refreshAccessToken) {
      await window.ArcadeAuth.refreshAccessToken();
      all = await window.ArcadeAuth.callQuery('m365:listConnections', {});
    }
    if (all === null) {
      connections = [];
      selectedLabel.textContent = 'Could not load customers (session error). Sign out and sign in again.';
      showError('Could not load M365 connections from Convex. Try signing out and back in.');
      renderPickList();
      return;
    }

    connections = (all || []).filter((c) => c && c.status === 'connected');
    renderPickList();

    if (!connections.length) {
      selectedLabel.textContent =
        'No connected customers yet. Connect one in M365 Connect first.';
      return;
    }

    const withFolder = connections.filter((c) => c.hasLocation).length;
    if (withFolder === 0) {
      selectedLabel.textContent = `${connections.length} connected — click a customer below to browse their OneDrive.`;
    } else {
      selectedLabel.textContent = `${connections.length} connected — click a customer below.`;
    }
  }

  customerSearch.addEventListener('focus', () => {
    menuOpen = true;
    renderMenu();
  });
  customerSearch.addEventListener('input', () => {
    menuOpen = true;
    renderMenu();
  });
  customerSearch.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      menuOpen = false;
      renderMenu();
    }
  });
  document.addEventListener('click', (e) => {
    if (!customerSearch.contains(e.target) && !customerMenu.contains(e.target)) {
      menuOpen = false;
      renderMenu();
    }
  });

  upBtn.addEventListener('click', () => {
    if (stack.length <= 1) return;
    stack.pop();
    loadFolder();
  });
  refreshBtn.addEventListener('click', () => loadFolder());

  await refreshConnections();
  if (connections.length === 1) {
    await selectCustomer(connections[0]);
  } else if (connections.length > 1) {
    browser.hidden = true;
  }
})();
