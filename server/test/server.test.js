// 伺服器資安與功能測試（不需網路、不需第三方套件）
// 執行：node server/test/server.test.js
'use strict';
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');

const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'chc-test-'));
process.env.CHC_DATA_DIR = DATA;
process.env.CHC_SECURE_COOKIE = 'false';
const S = require('../server.js');
const I = S._internal;

let pass = 0;
const results = [];
async function t(name, fn) { try { await fn(); pass++; results.push('PASS ' + name); } catch (e) { process.exitCode = 1; results.push('FAIL ' + name + '\n   ' + e.message); } }

(async () => {
  const log = console.log; console.log = () => {}; I.init(); console.log = log;
  I.loadKey(); I.loadDb(); I.auditInit();
  const admin = I.db().users[0];
  const ADMIN_PW = '管理者的測試密碼很長很長';
  admin.pw = I.hashPassword(ADMIN_PW); // 測試用：給定已知的臨時密碼（仍須變更）
  const server = http.createServer(S.handle).listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}`;

  // 小型 HTTP 客戶端（保存 cookie 與 CSRF）
  function client() {
    const c = { cookie: '', csrf: '' };
    c.req = async (method, p, body, headers = {}) => {
      const h = Object.assign({ 'Content-Type': 'application/json' }, c.cookie ? { Cookie: c.cookie } : {}, c.csrf ? { 'X-CHC-CSRF': c.csrf } : {}, headers);
      const r = await fetch(base + p, { method, headers: h, body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body) });
      const sc = r.headers.get('set-cookie'); if (sc) c.cookie = sc.split(';')[0];
      let j = null; const text = await r.text(); try { j = JSON.parse(text); } catch (e) { j = text; }
      return { status: r.status, j, headers: r.headers };
    };
    c.login = async (u, pw) => { const r = await c.req('POST', '/api/login', { username: u, password: pw }); if (r.status === 200) c.csrf = r.j.csrf; return r; };
    return c;
  }

  await t('靜態頁面帶有完整安全標頭', async () => {
    const r = await fetch(base + '/');
    assert.equal(r.status, 200);
    for (const h of ['content-security-policy', 'x-content-type-options', 'x-frame-options', 'referrer-policy', 'permissions-policy', 'cache-control']) assert.ok(r.headers.get(h), h);
    assert.ok(/frame-ancestors 'none'/.test(r.headers.get('content-security-policy')));
  });
  await t('路徑穿越與未列名檔案一律 404（含資料金鑰）', async () => {
    for (const p of ['/../server/data/data.key', '/%2e%2e/server/server.js', '/data.key', '/server.js', '/db.enc', '/tests/engine.test.js', '/README.md']) {
      const r = await fetch(base + p); assert.equal(r.status, 404, p);
    }
  });
  await t('未登入不能取資料', async () => { const r = await client().req('GET', '/api/data'); assert.equal(r.status, 401); });

  const a = client();
  await t('密碼錯誤被拒，且不透露帳號是否存在', async () => {
    const r1 = await client().login('admin', 'wrong-password-1234'); const r2 = await client().login('nobody', 'wrong-password-1234');
    assert.equal(r1.status, 401); assert.equal(r2.status, 401); assert.equal(r1.j.error, r2.j.error);
  });
  await t('首次登入強制變更密碼，否則不能取資料', async () => {
    assert.equal((await a.login('admin', ADMIN_PW)).status, 200);
    const d = await a.req('GET', '/api/data'); assert.equal(d.status, 403); assert.ok(d.j.mustChange);
    assert.equal((await a.req('POST', '/api/password', { current: ADMIN_PW, next: 'short' })).status, 400);
    assert.equal((await a.req('POST', '/api/password', { current: ADMIN_PW, next: '新的管理者密碼也很長很長' })).status, 200);
    assert.equal((await a.req('GET', '/api/data')).status, 200);
  });
  await t('Cookie 為 HttpOnly 與 SameSite=Strict', async () => {
    const r = await fetch(base + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: '新的管理者密碼也很長很長' }) });
    const sc = r.headers.get('set-cookie'); assert.ok(/HttpOnly/.test(sc) && /SameSite=Strict/.test(sc));
  });
  await t('缺少 CSRF 權杖或來源不符的寫入被拒', async () => {
    const r1 = await a.req('POST', '/api/regrade', {}, { 'X-CHC-CSRF': 'wrong' }); assert.equal(r1.status, 403);
    const r2 = await a.req('POST', '/api/regrade', {}, { Origin: 'https://evil.example' }); assert.equal(r2.status, 403);
  });
  await t('非 JSON 與過大請求被拒', async () => {
    assert.equal((await a.req('POST', '/api/regrade', 'x=1', { 'Content-Type': 'application/x-www-form-urlencoded' })).status, 415);
    assert.equal((await a.req('POST', '/api/password', { current: 'x'.repeat(10000), next: 'y' })).status, 413);
  });

  let nursePw;
  await t('管理者建立護理師帳號（只看 A 站），取得一次性臨時密碼', async () => {
    const r = await a.req('POST', '/api/users', { username: 'nurse.a', name: '護理師甲', role: 'nurse', sites: ['A站'] });
    assert.equal(r.status, 200); assert.ok(r.j.tempPassword); nursePw = r.j.tempPassword;
    assert.ok(!JSON.stringify(r.j.users).includes('hash'), '帳號清單不可含密碼雜湊');
  });
  await t('匯入名冊（A 站、B 站各一人）', async () => {
    const r = await a.req('POST', '/api/roster', { persons: [
      { name: '王大明', sex: 'M', birth: '1950-01-01', heightCm: 165, nationalId: 'A123456789', phone: '0912345678', site: 'A站' },
      { name: '林小美', sex: 'F', birth: '1952-02-02', heightCm: 155, nationalId: 'B223456787', phone: '0912000111', site: 'B站' },
    ] });
    assert.equal(r.status, 200); assert.equal(r.j.result.add, 2);
  });
  const n = client();
  await t('護理師只看得到自己據點的民眾，身分證號與電話已遮蔽', async () => {
    await n.login('nurse.a', nursePw);
    await n.req('POST', '/api/password', { current: nursePw, next: '護理師甲的新密碼已經夠長了' });
    const d = await n.req('GET', '/api/data');
    assert.equal(d.j.data.persons.length, 1); assert.equal(d.j.data.persons[0].site, 'A站');
    assert.equal(d.j.data.persons[0].nationalId, 'A1****6789'); assert.ok(!JSON.stringify(d.j).includes('A123456789') && !JSON.stringify(d.j).includes('0912345678'));
    assert.ok(!JSON.stringify(d.j).includes('林小美'));
  });
  await t('護理師不能存取其他據點的民眾（查無此人）', async () => {
    const all = I.db().persons; const b = all.find((p) => p.site === 'B站');
    assert.equal((await n.req('POST', `/api/persons/${b.id}/reveal`, {})).status, 404);
    assert.equal((await n.req('POST', `/api/persons/${b.id}/measurements`, { m: { at: new Date().toISOString(), sbp: 170, dbp: 90 } })).status, 404);
  });
  await t('護理師不能使用管理功能', async () => {
    assert.equal((await n.req('GET', '/api/users')).status, 403);
    assert.equal((await n.req('POST', '/api/settings', { sla: {} })).status, 403);
    assert.equal((await n.req('GET', '/api/audit')).status, 403);
  });
  await t('量測、開案與操作者身分由伺服器決定（無法冒名）', async () => {
    const p = I.db().persons.find((x) => x.site === 'A站');
    // 單次橙層血壓：暫定、不開案；7 天內第 2 次以平均判定
    const r1 = await n.req('POST', `/api/persons/${p.id}/measurements`, { m: { at: new Date(Date.now() - 3 * 3600000).toISOString(), sbp: 165, dbp: 85 } });
    assert.equal(r1.status, 200); assert.ok(r1.j.pending.includes('bp')); assert.equal(r1.j.pendingLevel, 'orange'); assert.equal(r1.j.data.episodes.length, 0);
    const r = await n.req('POST', `/api/persons/${p.id}/measurements`, { m: { at: new Date().toISOString(), sbp: 165, dbp: 85 } });
    assert.equal(r.status, 200); assert.equal(r.j.overall, 'orange');
    const ep = r.j.data.episodes[0];
    const r2 = await n.req('POST', `/api/episodes/${ep.id}/act`, { action: 'notify', payload: { method: '電話', assignee: '別人' }, by: '管理者' });
    assert.equal(r2.status, 200);
    const log = I.db().episodes.find((e) => e.id === ep.id).log.pop();
    assert.equal(log.by, '護理師甲');
  });
  await t('不合理的量測值與不支援的操作被拒', async () => {
    const p = I.db().persons.find((x) => x.site === 'A站');
    assert.equal((await n.req('POST', `/api/persons/${p.id}/measurements`, { m: { at: new Date().toISOString(), sbp: 1500, dbp: 85 } })).status, 400);
    const ep = I.db().episodes[0];
    assert.equal((await n.req('POST', `/api/episodes/${ep.id}/act`, { action: 'judge', payload: {} })).status, 400);
  });
  await t('調閱完整身分證號會寫入稽核紀錄', async () => {
    const p = I.db().persons.find((x) => x.site === 'A站');
    const r = await n.req('POST', `/api/persons/${p.id}/reveal`, {});
    assert.equal(r.j.nationalId, 'A123456789');
    const au = await a.req('GET', '/api/audit');
    assert.ok(au.j.entries.some((e) => e.action === '查看完整身分證號' && e.user === 'nurse.a' && e.target === p.id));
    assert.ok(!JSON.stringify(au.j.entries).includes('王大明'), '稽核紀錄不寫入姓名');
  });
  await t('資料檔與每日備份皆已加密（找不到姓名、身分證號、電話、密碼雜湊）', async () => {
    const files = [path.join(DATA, 'db.enc'), ...fs.readdirSync(path.join(DATA, 'backup')).map((f) => path.join(DATA, 'backup', f))];
    for (const f of files) { const s = fs.readFileSync(f, 'utf8'); assert.ok(!/王大明|A123456789|0912345678|scrypt|"hash"/.test(s), f); }
    if (process.platform !== 'win32') assert.equal(fs.statSync(path.join(DATA, 'data.key')).mode & 0o077, 0, '金鑰檔權限僅限擁有者');
  });
  await t('稽核紀錄雜湊鏈：完整時通過，竄改後可偵測', async () => {
    assert.ok(I.verifyAudit().ok);
    const f = path.join(DATA, 'audit.log'); const orig = fs.readFileSync(f, 'utf8');
    const lines = orig.trim().split('\n'); const first = JSON.parse(lines[0]); first.detail = '被竄改'; lines[0] = JSON.stringify(first);
    fs.writeFileSync(f, lines.join('\n') + '\n');
    const v = I.verifyAudit(); fs.writeFileSync(f, orig);
    assert.ok(!v.ok && v.brokenAt > 0);
  });
  await t('據點負責護理師名單：同步帳號可見據點、改派進行中案件、拒絕原型污染、限管理者', async () => {
    assert.equal((await n.req('POST', '/api/site-nurses', { map: { A站: '護理師甲' } })).status, 403);
    const r = await a.req('POST', '/api/site-nurses', JSON.stringify({ map: { A站: '護理師甲', C站: '護理師甲', '__proto__': 'x' }, reassign: true }));
    assert.equal(r.status, 200);
    assert.equal(({}).polluted, undefined); assert.ok(!('__proto__' in I.db().settings.siteNurse && I.db().settings.siteNurse.__proto__ === 'x'));
    assert.deepEqual(I.db().users.find((u) => u.username === 'nurse.a').sites, ['A站', 'C站']);
    assert.ok(r.j.data.sites.includes('C站'), '名單上的新據點可供指派');
    const ep = I.db().episodes[0];
    assert.equal(ep.assignee, '護理師甲');
  });
  await t('統一據點名稱（限管理者）', async () => {
    I.db().persons.push({ id: 'pz', name: 'z', site: '秀水頭前', nationalId: null });
    assert.equal((await n.req('POST', '/api/normalize-sites', {})).status, 403);
    const r = await a.req('POST', '/api/normalize-sites', {});
    assert.equal(r.j.changed, 1); assert.equal(I.db().persons.find((p) => p.id === 'pz').site, '頭前社區');
  });
  await t('連續登入失敗會鎖定', async () => {
    const c = client(); let last;
    for (let i = 0; i < 6; i++) last = await c.login('nurse.a', 'wrong-password-' + i);
    assert.equal(last.status, 429);
  });
  await t('停用帳號後立即登出且不能再登入', async () => {
    assert.equal((await a.req('POST', '/api/users', { username: 'nurse.a', disabled: true })).status, 200);
    assert.equal((await n.req('GET', '/api/data')).status, 401);
  });
  await t('不可停用自己、不可移除最後一位管理者', async () => {
    assert.equal((await a.req('POST', '/api/users', { username: 'admin', disabled: true })).status, 400);
    assert.equal((await a.req('POST', '/api/users', { username: 'admin', role: 'nurse' })).status, 400);
  });
  await t('閒置逾時自動登出', async () => {
    const old = S.CFG.idleMin; S.CFG.idleMin = 0.001;
    await new Promise((r) => setTimeout(r, 150));
    const r = await a.req('GET', '/api/data'); S.CFG.idleMin = old;
    assert.equal(r.status, 401);
  });

  server.close();
  fs.rmSync(DATA, { recursive: true, force: true });
  for (const r of results) console.log(r);
  console.log(`${pass}/${results.length} passed`);
})();
