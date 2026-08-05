(async function () {
  'use strict';

  if (!window.ArcadeAuthGuard?.ready) {
    window.location.replace('login.html?next=m365-studio.html');
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
  const pickSharePointBtn = document.getElementById('pickSharePointBtn');
  const pickOneDriveBtn = document.getElementById('pickOneDriveBtn');
  const clearLocationBtn = document.getElementById('clearLocationBtn');
  const disconnectBtn = document.getElementById('disconnectBtn');
  const siteSearchBlock = document.getElementById('siteSearchBlock');
  const siteQuery = document.getElementById('siteQuery');
  const siteSearchBtn = document.getElementById('siteSearchBtn');
  const siteResults = document.getElementById('siteResults');
  const folderBlock = document.getElementById('folderBlock');
  const folderResults = document.getElementById('folderResults');
  const folderPathHint = document.getElementById('folderPathHint');
  const folderUpBtn = document.getElementById('folderUpBtn');
  const selectHereBtn = document.getElementById('selectHereBtn');

  /** @type {any[]} */
  let connections = [];
  /** @type {any | null} */
  let active = null;
  /** @type {{ kind: 'sharepoint'|'onedrive', siteId?: string, siteName?: string, siteWebUrl?: string, driveId: string, itemId: string, itemName: string, itemWebUrl?: string, stack: { id: string, name: string }[] } | null} */
  let browse = null;

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
    if (status === 'pending_oauth') return 'Waiting for Microsoft';
    if (status === 'error') return 'Error';
    return status;
  }

  function displayName(c) {
    if (c.label && c.label !== 'Connecting…') return c.label;
    return c.tenantName || c.accountName || c.accountEmail || 'Connection';
  }

  function formatMeta(c) {
    const lines = [];
    lines.push(`Status: ${statusLabel(c.status)}`);
    if (c.tenantName || c.tenantId) {
      lines.push(`Tenant: ${c.tenantName || c.tenantId}`);
    }
    if (c.accountEmail || c.accountName) {
      lines.push(
        `Signed in as: ${c.accountName || ''}${c.accountName && c.accountEmail ? ' · ' : ''}${c.accountEmail || ''}`,
      );
    }
    if (c.hasLocation) {
      lines.push(
        `Location (${c.locationKind || '?'}): ${c.itemName || c.siteName || 'selected'}${c.itemWebUrl ? `\n${c.itemWebUrl}` : ''}`,
      );
    } else if (c.status === 'connected') {
      lines.push('Location: not selected yet — pick SharePoint or OneDrive below.');
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
      if (c.tenantName) subParts.push(c.tenantName);
      if (c.accountEmail) subParts.push(c.accountEmail);
      if (c.hasLocation) subParts.push(c.itemName || c.siteName || 'folder set');
      btn.querySelector('.m365-card-sub').textContent =
        subParts.join(' · ') || statusLabel(c.status);
      btn.querySelector('.m365-status').textContent = statusLabel(c.status);
      btn.addEventListener('click', () => openDetail(c.id));
      li.appendChild(btn);
      connectionList.appendChild(li);
    }
  }

  async function refreshList() {
    connections = (await window.ArcadeAuth.callQuery('m365:listConnections', {})) || [];
    if (active) {
      active = connections.find((c) => c.id === active.id) || null;
      if (active) {
        detailTitle.textContent = displayName(active);
        detailMeta.textContent = formatMeta(active);
      } else {
        detailPanel.hidden = true;
      }
    }
    renderList();
  }

  function openDetail(id) {
    clearFlash();
    active = connections.find((c) => c.id === id) || null;
    if (!active) return;
    detailPanel.hidden = false;
    detailTitle.textContent = displayName(active);
    detailMeta.textContent = formatMeta(active);
    siteSearchBlock.hidden = true;
    folderBlock.hidden = true;
    browse = null;
    renderList();
    detailPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  async function startBrowse(kind, root) {
    browse = {
      kind,
      siteId: root.siteId,
      siteName: root.siteName,
      siteWebUrl: root.siteWebUrl,
      driveId: root.driveId,
      itemId: root.itemId,
      itemName: root.itemName,
      itemWebUrl: root.itemWebUrl,
      stack: [{ id: root.itemId, name: root.itemName }],
    };
    folderBlock.hidden = false;
    siteSearchBlock.hidden = kind !== 'sharepoint';
    await loadChildren();
  }

  async function loadChildren() {
    if (!active || !browse) return;
    show(detailError, '');
    folderPathHint.textContent = browse.stack.map((s) => s.name).join(' / ');
    folderUpBtn.hidden = browse.stack.length <= 1;
    folderResults.innerHTML = '';
    try {
      const children = await window.ArcadeAuth.callAction(
        'm365:listChildren',
        {
          connectionId: active.id,
          driveId: browse.driveId,
          itemId: browse.itemId,
        },
        true,
      );
      for (const child of children || []) {
        const li = document.createElement('li');
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = child.isFolder ? 'is-folder' : '';
        btn.textContent = (child.isFolder ? '[folder] ' : '') + child.name;
        if (child.isFolder) {
          btn.addEventListener('click', async () => {
            browse.itemId = child.id;
            browse.itemName = child.name;
            browse.itemWebUrl = child.webUrl;
            browse.stack.push({ id: child.id, name: child.name });
            await loadChildren();
          });
        } else {
          btn.disabled = true;
          btn.title = 'Select a folder (or use “Use this folder” for the current level)';
        }
        li.appendChild(btn);
        folderResults.appendChild(li);
      }
      if (!children || children.length === 0) {
        const li = document.createElement('li');
        li.innerHTML = '<button type="button" disabled>Empty folder</button>';
        folderResults.appendChild(li);
      }
    } catch (err) {
      show(detailError, err.message || String(err));
    }
  }

  connectBtn.addEventListener('click', async () => {
    clearFlash();
    connectBtn.disabled = true;
    try {
      const result = await window.ArcadeAuth.callMutation('m365:startConnect', {});
      if (!result?.authorizeUrl) throw new Error('No authorize URL returned');
      window.location.href = result.authorizeUrl;
    } catch (err) {
      show(pageError, err.message || String(err));
      connectBtn.disabled = false;
    }
  });

  closeDetailBtn.addEventListener('click', () => {
    active = null;
    detailPanel.hidden = true;
    renderList();
  });

  testBtn.addEventListener('click', async () => {
    if (!active) return;
    show(detailError, '');
    show(detailOk, '');
    testBtn.disabled = true;
    try {
      const result = await window.ArcadeAuth.callAction(
        'm365:testAccess',
        {
          connectionId: active.id,
        },
        true,
      );
      show(
        detailOk,
        result.webUrl
          ? `Access OK — ${result.name}\n${result.webUrl}`
          : `Access OK — ${result.name}`,
      );
    } catch (err) {
      show(detailError, err.message || String(err));
    } finally {
      testBtn.disabled = false;
    }
  });

  pickSharePointBtn.addEventListener('click', () => {
    if (!active || active.status !== 'connected') {
      show(detailError, 'Connect Microsoft 365 first.');
      return;
    }
    show(detailError, '');
    siteSearchBlock.hidden = false;
    folderBlock.hidden = true;
    browse = null;
    siteResults.innerHTML = '';
    siteQuery.focus();
  });

  siteSearchBtn.addEventListener('click', async () => {
    if (!active) return;
    show(detailError, '');
    siteSearchBtn.disabled = true;
    siteResults.innerHTML = '';
    try {
      const sites = await window.ArcadeAuth.callAction(
        'm365:searchSites',
        {
          connectionId: active.id,
          query: (siteQuery.value || '').trim() || '*',
        },
        true,
      );
      if (!sites || sites.length === 0) {
        const li = document.createElement('li');
        li.innerHTML =
          '<button type="button" disabled>No sites found (try another keyword, or ask an admin to sign in)</button>';
        siteResults.appendChild(li);
        return;
      }
      for (const site of sites) {
        const li = document.createElement('li');
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.textContent = site.name + (site.webUrl ? ` — ${site.webUrl}` : '');
        btn.addEventListener('click', async () => {
          try {
            const root = await window.ArcadeAuth.callAction(
              'm365:getSiteDriveRoot',
              {
                connectionId: active.id,
                siteId: site.id,
              },
              true,
            );
            await startBrowse('sharepoint', {
              siteId: site.id,
              siteName: site.name,
              siteWebUrl: site.webUrl,
              driveId: root.driveId,
              itemId: root.itemId,
              itemName: root.itemName,
              itemWebUrl: root.itemWebUrl,
            });
          } catch (err) {
            show(detailError, err.message || String(err));
          }
        });
        li.appendChild(btn);
        siteResults.appendChild(li);
      }
    } catch (err) {
      show(detailError, err.message || String(err));
    } finally {
      siteSearchBtn.disabled = false;
    }
  });

  pickOneDriveBtn.addEventListener('click', async () => {
    if (!active || active.status !== 'connected') {
      show(detailError, 'Connect Microsoft 365 first.');
      return;
    }
    show(detailError, '');
    pickOneDriveBtn.disabled = true;
    try {
      const root = await window.ArcadeAuth.callAction(
        'm365:getMyDriveRoot',
        {
          connectionId: active.id,
        },
        true,
      );
      siteSearchBlock.hidden = true;
      await startBrowse('onedrive', {
        driveId: root.driveId,
        itemId: root.itemId,
        itemName: root.itemName,
        itemWebUrl: root.itemWebUrl,
      });
    } catch (err) {
      show(detailError, err.message || String(err));
    } finally {
      pickOneDriveBtn.disabled = false;
    }
  });

  folderUpBtn.addEventListener('click', async () => {
    if (!browse || browse.stack.length <= 1) return;
    browse.stack.pop();
    const top = browse.stack[browse.stack.length - 1];
    browse.itemId = top.id;
    browse.itemName = top.name;
    await loadChildren();
  });

  selectHereBtn.addEventListener('click', async () => {
    if (!active || !browse) return;
    show(detailError, '');
    selectHereBtn.disabled = true;
    try {
      await window.ArcadeAuth.callMutation('m365:selectLocation', {
        connectionId: active.id,
        locationKind: browse.kind,
        siteId: browse.siteId,
        siteName: browse.siteName,
        siteWebUrl: browse.siteWebUrl,
        driveId: browse.driveId,
        itemId: browse.itemId,
        itemName: browse.itemName,
        itemWebUrl: browse.itemWebUrl,
      });
      show(detailOk, `Saved location: ${browse.itemName}`);
      await refreshList();
      openDetail(active.id);
    } catch (err) {
      show(detailError, err.message || String(err));
    } finally {
      selectHereBtn.disabled = false;
    }
  });

  clearLocationBtn.addEventListener('click', async () => {
    if (!active) return;
    if (!confirm('Clear the selected folder/site for this connection?')) return;
    try {
      await window.ArcadeAuth.callMutation('m365:clearLocation', {
        connectionId: active.id,
      });
      await refreshList();
      openDetail(active.id);
      show(detailOk, 'Location cleared.');
    } catch (err) {
      show(detailError, err.message || String(err));
    }
  });

  disconnectBtn.addEventListener('click', async () => {
    if (!active) return;
    if (
      !confirm(
        'Disconnect this customer? Tokens will be removed. They can also revoke the app in their Entra admin center.',
      )
    ) {
      return;
    }
    try {
      await window.ArcadeAuth.callMutation('m365:disconnect', {
        connectionId: active.id,
      });
      active = null;
      detailPanel.hidden = true;
      await refreshList();
      show(pageOk, 'Disconnected.');
    } catch (err) {
      show(detailError, err.message || String(err));
    }
  });

  const params = new URLSearchParams(window.location.search);
  const errParam = params.get('error');
  const connectedId = params.get('connected');
  if (errParam || connectedId) {
    const url = new URL(window.location.href);
    url.searchParams.delete('error');
    url.searchParams.delete('connected');
    url.searchParams.delete('connection');
    window.history.replaceState({}, '', url.pathname + url.search + url.hash);
  }
  if (errParam) show(pageError, errParam);
  if (connectedId) {
    show(
      pageOk,
      'Microsoft 365 connected. Pick a SharePoint site or OneDrive folder.',
    );
  }

  await refreshList();
  if (connectedId) {
    const found = connections.find((c) => c.id === connectedId);
    if (found) openDetail(found.id);
  }
})();
