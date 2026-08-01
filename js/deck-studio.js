(async function () {
  'use strict';

  await (window.ArcadeAuthGuard?.ready || Promise.resolve());

  const form = document.getElementById('deckForm');
  const errorEl = document.getElementById('deckError');
  const submitBtn = document.getElementById('submitBtn');
  const statusBox = document.getElementById('deckStatus');
  const jobIdEl = document.getElementById('jobId');
  const jobStateEl = document.getElementById('jobState');
  const jobSummaryEl = document.getElementById('jobSummary');
  const downloadBtn = document.getElementById('downloadBtn');
  const userBar = document.getElementById('userBar');
  const signOutBtn = document.getElementById('signOutBtn');

  let pollTimer = null;

  const viewer = await window.ArcadeAuth.getViewer();
  if (userBar && viewer) {
    userBar.textContent = viewer.name || viewer.email || 'Player';
  }
  if (signOutBtn) {
    signOutBtn.addEventListener('click', async () => {
      await window.ArcadeAuth.signOut();
      window.location.href = 'index.html';
    });
  }

  function showError(msg) {
    errorEl.textContent = msg || '';
    errorEl.hidden = !msg;
  }

  async function api(path, options = {}) {
    const token = window.ArcadeAuth.getToken();
    if (!token) throw new Error('Not signed in');
    const res = await fetch(path, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        ...(options.headers || {}),
      },
    });
    if (res.status === 401) {
      window.location.href = 'login.html?next=deck-studio.html';
      throw new Error('Session expired');
    }
    const ctype = res.headers.get('Content-Type') || '';
    if (ctype.includes('application/json')) {
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Request failed');
      return data;
    }
    if (!res.ok) throw new Error('Request failed');
    return res;
  }

  function stopPoll() {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  }

  async function refreshStatus(jobId) {
    const data = await api(`/api/deck/jobs/${encodeURIComponent(jobId)}`);
    jobIdEl.textContent = data.id;
    jobStateEl.textContent = data.status;
    statusBox.hidden = false;

    if (data.summary) {
      jobSummaryEl.hidden = false;
      jobSummaryEl.textContent = data.summary;
    }

    if (data.downloadAvailable) {
      downloadBtn.hidden = false;
      downloadBtn.href = `/api/deck/jobs/${encodeURIComponent(jobId)}/download`;
      downloadBtn.onclick = async (e) => {
        e.preventDefault();
        const token = window.ArcadeAuth.getToken();
        const res = await fetch(downloadBtn.href, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) {
          showError('Download failed');
          return;
        }
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = data.downloadName || `${jobId}.pptx`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
      };
      stopPoll();
      submitBtn.disabled = false;
    } else if (data.status === 'error') {
      showError('Generation failed. Check the brief and try again.');
      stopPoll();
      submitBtn.disabled = false;
    }
    return data;
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    showError('');
    stopPoll();
    downloadBtn.hidden = true;
    jobSummaryEl.hidden = true;
    submitBtn.disabled = true;

    try {
      const payload = {
        title: document.getElementById('title').value.trim(),
        audience: document.getElementById('audience').value.trim(),
        slides: Number(document.getElementById('slides').value || 8),
        brief: document.getElementById('brief').value.trim(),
      };
      const created = await api('/api/deck/jobs', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      await refreshStatus(created.id);
      pollTimer = setInterval(() => {
        refreshStatus(created.id).catch((err) => {
          showError(err.message || 'Status check failed');
          stopPoll();
          submitBtn.disabled = false;
        });
      }, 5000);
    } catch (err) {
      showError(err.message || 'Could not start generation');
      submitBtn.disabled = false;
    }
  });
})();
