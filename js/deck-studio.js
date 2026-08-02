(async function () {
  'use strict';

  await (window.ArcadeAuthGuard?.ready || Promise.resolve());

  const form = document.getElementById('deckForm');
  const errorEl = document.getElementById('deckError');
  const reviewErrorEl = document.getElementById('reviewError');
  const readyErrorEl = document.getElementById('readyError');
  const draftBtn = document.getElementById('draftBtn');
  const refineForm = document.getElementById('refineForm');
  const refineBtn = document.getElementById('refineBtn');
  const generateBtn = document.getElementById('generateBtn');
  const reviseBtn = document.getElementById('reviseBtn');
  const startOverBtn = document.getElementById('startOverBtn');
  const waitingBox = document.getElementById('deckWaiting');
  const waitingTitle = document.getElementById('waitingTitle');
  const waitingNote = document.getElementById('waitingNote');
  const reviewBox = document.getElementById('deckReview');
  const readyBox = document.getElementById('deckReady');
  const draftView = document.getElementById('draftView');
  const chatLog = document.getElementById('chatLog');
  const jobIdEl = document.getElementById('jobId');
  const jobStateEl = document.getElementById('jobState');
  const jobSummaryEl = document.getElementById('jobSummary');
  const downloadBtn = document.getElementById('downloadBtn');
  const pptxInput = document.getElementById('pptxFile');
  const imageInput = document.getElementById('imageFiles');
  const pptxList = document.getElementById('pptxList');
  const imageList = document.getElementById('imageList');
  const imagePreviews = document.getElementById('imagePreviews');
  const stepsEl = document.getElementById('deckSteps');
  const userBar = document.getElementById('userBar');
  const signOutBtn = document.getElementById('signOutBtn');
  const slidePreview = document.getElementById('slidePreview');
  const styleNotes = document.getElementById('styleNotes');
  const briefMicBtn = document.getElementById('briefMicBtn');
  const refineMicBtn = document.getElementById('refineMicBtn');
  const briefMicHint = document.getElementById('briefMicHint');
  const refineMicHint = document.getElementById('refineMicHint');
  const briefEl = document.getElementById('brief');
  const refineEl = document.getElementById('refineMessage');

  const MAX_PPTX_BYTES = 8 * 1024 * 1024;
  const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
  const MAX_IMAGES = 5;

  /** @type {{ name: string, mime: string, kind: string, data: string, previewUrl?: string }[]} */
  let attachments = [];
  /** @type {{ role: 'user' | 'assistant', text: string }[]} */
  let chat = [];
  let currentDraft = '';
  let pollTimer = null;
  let lastPptxJobId = null;
  let iterationCount = 0;

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

  function showError(el, msg) {
    el.textContent = msg || '';
    el.hidden = !msg;
  }

  function setStep(active) {
    const order = ['brief', 'review', 'generate'];
    const idx = order.indexOf(active);
    stepsEl.querySelectorAll('li').forEach((li) => {
      const step = li.getAttribute('data-step');
      const si = order.indexOf(step);
      li.classList.toggle('is-active', step === active);
      li.classList.toggle('is-done', si < idx);
    });
  }

  function showPhase(phase) {
    form.hidden = phase !== 'brief';
    waitingBox.hidden = phase !== 'waiting';
    reviewBox.hidden = phase !== 'review';
    readyBox.hidden = phase !== 'ready';
    if (phase === 'brief') setStep('brief');
    if (phase === 'waiting') {
      /* keep previous step highlight via caller */
    }
    if (phase === 'review') setStep('review');
    if (phase === 'ready') setStep('generate');
  }

  function fileToBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = String(reader.result || '');
        const comma = result.indexOf(',');
        resolve(comma >= 0 ? result.slice(comma + 1) : result);
      };
      reader.onerror = () => reject(new Error('Could not read file'));
      reader.readAsDataURL(file);
    });
  }

  function renderAttachmentLists() {
    const pptx = attachments.filter((a) => a.kind === 'pptx');
    const images = attachments.filter((a) => a.kind === 'image');

    pptxList.innerHTML = '';
    if (pptx.length) {
      pptxList.hidden = false;
      pptx.forEach((a) => {
        const li = document.createElement('li');
        li.innerHTML = `<span>${escapeHtml(a.name)}</span>`;
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.textContent = 'Remove';
        btn.addEventListener('click', () => {
          attachments = attachments.filter((x) => x !== a);
          renderAttachmentLists();
        });
        li.appendChild(btn);
        pptxList.appendChild(li);
      });
    } else {
      pptxList.hidden = true;
    }

    imageList.innerHTML = '';
    imagePreviews.innerHTML = '';
    if (images.length) {
      imageList.hidden = false;
      imagePreviews.hidden = false;
      images.forEach((a) => {
        const li = document.createElement('li');
        li.innerHTML = `<span>${escapeHtml(a.name)}</span>`;
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.textContent = 'Remove';
        btn.addEventListener('click', () => {
          if (a.previewUrl) URL.revokeObjectURL(a.previewUrl);
          attachments = attachments.filter((x) => x !== a);
          renderAttachmentLists();
        });
        li.appendChild(btn);
        imageList.appendChild(li);

        if (a.previewUrl) {
          const img = document.createElement('img');
          img.src = a.previewUrl;
          img.alt = a.name;
          imagePreviews.appendChild(img);
        }
      });
    } else {
      imageList.hidden = true;
      imagePreviews.hidden = true;
    }
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  const SpeechRecognition =
    window.SpeechRecognition || window.webkitSpeechRecognition || null;
  /** @type {Map<HTMLElement, SpeechRecognition>} */
  const micSessions = new Map();

  function stopMic(button, hint) {
    const rec = micSessions.get(button);
    if (rec) {
      try {
        rec.stop();
      } catch (_) {
        /* ignore */
      }
      micSessions.delete(button);
    }
    button.classList.remove('is-listening');
    button.setAttribute('aria-pressed', 'false');
    button.querySelector('.mic-label').textContent = 'Dictate';
    if (hint) hint.hidden = true;
  }

  function wireDictation(textarea, button, hint) {
    if (!SpeechRecognition) {
      button.disabled = true;
      button.title = 'Speech dictation is not supported in this browser (try Chrome or Edge).';
      return;
    }

    button.addEventListener('click', () => {
      if (micSessions.has(button)) {
        stopMic(button, hint);
        return;
      }

      // Only one mic at a time
      for (const [btn] of [...micSessions.entries()]) {
        const otherHint =
          btn === briefMicBtn ? briefMicHint : btn === refineMicBtn ? refineMicHint : null;
        stopMic(btn, otherHint);
      }

      const recognition = new SpeechRecognition();
      recognition.lang = 'en-GB';
      recognition.interimResults = true;
      recognition.continuous = true;

      let committed = textarea.value;
      if (committed && !/\s$/.test(committed)) committed += ' ';

      recognition.onresult = (event) => {
        let interim = '';
        let finalChunk = '';
        for (let i = event.resultIndex; i < event.results.length; i += 1) {
          const piece = event.results[i][0].transcript;
          if (event.results[i].isFinal) finalChunk += piece;
          else interim += piece;
        }
        if (finalChunk) {
          committed += finalChunk.replace(/^\s+/, '');
          if (!/\s$/.test(committed)) committed += ' ';
        }
        textarea.value = (committed + interim).replace(/\s+$/, interim ? ' ' + interim : '');
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
      };

      recognition.onerror = () => {
        stopMic(button, hint);
      };
      recognition.onend = () => {
        if (micSessions.get(button) === recognition) {
          stopMic(button, hint);
        }
      };

      micSessions.set(button, recognition);
      button.classList.add('is-listening');
      button.setAttribute('aria-pressed', 'true');
      button.querySelector('.mic-label').textContent = 'Stop';
      if (hint) hint.hidden = false;
      try {
        recognition.start();
      } catch (err) {
        stopMic(button, hint);
        showError(errorEl, err.message || 'Could not start microphone');
      }
    });
  }

  wireDictation(briefEl, briefMicBtn, briefMicHint);
  wireDictation(refineEl, refineMicBtn, refineMicHint);

  function parseDraft(text) {
    const raw = String(text || '').trim();
    const styleLines = [];
    /** @type {{ index: number, title: string, bullets: string[], layout: string, image: string }[]} */
    const slides = [];

    if (!raw) return { styleNotes: '', slides };

    const lines = raw.split(/\r?\n/);
    let mode = 'pre';
    let current = null;

    function pushCurrent() {
      if (current) slides.push(current);
      current = null;
    }

    for (const line of lines) {
      const trimmed = line.trim();
      const slideMatch = trimmed.match(
        /^#{1,3}\s*Slide\s+(\d+)\s*[:.\-–—]?\s*(.*)$/i
      );
      const styleMatch = trimmed.match(/^#{1,3}\s*Style\b/i);

      if (styleMatch) {
        pushCurrent();
        mode = 'style';
        continue;
      }
      if (slideMatch) {
        pushCurrent();
        mode = 'slide';
        current = {
          index: Number(slideMatch[1]),
          title: (slideMatch[2] || `Slide ${slideMatch[1]}`).trim() || `Slide ${slideMatch[1]}`,
          bullets: [],
          layout: 'content',
          image: '',
        };
        continue;
      }

      if (mode === 'style') {
        if (/^#{1,3}\s+/.test(trimmed)) {
          mode = 'pre';
        } else if (trimmed) {
          styleLines.push(trimmed.replace(/^[-*•]\s*/, ''));
        }
        continue;
      }

      if (mode === 'slide' && current) {
        const layoutMatch = trimmed.match(/^Layout\s*:\s*(.+)$/i);
        const imageMatch = trimmed.match(/^Image\s*:\s*(.+)$/i);
        if (layoutMatch) {
          current.layout = layoutMatch[1].trim().toLowerCase();
          continue;
        }
        if (imageMatch) {
          current.image = imageMatch[1].trim().replace(/^["']|["']$/g, '');
          continue;
        }
        if (/^[-*•]\s+/.test(trimmed)) {
          current.bullets.push(trimmed.replace(/^[-*•]\s+/, ''));
          continue;
        }
        if (/^\d+[.)]\s+/.test(trimmed)) {
          current.bullets.push(trimmed.replace(/^\d+[.)]\s+/, ''));
          continue;
        }
        if (trimmed && !/^#{1,3}\s/.test(trimmed) && !/^speaker\s*notes/i.test(trimmed)) {
          // Loose paragraph under a slide heading
          if (trimmed.length < 160) current.bullets.push(trimmed);
        }
      }
    }
    pushCurrent();

    // Fallback: split by blank lines / numbered slides if nothing matched
    if (!slides.length) {
      const blocks = raw.split(/\n{2,}/).filter(Boolean);
      blocks.slice(0, 12).forEach((block, i) => {
        const blines = block.split(/\n/).map((l) => l.trim()).filter(Boolean);
        if (!blines.length) return;
        slides.push({
          index: i + 1,
          title: blines[0].replace(/^#+\s*/, '').replace(/^Slide\s+\d+\s*[:.\-–—]?\s*/i, ''),
          bullets: blines.slice(1).map((l) => l.replace(/^[-*•]\s+/, '').replace(/^\d+[.)]\s+/, '')),
          layout: i === 0 ? 'title' : 'content',
          image: '',
        });
      });
    }

    return { styleNotes: styleLines.join(' · '), slides };
  }

  function findAttachmentPreview(imageName) {
    if (!imageName) return '';
    const base = imageName.split(/[/\\]/).pop().toLowerCase();
    const hit = attachments.find(
      (a) => a.kind === 'image' && a.name.toLowerCase() === base && a.previewUrl
    );
    return hit ? hit.previewUrl : '';
  }

  function renderSlidePreview(draftText) {
    const parsed = parseDraft(draftText);
    if (parsed.styleNotes) {
      styleNotes.hidden = false;
      styleNotes.textContent = 'Format: ' + parsed.styleNotes;
    } else {
      styleNotes.hidden = true;
      styleNotes.textContent = '';
    }

    slidePreview.innerHTML = '';
    if (!parsed.slides.length) {
      const empty = document.createElement('p');
      empty.className = 'slide-preview-empty';
      empty.textContent =
        'No slide structure detected yet. Ask the AI to use headings like “## Slide 1: Title” so the format preview can render.';
      slidePreview.appendChild(empty);
      return;
    }

    parsed.slides.forEach((slide) => {
      const card = document.createElement('article');
      const layout = slide.layout || 'content';
      card.className = 'slide-card';
      if (layout.includes('title') || (slide.index === 1 && !slide.bullets.length)) {
        card.classList.add('slide-card--title');
      } else if (layout.includes('section')) {
        card.classList.add('slide-card--section');
      }

      const meta = document.createElement('div');
      meta.className = 'slide-card-meta';
      meta.textContent = `Slide ${slide.index}`;
      card.appendChild(meta);

      const title = document.createElement('h4');
      title.className = 'slide-card-title';
      title.textContent = slide.title;
      card.appendChild(title);

      if (slide.bullets.length) {
        const ul = document.createElement('ul');
        ul.className = 'slide-card-bullets';
        slide.bullets.slice(0, 6).forEach((b) => {
          const li = document.createElement('li');
          li.textContent = b;
          ul.appendChild(li);
        });
        card.appendChild(ul);
      }

      const imgUrl = findAttachmentPreview(slide.image);
      if (imgUrl) {
        const img = document.createElement('img');
        img.className = 'slide-card-image';
        img.src = imgUrl;
        img.alt = slide.image;
        card.appendChild(img);
      }

      slidePreview.appendChild(card);
    });
  }

  pptxInput.addEventListener('change', async () => {
    showError(errorEl, '');
    const file = pptxInput.files && pptxInput.files[0];
    pptxInput.value = '';
    if (!file) return;
    if (file.size > MAX_PPTX_BYTES) {
      showError(errorEl, 'Reference PowerPoint must be under 8 MB.');
      return;
    }
    try {
      const data = await fileToBase64(file);
      attachments = attachments.filter((a) => a.kind !== 'pptx');
      attachments.push({
        name: file.name,
        mime: file.type || 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        kind: 'pptx',
        data,
      });
      renderAttachmentLists();
    } catch (err) {
      showError(errorEl, err.message || 'Could not read PowerPoint');
    }
  });

  imageInput.addEventListener('change', async () => {
    showError(errorEl, '');
    const files = Array.from(imageInput.files || []);
    imageInput.value = '';
    const existing = attachments.filter((a) => a.kind === 'image').length;
    if (existing + files.length > MAX_IMAGES) {
      showError(errorEl, `You can attach at most ${MAX_IMAGES} images.`);
      return;
    }
    for (const file of files) {
      if (!file.type.startsWith('image/')) {
        showError(errorEl, `${file.name} is not an image.`);
        continue;
      }
      if (file.size > MAX_IMAGE_BYTES) {
        showError(errorEl, `${file.name} must be under 5 MB.`);
        continue;
      }
      try {
        const data = await fileToBase64(file);
        attachments.push({
          name: file.name,
          mime: file.type,
          kind: 'image',
          data,
          previewUrl: URL.createObjectURL(file),
        });
      } catch (err) {
        showError(errorEl, err.message || 'Could not read image');
      }
    }
    renderAttachmentLists();
  });

  function renderChat() {
    chatLog.innerHTML = '';
    chat.forEach((msg) => {
      const div = document.createElement('div');
      div.className =
        'chat-bubble ' +
        (msg.role === 'user' ? 'chat-bubble--user' : 'chat-bubble--assistant');
      div.textContent = msg.text;
      chatLog.appendChild(div);
    });
  }

  function briefPayload() {
    return {
      title: document.getElementById('title').value.trim(),
      audience: document.getElementById('audience').value.trim(),
      slides: Number(document.getElementById('slides').value || 8),
      brief: document.getElementById('brief').value.trim(),
    };
  }

  function attachmentPayload() {
    return attachments.map(({ name, mime, kind, data }) => ({
      name,
      mime,
      kind,
      data,
    }));
  }

  async function api(path, options = {}) {
    const token = window.ArcadeAuth.getToken();
    if (!token) throw new Error('Not signed in');
    const headers = {
      Authorization: `Bearer ${token}`,
      ...(options.headers || {}),
    };
    if (options.body && !headers['Content-Type']) {
      headers['Content-Type'] = 'application/json';
    }
    const res = await fetch(path, { ...options, headers });
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

  function setBusy(busy) {
    draftBtn.disabled = busy;
    refineBtn.disabled = busy;
    generateBtn.disabled = busy;
    reviseBtn.disabled = busy;
  }

  async function downloadPptx(jobId, downloadName) {
    const token = window.ArcadeAuth.getToken();
    const res = await fetch(`/api/deck/jobs/${encodeURIComponent(jobId)}/download`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error('Download failed');
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = downloadName || `${jobId}.pptx`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function enterReview(draftText, summary) {
    currentDraft = draftText || currentDraft;
    draftView.textContent = currentDraft || '(Empty draft — try refining.)';
    renderSlidePreview(currentDraft);
    if (summary) {
      chat.push({
        role: 'assistant',
        text: summary,
      });
    }
    renderChat();
    showPhase('review');
    setBusy(false);
  }

  function enterReady(data) {
    lastPptxJobId = data.id;
    if (data.summary) {
      jobSummaryEl.hidden = false;
      jobSummaryEl.textContent = data.summary;
    } else {
      jobSummaryEl.hidden = true;
    }
    if (data.draft) {
      currentDraft = data.draft;
    }
    downloadBtn.onclick = async (e) => {
      e.preventDefault();
      showError(readyErrorEl, '');
      try {
        await downloadPptx(data.id, data.downloadName);
      } catch (err) {
        showError(readyErrorEl, err.message || 'Download failed');
      }
    };
    downloadBtn.href = `#download-${data.id}`;
    showPhase('ready');
    setBusy(false);
  }

  async function pollUntilDone(jobId, { onReady }) {
    stopPoll();
    const tick = async () => {
      const data = await api(`/api/deck/jobs/${encodeURIComponent(jobId)}`);
      jobIdEl.textContent = data.id;
      jobStateEl.textContent = data.status;

      if (data.status === 'ready' || data.status === 'done') {
        stopPoll();
        onReady(data);
        return;
      }
      if (data.status === 'error') {
        stopPoll();
        setBusy(false);
        showPhase(currentDraft ? 'review' : 'brief');
        const errTarget = currentDraft ? reviewErrorEl : errorEl;
        showError(
          errTarget,
          'The worker failed on this job. Adjust the brief or message and try again.'
        );
      }
    };
    await tick();
    pollTimer = setInterval(() => {
      tick().catch((err) => {
        stopPoll();
        setBusy(false);
        showError(errorEl, err.message || 'Status check failed');
        showPhase(currentDraft ? 'review' : 'brief');
      });
    }, 5000);
  }

  async function submitJob({ type, refineMessage, priorDraft }) {
    const payload = {
      ...briefPayload(),
      type,
      attachments: attachmentPayload(),
    };
    if (priorDraft) payload.priorDraft = priorDraft;
    if (refineMessage) payload.refineMessage = refineMessage;

    const created = await api('/api/deck/jobs', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    return created;
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    showError(errorEl, '');
    stopPoll();
    setBusy(true);
    chat = [];
    currentDraft = '';
    iterationCount = 0;

    try {
      setStep('review');
      waitingTitle.textContent = 'Drafting outline…';
      waitingNote.textContent =
        'The Cursor worker is writing slide text for you to review. No PowerPoint yet.';
      showPhase('waiting');

      const created = await submitJob({ type: 'draft' });
      await pollUntilDone(created.id, {
        onReady: (data) => {
          iterationCount = 1;
          const draft =
            data.draft ||
            data.summary ||
            'Draft completed but no draft.md was returned. Ask for a full slide outline.';
          chat = [
            {
              role: 'assistant',
              text: 'Here is a first outline and format preview. Ask for content or look-and-feel changes, or generate the PowerPoint when you are happy.',
            },
          ];
          enterReview(draft, data.summary);
        },
      });
    } catch (err) {
      showError(errorEl, err.message || 'Could not start draft');
      setBusy(false);
      showPhase('brief');
    }
  });

  refineForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    showError(reviewErrorEl, '');
    const message = document.getElementById('refineMessage').value.trim();
    if (message.length < 3) {
      showError(reviewErrorEl, 'Describe the change you want (a few words at least).');
      return;
    }
    if (!currentDraft) {
      showError(reviewErrorEl, 'No draft to refine yet.');
      return;
    }

    chat.push({ role: 'user', text: message });
    renderChat();
    document.getElementById('refineMessage').value = '';
    setBusy(true);
    stopPoll();

    try {
      setStep('review');
      waitingTitle.textContent = 'Updating draft…';
      waitingNote.textContent = 'Applying your feedback to the slide outline.';
      showPhase('waiting');

      const created = await submitJob({
        type: 'draft',
        priorDraft: currentDraft,
        refineMessage: message,
      });
      await pollUntilDone(created.id, {
        onReady: (data) => {
          iterationCount += 1;
          const draft = data.draft || currentDraft;
          chat.push({
            role: 'assistant',
            text:
              data.summary ||
              'Draft updated. Review the text and format preview, refine again, or generate the PowerPoint.',
          });
          enterReview(draft);
        },
      });
    } catch (err) {
      showError(reviewErrorEl, err.message || 'Could not update draft');
      setBusy(false);
      showPhase('review');
    }
  });

  generateBtn.addEventListener('click', async () => {
    showError(reviewErrorEl, '');
    if (!currentDraft || currentDraft.length < 40) {
      showError(reviewErrorEl, 'Need a solid draft before generating PowerPoint.');
      return;
    }
    if (iterationCount < 1) {
      showError(reviewErrorEl, 'Create a draft first, then generate.');
      return;
    }

    const confirmGen = window.confirm(
      'Generate the PowerPoint from the current slide text?\n\nYou can still request changes afterward and regenerate.'
    );
    if (!confirmGen) return;

    setBusy(true);
    stopPoll();
    try {
      setStep('generate');
      waitingTitle.textContent = 'Creating PowerPoint…';
      waitingNote.textContent =
        'Building the .pptx from your approved draft. This can take several minutes.';
      showPhase('waiting');

      const created = await submitJob({
        type: 'generate',
        priorDraft: currentDraft,
        refineMessage:
          iterationCount > 1
            ? `User approved after ${iterationCount} draft iterations.`
            : 'User approved the first draft for PowerPoint generation.',
      });
      await pollUntilDone(created.id, {
        onReady: (data) => {
          if (!data.downloadAvailable && data.status === 'done') {
            showError(
              reviewErrorEl,
              'Job finished but no .pptx was found. Refine the draft and try Generate again.'
            );
            setBusy(false);
            showPhase('review');
            return;
          }
          enterReady(data);
        },
      });
    } catch (err) {
      showError(reviewErrorEl, err.message || 'Could not start generation');
      setBusy(false);
      showPhase('review');
    }
  });

  reviseBtn.addEventListener('click', () => {
    showError(readyErrorEl, '');
    chat.push({
      role: 'assistant',
      text: 'What should change (content or formatting)? Update the draft, then press Generate PowerPoint again when ready.',
    });
    renderChat();
    draftView.textContent = currentDraft;
    renderSlidePreview(currentDraft);
    showPhase('review');
    setStep('review');
  });

  startOverBtn.addEventListener('click', () => {
    stopPoll();
    stopMic(briefMicBtn, briefMicHint);
    stopMic(refineMicBtn, refineMicHint);
    chat = [];
    currentDraft = '';
    iterationCount = 0;
    lastPptxJobId = null;
    document.getElementById('refineMessage').value = '';
    slidePreview.innerHTML = '';
    styleNotes.hidden = true;
    showError(errorEl, '');
    showError(reviewErrorEl, '');
    showError(readyErrorEl, '');
    setBusy(false);
    showPhase('brief');
  });

  showPhase('brief');
})();
