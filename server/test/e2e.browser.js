// 伺服器模式端對端測試（Playwright）：管理者與護理師同時使用
// 用法：先 node server/server.js init 並啟動（CHC_SECURE_COOKIE=false 供本機 http 測試），再
//   node server/test/e2e.browser.js http://127.0.0.1:8080/ <admin 臨時密碼> <測試名冊.xlsx>
// 測試名冊可用 health-tracking/tests/make-security-fixtures.py 產生（evil_roster.xlsx）
const { chromium } = require('playwright');
const BASE = process.argv[2], ADMIN_PW = process.argv[3], ROSTER = process.argv[4];
const R = []; const ok = (n, c, x = '') => R.push([c ? 'PASS' : 'FAIL', n, x]);
(async () => {
  const b = await chromium.launch(); const errs = [];
  const mk = async () => { const ctx = await b.newContext(); const pg = await ctx.newPage(); pg.on('pageerror', (e) => errs.push(e.message)); pg.on('dialog', (d) => d.accept()); return pg; };
  const A = await mk(), N = await mk();
  const toast = (pg) => pg.$eval('#toast', (t) => t.textContent);

  await A.goto(BASE); await A.waitForTimeout(500);
  ok('偵測到伺服器並顯示登入畫面', !!(await A.$('#lg-u')));
  await A.fill('#lg-u', 'admin'); await A.fill('#lg-p', ADMIN_PW); await A.click('#lg-btn'); await A.waitForTimeout(700);
  ok('首次登入要求變更密碼', !!(await A.$('#cp-1')));
  await A.fill('#cp-0', ADMIN_PW); await A.fill('#cp-1', '端對端測試用的管理者新密碼'); await A.fill('#cp-2', '端對端測試用的管理者新密碼'); await A.click('#cp-btn'); await A.waitForTimeout(900);
  ok('進入後台，頁首顯示登入者與登出', (await A.$$('nav.tabs a')).length > 0 && (await A.$eval('#lock-btn', (x) => x.textContent)) === '登出');

  await A.goto(BASE + '#/import'); await A.waitForTimeout(300);
  ok('伺服器模式不顯示本機備份／清除功能', !(await A.$('#bk-exp')) && !(await A.$('#wipe')));
  await A.setInputFiles('#roster-file', ROSTER); await A.waitForTimeout(800);
  await A.click('#roster-go'); await A.waitForTimeout(900);
  ok('管理者匯入名冊（不需本機通行密語）', /已新增 2 位/.test(await toast(A)), await toast(A));

  await A.goto(BASE + '#/rules'); await A.waitForTimeout(800);
  await A.click('#u-add'); await A.waitForTimeout(300);
  await A.fill('#dlg input[name=username]', 'nurse.e2e'); await A.fill('#dlg input[name=name]', '護理師乙');
  await A.check('#dlg input[name=site][value="測試社區"]'); await A.click('#dlg-foot .btn.primary'); await A.waitForTimeout(800);
  const temp = await A.$eval('#dlg-body', (x) => x.querySelector('p.tnum').textContent.trim());
  ok('建立護理師帳號並顯示一次性臨時密碼', temp.length >= 12, temp.length + ' 字元');
  await A.click('#dlg-foot .btn.primary');

  await N.goto(BASE); await N.waitForTimeout(400);
  await N.fill('#lg-u', 'nurse.e2e'); await N.fill('#lg-p', temp); await N.click('#lg-btn'); await N.waitForTimeout(700);
  await N.fill('#cp-0', temp); await N.fill('#cp-1', '護理師乙的端對端測試新密碼'); await N.fill('#cp-2', '護理師乙的端對端測試新密碼'); await N.click('#cp-btn'); await N.waitForTimeout(900);
  await N.goto(BASE + '#/residents'); await N.waitForTimeout(500);
  const nhtml = await N.content();
  ok('護理師看到自己據點的民眾、身分證號遮蔽', /王大明/.test(nhtml) && !/A123456789/.test(nhtml) && /A1\*\*\*\*6789/.test(nhtml));
  await N.click('tbody tr.click >> nth=0'); await N.waitForTimeout(400);
  const href = N.url();
  await N.click('#add-m'); await N.fill('#dlg input[name=sbp]', '168'); await N.fill('#dlg input[name=dbp]', '88'); await N.click('#dlg-foot .btn.primary'); await N.waitForTimeout(900);
  ok('護理師新增量測，伺服器判定為橙層', /橙層/.test(await toast(N)), await toast(N));
  await N.click('[data-act=notify]'); await N.waitForTimeout(900);
  ok('護理師完成「通知」', /已記錄：通知/.test(await toast(N)), await toast(N));

  await A.goto(href.replace(/^[^#]*/, BASE)); await A.waitForTimeout(800);
  const atext = await A.$eval('main', (m) => m.textContent);
  ok('管理者即時看到護理師的處理（多人共用）', /通知民眾（電話）/.test(atext) && /護理師乙/.test(atext));
  await A.goto(BASE + '#/rules'); await A.waitForTimeout(600); await A.click('#audit-load'); await A.waitForTimeout(800);
  const audit = await A.$eval('main', (m) => m.textContent);
  ok('伺服器稽核紀錄完整並可檢視', /雜湊鏈完整/.test(audit) && /nurse\.e2e/.test(audit) && /追蹤操作/.test(audit));
  await N.click('#lock-btn'); await N.waitForTimeout(800);
  ok('護理師登出後回到登入畫面', !!(await N.$('#lg-u')));
  ok('全程無 JavaScript 錯誤', errs.length === 0, errs.join(' | '));
  await b.close();
  for (const [s, n, x] of R) console.log(s, n, x ? `〔${x}〕` : '');
  console.log(R.filter((r) => r[0] === 'PASS').length + '/' + R.length + ' passed');
})();
