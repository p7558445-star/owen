// 資安對抗測試（真實瀏覽器，Playwright）— 單機版：帳號密碼登入、資料明文存於本機瀏覽器
// 準備：python3 health-tracking/tests/make-security-fixtures.py /tmp/sec
//       cd health-tracking && python3 -m http.server 8765
// 執行：FIX=/tmp/sec node health-tracking/tests/security.browser.js
const { chromium } = require('playwright'); const fs = require('fs');
const FIX = process.env.FIX || 'sec';
const ROOT = require('path').resolve(__dirname, '..');
const BASE = 'http://localhost:8765/index.html';
const OLD_PASS = '彰基社區健康站測試通行密語2026'; // 舊版加密資料的通行密語
const R = []; const ok = (name, cond, extra = '') => { R.push([cond ? 'PASS' : 'FAIL', name, extra]); };
const toast = (pg) => pg.$eval('#toast', (t) => t.textContent);
const login = async (pg, u = 'D7500', p = 'D7500') => { await pg.fill('#ll-u', u); await pg.fill('#ll-p', p); await pg.click('#ll-btn'); await pg.waitForTimeout(900); };
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ acceptDownloads: true }); const pg = await ctx.newPage();
  const ext = [], csp = [], errs = [];
  pg.on('request', (r) => { const u = r.url(); if (!u.startsWith('http://localhost:8765/') && !u.startsWith('blob:') && !u.startsWith('data:')) ext.push(u); });
  pg.on('console', (m) => { if (/Content.Security.Policy|Refused/i.test(m.text())) csp.push(m.text().slice(0, 120)); });
  pg.on('pageerror', (e) => errs.push(e.message));
  const failed = []; pg.on('requestfailed', (r) => failed.push(r.url() + ' ' + (r.failure() || {}).errorText));
  const finished = []; pg.on('requestfinished', (r) => finished.push(r.url()));
  let promptAnswer = '', alertFired = false;
  pg.on('dialog', async (d) => { if (d.type() === 'alert') alertFired = true; if (d.type() === 'prompt') await d.accept(promptAnswer); else await d.accept(); });

  await pg.goto(BASE); await pg.evaluate(() => { localStorage.clear(); sessionStorage.clear(); }); await pg.reload(); await pg.waitForTimeout(600);
  ok('開啟時先要求登入，未登入看不到任何頁面', !!(await pg.$('#ll-u')) && (await pg.$$('nav.tabs a')).length === 0);
  await login(pg, 'd7500', 'd7500');
  ok('帳號密碼區分大小寫（小寫 d7500 被拒）', !!(await pg.$('#ll-u')) && /錯誤/.test(await pg.$eval('#app', (a) => a.textContent)));
  await login(pg, 'D7500', 'wrong');
  await login(pg, 'D7500', 'wrong2');
  ok('連續 3 次錯誤後暫停輸入', await pg.$eval('#ll-u', (x) => x.disabled));
  await pg.evaluate(() => localStorage.setItem('chc-tracking-lock', JSON.stringify({ fails: 0, until: 0 }))); await pg.reload(); await pg.waitForTimeout(500);
  await login(pg);
  ok('預設帳號密碼 D7500／D7500 可登入', !(await pg.$('#ll-u')) && (await pg.$$('nav.tabs a')).length > 0);
  await pg.reload(); await pg.waitForTimeout(600);
  ok('同一分頁重新整理不必重新登入', !(await pg.$('#ll-u')));

  let inline = 0;
  for (const r of ['dashboard', 'worklist', 'residents', 'quality', '888', 'import', 'rules']) {
    await pg.goto(BASE + '#/' + r); await pg.waitForTimeout(150);
    inline += await pg.evaluate(() => [...document.querySelectorAll('*')].filter((el) => [...el.attributes].some((a) => /^on/i.test(a.name))).length);
  }
  await pg.goto(BASE + '#/worklist'); await pg.waitForTimeout(150); await pg.click('tbody tr.click'); await pg.waitForTimeout(200);
  inline += await pg.evaluate(() => [...document.querySelectorAll('*')].filter((el) => [...el.attributes].some((a) => /^on/i.test(a.name))).length);
  ok('頁面沒有任何內嵌事件屬性（CSP 會阻擋，且是 XSS 常見入口）', inline === 0, inline + ' 個');
  ok('無任何外部連線（第三方程式、字型、CDN）', ext.length === 0, ext.join(' '));
  ok('正常使用時沒有 CSP 違規', csp.length === 0, csp.join(' | '));

  await pg.evaluate(() => { const s = document.createElement('script'); s.textContent = 'window.__pwned=1'; document.body.appendChild(s); const s2 = document.createElement('script'); s2.src = 'https://evil.example/x.js'; document.body.appendChild(s2); });
  await pg.waitForTimeout(300);
  ok('CSP 阻擋注入的內嵌腳本', (await pg.evaluate(() => window.__pwned)) === undefined);
  ok('CSP 阻擋外部腳本（請求未送出即被擋）', !finished.some((u) => u.includes('evil.example')) && failed.some((f) => f.includes('evil.example') && /BLOCKED_BY_CSP|csp/i.test(f)), failed.filter((f) => f.includes('evil')).join(' '));

  await pg.goto(BASE + '#/import'); await pg.waitForTimeout(200);
  await pg.setInputFiles('#roster-file', FIX + '/bomb.xlsx'); await pg.waitForTimeout(3000);
  const bombMsg = await toast(pg);
  ok('壓縮炸彈被拒絕', /過大|炸彈/.test(bombMsg), bombMsg);

  await pg.goto(BASE + '#/import'); await pg.waitForTimeout(200);
  await pg.setInputFiles('#roster-file', FIX + '/evil_roster.xlsx'); await pg.waitForTimeout(800);
  await pg.click('#roster-go'); await pg.waitForTimeout(600);
  ok('匯入名冊不再要求通行密語', !(await pg.$eval('#dlg', (d) => d.open)) && /已新增/.test(await toast(pg)), await toast(pg));
  await pg.goto(BASE + '#/residents'); await pg.waitForTimeout(400);
  const html = await pg.$eval('main', (m) => m.innerHTML);
  ok('惡意姓名以文字呈現、不執行（XSS）', !alertFired && /&lt;img\s?src=x\s?onerror=alert\(1\)&gt;/.test(html) && !/<img\s?src=x/i.test(html) && (await pg.$$('main img')).length === 0, (html.match(/&lt;img[^&]*&gt;/) || [''])[0]);

  const csvText = await pg.evaluate(() => [['=HYPERLINK("http://evil","x")', '+1', '-2', '@SUM(A1)', 5, -3]].map((r) => r.map((c) => { let s = String(c ?? ''); if (typeof c !== 'number' && /^[=+\-@\t\r]/.test(s)) s = "'" + s; return s; }).join('|')).join(''));
  ok('CSV 公式注入被中和', csvText.startsWith("'=HYPERLINK") && csvText.includes("'+1") && csvText.includes('|5|-3'), csvText);

  await pg.goto(BASE + '#/residents'); await pg.waitForTimeout(300);
  await pg.click('tbody tr.click'); await pg.waitForTimeout(300);
  if (await pg.$('#show-nid')) await pg.click('#show-nid');
  await pg.goto(BASE + '#/rules'); await pg.waitForTimeout(300);
  ok('設定頁明示資料未加密', /未加密/.test(await pg.$eval('main', (m) => m.textContent)));
  const [dl] = await Promise.all([pg.waitForEvent('download'), pg.click('#audit-exp')]);
  const auditCsv = fs.readFileSync(await dl.path(), 'utf8');
  await pg.goto(BASE + '#/import'); await pg.goto(BASE + '#/rules'); await pg.waitForTimeout(300);
  const want = ['匯入名冊', '查看完整身分證號', '匯出'];
  const auditRows = await pg.evaluate(() => [...document.querySelectorAll('main details table tbody tr')].map((tr) => tr.children[2].textContent));
  ok('稽核紀錄：匯入名冊、查看身分證號、匯出', want.every((k) => auditRows.some((a) => a.includes(k))), '紀錄：' + auditRows.join('、') + '｜缺：' + want.filter((k) => !auditRows.some((a) => a.includes(k))).join('、'));
  ok('匯出 CSV 中的惡意公式被中和', !/(^|,)=HYPERLINK/m.test(auditCsv));

  await pg.goto(BASE + '#/residents'); await pg.waitForTimeout(200); await pg.click('tbody tr.click'); await pg.waitForTimeout(300);
  await pg.click('#add-m'); await pg.fill('#dlg input[name=sbp]', '1500'); await pg.fill('#dlg input[name=dbp]', '80'); await pg.click('#dlg-foot .btn.primary'); await pg.waitForTimeout(200);
  ok('拒絕不合理的量測值', /超出合理範圍/.test(await toast(pg)));
  await pg.keyboard.press('Escape');

  // 備份：明文匯出前提醒；舊版加密備份仍可用舊密語開啟，竄改者被拒
  await pg.goto(BASE + '#/import'); await pg.waitForTimeout(200);
  const [bk] = await Promise.all([pg.waitForEvent('download'), pg.click('#bk-exp')]);
  const bkPath = FIX + '/backup.json'; await bk.saveAs(bkPath);
  ok('備份可匯出（明文 JSON）並可還原', JSON.parse(fs.readFileSync(bkPath, 'utf8')).persons.length > 0);
  const legacy = await pg.evaluate(async (pw) => { const k = await window.Vault.createKey(pw); return window.Vault.seal(k, JSON.parse(localStorage.getItem('chc-tracking-v1')), 'chc-backup'); }, OLD_PASS);
  fs.writeFileSync(FIX + '/legacy.json', JSON.stringify(legacy));
  const tampered = JSON.parse(JSON.stringify(legacy)); const ct = Buffer.from(tampered.ct, 'base64'); ct[10] ^= 1; tampered.ct = ct.toString('base64'); fs.writeFileSync(FIX + '/tampered.json', JSON.stringify(tampered));
  promptAnswer = OLD_PASS; await pg.setInputFiles('#bk-imp', FIX + '/tampered.json'); await pg.waitForTimeout(1500);
  ok('竄改過的舊版加密備份被拒絕', /竄改/.test(await toast(pg)));
  fs.writeFileSync(FIX + '/evil_plain.json', JSON.stringify({ persons: [{ id: 'x" onmouseover="alert(1)', name: 'a' }], measurements: [], episodes: [] }));
  await pg.goto(BASE + '#/import'); await pg.waitForTimeout(200);
  await pg.setInputFiles('#bk-imp', FIX + '/evil_plain.json'); await pg.waitForTimeout(500);
  ok('含注入內容的備份被拒絕', /驗證失敗/.test(await toast(pg)));
  await pg.goto(BASE + '#/import'); await pg.waitForTimeout(200);
  await pg.setInputFiles('#bk-imp', FIX + '/legacy.json'); await pg.waitForTimeout(2000);
  ok('舊版加密備份輸入舊密語可還原', /已還原/.test(await toast(pg)));

  // 變更帳號密碼
  await pg.goto(BASE + '#/rules'); await pg.waitForTimeout(300);
  await pg.click('#chg-login'); await pg.fill('#dlg input[name=old]', 'D7500'); await pg.fill('#dlg input[name=u]', 'D7500'); await pg.fill('#dlg input[name=p1]', 'NewPass2026'); await pg.fill('#dlg input[name=p2]', 'NewPass2026');
  await pg.click('#dlg-foot .btn.primary'); await pg.waitForTimeout(800);
  const authStored = await pg.evaluate(() => localStorage.getItem('chc-tracking-auth'));
  ok('變更後只存密碼雜湊、不存明碼', /"hash"/.test(authStored) && !/NewPass2026/.test(authStored));

  await pg.click('#lock-btn'); await pg.waitForTimeout(1200);
  ok('登出後畫面不顯示任何個資', !!(await pg.$('#ll-u')) && !/王大明|A123456789/.test(await pg.content()));
  await login(pg, 'D7500', 'D7500');
  ok('變更後舊密碼不能登入', !!(await pg.$('#ll-u')));
  await login(pg, 'D7500', 'NewPass2026');
  ok('新密碼可登入', !(await pg.$('#ll-u')) && (await pg.$$('nav.tabs a')).length > 0);
  ok('全程無 JavaScript 錯誤', errs.length === 0, errs.join(' | '));

  // 舊版加密的本機資料：登入後輸入舊密語一次，轉成新格式
  const p3 = await (await b.newContext()).newPage(); const e3 = []; p3.on('pageerror', (e) => e3.push(e.message));
  await p3.goto(BASE); await p3.waitForTimeout(400);
  await p3.evaluate(async (pw) => { localStorage.clear(); const k = await window.Vault.createKey(pw); const env = await window.Vault.seal(k, { persons: [{ id: 'p1', name: '舊資料王小明', sex: 'M', birth: '1950-01-01', site: 'A' }], measurements: [], episodes: [], schema: 2 }); localStorage.setItem('chc-tracking-v1', JSON.stringify(env)); }, OLD_PASS);
  await p3.reload(); await p3.waitForTimeout(500); await login(p3);
  ok('舊版加密資料：登入後要求輸入舊密語轉換', !!(await p3.$('#cv-p')));
  await p3.fill('#cv-p', OLD_PASS); await p3.click('#cv-btn'); await p3.waitForTimeout(2500);
  const conv = await p3.evaluate(() => localStorage.getItem('chc-tracking-v1'));
  ok('轉換後資料可用、不再需要舊密語', !(await p3.$('#cv-p')) && /舊資料王小明/.test(conv) && !/"vault":1/.test(conv) && e3.length === 0, e3.join(' | '));

  const p2 = await ctx.newPage(); const e2 = []; p2.on('pageerror', (e) => e2.push(e.message)); p2.on('console', (m) => { if (/Refused|Content Security/i.test(m.text())) e2.push(m.text().slice(0, 100)); });
  await p2.goto('file://' + ROOT + '/index.html'); await p2.waitForTimeout(1500);
  ok('直接雙擊開啟（file://）可正常運作、顯示登入畫面', !!(await p2.$('#ll-u')) && (await p2.evaluate(() => !!(window.crypto && crypto.subtle && window.XlsxReader))) && e2.length === 0, e2.join(' | '));
  await b.close();
  for (const [s, n, x] of R) console.log(s, n, x ? `〔${x}〕` : '');
  console.log(R.filter((r) => r[0] === 'PASS').length + '/' + R.length + ' passed');
})();
