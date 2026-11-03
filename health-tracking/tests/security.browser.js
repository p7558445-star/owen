// 資安對抗測試（真實瀏覽器，Playwright）
// 準備：python3 health-tracking/tests/make-security-fixtures.py /tmp/sec
//       cd health-tracking && python3 -m http.server 8765
// 執行：FIX=/tmp/sec node health-tracking/tests/security.browser.js
const { chromium } = require('playwright'); const fs = require('fs');
const FIX = process.env.FIX || 'sec';
const ROOT = require('path').resolve(__dirname, '..');
const PASS = '彰基社區健康站測試通行密語2026';
const R = []; const ok = (name, cond, extra = '') => { R.push([cond ? 'PASS' : 'FAIL', name, extra]); };
const toast = (pg) => pg.$eval('#toast', (t) => t.textContent);
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

  await pg.goto('http://localhost:8765/index.html'); await pg.evaluate(() => localStorage.clear()); await pg.reload(); await pg.waitForTimeout(600);
  for (const r of ['dashboard', 'worklist', 'residents', 'quality', '888', 'import', 'rules']) { await pg.goto('http://localhost:8765/index.html#/' + r); await pg.waitForTimeout(150); }
  ok('無任何外部連線（第三方程式、字型、CDN）', ext.length === 0, ext.join(' '));
  ok('正常使用時沒有 CSP 違規', csp.length === 0, csp.join(' | '));

  await pg.evaluate(() => { const s = document.createElement('script'); s.textContent = 'window.__pwned=1'; document.body.appendChild(s); const s2 = document.createElement('script'); s2.src = 'https://evil.example/x.js'; document.body.appendChild(s2); });
  await pg.waitForTimeout(300);
  ok('CSP 阻擋注入的內嵌腳本', (await pg.evaluate(() => window.__pwned)) === undefined);
  ok('CSP 阻擋外部腳本（請求未送出即被擋）', !finished.some((u) => u.includes('evil.example')) && failed.some((f) => f.includes('evil.example') && /BLOCKED_BY_CSP|csp/i.test(f)), failed.filter((f) => f.includes('evil')).join(' '));

  await pg.goto('http://localhost:8765/index.html#/import'); await pg.waitForTimeout(200);
  await pg.setInputFiles('#roster-file', FIX + '/bomb.xlsx'); await pg.waitForTimeout(3000);
  const bombMsg = await toast(pg);
  ok('壓縮炸彈被拒絕', /過大|炸彈/.test(bombMsg), bombMsg);

  await pg.goto('http://localhost:8765/index.html#/import'); await pg.waitForTimeout(200);
  await pg.setInputFiles('#roster-file', FIX + '/evil_roster.xlsx'); await pg.waitForTimeout(800);
  await pg.click('#roster-go'); await pg.waitForTimeout(300);
  ok('匯入名冊前強制設定通行密語', await pg.$eval('#dlg', (d) => d.open));
  await pg.fill('#dlg input[name=p1]', 'short'); await pg.fill('#dlg input[name=p2]', 'short'); await pg.click('#dlg-foot .btn.primary'); await pg.waitForTimeout(200);
  ok('拒絕過短的通行密語', (await pg.$eval('#dlg', (d) => d.open)) && /至少/.test(await toast(pg)));
  await pg.fill('#dlg input[name=p1]', PASS); await pg.fill('#dlg input[name=p2]', PASS); await pg.click('#dlg-foot .btn.primary'); await pg.waitForTimeout(2500);
  await pg.goto('http://localhost:8765/index.html#/residents'); await pg.waitForTimeout(400);
  const html = await pg.$eval('main', (m) => m.innerHTML);
  ok('惡意姓名以文字呈現、不執行（XSS）', !alertFired && /&lt;img\s?src=x\s?onerror=alert\(1\)&gt;/.test(html) && !/<img\s?src=x/i.test(html) && (await pg.$$('main img')).length === 0, (html.match(/&lt;img[^&]*&gt;/) || [''])[0]);
  const stored = await pg.evaluate(() => localStorage.getItem('chc-tracking-v1'));
  ok('瀏覽器儲存內容已加密（找不到姓名、身分證號、電話）', /"vault":1/.test(stored) && !/A123456789|王大明|0912000000/.test(stored), stored.slice(0, 50));

  const csvText = await pg.evaluate(() => [['=HYPERLINK("http://evil","x")', '+1', '-2', '@SUM(A1)', 5, -3]].map((r) => r.map((c) => { let s = String(c ?? ''); if (typeof c !== 'number' && /^[=+\-@\t\r]/.test(s)) s = "'" + s; return s; }).join('|')).join(''));
  ok('CSV 公式注入被中和', csvText.startsWith("'=HYPERLINK") && csvText.includes("'+1") && csvText.includes('|5|-3'), csvText);

  await pg.goto('http://localhost:8765/index.html#/residents'); await pg.waitForTimeout(300);
  await pg.click('tbody tr.click'); await pg.waitForTimeout(300);
  if (await pg.$('#show-nid')) await pg.click('#show-nid');
  await pg.goto('http://localhost:8765/index.html#/rules'); await pg.waitForTimeout(300);
  const [dl] = await Promise.all([pg.waitForEvent('download'), pg.click('#audit-exp')]);
  const auditCsv = fs.readFileSync(await dl.path(), 'utf8');
  await pg.goto('http://localhost:8765/index.html#/import'); await pg.goto('http://localhost:8765/index.html#/rules'); await pg.waitForTimeout(300);
  const auditText = await pg.$eval('main', (m) => m.textContent);
  const want = ['設定通行密語', '匯入名冊', '查看完整身分證號', '匯出'];
  const auditRows = await pg.evaluate(() => [...document.querySelectorAll('main details table tbody tr')].map((tr) => tr.children[2].textContent));
  ok('稽核紀錄：設定密語、匯入名冊、查看身分證號、匯出', want.every((k) => auditRows.some((a) => a.includes(k))), '紀錄：' + auditRows.join('、') + '｜缺：' + want.filter((k) => !auditRows.some((a) => a.includes(k))).join('、'));
  ok('匯出 CSV 中的惡意公式被中和', !/(^|,)=HYPERLINK/m.test(auditCsv));

  await pg.goto('http://localhost:8765/index.html#/residents'); await pg.waitForTimeout(200); await pg.click('tbody tr.click'); await pg.waitForTimeout(300);
  await pg.click('#add-m'); await pg.fill('#dlg input[name=sbp]', '1500'); await pg.fill('#dlg input[name=dbp]', '80'); await pg.click('#dlg-foot .btn.primary'); await pg.waitForTimeout(200);
  ok('拒絕不合理的量測值', /超出合理範圍/.test(await toast(pg)));
  await pg.keyboard.press('Escape');

  await pg.goto('http://localhost:8765/index.html#/import'); await pg.waitForTimeout(200);
  const [bk] = await Promise.all([pg.waitForEvent('download'), pg.click('#bk-exp')]);
  const bkPath = FIX + '/backup.json'; await bk.saveAs(bkPath); const bkText = fs.readFileSync(bkPath, 'utf8');
  ok('備份檔已加密', /"vault":1/.test(bkText) && !/A123456789|王大明/.test(bkText));
  const tampered = JSON.parse(bkText); const ct = Buffer.from(tampered.ct, 'base64'); ct[10] ^= 1; tampered.ct = ct.toString('base64'); fs.writeFileSync(FIX + '/tampered.json', JSON.stringify(tampered));
  promptAnswer = PASS; await pg.setInputFiles('#bk-imp', FIX + '/tampered.json'); await pg.waitForTimeout(1500);
  ok('竄改過的加密備份被拒絕', /竄改/.test(await toast(pg)));
  fs.writeFileSync(FIX + '/evil_plain.json', JSON.stringify({ persons: [{ id: 'x" onmouseover="alert(1)', name: 'a' }], measurements: [], episodes: [] }));
  await pg.goto('http://localhost:8765/index.html#/import'); await pg.waitForTimeout(200);
  await pg.setInputFiles('#bk-imp', FIX + '/evil_plain.json'); await pg.waitForTimeout(500);
  ok('含注入內容的備份被拒絕', /驗證失敗/.test(await toast(pg)));
  await pg.goto('http://localhost:8765/index.html#/import'); await pg.waitForTimeout(200);
  await pg.setInputFiles('#bk-imp', bkPath); await pg.waitForTimeout(2000);
  ok('正確密語可還原加密備份', /已還原/.test(await toast(pg)));

  await pg.click('#lock-btn'); await pg.waitForTimeout(1500);
  ok('鎖定後畫面不顯示任何個資', !!(await pg.$('#unlock-p')) && !/王大明|A123456789/.test(await pg.content()));
  for (let i = 0; i < 3; i++) { await pg.fill('#unlock-p', '錯誤的密語錯誤的密語' + i); await pg.click('#unlock-btn'); await pg.waitForTimeout(1500); }
  ok('連續 3 次錯誤後暫停輸入', await pg.$eval('#unlock-p', (x) => x.disabled));
  await pg.evaluate(() => localStorage.setItem('chc-tracking-lock', JSON.stringify({ fails: 0, until: 0 }))); await pg.reload(); await pg.waitForTimeout(500);
  await pg.fill('#unlock-p', PASS); await pg.click('#unlock-btn'); await pg.waitForTimeout(2500);
  ok('正確密語可解鎖', !(await pg.$('#unlock-p')) && (await pg.$$('nav.tabs a')).length > 0);
  ok('全程無 JavaScript 錯誤', errs.length === 0, errs.join(' | '));

  const p2 = await ctx.newPage(); const e2 = []; p2.on('pageerror', (e) => e2.push(e.message)); p2.on('console', (m) => { if (/Refused|Content Security/i.test(m.text())) e2.push(m.text().slice(0, 100)); });
  await p2.goto('file://' + ROOT + '/index.html'); await p2.waitForTimeout(1500);
  ok('直接雙擊開啟（file://）可正常運作、可加密', (await p2.$$('nav.tabs a, #unlock-p')).length > 0 && (await p2.evaluate(() => !!(window.crypto && crypto.subtle && window.XlsxReader && window.Vault))) && e2.length === 0, e2.join(' | '));
  await b.close();
  for (const [s, n, x] of R) console.log(s, n, x ? `〔${x}〕` : '');
  console.log(R.filter((r) => r[0] === 'PASS').length + '/' + R.length + ' passed');
})();
