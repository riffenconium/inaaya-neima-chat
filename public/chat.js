(function () {
  const socket = io();
  let currentUser = null;
  let otherUser = null;
  let typingTimeout = null;
  let mediaRecorder = null;
  let audioChunks = [];
  let recordingTimer = null;
  let recordingSeconds = 0;
  let pendingFile = null;

  const messagesEl = document.getElementById('messages');
  const input = document.getElementById('message-input');
  const sendBtn = document.getElementById('send-btn');
  const attachBtn = document.getElementById('attach-btn');
  const voiceBtn = document.getElementById('voice-btn');
  const fileInput = document.getElementById('file-input');
  const typingEl = document.getElementById('typing');
  const typingName = document.getElementById('typing-name');
  const statusEl = document.getElementById('online-status');
  const chatWithEl = document.getElementById('chat-with');
  const avatarEl = document.getElementById('avatar');
  const mediaPreview = document.getElementById('media-preview');
  const previewContent = document.getElementById('preview-content');
  const cancelPreview = document.getElementById('cancel-preview');
  const sendPreview = document.getElementById('send-preview');

  // Init
  fetch('/api/me')
    .then((r) => r.json())
    .then((data) => {
      currentUser = data.user;
      otherUser = currentUser === 'Inaaya' ? 'Neima' : 'Inaaya';
      chatWithEl.textContent = otherUser;
      avatarEl.textContent = otherUser[0];
      loadMessages();
    });

  // Load message history
  function loadMessages() {
    fetch('/api/messages')
      .then((r) => r.json())
      .then((messages) => {
        messagesEl.innerHTML = '';
        let lastDate = null;
        messages.forEach((msg) => {
          const msgDate = formatDate(msg.created_at);
          if (msgDate !== lastDate) {
            addDateDivider(msgDate);
            lastDate = msgDate;
          }
          appendMessage(msg, false);
        });
        scrollToBottom();
      });
  }

  // Send text message
  function sendText() {
    const text = input.value.trim();
    if (!text) return;
    socket.emit('send-message', { type: 'text', content: text });
    input.value = '';
    input.style.height = 'auto';
    socket.emit('stop-typing');
  }

  sendBtn.addEventListener('click', sendText);

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendText();
    }
  });

  // Auto-resize textarea
  input.addEventListener('input', () => {
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 120) + 'px';

    socket.emit('typing');
    clearTimeout(typingTimeout);
    typingTimeout = setTimeout(() => socket.emit('stop-typing'), 2000);
  });

  // File attach
  attachBtn.addEventListener('click', () => fileInput.click());

  fileInput.addEventListener('change', () => {
    const file = fileInput.files[0];
    if (!file) return;
    showPreview(file);
    fileInput.value = '';
  });

  // Preview before sending
  function showPreview(file) {
    pendingFile = file;
    previewContent.innerHTML = '';

    const url = URL.createObjectURL(file);
    if (file.type.startsWith('image/')) {
      const img = document.createElement('img');
      img.src = url;
      previewContent.appendChild(img);
    } else if (file.type.startsWith('video/')) {
      const vid = document.createElement('video');
      vid.src = url;
      vid.controls = true;
      previewContent.appendChild(vid);
    } else if (file.type.startsWith('audio/')) {
      const aud = document.createElement('audio');
      aud.src = url;
      aud.controls = true;
      previewContent.appendChild(aud);
    } else {
      previewContent.innerHTML = `<div style="color:#fff;font-size:18px">${file.name}</div>`;
    }

    mediaPreview.style.display = 'flex';
  }

  cancelPreview.addEventListener('click', () => {
    mediaPreview.style.display = 'none';
    pendingFile = null;
  });

  sendPreview.addEventListener('click', () => {
    if (!pendingFile) return;
    uploadAndSend(pendingFile);
    mediaPreview.style.display = 'none';
    pendingFile = null;
  });

  // Upload file then send socket message
  function uploadAndSend(file) {
    const form = new FormData();
    form.append('file', file);

    fetch('/api/upload', { method: 'POST', body: form })
      .then((r) => r.json())
      .then((data) => {
        socket.emit('send-message', {
          type: data.type,
          filename: data.filename,
          originalname: data.originalname,
          mimetype: data.mimetype,
        });
      })
      .catch((err) => console.error('Upload failed:', err));
  }

  // Voice recording
  voiceBtn.addEventListener('click', toggleRecording);

  function toggleRecording() {
    if (mediaRecorder && mediaRecorder.state === 'recording') {
      stopRecording();
    } else {
      startRecording();
    }
  }

  function getSupportedMime() {
    const types = [
      'audio/webm;codecs=opus',
      'audio/webm',
      'audio/mp4',
      'audio/ogg;codecs=opus',
      'audio/ogg',
    ];
    for (const t of types) {
      if (MediaRecorder.isTypeSupported(t)) return t;
    }
    return '';
  }

  function startRecording() {
    navigator.mediaDevices
      .getUserMedia({ audio: true })
      .then((stream) => {
        audioChunks = [];
        const mimeType = getSupportedMime();
        const options = mimeType ? { mimeType } : {};
        mediaRecorder = new MediaRecorder(stream, options);
        const actualMime = mediaRecorder.mimeType || mimeType || 'audio/webm';
        const ext = actualMime.includes('mp4') ? 'mp4' : actualMime.includes('ogg') ? 'ogg' : 'webm';

        mediaRecorder.ondataavailable = (e) => {
          if (e.data && e.data.size > 0) audioChunks.push(e.data);
        };
        mediaRecorder.onstop = () => {
          stream.getTracks().forEach((t) => t.stop());
          if (audioChunks.length === 0) return;
          const blob = new Blob(audioChunks, { type: actualMime });
          const file = new File([blob], `voice-${Date.now()}.${ext}`, {
            type: actualMime,
          });
          uploadAndSend(file);
        };

        mediaRecorder.start(500);
        voiceBtn.classList.add('recording');

        // Show timer
        recordingSeconds = 0;
        const timerEl = document.createElement('span');
        timerEl.className = 'recording-timer';
        timerEl.id = 'rec-timer';
        timerEl.textContent = '0:00';
        voiceBtn.parentNode.insertBefore(timerEl, voiceBtn);

        recordingTimer = setInterval(() => {
          recordingSeconds++;
          const m = Math.floor(recordingSeconds / 60);
          const s = String(recordingSeconds % 60).padStart(2, '0');
          timerEl.textContent = `${m}:${s}`;
        }, 1000);
      })
      .catch(() => alert('Microphone access denied'));
  }

  function stopRecording() {
    if (mediaRecorder) {
      mediaRecorder.stop();
      voiceBtn.classList.remove('recording');
      clearInterval(recordingTimer);
      const timer = document.getElementById('rec-timer');
      if (timer) timer.remove();
    }
  }

  // Socket events
  socket.on('new-message', (msg) => {
    const shouldScroll = isNearBottom();
    appendMessage(msg, true);
    if (shouldScroll || msg.sender === currentUser) scrollToBottom();
  });

  socket.on('online-users', (users) => {
    const isOnline = users.includes(otherUser);
    statusEl.textContent = isOnline ? 'online' : 'offline';
    statusEl.className = 'status' + (isOnline ? ' online' : '');
  });

  socket.on('user-typing', (user) => {
    if (user !== currentUser) {
      typingName.textContent = user;
      typingEl.classList.add('visible');
    }
  });

  socket.on('user-stop-typing', () => {
    typingEl.classList.remove('visible');
  });

  // Render message
  function appendMessage(msg, animate) {
    const div = document.createElement('div');
    const isSent = msg.sender === currentUser;
    div.className = `message ${isSent ? 'sent' : 'received'}`;
    if (!animate) div.style.animation = 'none';

    let content = '';

    switch (msg.type) {
      case 'image':
        content = `<img src="/uploads/${msg.filename}" alt="image" onclick="viewImage(this.src)" loading="lazy">`;
        break;
      case 'video':
        content = `<video src="/uploads/${msg.filename}" controls preload="metadata"></video>`;
        break;
      case 'audio':
        content = `<audio src="/uploads/${msg.filename}" controls preload="metadata"></audio>`;
        break;
      case 'file':
        content = `<a class="file-link" href="/uploads/${msg.filename}" download="${msg.original_name || msg.filename}">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
          ${msg.original_name || msg.filename}
        </a>`;
        break;
      default:
        content = escapeHtml(msg.content);
    }

    div.innerHTML = `
      <div class="bubble">${content}</div>
      <span class="time">${formatTime(msg.created_at)}</span>
    `;

    messagesEl.appendChild(div);
  }

  // Helpers
  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML.replace(/\n/g, '<br>');
  }

  function formatTime(dateStr) {
    const d = new Date(dateStr + 'Z');
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  function formatDate(dateStr) {
    const d = new Date(dateStr + 'Z');
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    if (d.toDateString() === today.toDateString()) return 'Today';
    if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
    return d.toLocaleDateString([], {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  }

  function addDateDivider(dateText) {
    const div = document.createElement('div');
    div.className = 'date-divider';
    div.innerHTML = `<span>${dateText}</span>`;
    messagesEl.appendChild(div);
  }

  function scrollToBottom() {
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function isNearBottom() {
    return (
      messagesEl.scrollHeight - messagesEl.scrollTop - messagesEl.clientHeight <
      100
    );
  }

  // ========== DRAWING ==========

  const drawOverlay = document.getElementById('draw-overlay');
  const drawCanvas = document.getElementById('draw-canvas');
  const drawCanvasWrap = document.getElementById('draw-canvas-wrap');
  const drawBtn = document.getElementById('draw-btn');
  const drawClose = document.getElementById('draw-close');
  const drawSend = document.getElementById('draw-send');
  const drawUndo = document.getElementById('draw-undo');
  const drawClear = document.getElementById('draw-clear');
  const brushSize = document.getElementById('brush-size');
  const colorBtns = document.querySelectorAll('.color-btn');
  const ctx = drawCanvas.getContext('2d');

  let drawing = false;
  let drawColor = '#1a1a2e';
  let drawSize = 4;
  let drawHistory = []; // saved canvas states for undo
  let lastPoint = null;

  function openDrawing() {
    drawOverlay.style.display = 'flex';
    resizeCanvas();
    clearCanvas();
    drawHistory = [];
  }

  function closeDrawing() {
    drawOverlay.style.display = 'none';
  }

  function resizeCanvas() {
    const rect = drawCanvasWrap.getBoundingClientRect();
    // Use a fixed aspect ratio canvas that fits the container
    const w = Math.min(rect.width - 8, 600);
    const h = Math.min(rect.height - 8, 600);
    drawCanvas.width = w;
    drawCanvas.height = h;
    drawCanvas.style.width = w + 'px';
    drawCanvas.style.height = h + 'px';
  }

  function clearCanvas() {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, drawCanvas.width, drawCanvas.height);
  }

  function saveState() {
    if (drawHistory.length > 50) drawHistory.shift();
    drawHistory.push(drawCanvas.toDataURL());
  }

  function undo() {
    if (drawHistory.length === 0) return;
    const img = new Image();
    img.onload = () => {
      ctx.clearRect(0, 0, drawCanvas.width, drawCanvas.height);
      ctx.drawImage(img, 0, 0);
    };
    img.src = drawHistory.pop();
  }

  function getCanvasPos(e) {
    const rect = drawCanvas.getBoundingClientRect();
    const touch = e.touches ? e.touches[0] : e;
    return {
      x: touch.clientX - rect.left,
      y: touch.clientY - rect.top,
    };
  }

  function startDraw(e) {
    e.preventDefault();
    drawing = true;
    saveState();
    lastPoint = getCanvasPos(e);
    // Draw a dot for single taps
    ctx.beginPath();
    ctx.arc(lastPoint.x, lastPoint.y, drawSize / 2, 0, Math.PI * 2);
    ctx.fillStyle = drawColor;
    ctx.fill();
  }

  function moveDraw(e) {
    e.preventDefault();
    if (!drawing) return;
    const point = getCanvasPos(e);
    ctx.beginPath();
    ctx.moveTo(lastPoint.x, lastPoint.y);
    ctx.lineTo(point.x, point.y);
    ctx.strokeStyle = drawColor;
    ctx.lineWidth = drawSize;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.stroke();
    lastPoint = point;
  }

  function endDraw(e) {
    e.preventDefault();
    drawing = false;
    lastPoint = null;
  }

  // Mouse events
  drawCanvas.addEventListener('mousedown', startDraw);
  drawCanvas.addEventListener('mousemove', moveDraw);
  drawCanvas.addEventListener('mouseup', endDraw);
  drawCanvas.addEventListener('mouseleave', endDraw);

  // Touch events
  drawCanvas.addEventListener('touchstart', startDraw, { passive: false });
  drawCanvas.addEventListener('touchmove', moveDraw, { passive: false });
  drawCanvas.addEventListener('touchend', endDraw, { passive: false });
  drawCanvas.addEventListener('touchcancel', endDraw, { passive: false });

  // Color selection
  colorBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      colorBtns.forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      drawColor = btn.dataset.color;
    });
  });

  // Brush size
  brushSize.addEventListener('input', () => {
    drawSize = parseInt(brushSize.value);
  });

  // Buttons
  drawBtn.addEventListener('click', openDrawing);
  drawClose.addEventListener('click', closeDrawing);
  drawUndo.addEventListener('click', undo);
  drawClear.addEventListener('click', () => {
    saveState();
    clearCanvas();
  });

  drawSend.addEventListener('click', () => {
    drawCanvas.toBlob((blob) => {
      if (!blob) return;
      const file = new File([blob], `drawing-${Date.now()}.png`, {
        type: 'image/png',
      });
      uploadAndSend(file);
      closeDrawing();
    }, 'image/png');
  });

  // Handle resize
  window.addEventListener('resize', () => {
    if (drawOverlay.style.display !== 'none') {
      // Save current drawing, resize, restore
      const data = drawCanvas.toDataURL();
      resizeCanvas();
      const img = new Image();
      img.onload = () => ctx.drawImage(img, 0, 0);
      img.src = data;
    }
  });

  // Fullscreen image viewer
  window.viewImage = function (src) {
    const viewer = document.createElement('div');
    viewer.className = 'image-viewer';
    viewer.innerHTML = `<img src="${src}">`;
    viewer.onclick = () => viewer.remove();
    document.body.appendChild(viewer);
  };
})();
