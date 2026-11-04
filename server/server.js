#!/usr/bin/env node
/*
 * 社區智慧健康站 分層管理與閉環追蹤後台 — 院內伺服器
 *
 * 只用 Node.js 內建模組（零第三方套件），需要 Node.js 22 LTS 以上。
 * 規則引擎（health-tracking/engine.js）在伺服器端執行；誰做了什麼由登入身分決定。
 *
 *   初始化（產生資料金鑰與管理者帳號）：node server.js init
 *   啟動：                              node server.js
 *   重設密碼：                          node server.js reset-password <帳號>
 *   驗證稽核紀錄完整性：                node server.js verify-audit
 *
 * 設定（環境變數）見 DEPLOY.md。
 */
'use strict';
const http = require('node:http');
const https = require('node:https');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const E = require('../health-tracking/engine.js');

// ───────────────────────── 設定 ─────────────────────────
const CFG = {
  port: +(process.env.CHC_PORT || 8080),
  host: process.env.CHC_HOST || '127.0.0.1', // 預設只聽本機，由 IIS／nginx 反向代理對外
  dataDir: path.resolve(process.env.CHC_DATA_DIR || path.join(__dirname, 'data')),
  keyFile: process.env.CHC_KEY_FILE || '',
  tlsCert: process.env.CHC_TLS_CERT || '',
  tlsKey: process.env.CHC_TLS_KEY || '',
  secureCookie: process.env.CHC_SECURE_COOKIE !== 'false',
  trustProxy: process.env.CHC_TRUST_PROXY === 'true',
  idleMin: +(process.env.CHC_IDLE_MIN || 15),
  absoluteHours: +(process.env.CHC_SESSION_HOURS || 8),
  backupDays: +(process.env.CHC_BACKUP_DAYS || 30),
};
const STATIC_DIR = path.resolve(__dirname, '..', 'health-tracking');
const STATIC_FILES = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']], ['/index.html', ['index.html', 'text/html; charset=utf-8']],
  ['/app.js', ['app.js', 'text/javascript; charset=utf-8']], ['/engine.js', ['engine.js', 'text/javascript; charset=utf-8']],
  ['/rx-library.js', ['rx-library.js', 'text/javascript; charset=utf-8']], ['/vault.js', ['vault.js', 'text/javascript; charset=utf-8']],
  ['/xlsx-reader.js', ['xlsx-reader.js', 'text/javascript; charset=utf-8']], ['/demo.js', ['demo.js', 'text/javascript; charset=utf-8']],
]);
const keyPath = () => CFG.keyFile || path.join(CFG.dataDir, 'data.key');
const dbPath = () => path.join(CFG.dataDir, 'db.enc');
const auditPath = () => path.join(CFG.dataDir, 'audit.log');

// ───────────────────────── 資料加密存放（AES-256-GCM） ─────────────────────────
let DATA_KEY = null;
function loadKey() {
  const k = Buffer.from(fs.readFileSync(keyPath(), 'utf8').trim(), 'base64');
  if (k.length !== 32) throw new Error('資料金鑰長度不正確');
  DATA_KEY = k;
}
function sealFile(obj) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', DATA_KEY, iv);
  c.setAAD(Buffer.from('chc-server-db'));
  const ct = Buffer.concat([c.update(JSON.stringify(obj), 'utf8'), c.final()]);
  return JSON.stringify({ v: 1, alg: 'AES-256-GCM', iv: iv.toString('base64'), tag: c.getAuthTag().toString('base64'), ct: ct.toString('base64') });
}
function openFile(text) {
  const env = JSON.parse(text);
  const d = crypto.createDecipheriv('aes-256-gcm', DATA_KEY, Buffer.from(env.iv, 'base64'));
  d.setAAD(Buffer.from('chc-server-db'));
  d.setAuthTag(Buffer.from(env.tag, 'base64'));
  return JSON.parse(Buffer.concat([d.update(Buffer.from(env.ct, 'base64')), d.final()]).toString('utf8'));
}
// 原子寫入：寫暫存檔 → fsync → rename，避免寫到一半斷電造成資料毀損
function atomicWrite(file, text, mode = 0o600) {
  const tmp = file + '.tmp';
  const fd = fs.openSync(tmp, 'w', mode);
  try { fs.writeSync(fd, text); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  fs.renameSync(tmp, file);
}

let DB = null;
function loadDb() {
  DB = fs.existsSync(dbPath()) ? openFile(fs.readFileSync(dbPath(), 'utf8')) : null;
  if (!DB) throw new Error('尚未初始化，請先執行：node server.js init');
  if (DB.schema !== E.SCHEMA) E.migrateWorkflow(DB);
}
function persist() {
  const text = sealFile(DB);
  atomicWrite(dbPath(), text);
  // 每日備份一份（加密），保留 CHC_BACKUP_DAYS 天
  const day = new Date().toISOString().slice(0, 10);
  const bdir = path.join(CFG.dataDir, 'backup');
  fs.mkdirSync(bdir, { recursive: true, mode: 0o700 });
  const bfile = path.join(bdir, `db-${day}.enc`);
  if (!fs.existsSync(bfile)) {
    atomicWrite(bfile, text);
    const all = fs.readdirSync(bdir).filter((f) => /^db-\d{4}-\d{2}-\d{2}\.enc$/.test(f)).sort();
    for (const f of all.slice(0, Math.max(0, all.length - CFG.backupDays))) fs.unlinkSync(path.join(bdir, f));
  }
}

// ───────────────────────── 稽核紀錄（只增不改，雜湊鏈防竄改） ─────────────────────────
let auditTail = { seq: 0, hash: 'GENESIS' };
function auditInit() {
  if (!fs.existsSync(auditPath())) return;
  const lines = fs.readFileSync(auditPath(), 'utf8').trim().split('\n').filter(Boolean);
  if (lines.length) { const last = JSON.parse(lines[lines.length - 1]); auditTail = { seq: last.seq, hash: last.hash }; }
}
function audit(req, action, target, detail) {
  const entry = { seq: auditTail.seq + 1, at: new Date().toISOString(), user: req && req.user ? req.user.username : '-', ip: req ? clientIp(req) : '-', action, target: target || '', detail: detail || '', prev: auditTail.hash };
  entry.hash = crypto.createHash('sha256').update(JSON.stringify(entry)).digest('hex');
  fs.appendFileSync(auditPath(), JSON.stringify(entry) + '\n', { mode: 0o600 });
  auditTail = { seq: entry.seq, hash: entry.hash };
}
function verifyAudit() {
  if (!fs.existsSync(auditPath())) return { ok: true, count: 0 };
  const lines = fs.readFileSync(auditPath(), 'utf8').trim().split('\n').filter(Boolean);
  let prev = 'GENESIS';
  for (let i = 0; i < lines.length; i++) {
    const e = JSON.parse(lines[i]);
    const { hash, ...rest } = e;
    if (e.prev !== prev || e.seq !== i + 1) return { ok: false, count: lines.length, brokenAt: i + 1 };
    if (crypto.createHash('sha256').update(JSON.stringify(rest)).digest('hex') !== hash) return { ok: false, count: lines.length, brokenAt: i + 1 };
    prev = hash;
  }
  return { ok: true, count: lines.length };
}

// ───────────────────────── 帳號與密碼（scrypt） ─────────────────────────
const SCRYPT = { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
function checkPasswordPolicy(pw) {
  if (typeof pw !== 'string' || pw.length < 12) throw new Error('密碼至少 12 個字元');
  if (pw.length > 200) throw new Error('密碼過長');
  if (/^(.)\1+$/.test(pw)) throw new Error('密碼不可全為相同字元');
}
function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(pw.normalize('NFC'), salt, 64, SCRYPT);
  return { salt: salt.toString('base64'), hash: hash.toString('base64'), N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p };
}
const DUMMY = hashPassword('dummy-password-for-timing');
function verifyPassword(pw, rec) {
  const r = rec || DUMMY;
  const h = crypto.scryptSync(String(pw).normalize('NFC'), Buffer.from(r.salt, 'base64'), 64, { N: r.N, r: r.r, p: r.p, maxmem: SCRYPT.maxmem });
  return crypto.timingSafeEqual(h, Buffer.from(r.hash, 'base64')) && !!rec;
}
const randomPassword = () => crypto.randomBytes(12).toString('base64url');
const USERNAME = /^[a-zA-Z0-9._-]{3,32}$/;
const publicUser = (u) => ({ username: u.username, name: u.name, role: u.role, sites: u.sites, disabled: !!u.disabled, mustChange: !!u.mustChange });

// ───────────────────────── 工作階段與防暴力破解 ─────────────────────────
const SESSIONS = new Map();
const FAILS = new Map(); // key -> { n, until }
function clientIp(req) {
  if (CFG.trustProxy && req.headers['x-forwarded-for']) return String(req.headers['x-forwarded-for']).split(',')[0].trim();
  return req.socket.remoteAddress || '';
}
function throttled(key) { const f = FAILS.get(key); return f && f.until > Date.now() ? Math.ceil((f.until - Date.now()) / 1000) : 0; }
function noteFail(key) {
  const f = FAILS.get(key) || { n: 0, until: 0 };
  f.n++;
  if (f.n >= 5) f.until = Date.now() + Math.min(60, 15 * Math.pow(2, f.n - 5)) * 60000;
  FAILS.set(key, f);
}
function newSession(user) {
  const sid = crypto.randomBytes(32).toString('base64url');
  SESSIONS.set(sid, { username: user.username, created: Date.now(), last: Date.now(), csrf: crypto.randomBytes(24).toString('base64url') });
  return sid;
}
function cookieOf(req, name) {
  const c = req.headers.cookie || '';
  for (const part of c.split(';')) { const [k, ...v] = part.trim().split('='); if (k === name) return v.join('='); }
  return null;
}
function sessionOf(req) {
  const sid = cookieOf(req, 'chc_sid');
  const s = sid && SESSIONS.get(sid);
  if (!s) return null;
  const now = Date.now();
  if (now - s.last > CFG.idleMin * 60000 || now - s.created > CFG.absoluteHours * 3600000) { SESSIONS.delete(sid); return null; }
  const user = DB.users.find((u) => u.username === s.username && !u.disabled);
  if (!user) { SESSIONS.delete(sid); return null; }
  if (!req.headers['x-chc-poll']) s.last = now; // 背景自動更新不延長閒置時間
  return { sid, s, user };
}
function setCookie(res, sid, maxAgeSec) {
  res.setHeader('Set-Cookie', `chc_sid=${sid}; Path=/; HttpOnly; SameSite=Strict${CFG.secureCookie ? '; Secure' : ''}${maxAgeSec === 0 ? '; Max-Age=0' : ''}`);
}

// ───────────────────────── 權限：依據點分權 ─────────────────────────
const isAdmin = (u) => u.role === 'admin';
const siteAllowed = (u, site) => u.sites.includes('*') || u.sites.includes(site);
function scoped(u) {
  const persons = DB.persons.filter((p) => siteAllowed(u, p.site));
  const ids = new Set(persons.map((p) => p.id));
  const mask = (p) => Object.assign({}, p, { nationalId: p.nationalId ? E.maskId(p.nationalId) : null, phone: p.phone ? String(p.phone).replace(/\d(?=\d{3})/g, (d, i) => (i > 3 ? '•' : d)) : null });
  return {
    server: true, persons: persons.map(mask),
    measurements: DB.measurements.filter((m) => ids.has(m.personId)),
    episodes: DB.episodes.filter((e) => ids.has(e.personId)),
    settings: Object.assign({}, DB.settings, { nurses: DB.users.filter((x) => !x.disabled && x.role === 'nurse').map((x) => x.name) }),
    sites: [...new Set(DB.persons.map((p) => p.site))].sort(),
    rulesVersion: DB.rulesVersion, schema: DB.schema,
  };
}
function personFor(u, id) {
  const p = DB.persons.find((x) => x.id === id);
  if (!p || !siteAllowed(u, p.site)) { const e = new Error('找不到此民眾或無權限'); e.status = 404; throw e; }
  return p;
}
const sla = () => Object.assign({}, E.DEFAULT_SLA, (DB.settings && DB.settings.sla) || {});

// ───────────────────────── HTTP ─────────────────────────
const CSP = "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; form-action 'none'; base-uri 'none'; object-src 'none'; frame-src 'none'; frame-ancestors 'none'; worker-src 'none'; manifest-src 'none'";
function securityHeaders(res) {
  res.setHeader('Content-Security-Policy', CSP);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=()');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  res.setHeader('Cache-Control', 'no-store');
  if (CFG.secureCookie) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
}
function send(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body) });
  res.end(body);
}
function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    if (!/^application\/json/i.test(req.headers['content-type'] || '')) { const e = new Error('只接受 JSON'); e.status = 415; return reject(e); }
    let n = 0; const parts = [];
    req.on('data', (c) => {
      if (n > limit) return; // 已超過上限：丟棄其餘內容，不暫存
      n += c.length;
      if (n > limit) { const e = new Error('資料量過大'); e.status = 413; parts.length = 0; reject(e); } else parts.push(c);
    });
    req.on('end', () => { try { resolve(n ? JSON.parse(Buffer.concat(parts).toString('utf8')) : {}); } catch (e) { const x = new Error('JSON 格式錯誤'); x.status = 400; reject(x); } });
    req.on('error', reject);
  });
}
function sameOrigin(req) {
  const o = req.headers.origin;
  if (!o) return true;
  try { return new URL(o).host === req.headers.host || (CFG.trustProxy && new URL(o).host === req.headers['x-forwarded-host']); } catch (e) { return false; }
}

const ROUTES = [];
const route = (method, re, opts, fn) => ROUTES.push({ method, re, opts, fn });

route('POST', /^\/api\/login$/, { auth: false, limit: 4096 }, async (req, res, body) => {
  const username = String(body.username || '').trim();
  const ipKey = 'ip:' + clientIp(req), uKey = 'u:' + username.toLowerCase();
  const wait = Math.max(throttled(ipKey), throttled(uKey));
  if (wait) return send(res, 429, { error: `嘗試次數過多，請 ${wait} 秒後再試` });
  const user = DB.users.find((u) => u.username.toLowerCase() === username.toLowerCase());
  const ok = verifyPassword(String(body.password || ''), user && !user.disabled ? user.pw : null);
  if (!ok) { noteFail(ipKey); noteFail(uKey); audit(req, '登入失敗', username.slice(0, 32)); return send(res, 401, { error: '帳號或密碼錯誤' }); }
  FAILS.delete(uKey); FAILS.delete(ipKey);
  const sid = newSession(user);
  setCookie(res, sid);
  req.user = user; audit(req, '登入', '');
  send(res, 200, { user: publicUser(user), csrf: SESSIONS.get(sid).csrf });
});
route('POST', /^\/api\/logout$/, {}, async (req, res) => { SESSIONS.delete(req.sid); setCookie(res, '', 0); audit(req, '登出', ''); send(res, 200, { ok: true }); });
route('GET', /^\/api\/me$/, { auth: false }, async (req, res) => {
  const ss = sessionOf(req);
  if (!ss) return send(res, 401, { mode: 'server', error: '請登入' });
  send(res, 200, { mode: 'server', user: publicUser(ss.user), csrf: ss.s.csrf, idleMin: CFG.idleMin });
});
route('POST', /^\/api\/password$/, { limit: 4096, allowMustChange: true }, async (req, res, body) => {
  if (!verifyPassword(String(body.current || ''), req.user.pw)) { audit(req, '變更密碼失敗', ''); return send(res, 400, { error: '目前密碼錯誤' }); }
  checkPasswordPolicy(body.next);
  if (body.next === body.current) throw new Error('新密碼不可與目前密碼相同');
  req.user.pw = hashPassword(body.next); req.user.mustChange = false;
  for (const [sid, s] of SESSIONS) if (s.username === req.user.username && sid !== req.sid) SESSIONS.delete(sid);
  persist(); audit(req, '變更密碼', '');
  send(res, 200, { user: publicUser(req.user) });
});
route('GET', /^\/api\/data$/, {}, async (req, res) => send(res, 200, { data: scoped(req.user) }));

route('POST', /^\/api\/episodes\/([\w-]{1,64})\/act$/, { limit: 65536 }, async (req, res, body, m) => {
  const ep = DB.episodes.find((e) => e.id === m[1]);
  if (!ep) return send(res, 404, { error: '找不到追蹤案' });
  personFor(req.user, ep.personId);
  const action = String(body.action || '');
  if (!['notify', 'intervene', 'confirm', 'close'].includes(action)) return send(res, 400, { error: '不支援的操作' });
  const p = body.payload || {};
  const payload = {};
  for (const k of ['method', 'note', 'assignee', 'rx', 'visitDate', 'facility', 'result', 'reason', 'followupDate']) if (p[k] != null) payload[k] = String(p[k]).slice(0, k === 'rx' ? 20000 : 500);
  E.act(DB, ep.id, action, payload, new Date().toISOString(), req.user.name, sla());
  persist(); audit(req, '追蹤操作', ep.personId, `${action}（第 ${ep.cycle} 輪）`);
  send(res, 200, { data: scoped(req.user) });
});
route('POST', /^\/api\/persons\/([\w-]{1,64})\/measurements$/, { limit: 16384 }, async (req, res, body, m) => {
  const person = personFor(req.user, m[1]);
  const src = body.m || {};
  const meas = { id: E.uid('m'), personId: person.id, at: new Date(src.at).toISOString(), source: 'manual', symptoms: Array.isArray(src.symptoms) ? src.symptoms.filter((x) => E.SYMPTOMS[x]) : [] };
  for (const k of Object.keys(E.RANGES)) if (src[k] != null && src[k] !== '') meas[k] = Number(src[k]);
  if (src.arr) meas.arr = true;
  if (meas.glucose != null) meas.glucoseType = String(src.glucoseType || '隨機').slice(0, 10);
  const bad = E.validateMeasurement(meas);
  if (bad.length) return send(res, 400, { error: bad.join('；') });
  DB.measurements.push(meas);
  const r = E.ingest(DB, person.id, meas.at, sla());
  persist(); audit(req, '新增量測', person.id, E.LEVEL_LABEL[r.ev.overall] + '層');
  send(res, 200, { data: scoped(req.user), overall: r.ev.overall, emergency: r.ev.emergency });
});
const FLAGS = ['chronic', 'immuno', 'copd', 'medHTN', 'medDM', 'medLipid'];
route('POST', /^\/api\/persons\/([\w-]{1,64})\/flags$/, { limit: 4096 }, async (req, res, body, m) => {
  const person = personFor(req.user, m[1]);
  const patch = body.patch || {};
  for (const k of FLAGS) if (k in patch) person[k] = !!patch[k];
  if ('spo2Baseline' in patch) { const v = patch.spo2Baseline; person.spo2Baseline = v === null || v === '' ? null : Math.min(100, Math.max(70, Number(v))); }
  persist(); audit(req, '更新風險註記', person.id, Object.keys(patch).join(','));
  send(res, 200, { data: scoped(req.user) });
});
route('POST', /^\/api\/persons\/([\w-]{1,64})\/reveal$/, {}, async (req, res, body, m) => {
  const person = personFor(req.user, m[1]);
  audit(req, '查看完整身分證號', person.id);
  send(res, 200, { nationalId: person.nationalId, phone: person.phone });
});
function cleanRosterPerson(r) {
  const s = (v, n) => (v == null ? null : String(v).slice(0, n));
  const nid = r.nationalId && /^[A-Z][1289]\d{8}$/.test(r.nationalId) ? r.nationalId : null;
  const birth = r.birth && /^\d{4}-\d{2}-\d{2}$/.test(r.birth) ? r.birth : null;
  const h = Number(r.heightCm);
  return { name: s(r.name, 50) || '（未填）', sex: ['M', 'F'].includes(r.sex) ? r.sex : null, birth, heightCm: isFinite(h) && h > 50 && h < 250 ? h : null, nationalId: nid, phone: r.phone ? String(r.phone).replace(/[^\d#]/g, '').slice(0, 20) : null, site: s(r.site, 60) || '未分據點' };
}
route('POST', /^\/api\/roster$/, { limit: 20 * 1024 * 1024 }, async (req, res, body) => {
  if (!Array.isArray(body.persons) || body.persons.length > 100000) return send(res, 400, { error: '名冊格式不正確' });
  const r = E.mergeRoster(DB, body.persons.map(cleanRosterPerson), (site) => siteAllowed(req.user, site));
  persist(); audit(req, '匯入名冊', '', `新增 ${r.add}、更新 ${r.upd}、無權限 ${r.denied}`);
  send(res, 200, { data: scoped(req.user), result: r });
});
route('POST', /^\/api\/measurements\/import$/, { limit: 20 * 1024 * 1024 }, async (req, res, body) => {
  if (!Array.isArray(body.rows) || body.rows.length > 200000) return send(res, 400, { error: '量測檔格式不正確' });
  const rows = body.rows.map((r) => (Array.isArray(r) ? r.slice(0, 128).map((c) => (typeof c === 'string' ? c.slice(0, 200) : typeof c === 'number' || typeof c === 'boolean' || c === null ? c : '')) : []));
  // 自動建檔只限管理者（新建檔的民眾先列「未分據點」，一般護理師沒有該據點權限）
  const result = E.importMeasurementRows(DB, rows, sla(), (p) => siteAllowed(req.user, p.site), { createMissing: !!body.createMissing && isAdmin(req.user) });
  persist(); audit(req, '匯入量測', '', `${result.added} 筆、新建檔 ${result.created}、無權限 ${result.denied}`);
  send(res, 200, { data: scoped(req.user), result });
});
route('POST', /^\/api\/export-log$/, { limit: 4096 }, async (req, res, body) => { audit(req, '匯出', '', `${String(body.what || '').slice(0, 60)}（${+body.count || 0} 列）`); send(res, 200, { ok: true }); });

// ── 管理者 ──
route('POST', /^\/api\/settings$/, { admin: true, limit: 16384 }, async (req, res, body) => {
  const num = (v) => (v === null || v === '' ? null : Math.max(0, Math.min(3650, Number(v))));
  const s = body.sla || {}, cur = sla();
  const out = {};
  for (const k of ['notify', 'intervene', 'confirm']) { out[k] = {}; for (const l of ['red', 'orange', 'yellow']) out[k][l] = s[k] && l in s[k] ? num(s[k][l]) : cur[k][l]; }
  out.retest = Object.assign({}, cur.retest); for (const l of ['orange', 'yellow']) if (s.retest && l in s.retest) out.retest[l] = num(s.retest[l]);
  out.phoneAfterVisit = 'phoneAfterVisit' in s ? num(s.phoneAfterVisit) : cur.phoneAfterVisit;
  const t = body.t888 || {};
  const t888 = { lookbackDays: num(t.lookbackDays) ?? 365, entry: ['notified', 'intervened', 'confirmed'].includes(t.entry) ? t.entry : 'notified', downgrade: t.downgrade == 1 ? 1 : 2, target: Math.min(1, Math.max(0.01, Number(t.target) || 0.8)) };
  DB.settings = Object.assign({}, DB.settings, { sla: out, t888 });
  persist(); audit(req, '變更設定', '', '處理時限、健康888 定義');
  send(res, 200, { data: scoped(req.user) });
});
route('POST', /^\/api\/regrade$/, { admin: true }, async (req, res) => {
  const ch = E.regradeOpen(DB, new Date().toISOString(), sla(), req.user.name);
  persist(); audit(req, '依新規則重新判定', '', `${ch.length} 案`);
  send(res, 200, { data: scoped(req.user), changes: ch.length });
});
route('GET', /^\/api\/users$/, { admin: true }, async (req, res) => send(res, 200, { users: DB.users.map(publicUser) }));
route('POST', /^\/api\/users$/, { admin: true, limit: 8192 }, async (req, res, body) => {
  const username = String(body.username || '').trim();
  if (!USERNAME.test(username)) return send(res, 400, { error: '帳號限 3–32 個英數字或 . _ -' });
  let u = DB.users.find((x) => x.username.toLowerCase() === username.toLowerCase());
  const creating = !u;
  if (creating) { u = { username, pw: null, mustChange: true }; DB.users.push(u); }
  if (body.name != null) u.name = String(body.name).trim().slice(0, 30) || username;
  if (body.role != null) { if (!['admin', 'nurse'].includes(body.role)) return send(res, 400, { error: '角色不正確' }); u.role = body.role; }
  if (Array.isArray(body.sites)) u.sites = body.sites.map((x) => String(x).slice(0, 60)).slice(0, 100);
  if (body.disabled != null) {
    if (u.username === req.user.username && body.disabled) return send(res, 400, { error: '不可停用自己的帳號' });
    u.disabled = !!body.disabled;
    if (u.disabled) for (const [sid, s] of SESSIONS) if (s.username === u.username) SESSIONS.delete(sid);
  }
  u.name = u.name || username; u.role = u.role || 'nurse'; u.sites = u.sites || [];
  let temp = null;
  if (creating || body.resetPassword) { temp = randomPassword(); u.pw = hashPassword(temp); u.mustChange = true; for (const [sid, s] of SESSIONS) if (s.username === u.username) SESSIONS.delete(sid); }
  if (DB.users.filter((x) => x.role === 'admin' && !x.disabled).length === 0) return send(res, 400, { error: '至少需保留一位啟用中的管理者' });
  persist(); audit(req, creating ? '新增帳號' : '修改帳號', u.username, `${u.role}；據點 ${u.sites.join('、') || '無'}${u.disabled ? '；停用' : ''}${temp ? '；重設密碼' : ''}`);
  send(res, 200, { users: DB.users.map(publicUser), tempPassword: temp });
});
route('GET', /^\/api\/audit$/, { admin: true }, async (req, res) => {
  const lines = fs.existsSync(auditPath()) ? fs.readFileSync(auditPath(), 'utf8').trim().split('\n').filter(Boolean) : [];
  send(res, 200, { entries: lines.slice(-500).map((l) => JSON.parse(l)).reverse(), integrity: verifyAudit() });
});

async function handle(req, res) {
  securityHeaders(res);
  const url = new URL(req.url, 'http://x');
  const pathname = url.pathname.replace(/\/{2,}/g, '/');
  if (!pathname.startsWith('/api/')) {
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, { error: '不支援' });
    const f = STATIC_FILES.get(pathname);
    if (!f) return send(res, 404, { error: '找不到' });
    const buf = fs.readFileSync(path.join(STATIC_DIR, f[0]));
    res.writeHead(200, { 'Content-Type': f[1], 'Content-Length': buf.length });
    return res.end(req.method === 'HEAD' ? undefined : buf);
  }
  const r = ROUTES.find((x) => x.method === req.method && x.re.test(pathname));
  if (!r) return send(res, 404, { error: '找不到' });
  const m = pathname.match(r.re);
  try {
    if (req.method === 'POST' && !sameOrigin(req)) return send(res, 403, { error: '來源不正確' });
    if (r.opts.auth !== false) {
      const ss = sessionOf(req);
      if (!ss) return send(res, 401, { mode: 'server', error: '請登入' });
      req.user = ss.user; req.sid = ss.sid;
      if (req.method === 'POST' && req.headers['x-chc-csrf'] !== ss.s.csrf) return send(res, 403, { error: '請重新整理頁面' });
      if (ss.user.mustChange && !r.opts.allowMustChange && !/\/(me|logout)$/.test(pathname)) return send(res, 403, { error: '請先變更密碼', mustChange: true });
      if (r.opts.admin && !isAdmin(ss.user)) return send(res, 403, { error: '需要管理者權限' });
    }
    const body = req.method === 'POST' ? await readBody(req, r.opts.limit || 1024) : null;
    await r.fn(req, res, body, m);
  } catch (e) {
    const status = e.status || 400;
    if (status >= 500) console.error(e);
    send(res, status, { error: status >= 500 ? '伺服器錯誤' : e.message });
  }
}

// ───────────────────────── 指令 ─────────────────────────
function init() {
  fs.mkdirSync(CFG.dataDir, { recursive: true, mode: 0o700 });
  if (!fs.existsSync(keyPath())) { atomicWrite(keyPath(), crypto.randomBytes(32).toString('base64')); console.log('已產生資料金鑰：' + keyPath() + '（請另行備份並妥善保管，遺失即無法開啟資料）'); }
  loadKey();
  if (fs.existsSync(dbPath())) { console.log('資料已存在，不重複初始化。'); return; }
  const pw = randomPassword();
  DB = { persons: [], measurements: [], episodes: [], settings: {}, users: [{ username: 'admin', name: '系統管理者', role: 'admin', sites: ['*'], pw: hashPassword(pw), mustChange: true }], rulesVersion: E.RULES_VERSION, schema: E.SCHEMA };
  persist(); audit(null, '初始化', '', '建立管理者帳號 admin');
  console.log(`已建立管理者帳號：admin\n臨時密碼：${pw}\n（首次登入須變更密碼；此密碼只顯示這一次）`);
}
function main() {
  const cmd = process.argv[2];
  if (cmd === 'init') return init();
  loadKey(); loadDb(); auditInit();
  if (cmd === 'reset-password') {
    const u = DB.users.find((x) => x.username === process.argv[3]);
    if (!u) { console.error('找不到帳號'); process.exit(1); }
    const pw = randomPassword(); u.pw = hashPassword(pw); u.mustChange = true; u.disabled = false;
    persist(); audit(null, '重設密碼（主機指令）', u.username);
    return console.log(`帳號 ${u.username} 臨時密碼：${pw}`);
  }
  if (cmd === 'verify-audit') { const v = verifyAudit(); console.log(v.ok ? `稽核紀錄完整（${v.count} 筆）` : `稽核紀錄在第 ${v.brokenAt} 筆遭到修改或刪除`); process.exit(v.ok ? 0 : 2); }
  const server = CFG.tlsCert ? https.createServer({ cert: fs.readFileSync(CFG.tlsCert), key: fs.readFileSync(CFG.tlsKey), minVersion: 'TLSv1.2' }, handle) : http.createServer(handle);
  server.headersTimeout = 20000; server.requestTimeout = 60000;
  server.listen(CFG.port, CFG.host, () => console.log(`健康站追蹤後台已啟動：${CFG.tlsCert ? 'https' : 'http'}://${CFG.host}:${CFG.port}/`));
  setInterval(() => { const now = Date.now(); for (const [sid, s] of SESSIONS) if (now - s.last > CFG.idleMin * 60000 || now - s.created > CFG.absoluteHours * 3600000) SESSIONS.delete(sid); }, 60000).unref();
}
if (require.main === module) main();
module.exports = { handle, CFG, _internal: { hashPassword, verifyPassword, verifyAudit, sealFile, openFile, loadKey, loadDb, auditInit, init, db: () => DB, sessions: SESSIONS } };
