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

  function startRecording() {
    navigator.mediaDevices
      .getUserMedia({ audio: true })
      .then((stream) => {
        audioChunks = [];
        mediaRecorder = new MediaRecorder(stream);

        mediaRecorder.ondataavailable = (e) => audioChunks.push(e.data);
        mediaRecorder.onstop = () => {
          stream.getTracks().forEach((t) => t.stop());
          const blob = new Blob(audioChunks, { type: 'audio/webm' });
          const file = new File([blob], `voice-${Date.now()}.webm`, {
            type: 'audio/webm',
          });
          uploadAndSend(file);
        };

        mediaRecorder.start();
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

  // Fullscreen image viewer
  window.viewImage = function (src) {
    const viewer = document.createElement('div');
    viewer.className = 'image-viewer';
    viewer.innerHTML = `<img src="${src}">`;
    viewer.onclick = () => viewer.remove();
    document.body.appendChild(viewer);
  };
})();
