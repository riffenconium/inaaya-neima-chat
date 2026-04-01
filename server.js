const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const session = require('express-session');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const app = express();
const server = http.createServer(app);

// Data directory (mount Railway volume here)
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');
fs.mkdirSync(UPLOADS_DIR, { recursive: true });

// Database
const db = new Database(path.join(DATA_DIR, 'chat.db'));
db.pragma('journal_mode = WAL');
db.exec(`
  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sender TEXT NOT NULL,
    type TEXT NOT NULL DEFAULT 'text',
    content TEXT,
    filename TEXT,
    original_name TEXT,
    mimetype TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  )
`);

// Users
const USERS = {
  Inaaya: 'Inaaya786',
  Neima: 'Neima786',
};

// Session middleware
const sessionMiddleware = session({
  secret: process.env.SESSION_SECRET || 'inaaya-neima-private-chat-2026',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 30 * 24 * 60 * 60 * 1000 },
});

app.use(sessionMiddleware);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));
app.use('/uploads', express.static(UPLOADS_DIR));

// Socket.io
const io = new Server(server);
io.use((socket, next) => {
  sessionMiddleware(socket.request, {}, next);
});

// Auth middleware
function requireAuth(req, res, next) {
  if (req.session && req.session.user) return next();
  res.redirect('/');
}

// Multer
const storage = multer.diskStorage({
  destination: UPLOADS_DIR,
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`);
  },
});
const upload = multer({ storage, limits: { fileSize: 50 * 1024 * 1024 } });

// --- Routes ---

app.get('/', (req, res) => {
  if (req.session && req.session.user) return res.redirect('/chat');
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.post('/login', (req, res) => {
  const { username, password } = req.body;
  if (USERS[username] && USERS[username] === password) {
    req.session.user = username;
    return res.redirect('/chat');
  }
  res.redirect('/?error=1');
});

app.get('/chat', requireAuth, (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'chat.html'));
});

app.get('/api/me', requireAuth, (req, res) => {
  res.json({ user: req.session.user });
});

app.get('/api/messages', requireAuth, (_req, res) => {
  const messages = db.prepare('SELECT * FROM messages ORDER BY id ASC').all();
  res.json(messages);
});

app.post('/api/upload', requireAuth, upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file' });

  let type = 'file';
  if (req.file.mimetype.startsWith('image/')) type = 'image';
  else if (req.file.mimetype.startsWith('video/')) type = 'video';
  else if (req.file.mimetype.startsWith('audio/')) type = 'audio';

  res.json({
    filename: req.file.filename,
    originalname: req.file.originalname,
    mimetype: req.file.mimetype,
    type,
  });
});

app.post('/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/');
});

// --- Socket.io ---

const onlineUsers = new Set();

io.on('connection', (socket) => {
  const user = socket.request.session?.user;
  if (!user) return socket.disconnect();

  onlineUsers.add(user);
  io.emit('online-users', Array.from(onlineUsers));

  socket.on('send-message', (data) => {
    const stmt = db.prepare(
      'INSERT INTO messages (sender, type, content, filename, original_name, mimetype) VALUES (?, ?, ?, ?, ?, ?)'
    );
    const result = stmt.run(
      user,
      data.type || 'text',
      data.content || null,
      data.filename || null,
      data.originalname || null,
      data.mimetype || null
    );
    const message = db.prepare('SELECT * FROM messages WHERE id = ?').get(result.lastInsertRowid);
    io.emit('new-message', message);
  });

  socket.on('typing', () => {
    socket.broadcast.emit('user-typing', user);
  });

  socket.on('stop-typing', () => {
    socket.broadcast.emit('user-stop-typing', user);
  });

  socket.on('disconnect', () => {
    onlineUsers.delete(user);
    io.emit('online-users', Array.from(onlineUsers));
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Inaaya & Neima chat running on port ${PORT}`);
});
