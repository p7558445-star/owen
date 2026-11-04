/* 社區智慧健康站：分層管理與閉環追蹤後台（前端） */
(function () {
  'use strict';
  const E = window.Engine;
  const KEY = 'chc-tracking-v1';
  const UI_KEY = 'chc-tracking-ui';
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const pad = (n) => String(n).padStart(2, '0');
  const fmtD = (iso) => { if (!iso) return '—'; const d = new Date(iso); return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())}`; };
  const fmtDT = (iso) => { if (!iso) return '—'; const d = new Date(iso); return `${fmtD(iso)} ${pad(d.getHours())}:${pad(d.getMinutes())}`; };
  const pct = (w) => (w.p === null ? '—' : (w.p * 100).toFixed(1) + '%');
  const ci = (w) => (w.p === null ? '' : `95% CI ${(w.lo * 100).toFixed(1)}–${(w.hi * 100).toFixed(1)}%`);
  const nowISO = () => new Date().toISOString();
  const LV_ORDER = ['red', 'orange', 'yellow', 'green'];
  const SHORT = { bp: '血壓', pulse: '心律', spo2: '血氧', temp: '體溫', glucose: '血糖', lipid: '血脂', mets: '代謝', body: '體位' };

  // ───────────── 資料 ─────────────
  let db = null;
  const ui = Object.assign({ site: 'all', user: '', mask: false, wl: { levels: [], state: 'all', overdue: false, q: '', mine: false }, rs: { levels: [], q: '' }, qWindow: 90 }, readUI());

  function readUI() { try { return JSON.parse(localStorage.getItem(UI_KEY)) || {}; } catch (e) { return {}; } }
  function saveUI() { try { localStorage.setItem(UI_KEY, JSON.stringify(ui)); } catch (e) { /* 無痕模式 */ } }
  function load() {
    try { const s = localStorage.getItem(KEY); if (s) return JSON.parse(s); } catch (e) { /* 忽略 */ }
    return null;
  }
  // 示範資料以明文存放；正式資料（含姓名、身分證號等個資）一律以 AES-256-GCM 加密後才寫入瀏覽器
  let vaultKey = null;
  let saving = Promise.resolve();
  const sensitive = () => db && !db.demo && db.persons.length > 0;
  // ── 伺服器模式（院內主機）：資料、規則判定、稽核都在伺服器端；前端只呼叫 API
  let SERVER = null; // { user, csrf }
  async function api(pathname, body, opts = {}) {
    const headers = { 'Content-Type': 'application/json', 'X-CHC-CSRF': SERVER ? SERVER.csrf : '' };
    if (opts.poll) headers['X-CHC-Poll'] = '1';
    const r = await fetch('api/' + pathname, { method: body === undefined ? 'GET' : 'POST', credentials: 'same-origin', headers, body: body === undefined ? undefined : JSON.stringify(body) });
    let j = {}; try { j = await r.json(); } catch (e) { /* 非 JSON */ }
    if (r.status === 401) { loginScreen('連線逾時或已登出，請重新登入'); throw new Error('請重新登入'); }
    if (j.mustChange) { changePasswordScreen(); throw new Error(j.error); }
    if (!r.ok) throw new Error(j.error || '操作失敗');
    if (j.data) db = j.data;
    return j;
  }
  const srv = (promise, okMsg) => promise.then((j) => { render(); if (okMsg) toast(typeof okMsg === 'function' ? okMsg(j) : okMsg); return j; }).catch((e) => toast(e.message));

  function save() {
    if (SERVER) return true;
    if (!db) return false;
    if (sensitive() && !vaultKey) { toast('含個資的資料必須先設定通行密語才能儲存'); requirePassphrase(); return false; }
    const snapshot = JSON.stringify(db);
    const write = async () => {
      try {
        const payload = vaultKey && !db.demo ? JSON.stringify(await window.Vault.seal(vaultKey, JSON.parse(snapshot))) : snapshot;
        localStorage.setItem(KEY, payload);
      } catch (e) { toast('無法儲存到瀏覽器（空間不足或已停用），請先匯出備份'); }
    };
    saving = saving.then(write, write);
    return true;
  }
  // 稽核紀錄：敏感操作留痕（存在加密資料內）。注意：操作者為自選，正式上線需搭配院內帳號登入
  function audit(action, detail) {
    if (SERVER || !db || db.demo) return;
    db.audit = db.audit || [];
    db.audit.push({ at: nowISO(), user: ui.user || '', action, detail: detail || '' });
    if (db.audit.length > 5000) db.audit.splice(0, db.audit.length - 5000);
  }
  const t888 = () => Object.assign({}, E.DEFAULT_888, (db.settings && db.settings.t888) || {});
  const sla = () => Object.assign({}, E.DEFAULT_SLA, (db.settings && db.settings.sla) || {});
  const DEFAULT_NURSES = '甲乙丙丁戊己庚辛'.split('').map((x) => '社區護理師 ' + x);
  const nurses = () => (db.settings && db.settings.nurses && db.settings.nurses.length ? db.settings.nurses : DEFAULT_NURSES);

  // 每次渲染重建索引
  let IX = null;
  function index() {
    const byPerson = new Map(), open = new Map(), mByP = new Map();
    for (const p of db.persons) byPerson.set(p.id, p);
    for (const m of db.measurements) { if (!mByP.has(m.personId)) mByP.set(m.personId, []); mByP.get(m.personId).push(m); }
    const last = new Map();
    for (const e of db.episodes) { last.set(e.personId, e); if (E.isOpen(e)) open.set(e.personId, e); }
    const evalCache = new Map();
    IX = {
      byPerson, open, last, mByP,
      sessions(pid) { return E.groupSessions(mByP.get(pid) || [], sla().sessionMinutes); },
      latest(pid) {
        if (evalCache.has(pid)) return evalCache.get(pid);
        const ss = this.sessions(pid); const s = ss[ss.length - 1];
        const r = s ? { session: s, ev: E.evaluateSession(ctx(byPerson.get(pid), s.at), s.readings) } : null;
        evalCache.set(pid, r); return r;
      },
      // 管理層級：進行中的輪次；上一輪已確認、仍在等複測者維持該層級；其餘依是否量測過為綠或未量測
      mgmt(pid) { const e = open.get(pid); if (e) return e.level; const x = last.get(pid); if (x && x.state === 'confirmed' && x.nextDue) return x.level; return this.latest(pid) ? 'green' : 'none'; },
      stage(pid) { const e = open.get(pid); if (e) return E.STATE_LABEL[e.state]; const x = last.get(pid); return x && x.state === 'confirmed' && x.nextDue ? `確認・待複測 ${fmtD(x.nextDue)}` : ''; },
    };
  }
  const ctx = (p, at) => Object.assign({}, p, { age: E.ageAt(p.birth, at) });
  const inSite = (p) => ui.site === 'all' || p.site === ui.site;
  const persons = () => db.persons.filter(inSite);
  const pname = (p) => (ui.mask ? E.maskName(p.name) : p.name);
  const pid2 = (p) => p.demoId || E.maskId(p.nationalId);

  // ───────────── 共用元件 ─────────────
  const lv = (l, extra = '') => `<span class="lv ${l || 'na'}">${E.LEVEL_LABEL[l] || '—'}${extra}</span>`;
  const dot = (r) => r ? `<span class="dot ${r.level}" data-tip="${esc(`${r.label}：${r.value}\n${E.LEVEL_LABEL[r.level]}層｜${r.reason}`)}">${r.level === 'na' ? '–' : E.LEVEL_LABEL[r.level]}</span>` : '<span class="dot none" data-tip="未量測">·</span>';
  function dueText(s) {
    if (!s.due) return '<span class="muted">—</span>';
    const d = s.daysLeft;
    const t = s.overdue ? `逾期 ${Math.max(1, -d + 1)} 天` : d <= 0 ? '今天到期' : `剩 ${d} 天`;
    return `<span class="${s.overdue ? 'overdue' : ''} tnum">${fmtD(s.due)}</span><br><span class="small ${s.overdue ? 'overdue' : 'muted'}">${s.overdue ? '⚠ ' : ''}${t}</span>`;
  }
  function toast(msg) { const t = $('#toast'); t.textContent = msg; t.style.display = 'block'; clearTimeout(toast.h); toast.h = setTimeout(() => (t.style.display = 'none'), 2800); }
  function download(name, content, type) {
    const blob = new Blob([content], { type }); const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
  // CSV：防公式注入（文字以 = + - @ 或定位字元開頭時前置 '，避免在 Excel 被當成公式執行）
  function csv(rows) { return '\ufeff' + rows.map((r) => r.map((c) => { let s = String(c ?? ''); if (typeof c !== 'number' && /^[=+\-@\t\r]/.test(s)) s = "'" + s; return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; }).join(',')).join('\r\n'); }
  function exportCsv(name, rows, what) {
    if ((SERVER || sensitive()) && !confirm('匯出的檔案含個人資料且未加密。請只存放在院內核可的加密位置，用畢刪除。確定匯出？')) return;
    if (SERVER) api('export-log', { what: what || name, count: Math.max(0, rows.length - 1) }).catch(() => {});
    else { audit('匯出', `${what || name}（${Math.max(0, rows.length - 1)} 列）`); save(); }
    download(name, csv(rows), 'text/csv');
  }

  // 全域提示框：任何帶 data-tip 的元素
  const tip = document.createElement('div'); tip.className = 'tip'; tip.style.position = 'fixed'; document.body.appendChild(tip);
  document.addEventListener('mouseover', (e) => { const el = e.target.closest('[data-tip]'); if (!el) { tip.style.display = 'none'; return; } tip.innerHTML = esc(el.dataset.tip).replace(/\n/g, '<br>'); tip.style.display = 'block'; });
  document.addEventListener('mousemove', (e) => { if (tip.style.display === 'block') { tip.style.left = e.clientX + 'px'; tip.style.top = e.clientY + 'px'; } });
  document.addEventListener('scroll', () => (tip.style.display = 'none'), true);

  function dialog(title, body, buttons) {
    const dlg = $('#dlg'); $('#dlg-title').textContent = title; $('#dlg-body').innerHTML = body;
    const foot = $('#dlg-foot'); foot.innerHTML = '';
    for (const b of buttons) {
      const el = document.createElement('button'); el.type = 'button'; el.className = 'btn' + (b.primary ? ' primary' : ''); el.textContent = b.label;
      el.onclick = () => { try { if (b.onClick && b.onClick($('#dlg-body')) === false) return; dlg.close(); } catch (err) { toast(err.message); } };
      foot.appendChild(el);
    }
    dlg.showModal();
  }

  // ───────────── 圖表（內嵌 SVG） ─────────────
  // 折線：線為中性色，點依該次量測層級著色（顏色＋提示框中的層級文字）
  function lineChart({ series, refs = [], unit = '', h = 150, yMin, yMax }) {
    const W = 560, H = h, L = 36, R = 44, T = 8, B = 22;
    const pts = series.flatMap((s) => s.pts);
    if (!pts.length) return '<div class="empty small">尚無資料</div>';
    const ts = pts.map((p) => +p.t), vs = pts.map((p) => p.v);
    let x0 = Math.min(...ts), x1 = Math.max(...ts); if (x0 === x1) { x0 -= 864e5 * 15; x1 += 864e5 * 15; }
    let y0 = Math.min(...vs, ...refs.map((r) => r.v)), y1 = Math.max(...vs, ...refs.map((r) => r.v));
    if (yMin !== undefined) y0 = Math.min(y0, yMin); if (yMax !== undefined) y1 = Math.max(y1, yMax);
    const padY = (y1 - y0) * 0.08 || 1; y0 -= padY; y1 += padY;
    const X = (t) => L + ((t - x0) / (x1 - x0)) * (W - L - R), Y = (v) => T + (1 - (v - y0) / (y1 - y0)) * (H - T - B);
    const ticks = 4, step = (y1 - y0) / ticks;
    let g = '';
    for (let i = 0; i <= ticks; i++) { const v = y0 + step * i; g += `<line class="grid-l" x1="${L}" x2="${W - R}" y1="${Y(v)}" y2="${Y(v)}"/><text class="axis-t" x="${L - 6}" y="${Y(v) + 4}" text-anchor="end">${Math.round(v)}</text>`; }
    for (const r of refs) g += `<line class="ref-l" x1="${L}" x2="${W - R}" y1="${Y(r.v)}" y2="${Y(r.v)}" style="stroke:var(--lv-${r.level})"/><text class="axis-t" x="${W - R + 4}" y="${Y(r.v) + 4}">${esc(r.label)}</text>`;
    g += `<text class="axis-t" x="${L}" y="${H - 4}">${fmtD(new Date(x0).toISOString())}</text><text class="axis-t" x="${W - R}" y="${H - 4}" text-anchor="end">${fmtD(new Date(x1).toISOString())}</text>`;
    for (const s of series) {
      if (s.pts.length > 1) g += `<polyline fill="none" stroke="var(--ink-3)" stroke-width="2" stroke-linejoin="round" ${s.dash ? 'stroke-dasharray="5 4"' : ''} points="${s.pts.map((p) => `${X(+p.t)},${Y(p.v)}`).join(' ')}"/>`;
      for (const p of s.pts) g += `<circle cx="${X(+p.t)}" cy="${Y(p.v)}" r="4.5" fill="var(--lv-${p.level || 'na'})" stroke="var(--surface)" stroke-width="2"/>`;
      const last = s.pts[s.pts.length - 1];
      if (series.length > 1) g += `<text class="axis-t" x="${X(+last.t) + 8}" y="${Y(last.v) + 4}">${esc(s.name)}</text>`;
    }
    // 命中區：每個時間點一欄，懸停顯示十字線與數值
    const times = [...new Set(ts)].sort((a, b) => a - b);
    times.forEach((t, i) => {
      const xa = i ? (X(times[i - 1]) + X(t)) / 2 : L, xb = i < times.length - 1 ? (X(t) + X(times[i + 1])) / 2 : W - R;
      const lines = series.map((s) => { const p = s.pts.find((q) => +q.t === t); return p ? `${s.name} ${p.label ?? p.v}${unit}（${E.LEVEL_LABEL[p.level] || '—'}）` : null; }).filter(Boolean);
      g += `<g class="col"><line x1="${X(t)}" x2="${X(t)}" y1="${T}" y2="${H - B}" stroke="var(--ink-3)" stroke-width="1" opacity="0"/><rect x="${xa}" y="${T}" width="${Math.max(1, xb - xa)}" height="${H - T - B}" fill="transparent" data-tip="${esc(fmtDT(new Date(t).toISOString()) + '\n' + lines.join('\n'))}"/></g>`;
    });
    return `<div class="chart"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(series.map((s) => s.name).join('、'))}趨勢圖"><style>.col:hover line{opacity:1}</style>${g}</svg></div>`;
  }

  // 堆疊橫條：各據點管理層級分布
  function stackedBars(rows) {
    const max = Math.max(1, ...rows.map((r) => r.total));
    const legend = `<div class="legend">${LV_ORDER.slice().reverse().map((l) => `<span><i style="background:var(--lv-${l})"></i>${E.LEVEL_LABEL[l]}</span>`).join('')}</div>`;
    const body = rows.map((r) => `<div class="bar-row"><span title="${esc(r.name)}" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(r.name)}</span><div class="track" style="width:${(r.total / max) * 100}%">${['green', 'yellow', 'orange', 'red'].filter((l) => r[l]).map((l) => `<div class="seg ${l}" style="flex:${r[l]}" data-tip="${esc(`${r.name}｜${E.LEVEL_LABEL[l]}層 ${r[l]} 人（${((r[l] / r.total) * 100).toFixed(0)}%）`)}"></div>`).join('')}</div><span class="tnum muted small" style="text-align:right">${r.total}</span></div>`).join('');
    return legend + body;
  }

  function simpleBars(rows, unit = '') {
    const max = Math.max(1, ...rows.map((r) => r.v));
    return rows.map((r) => `<div class="bar-row"><span>${esc(r.name)}</span><div class="track" style="width:${Math.max(0.5, (r.v / max) * 100)}%"><div class="seg ${r.cls || 'neutral'}" style="flex:1" data-tip="${esc(`${r.name}：${r.v}${unit}`)}"></div></div><span class="tnum small" style="text-align:right">${r.v}</span></div>`).join('');
  }

  // ───────────── 外框 ─────────────
  const ROUTES = [
    ['dashboard', '總覽'], ['worklist', '追蹤工作清單'], ['residents', '民眾名冊'], ['quality', '品質指標'], ['888', '健康888'], ['import', '資料匯入'], ['rules', '分層規則與設定'],
  ];
  function shell() {
    const sites = [...new Set(db.persons.map((p) => p.site))].sort();
    if (ui.site !== 'all' && !sites.includes(ui.site)) ui.site = 'all';
    $('#site-filter').innerHTML = `<option value="all">全部據點</option>` + sites.map((s) => `<option ${s === ui.site ? 'selected' : ''}>${esc(s)}</option>`).join('');
    if (SERVER) { ui.user = SERVER.user.name; $('#user-sel').innerHTML = `<option>${esc(SERVER.user.name)}</option>`; $('#user-sel').disabled = true; }
    const ns = nurses(); if (!SERVER && !ns.includes(ui.user)) ui.user = ns[0];
    $('#lock-btn').hidden = !vaultKey && !SERVER;
    $('#lock-btn').textContent = SERVER ? '登出' : '🔒 鎖定';
    $('#user-sel').innerHTML = ns.map((n) => `<option ${n === ui.user ? 'selected' : ''}>${esc(n)}</option>`).join('');
    const route = (location.hash.slice(2) || 'dashboard').split('/')[0];
    const now = new Date();
    const overdue = db.episodes.filter((e) => E.isOpen(e) && inSite(IX.byPerson.get(e.personId)) && E.nextStep(e, now).overdue).length;
    $('#tabs').innerHTML = ROUTES.map(([k, t]) => `<a href="#/${k}" class="${route === k || (route === 'p' && k === 'residents') ? 'on' : ''}">${t}${k === 'worklist' && overdue ? ` <span class="badge" title="逾期案件">${overdue}</span>` : ''}</a>`).join('');
  }

  function render() {
    if (!db) return; // 登入或解鎖畫面時沒有資料，不渲染
    index(); shell();
    const [route, arg] = (location.hash.slice(2) || 'dashboard').split('/');
    const app = $('#app');
    const stale = !db.demo && (!SERVER || SERVER.user.role === 'admin') && db.episodes.some(E.isOpen) && db.rulesVersion !== E.RULES_VERSION
      ? `<div class="banner no-print row spread"><span>分層規則已更新（${E.RULES_VERSION}）。開放中的追蹤案仍是依開案當時的規則判定，可能與目前畫面上的項目層級不一致。</span><button class="btn sm primary" type="button" id="regrade-btn">依新規則重新判定</button></div>` : '';
    const banner = stale + (db.demo ? `<div class="banner no-print">目前顯示的是<strong>虛構示範資料</strong>（${db.persons.length} 位合成民眾），用來展示分層與閉環流程。正式使用請到「資料匯入」清除示範資料並匯入名冊。</div>` : '');
    const views = { dashboard, worklist, residents, p: caseView, quality: qualityView, 888: view888, import: importView, rules: rulesView };
    app.innerHTML = banner + (views[route] || dashboard)(arg);
    const rg = $('#regrade-btn');
    if (rg && SERVER) rg.onclick = () => { if (confirm('依目前規則重新判定所有進行中的追蹤輪次？')) srv(api('regrade', {}), (j) => `已重新判定：${j.changes} 案層級改變`); };
    else if (rg) rg.onclick = () => {
      if (!confirm('依目前規則，以每人最近一次量測重新判定所有開放中的追蹤案？變動會寫入各案的處理紀錄。')) return;
      const ch = E.regradeOpen(db, nowISO(), sla(), ui.user); audit('依新規則重新判定', `${ch.length} 案`); save(); render();
      const up = ch.filter((c) => E.RANK[c.to] > E.RANK[c.from]).length, down = ch.length - up;
      toast(`已重新判定：${ch.length} 案層級改變（升 ${up}、降或結案 ${down}）`);
    };
    (bind[route] || (() => {}))(arg);
    saveUI();
  }

  // ───────────── 總覽 ─────────────
  function dashboard() {
    const now = new Date();
    const ps = persons();
    const cnt = { red: 0, orange: 0, yellow: 0, green: 0, none: 0 };
    for (const p of ps) cnt[IX.mgmt(p.id)]++;
    const openEps = db.episodes.filter((e) => E.isOpen(e) && inSite(IX.byPerson.get(e.personId)));
    const od = { red: 0, orange: 0, yellow: 0 };
    for (const e of openEps) if (E.nextStep(e, now).overdue) od[e.level]++;
    const today = db.episodes.filter((e) => inSite(IX.byPerson.get(e.personId)) && E.sameDay(e.detectedAt, now) && e.cycle === 1).length;
    const mon = new Date(now.getFullYear(), now.getMonth(), 1);
    const visits = new Set(db.measurements.filter((m) => new Date(m.at) >= mon && inSite(IX.byPerson.get(m.personId))).map((m) => m.personId + fmtD(m.at))).size;

    const kpi = (l, sub) => `<div class="card kpi ${l}"><a href="#/worklist" data-lv="${l}"><div class="k-label">${lv(l)} ${E.LEVEL_MEANING[l].split('：')[0]}</div><div class="k-val tnum">${cnt[l]}<span class="small muted"> 人</span></div><div class="k-sub">${sub}</div></a></div>`;
    const urgent = openEps.map((e) => ({ e, s: E.nextStep(e, now), p: IX.byPerson.get(e.personId) }))
      .filter((x) => x.e.level === 'red' || x.s.overdue)
      .sort((a, b) => E.RANK[b.e.level] - E.RANK[a.e.level] || (b.s.overdue - a.s.overdue) || new Date(a.s.due) - new Date(b.s.due)).slice(0, 10);

    const sites = [...new Set(ps.map((p) => p.site))].sort();
    const siteRows = sites.map((s) => { const r = { name: s, total: 0, red: 0, orange: 0, yellow: 0, green: 0 }; for (const p of ps.filter((x) => x.site === s)) { const l = IX.mgmt(p.id); if (l !== 'none') { r[l]++; r.total++; } } return r; });
    const waiting = E.recheckOverdue(db, now).filter((e) => inSite(IX.byPerson.get(e.personId)));
    const stateRows = E.OPEN_STATES.map((st) => ({ name: '停在' + E.STATE_LABEL[st], v: openEps.filter((e) => e.state === st).length })).concat([{ name: '待回站複測', v: waiting.length, cls: 'yellow' }]);
    const q = E.quality(db, now, ui.qWindow, (e) => inSite(IX.byPerson.get(e.personId)));
    let screened = 0, totalVisits = 0;
    for (const p of ps) { const n = IX.sessions(p.id).length; if (n) { screened++; totalVisits += n; } }

    return `
    <div class="row spread"><h1>總覽</h1><span class="muted small">${fmtDT(now.toISOString())}・${ui.site === 'all' ? '全部據點' : esc(ui.site)}</span></div>
    <div class="grid g4">
      ${kpi('red', `${od.red ? `<span class="overdue">逾期 ${od.red} 案</span>` : '無逾期'}・當日處理、24 小時確認就醫`)}
      ${kpi('orange', `${od.orange ? `<span class="overdue">逾期 ${od.orange} 案</span>` : '無逾期'}・4 週內就醫`)}
      ${kpi('yellow', `${od.yellow ? `<span class="overdue">逾期 ${od.yellow} 案</span>` : '無逾期'}・3 個月內完成處方`)}
      ${kpi('green', `例行量測${cnt.none ? `・另 ${cnt.none} 人尚未量測` : ''}`)}
    </div>
    <div class="grid g-side" style="margin-top:12px">
      <div class="card">
        <div class="row spread"><h2>需優先處理（紅層與逾期）</h2><a href="#/worklist" class="small">完整工作清單 →</a></div>
        ${urgent.length ? `<div class="tbl-wrap"><table><thead><tr><th>層級</th><th>民眾</th><th>據點</th><th>異常項目</th><th>下一步</th><th>期限</th></tr></thead><tbody>
        ${urgent.map(({ e, s, p }) => `<tr class="click" data-href="#/p/${p.id}"><td>${lv(e.level)}${e.emergency ? ' <span class="tag bad">急</span>' : ''}</td><td>${esc(pname(p))}</td><td class="small">${esc(p.site)}</td><td class="small">${e.items.filter((i) => i.level === e.level).map((i) => E.ITEM_LABEL[i.key]).join('、')}</td><td class="small">${esc(s.label)}</td><td class="small">${dueText(s)}</td></tr>`).join('')}
        </tbody></table></div>` : '<div class="empty">目前沒有紅層或逾期案件</div>'}
      </div>
      <div class="stack">
        <div class="card"><h2>篩檢</h2><div class="grid g2">
          <div><div class="muted small">總篩檢人數</div><div class="k-val tnum" style="font-size:24px;font-weight:700">${screened}<span class="small muted" style="font-weight:400"> / ${ps.length} 人</span></div><div class="small muted tnum">涵蓋率 ${ps.length ? ((screened / ps.length) * 100).toFixed(1) : '—'}%</div></div>
          <div><div class="muted small">累計量測人次</div><div class="k-val tnum" style="font-size:24px;font-weight:700">${totalVisits}</div><div class="small muted">同人 60 分鐘內重測算 1 次</div></div>
        </div><p class="small muted" style="margin:6px 0 0">總篩檢人數＝已建檔民眾中，健康站量測至少 1 次者（不限期間）。</p></div>
        <div class="card"><h2>今日</h2><div class="grid g2">
          <div><div class="muted small">今日新偵測異常</div><div class="k-val tnum" style="font-size:24px;font-weight:700">${today}</div></div>
          <div><div class="muted small">本月量測人次</div><div class="k-val tnum" style="font-size:24px;font-weight:700">${visits}</div></div>
        </div></div>
        <div class="card"><h2>追蹤進度</h2><p class="small muted" style="margin:0 0 6px">每一輪：偵測 → 通知 → 介入 → 確認；確認後到期回站複測，再開始下一輪</p>${simpleBars(stateRows, ' 案')}</div>
      </div>
    </div>
    <div class="grid g2" style="margin-top:12px">
      <div class="card"><div class="row spread"><h2>各據點管理層級分布</h2><button class="btn sm" id="site-tbl-btn" type="button">表格檢視</button></div>
        <div id="site-chart">${stackedBars(siteRows)}</div>
        <div id="site-tbl" hidden><div class="tbl-wrap"><table><thead><tr><th>據點</th>${LV_ORDER.map((l) => `<th class="num">${E.LEVEL_LABEL[l]}</th>`).join('')}<th class="num">合計</th></tr></thead><tbody>${siteRows.map((r) => `<tr><td>${esc(r.name)}</td>${LV_ORDER.map((l) => `<td class="num">${r[l]}</td>`).join('')}<td class="num">${r.total}</td></tr>`).join('')}</tbody></table></div></div>
      </div>
      <div class="card"><div class="row spread"><h2>品質指標（近 ${ui.qWindow} 天）</h2><a href="#/quality" class="small">詳細 →</a></div>
        <div class="grid g2">${[['紅層當日處理率', q.redSameDay], ['橙層就醫確認率', q.orangeConfirm], ['複測完成率', q.retest], ['降級（改善）率', q.improve]].map(([t, w]) => `<div><div class="muted small">${t}</div><div class="tnum" style="font-size:22px;font-weight:700">${pct(w)}</div><div class="small muted tnum">${w.k}/${w.n}　${ci(w)}</div></div>`).join('')}</div>
        <p class="small" style="margin:10px 0 0">未閉環逾期個案：<strong class="${q.unclosed ? 'overdue' : ''}">${q.unclosed}</strong> 案</p>
      </div>
    </div>`;
  }

  // ───────────── 工作清單 ─────────────
  function worklistRows() {
    const now = new Date(), f = ui.wl, q = f.q.trim();
    return db.episodes.filter(E.isOpen).map((e) => ({ e, p: IX.byPerson.get(e.personId), s: E.nextStep(e, now) }))
      .filter(({ e, p, s }) => p && inSite(p) && (!f.levels.length || f.levels.includes(e.level)) && (f.state === 'all' || e.state === f.state) && (!f.overdue || s.overdue) && (!f.mine || e.assignee === ui.user)
        && (!q || p.name.includes(q) || (p.nationalId || '').includes(q.toUpperCase()) || (p.demoId || '').includes(q.toUpperCase())))
      .sort((a, b) => (b.s.overdue - a.s.overdue) || E.RANK[b.e.level] - E.RANK[a.e.level] || (new Date(a.s.due || 8.64e15) - new Date(b.s.due || 8.64e15)));
  }
  function worklist() {
    const f = ui.wl, rows = worklistRows();
    return `<h1>追蹤工作清單</h1>
    <div class="filters">
      <div class="chips" role="group" aria-label="層級">${['red', 'orange', 'yellow'].map((l) => `<button type="button" class="chip" data-lvf="${l}" aria-pressed="${f.levels.includes(l)}">${E.LEVEL_LABEL[l]}層</button>`).join('')}</div>
      <select id="wl-state" aria-label="階段"><option value="all">全部階段</option>${E.OPEN_STATES.map((s) => `<option value="${s}" ${f.state === s ? 'selected' : ''}>${E.STATE_LABEL[s]}</option>`).join('')}</select>
      <label class="row small"><input type="checkbox" id="wl-od" ${f.overdue ? 'checked' : ''}>只看逾期</label>
      <label class="row small"><input type="checkbox" id="wl-mine" ${f.mine ? 'checked' : ''}>只看派給我</label>
      <input type="search" id="wl-q" placeholder="搜尋姓名或證號" value="${esc(f.q)}">
      <span class="muted small" style="margin-left:auto">${rows.length} 案</span>
      <button class="btn sm" id="wl-export" type="button">匯出 CSV</button>
    </div>
    ${rows.length ? `<div class="tbl-wrap"><table><thead><tr><th>層級</th><th>民眾</th><th>據點</th><th>異常項目（目前層級）</th><th>階段</th><th>下一步</th><th>期限</th><th>負責</th></tr></thead><tbody>
    ${rows.map(({ e, p, s }) => `<tr class="click" data-href="#/p/${p.id}"><td>${lv(e.level)}${e.provisional ? ' <span class="tag warn" data-tip="單次量測，需重測確認">暫定</span>' : ''}${e.emergency ? ' <span class="tag bad">急</span>' : ''}${e.cycle > 1 ? `<div class="small muted">第 ${e.cycle} 輪</div>` : ''}</td>
      <td><strong>${esc(pname(p))}</strong><div class="small muted">${esc(pid2(p))}・${p.sex === 'M' ? '男' : p.sex === 'F' ? '女' : '—'} ${E.ageAt(p.birth, new Date()) ?? '—'} 歲</div></td>
      <td class="small">${esc(p.site)}</td>
      <td class="small">${e.items.map((i) => `<span class="lv ${i.level}" style="margin:0 4px 4px 0" data-tip="${esc(`${i.value}｜${i.reason}${i.lifestyle ? '｜生活型態追蹤，不轉介' : ''}`)}">${E.ITEM_LABEL[i.key]}${i.lifestyle ? '・生活' : ''}</span>`).join('')}</td>
      <td class="small">${E.STATE_LABEL[e.state]}</td><td class="small">${esc(s.label)}</td><td class="small">${dueText(s)}</td><td class="small">${esc(e.assignee || '未派')}</td></tr>`).join('')}
    </tbody></table></div>` : '<div class="card empty">沒有符合條件的追蹤案</div>'}
    ${(() => { const now = new Date(), w = E.recheckOverdue(db, now).map((e) => ({ e, p: IX.byPerson.get(e.personId) })).filter(({ p }) => p && inSite(p)).sort((a, b) => new Date(a.e.nextDue) - new Date(b.e.nextDue));
      return `<h2 style="margin-top:20px">待回站複測 <span class="muted small">${w.length} 人・上一輪已確認、複測日已過，請通知民眾回站量測</span></h2>${w.length ? `<div class="tbl-wrap"><table><thead><tr><th>上一輪</th><th>民眾</th><th>據點</th><th>複測日</th><th>負責</th></tr></thead><tbody>${w.map(({ e, p }) => `<tr class="click" data-href="#/p/${p.id}"><td>${lv(e.level)} <span class="small muted">第 ${e.cycle} 輪</span></td><td><strong>${esc(pname(p))}</strong><div class="small muted">${esc(pid2(p))}</div></td><td class="small">${esc(p.site)}</td><td class="small">${dueText(E.nextStep(e, now))}</td><td class="small">${esc(e.assignee || '—')}</td></tr>`).join('')}</tbody></table></div>` : '<div class="card empty">目前沒有逾期未回站的民眾</div>'}`; })()}`;
  }

  // ───────────── 民眾名冊 ─────────────
  function residents() {
    const f = ui.rs, q = f.q.trim();
    const rows = persons().map((p) => ({ p, m: IX.mgmt(p.id), l: IX.latest(p.id) }))
      .filter(({ p, m }) => (!f.levels.length || f.levels.includes(m)) && (!q || p.name.includes(q) || (p.nationalId || '').includes(q.toUpperCase()) || (p.demoId || '').includes(q.toUpperCase())))
      .sort((a, b) => (E.RANK[b.m] ?? -2) - (E.RANK[a.m] ?? -2) || a.p.site.localeCompare(b.p.site) || a.p.name.localeCompare(b.p.name));
    const shown = rows.slice(0, ui.rsLimit || 200);
    return `<h1>民眾名冊</h1>
    <div class="filters">
      <div class="chips">${[...LV_ORDER, 'none'].map((l) => `<button type="button" class="chip" data-rsf="${l}" aria-pressed="${f.levels.includes(l)}">${l === 'none' ? '未量測' : E.LEVEL_LABEL[l] + '層'}</button>`).join('')}</div>
      <input type="search" id="rs-q" placeholder="搜尋姓名或證號" value="${esc(f.q)}">
      <span class="muted small" style="margin-left:auto">${rows.length} 人</span>
    </div>
    <div class="tbl-wrap"><table><thead><tr><th>管理層級</th><th>民眾</th><th>據點</th><th>最近量測</th>${E.ITEMS.map((i) => `<th title="${i.label}" style="text-align:center">${SHORT[i.key]}</th>`).join('')}<th>追蹤階段</th></tr></thead><tbody>
    ${shown.map(({ p, m, l }) => { const e = IX.open.get(p.id); return `<tr class="click" data-href="#/p/${p.id}"><td>${m === 'none' ? '<span class="lv na">未量測</span>' : lv(m)}</td><td><strong>${esc(pname(p))}</strong><div class="small muted">${esc(pid2(p))}</div></td><td class="small">${esc(p.site)}</td><td class="small tnum">${l ? fmtD(l.session.at) : '—'}</td>${E.ITEMS.map((i) => `<td style="text-align:center">${l ? dot(l.ev.items[i.key]) : dot(null)}</td>`).join('')}<td class="small">${IX.stage(p.id) || '<span class="muted">—</span>'}</td></tr>`; }).join('')}
    </tbody></table></div>
    ${rows.length > shown.length ? `<p class="row"><button class="btn" id="rs-more" type="button">再顯示 200 人</button></p>` : ''}
    <p class="small muted">表格中的小方塊為最近一次量測各項目的層級（綠／黃／橙／紅，「–」為資料不足）；管理層級則以開放中的追蹤案為準。</p>`;
  }

  // ───────────── 個案頁 ─────────────
  function caseView(id) {
    const p = IX.byPerson.get(id);
    if (!p) return '<div class="card empty">找不到此民眾</div>';
    const now = new Date();
    const l = IX.latest(id), ep = IX.open.get(id);
    const past = db.episodes.filter((e) => e.personId === id && !E.isOpen(e)).sort((a, b) => new Date(b.detectedAt) - new Date(a.detectedAt));
    const lastEp = IX.last.get(id);
    const sessions = IX.sessions(id);
    const evs = sessions.map((s) => ({ s, ev: E.evaluateSession(ctx(p, s.at), s.readings) }));
    const age = E.ageAt(p.birth, now);
    const flags = [['chronic', '慢性病'], ['immuno', '免疫低下'], ['copd', '慢性肺病'], ['medHTN', '服降壓藥'], ['medDM', '服降糖藥'], ['medLipid', '服降脂藥']];

    const series = (key, field, name, opts = {}) => ({ name, dash: opts.dash, pts: evs.map(({ s, ev }) => { const v = s.readings.map((r) => r[field]).filter((x) => x !== undefined && x !== null && x !== '').pop(); return v === undefined ? null : { t: new Date(s.at), v: +v, level: ev.items[key] && ev.items[key].level, label: opts.lab ? opts.lab(s) : undefined }; }).filter(Boolean) });
    const bmiSeries = { name: 'BMI', pts: evs.map(({ s, ev }) => ev.items.body && ev.items.body.bmi ? { t: new Date(s.at), v: Math.round(ev.items.body.bmi * 10) / 10, level: ev.items.body.level } : null).filter(Boolean) };

    return `
    <div class="row spread"><div><a href="#/residents" class="small">← 民眾名冊</a><h1 style="margin-top:4px">${esc(pname(p))} <span class="muted small" style="font-weight:400">${esc(pid2(p))}</span></h1></div>
      <div class="row no-print"><button class="btn" id="add-m" type="button">＋ 新增量測</button></div></div>
    ${ep && ep.emergency ? `<div class="banner danger">⚠ 有警示症狀：依規範有症狀者立即撥 119，並於當日確認就醫。</div>` : ''}
    <div class="grid g-side">
      <div class="stack">
        ${ep ? episodeCard(p, ep, now) : waitCard(p, lastEp, l, now)}
        ${l && E.RANK[l.ev.lifestyle] >= 1 ? `<div class="card" style="border-left:4px solid var(--lv-${l.ev.lifestyle})"><div class="row spread"><h2 style="margin:0">生活型態追蹤 ${lv(l.ev.lifestyle)}</h2><button class="btn sm no-print" type="button" id="life-rx">列印生活型態處方</button></div>
          <p class="small" style="margin:6px 0 0">${E.LIFESTYLE.map((k) => l.ev.items[k]).filter((r) => r && E.RANK[r.level] >= 1).map((r) => `${r.label}：${esc(r.value)}（${E.LEVEL_LABEL[r.level]}）`).join('；')}</p>
          <p class="small muted" style="margin:4px 0 0">只開健康處方，不派案、不轉介，也不計入整體層級。${ep ? '已併入目前追蹤案的健康處方。' : ''}</p></div>` : ''}
        <div class="card"><div class="row spread"><h2>最近一次量測判定</h2><span class="small muted">${l ? fmtDT(l.session.at) + (l.session.readings.length > 1 ? `・含 ${l.session.readings.length - 1} 次重測` : '') : ''}</span></div>
          ${l ? `<div class="tbl-wrap"><table><thead><tr><th>項目</th><th>數值</th><th>層級</th><th>判定依據</th><th>處理建議</th></tr></thead><tbody>
          ${E.ITEMS.map((it) => { const r = l.ev.items[it.key]; return r ? `<tr><td>${it.label}</td><td class="tnum">${esc(r.value)}</td><td>${lv(r.level)}${r.provisional ? ' <span class="tag warn">暫定</span>' : ''}${r.lifestyle ? ' <span class="tag" data-tip="生活型態追蹤：不計入整體層級、不轉介">生活型態</span>' : ''}</td><td class="small">${esc(r.reason)}${r.notes.length ? `<div class="small" style="color:var(--warn-ink)">${r.notes.map(esc).join('<br>')}</div>` : ''}</td><td class="small">${r.actions.map(esc).join('、')}</td></tr>` : `<tr><td>${it.label}</td><td colspan="4" class="muted small">本次未量測</td></tr>`; }).join('')}
          </tbody></table></div>${l.ev.symptoms.length ? `<p class="small">回報症狀：${l.ev.symptoms.map((s) => E.SYMPTOMS[s] || s).join('、')}</p>` : ''}` : '<div class="empty">尚無量測資料</div>'}
        </div>
        <div class="card"><h2>趨勢</h2><p class="small muted" style="margin-top:-6px">點的顏色為該次量測的層級；虛線為分層閾值。滑過可看數值。</p>
          <div class="grid g2">
            <div><h3>血壓（mmHg）</h3><div class="legend"><span>— 實線 收縮壓</span><span>- - 虛線 舒張壓</span></div>${lineChart({ series: [series('bp', 'sbp', '收縮壓'), series('bp', 'dbp', '舒張壓', { dash: true })], refs: [{ v: 160, label: '160', level: 'orange' }, { v: 140, label: '140', level: 'yellow' }, { v: 90, label: '90', level: 'yellow' }] })}</div>
            <div><h3>血糖（mg/dL）</h3>${lineChart({ series: [series('glucose', 'glucose', '血糖')], refs: [{ v: 126, label: '空腹126', level: 'orange' }, { v: 200, label: '飯後200', level: 'orange' }] })}</div>
            <div><h3>血氧（%）</h3>${lineChart({ series: [series('spo2', 'spo2', '血氧')], refs: [{ v: 95, label: '95', level: 'yellow' }, { v: 90, label: '90', level: 'red' }], yMax: 100 })}</div>
            <div><h3>脈搏（次/分）</h3>${lineChart({ series: [series('pulse', 'pulse', '脈搏')], refs: [{ v: 100, label: '100', level: 'orange' }, { v: 60, label: '60', level: 'yellow' }] })}</div>
            <div><h3>BMI</h3>${lineChart({ series: [bmiSeries], refs: [{ v: 24, label: '24', level: 'yellow' }, { v: 27, label: '27', level: 'orange' }] })}</div>
            <div><h3>LDL（mg/dL）</h3>${lineChart({ series: [series('lipid', 'ldl', 'LDL')], refs: [{ v: 130, label: '130', level: 'yellow' }, { v: 160, label: '160', level: 'orange' }] })}</div>
          </div>
        </div>
        <div class="card"><h2>量測紀錄</h2><div class="tbl-wrap"><table><thead><tr><th>時間</th><th>整體</th>${E.ITEMS.map((i) => `<th style="text-align:center">${SHORT[i.key]}</th>`).join('')}<th>來源</th></tr></thead><tbody>
          ${evs.slice().reverse().slice(0, 30).map(({ s, ev }) => `<tr><td class="small tnum">${fmtDT(s.at)}${s.readings.length > 1 ? ` <span class="tag">重測×${s.readings.length - 1}</span>` : ''}</td><td>${lv(ev.overall)}</td>${E.ITEMS.map((i) => `<td style="text-align:center">${dot(ev.items[i.key])}</td>`).join('')}<td class="small muted">${esc({ device: '設備', manual: '手動', import: '匯入' }[s.readings[0].source] || '')}</td></tr>`).join('')}
        </tbody></table></div></div>
      </div>
      <div class="stack">
        <div class="card"><h2>基本資料</h2>
          <div class="small" style="display:grid;grid-template-columns:auto 1fr;gap:4px 12px">
            <span class="muted">性別／年齡</span><span>${p.sex === 'M' ? '男' : p.sex === 'F' ? '女' : '—'}／${age ?? '—'} 歲</span>
            <span class="muted">生日</span><span>${p.birth ? fmtD(p.birth) : '<span class="overdue">未填或待確認</span>'}</span>
            <span class="muted">身高</span><span>${p.heightCm ?? '—'} 公分</span>
            <span class="muted">據點</span><span>${esc(p.site)}</span>
            <span class="muted">身分證號</span><span>${p.nationalId ? `<span id="nid">${E.maskId(p.nationalId)}</span> <button class="btn sm" type="button" id="show-nid">顯示</button>` : '<span class="muted">—</span>'}</span>
            <span class="muted">電話</span><span>${p.phone ? esc(p.phone.replace(/\d(?=\d{3})/g, (d, i) => (i > 3 ? '•' : d))) : '—'}</span>
          </div>
          <h3 style="margin-top:12px">風險註記（影響分層）</h3>
          <div class="chips">${flags.map(([k, t]) => `<label class="chip" style="cursor:pointer"><input type="checkbox" data-flag="${k}" ${p[k] ? 'checked' : ''} style="margin-right:4px">${t}</label>`).join('')}</div>
          ${p.copd ? `<label class="f" style="margin-top:8px">慢性肺病個人血氧基線（%）<input type="number" id="spo2-base" value="${p.spo2Baseline ?? ''}" min="80" max="100"></label>` : ''}
          <p class="small muted">已服藥者於代謝症候群該項視為符合；高齡（≥65）、免疫低下、慢性病者發燒須當日就醫。</p>
        </div>
        <div class="card"><h2>歷次追蹤</h2>
          ${past.length ? past.map((e) => `<details style="margin-bottom:6px"><summary>${lv(e.level)} 第 ${e.cycle} 輪・${fmtD(e.detectedAt)}・${e.state === 'closed' ? `結案（${esc(e.close.reason)}）` : `已確認${e.recheck ? `・複測 ${E.LEVEL_LABEL[e.recheck.level]}層` : e.nextDue ? `・待複測 ${fmtD(e.nextDue)}` : ''}`}</summary>${timeline(e)}${e.rx ? `<div class="rx small" style="margin-top:6px">${esc(e.rx.text)}</div>` : ''}</details>`).join('') : '<p class="muted small">尚無已完成的追蹤</p>'}
        </div>
      </div>
    </div>`;
  }

  function timeline(e) { return `<ul class="timeline">${e.log.slice().reverse().map((x) => `<li><time class="tnum">${fmtDT(x.at)}</time>${esc(x.text)} <span class="muted small">${esc(x.by)}</span></li>`).join('')}</ul>`; }

  const STEPS = ['detected', 'notified', 'intervened', 'confirmed'];
  function stepper(state) {
    const ci = STEPS.indexOf(state);
    return `<div class="stepper" aria-label="追蹤步驟">${STEPS.map((st, i) => `<div class="step ${i < ci || state === 'confirmed' ? 'done' : i === ci ? 'cur' : ''}">${E.STATE_LABEL[st]}</div>`).join('')}</div>`;
  }

  // 沒有進行中的輪次時：顯示上一輪完成、等待複測，或目前不需追蹤
  function waitCard(p, last, l, now) {
    if (last && last.state === 'confirmed' && last.nextDue) {
      const s = E.nextStep(last, now);
      return `<div class="card" style="border-left:4px solid var(--lv-${last.level})">
        <div class="row spread"><h2 style="margin:0">${lv(last.level)} 第 ${last.cycle} 輪已完成</h2><span class="small muted">確認於 ${fmtD(last.confirm && last.confirm.at)}</span></div>
        ${stepper('confirmed')}
        <div class="grid g2" style="margin-top:10px"><div><h3>下一步：${esc(s.label)}</h3><div class="small">${dueText(s)}</div></div>
        <p class="small muted" style="margin:0">民眾回站量測後，系統自動判斷：升高立即開始下一輪；複測日後仍異常則開始下一輪（最近 2 次量測取較高者）；連續 2 次綠層則回到例行量測。</p></div>
        <div class="row" style="margin-top:10px"><button class="btn" type="button" id="add-m2">登錄複測量測</button></div></div>`;
    }
    return `<div class="card"><h2>追蹤狀態</h2><p>${lv(l ? (l.ev.overall === 'na' ? 'na' : l.ev.overall) : 'na')} 目前沒有進行中的追蹤。${l && E.RANK[l.ev.overall] <= 0 ? '回饋與例行量測即可。' : ''}</p></div>`;
  }

  function episodeCard(p, ep, now) {
    const s = E.nextStep(ep, now);
    const nurseOpts = nurses().map((n) => `<option ${n === (ep.assignee || ui.user) ? 'selected' : ''}>${esc(n)}</option>`).join('');
    const needVisit = E.RANK[ep.level] >= 2;
    let form = '';
    switch (ep.state) {
      case 'detected':
        form = `<div class="form-grid"><label class="f">負責護理師<select name="assignee">${nurseOpts}</select></label><label class="f">通知方式<select name="method"><option>電話</option><option>App 推播</option><option>現場</option><option>家訪</option><option>簡訊</option></select></label></div>
          <label class="f" style="margin-top:8px">通知內容／備註<input type="text" name="note" placeholder="例：已電話告知量測結果與就醫建議"></label>
          <button class="btn primary" style="margin-top:10px" data-act="notify">完成通知</button>`; break;
      case 'notified':
        form = `<label class="f">健康處方（必填，可修改）<textarea name="rx">${esc(E.prescription(p, ep))}</textarea></label>
          <label class="f" style="margin-top:8px">介入紀錄<input type="text" name="note" placeholder="例：衛教飲食與運動、評估用藥狀況"></label>
          <div class="row" style="margin-top:10px"><button class="btn primary" data-act="intervene">完成介入（開立健康處方）</button><button class="btn" data-print-rx>列印處方</button></div>`; break;
      case 'intervened':
        form = needVisit ? `<div class="form-grid"><label class="f">就醫日期<input type="date" name="visitDate" required></label><label class="f">就醫院所／科別<input type="text" name="facility" placeholder="彰基家醫科"></label></div>
          <label class="f" style="margin-top:8px">就醫結果<input type="text" name="result" placeholder="例：開始用藥、安排心電圖"></label>
          <button class="btn primary" style="margin-top:10px" data-act="confirm">確認已就醫</button>`
          : `<p class="small">黃層：確認民眾已收到並理解健康處方（衛教完成）。</p><label class="f">備註<input type="text" name="result"></label><button class="btn primary" style="margin-top:10px" data-act="confirm">確認完成健康處方</button>`; break;
    }
    const dueRows = [['通知', ep.due.notify, ep.notify && ep.notify.at], ['介入（健康處方）', ep.due.intervene, ep.intervene && ep.intervene.at], [needVisit ? '確認就醫' : '確認處方', ep.due.confirm, ep.confirm && ep.confirm.at]];
    return `<div class="card" style="border-left:4px solid var(--lv-${ep.level})">
      <div class="row spread"><h2 style="margin:0">${lv(ep.level)} 追蹤中・第 ${ep.cycle} 輪${ep.provisional ? ' <span class="tag warn">暫定，需重測確認</span>' : ''}</h2><span class="small muted">偵測 ${fmtDT(ep.detectedAt)}・負責 ${esc(ep.assignee || '未指定')}</span></div>
      <p class="small" style="margin:6px 0">${esc(E.LEVEL_MEANING[ep.level])}</p>
      <div class="chips" style="margin-bottom:8px">${ep.items.map((i) => `<span class="lv ${i.level}" data-tip="${esc(i.reason)}">${E.ITEM_LABEL[i.key]} ${esc(i.value)}</span>`).join('')}</div>
      ${stepper(ep.state)}
      <div class="grid g2" style="margin-top:10px">
        <div><h3>下一步：${esc(s.label)}</h3><div class="small">${dueText(s)}</div></div>
        <div class="tbl-wrap"><table class="small"><thead><tr><th>步驟</th><th>期限</th><th>完成</th></tr></thead><tbody>${dueRows.map(([n, d, done]) => `<tr><td>${n}</td><td class="tnum">${d ? fmtD(d) : '—'}</td><td class="tnum">${done ? '✓ ' + fmtD(done) : (d && new Date(d) < now ? '<span class="overdue">逾期</span>' : '—')}</td></tr>`).join('')}</tbody></table></div>
      </div>
      <form id="ep-form" class="no-print" style="margin-top:12px">${form}</form>
      <details class="no-print" style="margin-top:12px"><summary class="small">結案（轉由醫師持續管理、死亡、遷出、失聯、拒絕）</summary>
        <div class="row" style="margin-top:8px"><select id="close-reason">${['已轉由醫師持續管理', '失聯', '拒絕', '遷出', '死亡'].map((r) => `<option>${r}</option>`).join('')}</select><input type="date" id="close-followup" title="轉由醫師管理時填回診日期"><input type="text" id="close-note" placeholder="說明（如：3 次電訪未接）"><button class="btn danger" type="button" id="close-btn">結案</button></div>
      </details>
      ${ep.rx ? `<details style="margin-top:8px"><summary class="small">健康處方</summary><div class="rx">${esc(ep.rx.text)}</div><button class="btn sm" type="button" data-print-rx style="margin-top:6px">列印</button></details>` : ''}
      <details style="margin-top:8px" open><summary class="small">處理紀錄</summary>${timeline(ep)}</details>
    </div>`;
  }

  function measurementDialog(p) {
    const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    const n = (name, label, step = 1) => `<label class="f">${label}<input type="number" name="${name}" step="${step}"></label>`;
    dialog(`新增量測：${pname(p)}`, `
      <div class="form-grid">
        <label class="f">量測時間<input type="datetime-local" name="at" value="${d.toISOString().slice(0, 16)}" required></label>
        ${n('sbp', '收縮壓')}${n('dbp', '舒張壓')}${n('pulse', '脈搏')}
        <label class="f">心律旗標<select name="arr"><option value="">無</option><option value="Y">ARR／疑似房顫</option></select></label>
        ${n('spo2', '血氧 %')}${n('temp', '體溫 ℃', 0.1)}${n('glucose', '血糖')}
        <label class="f">血糖類型<select name="glucoseType"><option>空腹</option><option>飯後</option><option selected>隨機</option></select></label>
        ${n('ldl', 'LDL')}${n('tg', '三酸甘油脂')}${n('hdl', 'HDL')}${n('tc', '總膽固醇')}${n('ua', '尿酸', 0.1)}${n('weight', '體重 kg', 0.1)}${n('waist', '腰圍 cm', 0.1)}${n('bodyFat', '體脂 %', 0.1)}
      </div>
      <h3 style="margin-top:12px">症狀</h3><div class="chips">${Object.entries(E.SYMPTOMS).map(([k, v]) => `<label class="chip"><input type="checkbox" name="sx" value="${k}" style="margin-right:4px">${v}</label>`).join('')}</div>
      <p class="small muted">同一場次（60 分鐘內）的重測會合併判定；例如血氧 91–94 需重測 2 次。</p>`,
    [{ label: '取消' }, { label: '儲存並判定', primary: true, onClick: (b) => {
      const fd = new FormData($('#dlg-form'));
      const m = { id: E.uid('m'), personId: p.id, at: new Date(fd.get('at')).toISOString(), source: 'manual', symptoms: fd.getAll('sx') };
      for (const k of ['sbp', 'dbp', 'pulse', 'spo2', 'temp', 'glucose', 'ldl', 'tg', 'hdl', 'tc', 'ua', 'weight', 'waist', 'bodyFat']) { const v = fd.get(k); if (v !== '' && v !== null) m[k] = +v; }
      if (fd.get('arr')) m.arr = true;
      if (m.glucose !== undefined) m.glucoseType = fd.get('glucoseType');
      if (Object.keys(m).length <= 5 && !m.arr) throw new Error('請至少輸入一項數值');
      const bad = E.validateMeasurement(m); if (bad.length) throw new Error(bad.join('；'));
      if ((m.sbp === undefined) !== (m.dbp === undefined)) throw new Error('血壓請同時輸入收縮壓與舒張壓');
      if (SERVER) { srv(api(`persons/${p.id}/measurements`, { m }), (j) => `已判定：${E.LEVEL_LABEL[j.overall]}層${j.emergency ? '，有警示症狀請立即處理' : ''}`); return; }
      db.measurements.push(m);
      const r = E.ingest(db, p.id, m.at, sla());
      save(); render();
      toast(`已判定：${E.LEVEL_LABEL[r.ev.overall]}層${r.ev.emergency ? '，有警示症狀請立即處理' : ''}`);
    } }]);
  }

  function printRx(p, ep, txt) {
    const text = txt || (ep.rx ? ep.rx.text : E.prescription(p, ep));
    const w = window.open('', '_blank');
    if (!w) { toast('瀏覽器擋住了列印視窗'); return; }
    w.document.write(`<!doctype html><meta charset="utf-8"><title>健康處方</title><body style="font:16px/1.7 'Noto Sans TC',sans-serif;padding:32px;white-space:pre-wrap">${esc(text)}\n\n開立：${esc(ui.user)}　日期：${fmtD(nowISO())}\n彰化基督教醫院 社區智慧健康站</body>`);
    w.document.close(); w.print();
  }

  // ───────────── 品質指標 ─────────────
  function qualityView() {
    const now = new Date(), w = ui.qWindow;
    const f = (e) => inSite(IX.byPerson.get(e.personId));
    const q = E.quality(db, now, w, f);
    const defs = {
      redSameDay: ['紅層當日處理率', '分母：期間內初判為紅層的追蹤輪次；分子：偵測當日即完成「介入」者。'],
      orangeConfirm: ['橙層就醫確認率', '分母：初判橙層且 4 週期限已到或已確認者（排除死亡、遷出）；分子：期限內確認就醫者。'],
      retest: ['複測完成率', '分母：已確認、且複測日已過的輪次；分子：之後有回站量測者（含複測日前就升高而開新輪者）。'],
      improve: ['降級（改善）率', '分母：已有複測結果的輪次；分子：複測層級低於本輪者（降級須連續 2 次較低）。'],
    };
    const sites = [...new Set(persons().map((p) => p.site))].sort();
    const bySite = sites.map((s) => ({ s, q: E.quality(db, now, w, (e) => { const p = IX.byPerson.get(e.personId); return p && p.site === s; }) }));
    const reasons = Object.entries(q.unclosedReasons).sort((a, b) => b[1] - a[1]).map(([k, v]) => ({ name: k, v, cls: 'red' }));
    const close = Object.entries(q.closeReasons).sort((a, b) => b[1] - a[1]).map(([k, v]) => ({ name: k, v }));
    return `<div class="row spread"><h1>品質指標</h1>
      <div class="row"><label class="small muted" for="q-win">期間</label><select id="q-win">${[[30, '近 30 天'], [90, '近 90 天'], [180, '近 180 天'], [365, '近 1 年'], [0, '全部']].map(([v, t]) => `<option value="${v}" ${w === v ? 'selected' : ''}>${t}</option>`).join('')}</select><button class="btn sm" id="q-export" type="button">匯出 CSV</button></div></div>
    <div class="grid g4">${Object.entries(defs).map(([k, [t, d]]) => `<div class="card"><div class="muted small">${t}</div><div class="tnum" style="font-size:28px;font-weight:700">${pct(q[k])}</div><div class="small tnum">${q[k].k} / ${q[k].n}</div><div class="small muted tnum">${ci(q[k])}</div><details class="small" style="margin-top:6px"><summary>定義</summary>${d}</details></div>`).join('')}</div>
    <div class="grid g2" style="margin-top:12px">
      <div class="card"><h2>未閉環個案：${q.unclosed} 案逾期（開放中共 ${q.openCount} 案）</h2>${reasons.length ? simpleBars(reasons, ' 案') : '<div class="empty">沒有逾期未閉環個案</div>'}<p class="small muted">依目前停留階段與逾期節點分類。</p></div>
      <div class="card"><h2>結案原因</h2>${close.length ? simpleBars(close, ' 案') : '<div class="empty">期間內無結案</div>'}<p class="small muted">結案原因限：${E.CLOSE_REASONS.join('、')}。</p></div>
    </div>
    <div class="card" style="margin-top:12px"><h2>各據點</h2><div class="tbl-wrap"><table><thead><tr><th>據點</th><th class="num">追蹤輪次</th>${Object.values(defs).map(([t]) => `<th class="num">${t}</th>`).join('')}<th class="num">未閉環逾期</th></tr></thead><tbody>
      ${bySite.map(({ s, q }) => `<tr><td>${esc(s)}</td><td class="num">${q.episodes}</td>${Object.keys(defs).map((k) => `<td class="num" data-tip="${esc(ci(q[k]) || '分母為 0')}">${pct(q[k])}<span class="muted small"> ${q[k].k}/${q[k].n}</span></td>`).join('')}<td class="num ${q.unclosed ? 'overdue' : ''}">${q.unclosed}</td></tr>`).join('')}
    </tbody></table></div>
    <p class="small muted">95% 信賴區間採 Wilson score 法。各據點分母多半很小（常 &lt;30），區間很寬，跨據點排名請看區間是否重疊，不要只比點估計。</p></div>`;
  }

  // ───────────── 健康 888 ─────────────
  const GAPS = {
    unscreened: ['找得出：已建檔、未曾量測三高', '邀請到健康站量測血壓、血糖、血脂（可依據點分派志工電話邀約）'],
    yellowUnmanaged: ['要介入：三高黃層以上、未進入管理流程', '派案並通知民眾，完成健康處方'],
    orangeNotImproved: ['有改善：三高橙層以上、未曾降級', '確認已就醫與用藥、強化健康處方，邀請回站複測'],
  };

  function view888() {
    const now = new Date(), o = t888();
    const c = E.cascade888(db, now, o, inSite);
    const g = GAPS[ui.gap888] ? ui.gap888 : 'unscreened';
    const entry = E.ENTRY_888[o.entry];
    const stages = [
      ['找得出', c.find, '健康站已建立個資的民眾', '健康站量測三高至少 1 次', 'unscreened'],
      ['要介入', c.intervene, '三高至少一次進入黃層以上的民眾', `進入管理流程（${entry}）`, 'yellowUnmanaged'],
      ['有改善', c.improve, '三高至少一次進入橙層以上的民眾', `曾經降級過（${E.DOWNGRADE_888[o.downgrade] || E.DOWNGRADE_888[2]}）`, 'orangeNotImproved'],
    ];
    const rows = c.ids[g].map((id) => IX.byPerson.get(id)).filter(Boolean);
    return `<div class="row spread"><h1>健康888（三高：血壓、血糖、血脂）</h1><span class="small muted">${o.lookbackDays ? `近 ${o.lookbackDays} 天` : '全部期間'}・${ui.site === 'all' ? '全部據點' : esc(ui.site)}・<a href="#/rules">調整定義</a></span></div>
    <div class="grid g3">${stages.map(([t, w, den, numr, gap]) => `<div class="card kpi" style="--c:${w.p !== null && w.p >= o.target ? 'var(--lv-green)' : 'var(--lv-orange)'}">
      <div class="k-label"><strong>${t}</strong>　目標 ${Math.round(o.target * 100)}%</div>
      <div class="k-val tnum">${pct(w)}</div>
      <div class="small tnum">${w.k} / ${w.n} 人　<span class="muted">${ci(w)}</span></div>
      <div class="small" style="margin-top:4px">${w.n ? (w.need ? `<a href="#/888" data-gap="${gap}" class="overdue">差 ${w.need} 人達 ${Math.round(o.target * 100)}% →</a>` : '✓ 已達標') : '<span class="muted">分母為 0</span>'}</div>
      <div class="small muted" style="margin-top:8px;border-top:1px solid var(--line);padding-top:6px">分母：${den}<br>分子：${numr}</div></div>`).join('')}</div>
    <div class="card" style="margin-top:12px"><div class="row spread"><h2 style="margin:0">缺口名單</h2>
      <div class="row"><select id="g-gap">${Object.entries(GAPS).map(([k, [t]]) => `<option value="${k}" ${g === k ? 'selected' : ''}>${t}（${c.ids[k].length}）</option>`).join('')}</select>
      <button class="btn sm" id="g-export" type="button">匯出 CSV</button></div></div>
      <p class="small">建議動作：${GAPS[g][1]}</p>
      ${rows.length ? `<div class="tbl-wrap"><table><thead><tr><th>民眾</th><th>據點</th><th>管理層級</th><th>最近量測</th><th>追蹤階段</th></tr></thead><tbody>${rows.slice(0, 300).map((p) => { const l = IX.latest(p.id), e = IX.open.get(p.id), m = IX.mgmt(p.id); return `<tr class="click" data-href="#/p/${p.id}"><td><strong>${esc(pname(p))}</strong><div class="small muted">${esc(pid2(p))}</div></td><td class="small">${esc(p.site)}</td><td>${m === 'none' ? '<span class="lv na">未量測</span>' : lv(m)}</td><td class="small tnum">${l ? fmtD(l.session.at) : '—'}</td><td class="small">${e ? E.STATE_LABEL[e.state] : '—'}</td></tr>`; }).join('')}</tbody></table></div>${rows.length > 300 ? '<p class="small muted">僅顯示前 300 人，完整名單請匯出 CSV。</p>' : ''}` : '<div class="empty">此缺口目前沒有個案</div>'}
    </div>
    <details class="card" style="margin-top:12px"><summary><strong>計算說明</strong></summary><ul class="small">
      <li>只看三高項目：每個量測場次的「三高層級」取血壓、血糖、血脂三項中最高者；脈搏、血氧、體溫、體位與代謝症候群不納入。</li>
      <li>「至少一次進入黃層／橙層以上」：觀察期內任一場次的三高層級達到該層以上；同一場次 60 分鐘內重測回到綠層者不計。</li>
      <li>「進入管理流程」（要介入的分子）：該民眾有含三高異常項目的追蹤案，在觀察期內到達「${entry}」。可在設定頁改為已通知／已介入／已確認。</li>
      <li>「曾經降級過」（有改善的分子）：首次達橙層以上之後，三高層級${o.downgrade == 1 ? '有任 1 個場次' : '連續 2 個場次'}低於先前最高層級（例如紅→橙、橙→黃或綠）。之後若再升高，最高層級隨之提高，需再次降級才算。</li>
      <li>單次量測受測量誤差與「趨中迴歸」影響：因為數值高而被選入的人，下一次量測平均就會比較低，即使沒有任何介入。預設要求連續 2 次，就是為了減少這種假性改善。</li>
      <li>三個指標的分母是不同母群，不是前一段的分子，不能相乘。</li>
      <li>信賴區間採 Wilson score 法；據點人數少時區間很寬。</li></ul></details>`;
  }

  // ───────────── 資料匯入 ─────────────
  const M_COLS = [['識別值', 'id'], ['量測時間', 'at'], ['收縮壓', 'sbp'], ['舒張壓', 'dbp'], ['脈搏', 'pulse'], ['心律旗標', 'arr'], ['血氧', 'spo2'], ['體溫', 'temp'], ['血糖', 'glucose'], ['血糖類型', 'glucoseType'], ['LDL', 'ldl'], ['三酸甘油脂', 'tg'], ['HDL', 'hdl'], ['總膽固醇', 'tc'], ['尿酸', 'ua'], ['體重', 'weight'], ['腰圍', 'waist'], ['體脂率', 'bodyFat'], ['症狀', 'symptoms']];
  let pendingRoster = null;

  function importView() {
    return `<h1>資料匯入</h1>
    <div class="grid g2">
      <div class="card"><h2>1. 民眾名冊（優活雲批次建立個案名單）</h2>
        <p class="small">支援目前各據點填寫的 Excel 格式（每個工作表一個據點）。系統會自動校正：民國年、年份重複加 1911、身高以公尺填寫、身分證號填錯欄位，並以身分證號去重。</p>
        <input type="file" id="roster-file" accept=".xlsx">
        <div id="roster-preview"></div>
      </div>
      <div class="card"><h2>2. 量測資料（九合一設備／App 匯出）</h2>
        <p class="small">CSV 或 Excel，每列一次量測，以「識別值」（身分證號或示範編號）對應民眾。同一人 60 分鐘內的多筆視為同一場次重測。匯入後依時間順序逐筆判定並開案。</p>
        <div class="row"><input type="file" id="meas-file" accept=".csv,.xlsx"><button class="btn sm" id="tpl" type="button">下載欄位範本</button></div>
        <p class="small muted">可直接匯入九合一設備匯出的「量測資料」報表（標題列不在第一列也可以）。</p>
        ${!SERVER || SERVER.user.role === 'admin' ? `<label class="row small" style="margin-top:4px"><input type="checkbox" id="meas-create">名冊中沒有的民眾，依量測檔的姓名、性別、生日自動建檔（據點先列「未分據點」，之後可補名冊更新）</label>` : ''}
        <div id="meas-preview"></div>
        <details class="small" style="margin-top:8px"><summary>欄位說明</summary><p>${M_COLS.map(([c]) => c).join('、')}。<br>血糖類型填「空腹／飯後／隨機」；心律旗標填 Y；症狀以「、」分隔，可用：${Object.values(E.SYMPTOMS).map((s) => s.replace(/（.*）/, '')).join('、')}。<br>正式串接時建議由 App 後端以 API 即時推送同樣欄位，而非人工匯檔。</p></details>
      </div>
    </div>
    ${SERVER ? `<div class="card" style="margin-top:12px"><h2>資料存放</h2><p class="small">資料集中存放在院內主機（加密），由伺服器每日自動備份；匯入、操作都會記錄在伺服器端稽核紀錄。</p></div>` : `<div class="card" style="margin-top:12px"><h2>備份與重設</h2>
      <p class="small">資料目前只存在<strong>這台電腦的這個瀏覽器</strong>。請定期匯出備份；正式上線需改接院內資料庫（見說明文件）。</p>
      <div class="row"><button class="btn" id="bk-exp" type="button">匯出備份（JSON）</button><label class="btn">匯入備份<input type="file" id="bk-imp" accept=".json" hidden></label>
      <button class="btn" id="demo-load" type="button">重新載入示範資料</button><button class="btn danger" id="wipe" type="button">清除全部資料</button></div>
    </div>`}`;
  }

  // 不依賴第三方程式庫的 xlsx／csv 讀取器（xlsx-reader.js），離線可用
  function readWorkbook(file) { return window.XlsxReader.readFile(file); }

  function previewRoster(wb) {
    const sheets = wb.SheetNames.map((n) => ({ name: n, ...E.parseRoster(wb.rows.get(n), n) }));
    const all = sheets.flatMap((s) => s.persons);
    const seen = new Map(), dups = [];
    for (const p of all) { if (!p.nationalId) continue; if (seen.has(p.nationalId)) dups.push(p); else seen.set(p.nationalId, p); }
    const issues = sheets.flatMap((s) => s.issues);
    const serious = issues.filter((i) => i.issues.some((x) => /找不到|檢查碼|無法解析|可疑|不一致|空白|請確認|不存在/.test(x)));
    const existing = new Set(db.persons.map((p) => p.nationalId).filter(Boolean));
    const willAdd = [...seen.values()].filter((p) => !existing.has(p.nationalId)).length + all.filter((p) => !p.nationalId).length;
    pendingRoster = { all, dups, issues };
    $('#roster-preview').innerHTML = `
      <div class="tbl-wrap" style="margin-top:10px"><table class="small"><thead><tr><th>工作表</th><th class="num">人數</th><th class="num">需確認</th></tr></thead><tbody>${sheets.map((s) => `<tr><td>${esc(s.name)}</td><td class="num">${s.persons.length}</td><td class="num">${s.issues.filter((i) => serious.includes(i)).length}</td></tr>`).join('')}</tbody></table></div>
      <p class="small">共 <strong>${all.length}</strong> 位；身分證號重複 <strong>${dups.length}</strong> 位（保留第一筆）；需人工確認 <strong>${serious.length}</strong> 列；將新增 <strong>${willAdd}</strong> 位，已存在者更新基本資料。</p>
      ${serious.length ? `<details><summary class="small">需確認清單（前 50 列）</summary><div class="tbl-wrap"><table class="small"><thead><tr><th>工作表</th><th>列</th><th>姓名</th><th>問題</th></tr></thead><tbody>${serious.slice(0, 50).map((i) => `<tr><td>${esc(i.sheet)}</td><td class="num">${i.row}</td><td>${esc(pname(i))}</td><td>${esc(i.issues.join('；'))}</td></tr>`).join('')}</tbody></table></div></details>` : ''}
      <div class="row" style="margin-top:8px"><button class="btn primary" id="roster-go" type="button">確認匯入</button><button class="btn sm" id="roster-issues" type="button">下載問題清單 CSV（交據點修正）</button></div>
      <p class="small muted">缺身分證號者仍會建檔，但無法自動對應設備資料。</p>`;
  }

  function commitRoster(newKey) {
    if (!pendingRoster) return;
    if (db.demo) { db = { persons: [], measurements: [], episodes: [], settings: db.settings, rulesVersion: E.RULES_VERSION, schema: E.SCHEMA }; }
    const { add, upd } = E.mergeRoster(db, pendingRoster.all);
    if (newKey) audit('設定通行密語', '匯入名冊前設定，資料開始加密');
    audit('匯入名冊', `新增 ${add} 位、更新 ${upd} 位`);
    pendingRoster = null; save(); render(); toast(`已新增 ${add} 位、更新 ${upd} 位`);
  }

  function showImportResult(r) {
    $('#meas-preview').innerHTML = `<p class="small">已匯入 <strong>${r.added}</strong> 筆${r.created ? `，新建檔 <strong>${r.created}</strong> 位民眾` : ''}（標題在第 ${r.headerRow} 列；重複略過 ${r.dup}、時間無法解析 ${r.bad}、數值超出合理範圍 ${r.invalid}${r.denied ? `、無權限 ${r.denied}` : ''}、找不到民眾 ${r.unmatched.length} 人）。本次最新判定異常：紅 ${r.levels.red}、橙 ${r.levels.orange}、黃 ${r.levels.yellow} 人。</p>${r.unmatched.length ? `<p class="small muted">找不到的識別值：${r.unmatched.slice(0, 20).map(esc).join('、')}${r.unmatched.length > 20 ? '…' : ''}</p>` : ''}`;
  }
  // 量測檔：選檔後先預覽（不寫入），按「確認匯入」才匯入
  let pendingMeas = null;
  const pad2 = (n) => String(n).padStart(2, '0');
  // 送到伺服器前把日期轉成「本地時間＋時區」，避免生日等日期因時區差一天
  const localIso = (d) => { const o = -d.getTimezoneOffset(); return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}${o >= 0 ? '+' : '-'}${pad2(Math.floor(Math.abs(o) / 60))}:${pad2(Math.abs(o) % 60)}`; };
  const wireRows = (rows) => rows.map((r) => (Array.isArray(r) ? r.map((c) => (c instanceof Date ? localIso(c) : c)) : r));
  async function previewMeasurements() {
    const createMissing = !!($('#meas-create') && $('#meas-create').checked);
    const r = SERVER
      ? (await api('measurements/import', { rows: wireRows(pendingMeas.rows), createMissing, dryRun: true })).result
      : E.importMeasurementRows(db.demo ? { persons: [], measurements: [], episodes: [] } : db, pendingMeas.rows, sla(), null, { createMissing: createMissing || db.demo, dryRun: true });
    const dt = (iso) => (iso ? fmtDT(iso) : '—');
    $('#meas-preview').innerHTML = `<div class="card" style="margin-top:10px;background:var(--surface-2)">
      <h3 style="margin:0 0 6px">匯入預覽：${esc(pendingMeas.name)}</h3>
      <div class="small" style="display:grid;grid-template-columns:auto 1fr;gap:3px 12px">
        <span class="muted">標題列</span><span>第 ${r.headerRow} 列</span>
        <span class="muted">辨識到的欄位</span><span>${esc(r.columnLabels.join('、'))}</span>
        <span class="muted">量測期間</span><span class="tnum">${dt(r.from)} ～ ${dt(r.to)}</span>
        <span class="muted">將匯入</span><span><strong>${r.added}</strong> 筆、${r.people} 位民眾${r.created ? `（其中新建檔 <strong>${r.created}</strong> 位）` : ''}</span>
        <span class="muted">略過</span><span>已匯入過 ${r.dup}、時間無法解析 ${r.bad}、數值不合理 ${r.invalid}${r.denied ? `、無權限 ${r.denied}` : ''}、找不到民眾 ${r.unmatched.length} 人</span>
      </div>
      ${!r.added && r.dup ? `<p class="small" style="margin:8px 0 0;padding:8px;border-radius:6px;background:var(--lv-green-bg);color:var(--lv-green-ink)">✓ 這份檔案的量測都已經在系統中（${r.dup} 筆，比對民眾與量測時間），<strong>不需要再匯入</strong>。重複匯入不會造成重複計算。若要匯入新資料，請從設備匯出較新的日期區間。</p>` : r.dup ? `<p class="small muted" style="margin:6px 0 0">其中 ${r.dup} 筆先前已匯入過，會自動略過，只匯入新的 ${r.added} 筆。</p>` : ''}
      ${db.demo ? '<p class="small" style="margin:8px 0 0;color:var(--warn-ink)">目前是示範資料：確認匯入時會清除示範資料，並依量測檔自動建檔，同時要求設定通行密語加密。</p>' : ''}
      ${(r.badFormat || []).length ? `<p class="small" style="margin:6px 0 0;color:var(--warn-ink)">識別值格式不符 ${r.badFormat.length} 人：${r.badFormat.slice(0, 12).map(esc).join('、')}${r.badFormat.length > 12 ? '…' : ''}。身分證號應為 10 碼（1 個英文字母＋9 個數字）；少一碼、多一碼或臨時編號都無法對應，自動建檔也不會建立。請在設備或 App 端更正個人資料後，再匯出、匯入一次（已匯入的資料會自動略過）。</p>` : ''}
      ${(r.notInRoster || []).length && !r.created ? `<p class="small muted" style="margin:6px 0 0">名冊中沒有 ${r.notInRoster.length} 人：${r.notInRoster.slice(0, 12).map(esc).join('、')}${r.notInRoster.length > 12 ? '…' : ''}${$('#meas-create') ? '。若要一併建檔，請勾選上方「自動建檔」。' : '。請先由管理者匯入名冊。'}</p>` : ''}
      <div class="row" style="margin-top:10px"><button class="btn primary" id="meas-go" type="button" ${r.added ? '' : 'disabled'}>確認匯入 ${r.added} 筆</button><button class="btn" id="meas-cancel" type="button">取消</button></div>
      <p class="small muted" style="margin:6px 0 0">預覽不會寫入任何資料。</p></div>`;
    $('#meas-cancel').onclick = () => { pendingMeas = null; $('#meas-file').value = ''; $('#meas-preview').innerHTML = ''; };
    $('#meas-go').onclick = async () => {
      const go = $('#meas-go'); go.disabled = true; go.textContent = '匯入中…';
      const rows = pendingMeas.rows;
      try {
        if (SERVER) { const j = await api('measurements/import', { rows: wireRows(rows), createMissing: !!($('#meas-create') && $('#meas-create').checked) }); pendingMeas = null; render(); showImportResult(j.result); }
        else { await importMeasurements(rows); }
      } catch (e) { toast(e.message); go.disabled = false; go.textContent = '確認匯入'; }
    };
  }

  async function importMeasurements(rows) {
    let createMissing = !!($('#meas-create') && $('#meas-create').checked);
    // 示範資料裡沒有真實民眾：清除示範資料並依量測檔自動建檔（預覽已提示）
    if (db.demo) createMissing = true;
    // 會寫入真實個資：先設定通行密語（加密）
    if (!vaultKey && (createMissing || sensitive()) && !(await passphraseDialog('設定通行密語', '量測檔含姓名與身分證號，匯入前必須設定通行密語加密。'))) return;
    const fresh = db.demo;
    if (db.demo) db = { persons: [], measurements: [], episodes: [], settings: db.settings, rulesVersion: E.RULES_VERSION, schema: E.SCHEMA };
    const r = E.importMeasurementRows(db, rows, sla(), null, { createMissing });
    if (fresh) audit('設定通行密語', '匯入量測前設定，資料開始加密');
    audit('匯入量測', `${r.added} 筆、新建檔 ${r.created}`);
    pendingMeas = null;
    save(); render(); showImportResult(r);
  }

  // ───────────── 據點與負責護理師 ─────────────
  let pendingSN = null;
  function siteNurseCard() {
    const map = (db.settings && db.settings.siteNurse) || {};
    const aliases = db.settings && db.settings.siteAliases;
    const canEdit = !SERVER || SERVER.user.role === 'admin';
    const count = (site) => db.persons.filter((p) => p.site === site).length;
    const openCnt = (site) => db.episodes.filter((e) => E.isOpen(e) && (IX.byPerson.get(e.personId) || {}).site === site).length;
    const dataSites = [...new Set(db.persons.map((p) => p.site))];
    const mism = dataSites.filter((s) => E.normalizeSite(s, aliases) !== s);
    const mismPeople = db.persons.filter((p) => mism.includes(p.site)).length;
    const show = pendingSN ? pendingSN.map : map;
    const sites = [...new Set([...Object.keys(show), ...dataSites.map((s) => E.normalizeSite(s, aliases))])].sort((a, b) => a.localeCompare(b, 'zh-Hant'));
    const load = {};
    for (const s of sites) { const n = show[s]; if (!n) continue; load[n] = load[n] || { sites: 0, people: 0, open: 0 }; load[n].sites++; load[n].people += count(s); load[n].open += openCnt(s); }
    const noOwner = sites.filter((s) => !show[s]);
    const maxPeople = Math.max(1, ...Object.values(load).map((x) => x.people));
    return `<div class="card" style="margin-top:12px"><h2>據點與負責護理師</h2>
      <p class="small">新偵測的追蹤案會自動派給該據點的負責護理師。可上傳年度名單（Excel，含「社區／據點」與「負責護理師」欄位）。</p>
      ${mism.length ? `<div class="banner" style="margin:8px 0">有 ${mismPeople} 位民眾的據點名稱與年度名單寫法不同（${esc(mism.slice(0, 6).join('、'))}${mism.length > 6 ? `…共 ${mism.length} 種` : ''}），會導致對應不到負責護理師。${canEdit ? '<button class="btn sm" type="button" id="sn-norm" style="margin-left:6px">統一名稱</button>' : ''}</div>` : ''}
      ${canEdit ? `<div class="row"><input type="file" id="sn-file" accept=".xlsx,.csv"><span class="small muted">選檔後會先預覽，不會立即套用</span></div>` : ''}
      ${pendingSN ? `<div class="card" style="margin-top:10px;background:var(--surface-2)"><h3 style="margin:0 0 6px">預覽：${esc(pendingSN.file)}（工作表「${esc(pendingSN.sheet)}」）</h3>
        <p class="small" style="margin:0">共 ${Object.keys(pendingSN.map).length} 個據點、${pendingSN.nurses.length} 位護理師：${esc(pendingSN.nurses.join('、'))}</p>
        ${pendingSN.issues.length ? `<ul class="small" style="margin:6px 0">${pendingSN.issues.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
        <label class="row small" style="margin-top:6px"><input type="checkbox" id="sn-reassign" checked>把進行中的追蹤案改派給新的負責護理師（寫入各案處理紀錄）</label>
        <div class="row" style="margin-top:8px"><button class="btn primary" type="button" id="sn-go">確認套用</button><button class="btn" type="button" id="sn-cancel">取消</button></div></div>` : ''}
      <div class="grid g2" style="margin-top:10px">
        <div><h3>${pendingSN ? '套用後' : '目前'}各據點負責人</h3><div class="tbl-wrap" style="max-height:340px;overflow:auto"><table class="small"><thead><tr><th>據點</th><th>負責護理師</th><th class="num">民眾</th><th class="num">進行中</th></tr></thead><tbody>
          ${sites.map((s) => `<tr><td>${esc(s)}</td><td>${show[s] ? esc(show[s]) + (pendingSN && map[s] !== show[s] ? ` <span class="tag warn" data-tip="原本：${esc(map[s] || '未指定')}">變更</span>` : '') : '<span class="overdue">未指定</span>'}</td><td class="num">${count(s) || '<span class="muted">0</span>'}</td><td class="num">${openCnt(s)}</td></tr>`).join('') || '<tr><td colspan="4" class="muted">尚未設定</td></tr>'}
        </tbody></table></div></div>
        <div><h3>每位護理師的負擔</h3>${Object.keys(load).length ? Object.entries(load).sort((a, b) => b[1].people - a[1].people).map(([n, x]) => `<div class="bar-row" style="grid-template-columns:72px minmax(0,1fr) 130px"><span>${esc(n)}</span><div class="track" style="width:${Math.max(1, (x.people / maxPeople) * 100)}%"><div class="seg neutral" style="flex:1" data-tip="${esc(`${n}：${x.sites} 個據點、${x.people} 位民眾、${x.open} 案進行中`)}"></div></div><span class="small tnum" style="text-align:right">${x.sites} 站・${x.people} 人・${x.open} 案</span></div>`).join('') : '<p class="small muted">尚未設定</p>'}
          ${noOwner.length ? `<p class="small overdue" style="margin-top:8px">未指定負責人：${esc(noOwner.join('、'))}。這些據點的新案會是「未指定」，請由管理者派案。</p>` : ''}
          <p class="small muted">民眾數以目前名冊計；尚未匯入名冊的據點顯示 0。</p></div>
      </div></div>`;
  }
  function bindSiteNurse() {
    const f = $('#sn-file');
    if (f) f.onchange = async () => {
      try {
        const file = f.files[0]; if (!file) return;
        const wb = await window.XlsxReader.readFile(file);
        const names = wb.SheetNames.slice().sort((a, b) => /負責|護理師/.test(b) - /負責|護理師/.test(a));
        let got = null;
        for (const n of names) { try { got = Object.assign(E.parseSiteNurseSheet(wb.rows.get(n)), { sheet: n }); break; } catch (e) { /* 試下一個工作表 */ } }
        if (!got) throw new Error('檔案中找不到含「社區／據點」與「負責護理師」欄位的工作表');
        const aliases = db.settings && db.settings.siteAliases;
        const listed = new Set(Object.keys(got.map));
        const missing = [...new Set(db.persons.map((p) => E.normalizeSite(p.site, aliases)))].filter((s) => !listed.has(s));
        for (const s of missing) got.issues.push(`「${s}」有 ${db.persons.filter((p) => E.normalizeSite(p.site, aliases) === s).length} 位民眾，但不在新名單中，套用後沒有負責人`);
        pendingSN = Object.assign(got, { file: file.name });
        render();
      } catch (e) { toast(e.message); }
    };
    const c = $('#sn-cancel'); if (c) c.onclick = () => { pendingSN = null; render(); };
    const go = $('#sn-go');
    if (go) go.onclick = () => {
      const reassign = $('#sn-reassign').checked, map = pendingSN.map, nurses = pendingSN.nurses;
      if (SERVER) { srv(api('site-nurses', { map, reassign }), (j) => { pendingSN = null; return `已套用；帳號據點更新 ${j.usersUpdated} 位、改派 ${j.moved} 案`; }); return; }
      db.settings = Object.assign({}, db.settings, { siteNurse: map, nurses });
      const moved = reassign ? E.applySiteNurses(db, nowISO(), ui.user, `依「${pendingSN.file}」`) : 0;
      audit('更新據點負責護理師', `${Object.keys(map).length} 個據點、改派 ${moved} 案`);
      pendingSN = null; save(); render(); toast(`已套用；改派 ${moved} 案`);
    };
    const nb = $('#sn-norm');
    if (nb) nb.onclick = () => {
      if (!confirm('把名冊上的據點名稱統一成年度名單的寫法？（例如「秀水頭前」→「頭前社區」、「金齡關懷協會-1～86」→「永福教會松年團契」）')) return;
      if (SERVER) { srv(api('normalize-sites', {}), (j) => `已統一 ${j.changed} 位民眾的據點名稱`); return; }
      let n = 0; const aliases = db.settings && db.settings.siteAliases;
      for (const p of db.persons) { const to = E.normalizeSite(p.site, aliases); if (to !== p.site) { p.site = to; n++; } }
      audit('統一據點名稱', `${n} 位`); save(); render(); toast(`已統一 ${n} 位民眾的據點名稱`);
    };
  }

  // ───────────── 伺服器模式：帳號與稽核 ─────────────
  let usersCache = null, auditCache = null;
  function serverSecurityCard() {
    const u = SERVER.user, admin = u.role === 'admin';
    const sites = db.sites || [];
    const userRows = (usersCache || []).map((x) => `<tr><td>${esc(x.username)}</td><td>${esc(x.name)}</td><td>${x.role === 'admin' ? '管理者' : '社區護理師'}</td><td class="small">${x.sites.includes('*') ? '全部據點' : esc(x.sites.join('、')) || '<span class="overdue">未指定</span>'}</td><td>${x.disabled ? '<span class="overdue">停用</span>' : x.mustChange ? '待改密碼' : '啟用'}</td>
      <td class="row"><button class="btn sm" type="button" data-uedit="${esc(x.username)}">編輯</button><button class="btn sm" type="button" data-ureset="${esc(x.username)}">重設密碼</button><button class="btn sm ${x.disabled ? '' : 'danger'}" type="button" data-udis="${esc(x.username)}" data-v="${x.disabled ? 0 : 1}">${x.disabled ? '啟用' : '停用'}</button></td></tr>`).join('');
    return `<div class="card" style="margin-top:12px"><h2>帳號與資訊安全</h2>
      <div class="small" style="display:grid;grid-template-columns:auto 1fr;gap:4px 12px">
        <span class="muted">登入身分</span><span>${esc(u.name)}（${esc(u.username)}）・${admin ? '管理者' : '社區護理師'}・可見據點：${u.sites.includes('*') ? '全部' : esc(u.sites.join('、'))}</span>
        <span class="muted">資料保護</span><span>資料集中於院內主機，以 AES-256-GCM 加密存放；身分證號預設遮蔽，調閱完整號碼會記錄稽核</span>
        <span class="muted">工作階段</span><span>閒置自動登出；同一帳號變更密碼時，其他裝置會被登出</span>
      </div>
      <div class="row" style="margin-top:8px"><button class="btn sm" type="button" id="my-pass">變更我的密碼</button></div>
      ${admin ? `<h3 style="margin-top:14px">帳號管理</h3>
        ${usersCache ? `<div class="tbl-wrap"><table class="small"><thead><tr><th>帳號</th><th>姓名</th><th>角色</th><th>可見據點</th><th>狀態</th><th></th></tr></thead><tbody>${userRows}</tbody></table></div>` : '<p class="small muted">載入中…</p>'}
        <div class="row" style="margin-top:8px"><button class="btn sm primary" type="button" id="u-add">新增帳號</button></div>
        <h3 style="margin-top:14px">伺服器稽核紀錄</h3>
        <div class="row"><button class="btn sm" type="button" id="audit-load">載入最近 500 筆</button>${auditCache ? `<span class="small ${auditCache.integrity.ok ? '' : 'overdue'}">${auditCache.integrity.ok ? `✓ 雜湊鏈完整（共 ${auditCache.integrity.count} 筆）` : `⚠ 第 ${auditCache.integrity.brokenAt} 筆之後遭修改或刪除`}</span><button class="btn sm" type="button" id="audit-exp2">匯出</button>` : ''}</div>
        ${auditCache ? `<div class="tbl-wrap" style="margin-top:6px;max-height:360px;overflow:auto"><table class="small"><thead><tr><th>#</th><th>時間</th><th>帳號</th><th>來源 IP</th><th>動作</th><th>對象</th><th>內容</th></tr></thead><tbody>${auditCache.entries.map((a) => `<tr><td class="tnum">${a.seq}</td><td class="tnum">${fmtDT(a.at)}</td><td>${esc(a.user)}</td><td class="tnum">${esc(a.ip)}</td><td>${esc(a.action)}</td><td>${esc(a.target)}</td><td>${esc(a.detail)}</td></tr>`).join('')}</tbody></table></div>` : ''}` : ''}
      <p class="small muted">${esc(sites.length ? '' : '')}</p></div>`;
  }
  function userDialog(x) {
    const sites = db.sites || [];
    const has = (s) => x && x.sites.includes(s);
    dialog(x ? `編輯帳號：${x.username}` : '新增帳號', `<div class="form-grid">
      <label class="f">帳號（英數字）<input type="text" name="username" value="${esc(x ? x.username : '')}" ${x ? 'readonly' : ''} autocapitalize="none" spellcheck="false"></label>
      <label class="f">姓名<input type="text" name="name" value="${esc(x ? x.name : '')}"></label>
      <label class="f">角色<select name="role"><option value="nurse" ${x && x.role === 'nurse' ? 'selected' : ''}>社區護理師</option><option value="admin" ${x && x.role === 'admin' ? 'selected' : ''}>管理者</option></select></label></div>
      <h3 style="margin-top:12px">可見據點</h3><div class="chips"><label class="chip"><input type="checkbox" name="site" value="*" ${has('*') ? 'checked' : ''} style="margin-right:4px">全部據點</label>${sites.map((s) => `<label class="chip"><input type="checkbox" name="site" value="${esc(s)}" ${has(s) ? 'checked' : ''} style="margin-right:4px">${esc(s)}</label>`).join('')}</div>
      <p class="small muted">${sites.length ? '' : '尚未匯入名冊，據點清單為空；可先勾選「全部據點」，匯入名冊後再調整。'}新增帳號會產生一組臨時密碼，只顯示一次，請當面或以院內管道交給本人；首次登入須自行變更。</p>`,
    [{ label: '取消' }, { label: '儲存', primary: true, onClick: () => {
      const fd = new FormData($('#dlg-form'));
      const body = { username: fd.get('username'), name: fd.get('name'), role: fd.get('role'), sites: fd.getAll('site') };
      api('users', body).then(showTempPassword).catch((e) => toast(e.message));
    } }]);
  }
  function showTempPassword(j) {
    usersCache = j.users; render();
    if (j.tempPassword) dialog('臨時密碼（只顯示這一次）', `<p>請交給本人，首次登入須變更：</p><p style="font-size:22px;font-weight:700;letter-spacing:.05em" class="tnum">${esc(j.tempPassword)}</p>`, [{ label: '我已記下', primary: true }]);
    else toast('已更新帳號');
  }
  function bindServerSecurity() {
    $('#my-pass').onclick = () => changePasswordScreen();
    if (SERVER.user.role !== 'admin') return;
    if (!usersCache) api('users').then((j) => { usersCache = j.users; render(); }).catch((e) => toast(e.message));
    $('#u-add').onclick = () => userDialog(null);
    $$('[data-uedit]').forEach((b) => (b.onclick = () => userDialog(usersCache.find((x) => x.username === b.dataset.uedit))));
    $$('[data-ureset]').forEach((b) => (b.onclick = () => { if (confirm(`重設 ${b.dataset.ureset} 的密碼？對方會被登出，需用臨時密碼重新登入。`)) api('users', { username: b.dataset.ureset, resetPassword: true }).then(showTempPassword).catch((e) => toast(e.message)); }));
    $$('[data-udis]').forEach((b) => (b.onclick = () => api('users', { username: b.dataset.udis, disabled: b.dataset.v === '1' }).then(showTempPassword).catch((e) => toast(e.message))));
    $('#audit-load').onclick = () => api('audit').then((j) => { auditCache = j; render(); }).catch((e) => toast(e.message));
    const ae = $('#audit-exp2'); if (ae) ae.onclick = () => exportCsv('伺服器稽核紀錄.csv', [['序號', '時間', '帳號', '來源IP', '動作', '對象', '內容', '雜湊'], ...auditCache.entries.map((a) => [a.seq, a.at, a.user, a.ip, a.action, a.target, a.detail, a.hash])], '伺服器稽核紀錄');
  }

  // ───────────── 規則與設定 ─────────────
  function rulesView() {
    const s = sla(), t8 = t888();
    const T = [
      ['血壓（mmHg，院內修訂版）', '收縮壓 <140 且舒張壓 <90', '收縮壓 140–159 或舒張壓 90–99', '收縮壓 160–179 或舒張壓 100–109', '收縮壓 ≥180 或舒張壓 ≥110（休息 5 分鐘後重測；有症狀撥 119；無症狀仍須當日就醫）'],
      ['脈搏與心律（次/分）', '60–100', '50–59（無症狀）', '<50 或 >100（休息 5–10 分鐘後重測仍異常）；設備心律旗標 ARR／疑似房顫', '<40 或 >120 持續；或合併胸痛、暈厥、呼吸困難'],
      ['血氧（%）', '95–100', '91–94', '91–94 且重測 2 次仍低；或低於慢性肺病者個人基線', '≤90（重測仍低）；或合併呼吸困難、嘴唇發紺'],
      ['體溫（℃）', '36.0–37.0', '35.0–35.9 或 37.1–37.9', '≥38 且 <39；<35（保暖 30 分鐘後重測仍 <35）', '≥39；或發燒／低體溫合併意識改變、呼吸困難、抽搐'],
      ['血糖（mg/dL）', '空腹 <100；飯後 <140', '空腹 100–125；飯後 140–199', '空腹 ≥126；飯後 ≥200', '任何 ≥300；或合併多尿、口渴、噁心嘔吐、意識改變；或用藥者 <70 並有症狀'],
      ['血脂（mg/dL）', 'LDL <130；TG <150', 'LDL 130–159；或 TG 150–199', 'LDL 160–189；或 TG 200–499', 'LDL ≥190；或 TG ≥500；或急性心血管症狀（1 週內，有症狀當日）'],
      ['代謝症候群（5 項）', '0 項', '1–2 項', '≥3 項', '（無紅層）'],
      ['BMI・腰圍・體脂【生活型態追蹤】', 'BMI 18.5–23.9；腰圍達標；體脂男 10–20%、女 20–30%', 'BMI <18.5 或 24–26.9；腰圍男 ≥90、女 ≥80；體脂男 20–25%、女 30–35%', 'BMI ≥27；體脂男 >25%、女 >35%；或男 <10%、女 <20%', '（無紅層）'],
    ];
    const num = (path, v) => `<input type="number" min="0" style="width:64px" data-sla="${path}" value="${v ?? ''}">`;
    return `<h1>分層規則與設定</h1>
    <div class="card"><h2>四層級定義</h2><div class="tbl-wrap"><table><thead><tr><th>層級</th><th>意義</th><th>處理</th><th>追蹤方式</th></tr></thead><tbody>
      <tr><td>${lv('green')}</td><td>正常或已達標</td><td>不需派案</td><td>回饋與例行量測</td></tr>
      <tr><td>${lv('yellow')}</td><td>偏高或邊緣，尚無轉介必要</td><td>健康處方</td><td>6 個月複測</td></tr>
      <tr><td>${lv('orange')}</td><td>異常，需醫師評估</td><td>4 週內轉介就醫，並確認有就醫、健康處方</td><td>3 個月複測</td></tr>
      <tr><td>${lv('red')}</td><td>可能危及安全</td><td>當日處理，24 小時內確認就醫、健康處方</td><td>就醫後 2 週電訪確認</td></tr>
    </tbody></table></div><p class="small muted">整體層級取各項目中最高者，但【生活型態追蹤】項目（BMI・腰圍・體脂）不計入整體層級、不派案、不轉介，只開健康處方。只要有異常就要完成健康處方。依據：《彰基社區智慧健康站量測異常分層管理與閉環追蹤建議 v1》。</p></div>
    <div class="card" style="margin-top:12px"><h2>各項目閾值</h2><div class="tbl-wrap"><table class="small"><thead><tr><th>項目</th><th>${lv('green')}</th><th>${lv('yellow')}</th><th>${lv('orange')}</th><th>${lv('red')}</th></tr></thead><tbody>${T.map((r) => `<tr>${r.map((c, i) => (i ? `<td>${esc(c)}</td>` : `<td><strong>${esc(c)}</strong></td>`)).join('')}</tr>`).join('')}</tbody></table></div></div>
    <div class="card" style="margin-top:12px"><h2>健康處方內容</h2><p class="small">處方內容依院內《健康處方》文件，<strong>依量測數值</strong>選擇文件中的類別（例如 LDL 160–189 為「LDL高風險」）；血壓例外，依院內修訂版分層選擇：黃、橙、紅層都用「高血壓警示」，黃層不印轉介的就醫建議，並依紅橙黃綠層級附上追蹤計畫（就醫時限、複測）與三條警語。文件未涵蓋的數值範圍，會標註「院內衛教文件未涵蓋」並改用系統暫用文字。護理師開立前都可以修改。</p></div>
    <div class="card" style="margin-top:12px"><h2>追蹤流程</h2><p><strong>偵測 → 通知 → 介入（健康處方）→ 確認（就醫或完成處方）</strong>，四步驟反覆進行。</p>
      <ul class="small"><li>每一輪都必須走到「確認」，不能停在「通知」。</li>
      <li>確認後設定複測日：黃層 6 個月、橙層 3 個月、紅層就醫後 2 週（電訪並請回站）。</li>
      <li>下一輪自動開始：量測高於本輪層級時立即開始；複測日後回站仍異常則開始，層級取最近 2 次量測的較高者（連續 2 次較低才降級）；連續 2 次綠層則回到例行量測。複測日前、未升高的量測只記錄。</li>
      <li>複測日已過未回站者，列入「待回站複測」，請通知民眾回站。</li>
      <li>結案原因限於：已轉由醫師持續管理（需登記回診日期）、死亡、遷出、失聯、拒絕。</li></ul></div>
    <div class="card" style="margin-top:12px"><h2>系統解讀（請臨床委員會確認）</h2><ol class="small">${E.ASSUMPTIONS.map((a) => `<li>${esc(a)}</li>`).join('')}</ol></div>
    ${siteNurseCard()}
    ${SERVER ? serverSecurityCard() : `<div class="card" style="margin-top:12px"><h2>資訊安全</h2>
      <div class="small" style="display:grid;grid-template-columns:auto 1fr;gap:4px 12px">
        <span class="muted">資料保護</span><span>${db.demo ? '示範資料（虛構，未加密）' : vaultKey ? `✓ 已加密：AES-256-GCM，金鑰由通行密語經 PBKDF2-SHA256 ${window.Vault.ITER.toLocaleString()} 次衍生` : '<span class="overdue">未加密</span>'}</span>
        <span class="muted">自動鎖定</span><span>閒置 ${IDLE_MIN} 分鐘；輸入錯誤 3 次後延遲重試</span>
        <span class="muted">外部連線</span><span>無：不載入任何外部程式或字型，內容安全政策（CSP）禁止對外連線</span>
        <span class="muted">稽核紀錄</span><span>${(db.audit || []).length} 筆（含解鎖、查看完整身分證號、匯出、匯入、還原、清除）</span>
      </div>
      ${vaultKey ? '<div class="row" style="margin-top:8px"><button class="btn sm" type="button" id="chg-pass">變更通行密語</button><button class="btn sm" type="button" id="audit-exp">匯出稽核紀錄</button></div>' : ''}
      ${(db.audit || []).length ? `<details style="margin-top:8px"><summary class="small">最近 100 筆稽核紀錄</summary><div class="tbl-wrap"><table class="small"><thead><tr><th>時間</th><th>操作者</th><th>動作</th><th>內容</th></tr></thead><tbody>${db.audit.slice(-100).reverse().map((a) => `<tr><td class="tnum">${fmtDT(a.at)}</td><td>${esc(a.user)}</td><td>${esc(a.action)}</td><td>${esc(a.detail)}</td></tr>`).join('')}</tbody></table></div></details>` : ''}
      <p class="small muted">「操作者」目前為自行選擇，稽核紀錄存在本機加密資料內，無法防止有密語者竄改。多人共用請改用院內主機版（見 server/DEPLOY.md）。</p></div>`}
    <div class="card" style="margin-top:12px"><h2>健康888 定義</h2>
      <div class="form-grid">
        <label class="f">觀察期（天，0 為全部）<input type="number" min="0" data-t888="lookbackDays" value="${t8.lookbackDays}"></label>
        <label class="f">「進入管理流程」的判定<select data-t888="entry">${Object.entries(E.ENTRY_888).map(([k, v]) => `<option value="${k}" ${t8.entry === k ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
        <label class="f">有改善「降級」的判定<select data-t888="downgrade">${Object.entries(E.DOWNGRADE_888).map(([k, v]) => `<option value="${k}" ${String(t8.downgrade) === k ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
        <label class="f">目標比率（%）<input type="number" min="1" max="100" data-t888="target" value="${Math.round(t8.target * 100)}"></label>
      </div></div>
    <div class="card" style="margin-top:12px"><h2>處理時限設定（天）</h2>
      <div class="tbl-wrap"><table class="small"><thead><tr><th>節點</th><th>紅</th><th>橙</th><th>黃</th></tr></thead><tbody>
        <tr><td>派案並通知</td><td>${num('notify.red', s.notify.red)}</td><td>${num('notify.orange', s.notify.orange)}</td><td>${num('notify.yellow', s.notify.yellow)}</td></tr>
        <tr><td>介入＋健康處方</td><td>${num('intervene.red', s.intervene.red)}</td><td>${num('intervene.orange', s.intervene.orange)}</td><td>${num('intervene.yellow', s.intervene.yellow)}</td></tr>
        <tr><td>確認就醫／處方</td><td>${num('confirm.red', s.confirm.red)}</td><td>${num('confirm.orange', s.confirm.orange)}</td><td>${num('confirm.yellow', s.confirm.yellow)}</td></tr>
        <tr><td>複測</td><td>就醫後 ${num('phoneAfterVisit', s.phoneAfterVisit)} 天電訪</td><td>${num('retest.orange', s.retest.orange)}</td><td>${num('retest.yellow', s.retest.yellow)}</td></tr>
      </tbody></table></div>
      <p class="small muted">0 表示當日。修改只影響之後新開或重新判定的追蹤案。</p>
      ${SERVER ? '<p class="small muted">社區護理師名單由「帳號管理」決定。' + (SERVER.user.role === 'admin' ? '' : '處理時限與健康888 定義只有管理者可以修改。') + '</p>' : `<label class="f" style="margin-top:8px">社區護理師名單（以逗號分隔）<input type="text" id="nurses" value="${esc(nurses().join('，'))}"></label>`}
      <div class="row" style="margin-top:8px"><button class="btn primary" id="save-set" type="button" ${SERVER && SERVER.user.role !== 'admin' ? 'disabled' : ''}>儲存設定</button><label class="row small"><input type="checkbox" id="mask" ${ui.mask ? 'checked' : ''}>畫面遮蔽姓名（簡報／螢幕分享用）</label></div>
    </div>`;
  }

  // ───────────── 資安：通行密語、鎖定、自動登出 ─────────────
  const LOCK_KEY = 'chc-tracking-lock';
  const IDLE_MIN = 15;
  function lockState() { try { return JSON.parse(localStorage.getItem(LOCK_KEY)) || { fails: 0, until: 0 }; } catch (e) { return { fails: 0, until: 0 }; } }
  function setLockState(x) { try { localStorage.setItem(LOCK_KEY, JSON.stringify(x)); } catch (e) { /* 忽略 */ } }

  // 設定（或變更）通行密語；回傳 true 表示完成
  function passphraseDialog(title, why) {
    return new Promise((resolve) => {
      dialog(title, `<p class="small">${esc(why || '')}</p>
        <p class="small">資料會以 AES-256-GCM 加密存在這台電腦；金鑰由通行密語衍生（PBKDF2-SHA256 ${window.Vault.ITER.toLocaleString()} 次），只存在記憶體。<strong>遺失通行密語即無法還原資料</strong>，請由單位主管另行密封保管。</p>
        <label class="f">通行密語（至少 ${window.Vault.MIN_LEN} 字，建議用一句好記的話）<input type="password" name="p1" autocomplete="new-password" required></label>
        <label class="f" style="margin-top:8px">再輸入一次<input type="password" name="p2" autocomplete="new-password" required></label>`,
      [{ label: '取消', onClick: () => { resolve(false); } }, { label: '設定並加密', primary: true, onClick: () => {
        const fd = new FormData($('#dlg-form')); const a = fd.get('p1'), b = fd.get('p2');
        window.Vault.checkPassphrase(a);
        if (a !== b) throw new Error('兩次輸入不一致');
        const btn = $('#dlg-foot .btn.primary'); btn.disabled = true; btn.textContent = '加密中…';
        window.Vault.createKey(a).then((k) => { vaultKey = k; audit('設定通行密語', '資料改以新金鑰加密'); save(); resolve(true); $('#dlg').close(); })
          .catch((e) => { toast(e.message); btn.disabled = false; btn.textContent = '設定並加密'; });
        return false; // 金鑰衍生完成後才關閉對話框
      } }]);
      $('#dlg').addEventListener('close', () => setTimeout(() => resolve(!!vaultKey), 0), { once: true });
    });
  }
  let asking = null;
  function requirePassphrase() {
    if (!asking) asking = passphraseDialog('設定通行密語', '目前資料含個人資料，必須加密後才能存在瀏覽器。').then((ok) => { asking = null; return ok; });
    return asking;
  }

  // 啟動時資料已加密：顯示鎖定畫面
  function unlockScreen(envelope) {
    return new Promise((resolve) => {
      $('#tabs').innerHTML = ''; $('.top-tools').hidden = true;
      const draw = (msg) => {
        const st = lockState(), wait = Math.max(0, Math.ceil((st.until - Date.now()) / 1000));
        $('#app').innerHTML = `<div class="card" style="max-width:440px;margin:40px auto">
          <h1>資料已加密鎖定</h1><p class="small">請輸入通行密語。閒置 ${IDLE_MIN} 分鐘會自動鎖定。</p>
          <form id="unlock-form"><label class="f">通行密語<input type="password" id="unlock-p" autocomplete="current-password" ${wait ? 'disabled' : ''} autofocus></label>
          <div class="row" style="margin-top:10px"><button class="btn primary" id="unlock-btn" ${wait ? 'disabled' : ''}>解鎖</button></div></form>
          ${msg ? `<p class="small overdue">${esc(msg)}</p>` : ''}${wait ? `<p class="small overdue">多次輸入錯誤，請 ${wait} 秒後再試。</p>` : ''}
          <details class="small" style="margin-top:16px"><summary>忘記通行密語</summary><p>無法還原（沒有後門）。只能清除這台電腦上的加密資料，再從加密備份或原始名冊重新匯入。</p><button class="btn danger sm" type="button" id="forget-btn">清除本機加密資料</button></details></div>`;
        if (wait) setTimeout(() => draw(), Math.min(wait, 5) * 1000);
        const go = async () => {
          const pw = $('#unlock-p').value; if (!pw) return;
          $('#unlock-btn').disabled = true; $('#unlock-btn').textContent = '驗證中…';
          try {
            const r = await window.Vault.open(envelope, pw);
            setLockState({ fails: 0, until: 0 });
            vaultKey = r.k; db = r.data; $('.top-tools').hidden = false;
            audit('解鎖', ''); resolve();
          } catch (e) {
            const st2 = lockState(); st2.fails = (st2.fails || 0) + 1;
            if (st2.fails >= 3) st2.until = Date.now() + Math.min(900, 15 * Math.pow(2, st2.fails - 3)) * 1000;
            setLockState(st2); draw(e.message);
          }
        };
        $('#unlock-btn').onclick = go;
        $('#forget-btn').onclick = () => { if (prompt('此動作會永久刪除本機的加密資料。請輸入「清除」確認') !== '清除') return; localStorage.removeItem(KEY); setLockState({ fails: 0, until: 0 }); location.reload(); };
        const inp = $('#unlock-p'); if (inp && !wait) inp.focus();
      };
      draw();
    });
  }

  // 鎖定：清掉記憶體中的金鑰與資料，重新載入頁面
  function lockNow(reason) {
    if (!vaultKey) return;
    audit('鎖定', reason || '手動');
    save();
    saving.then(() => { vaultKey = null; db = null; location.reload(); });
  }
  let idleTimer = null;
  function armIdle() {
    clearTimeout(idleTimer);
    if (vaultKey) idleTimer = setTimeout(() => lockNow(`閒置 ${IDLE_MIN} 分鐘自動鎖定`), IDLE_MIN * 60000);
  }
  ['mousemove', 'keydown', 'click', 'touchstart', 'scroll'].forEach((ev) => document.addEventListener(ev, () => { if (vaultKey) armIdle(); }, { passive: true, capture: true }));

  // ───────────── 伺服器模式：登入與啟動 ─────────────
  async function detectServer() {
    try {
      const r = await fetch('api/me', { credentials: 'same-origin' });
      if (r.status !== 200 && r.status !== 401) return null;
      const j = await r.json();
      return j && j.mode === 'server' ? j : null;
    } catch (e) { return null; } // 直接開檔、靜態主機、claude.ai 連結：單機模式
  }
  function bareScreen(html) { $('#tabs').innerHTML = ''; $('.top-tools').hidden = true; $('#app').innerHTML = `<div class="card" style="max-width:440px;margin:40px auto">${html}</div>`; }
  function loginScreen(msg) {
    SERVER = null; db = null; clearInterval(pollTimer);
    bareScreen(`<h1>社區健康站追蹤後台</h1><p class="small">請以院內核發的帳號登入。閒置一段時間會自動登出。</p>
      <form id="login-form"><label class="f">帳號<input type="text" id="lg-u" autocomplete="username" autocapitalize="none" spellcheck="false"></label>
      <label class="f" style="margin-top:8px">密碼<input type="password" id="lg-p" autocomplete="current-password"></label>
      <div class="row" style="margin-top:10px"><button class="btn primary" id="lg-btn">登入</button></div></form>
      ${msg ? `<p class="small overdue">${esc(msg)}</p>` : ''}`);
    $('#lg-u').focus();
    $('#lg-btn').onclick = async () => {
      const b = $('#lg-btn'); b.disabled = true; b.textContent = '登入中…';
      try {
        const r = await fetch('api/login', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: $('#lg-u').value, password: $('#lg-p').value }) });
        const j = await r.json();
        if (!r.ok) throw new Error(j.error || '登入失敗');
        SERVER = { user: j.user, csrf: j.csrf };
        if (j.user.mustChange) changePasswordScreen(); else enterServerApp();
      } catch (e) { loginScreen(e.message); }
    };
  }
  function changePasswordScreen() {
    bareScreen(`<h1>請變更密碼</h1><p class="small">首次登入或密碼已被重設，請設定新密碼（至少 12 個字元，建議用一句好記的話）。</p>
      <form><label class="f">目前密碼<input type="password" id="cp-0" autocomplete="current-password"></label>
      <label class="f" style="margin-top:8px">新密碼<input type="password" id="cp-1" autocomplete="new-password"></label>
      <label class="f" style="margin-top:8px">再輸入一次<input type="password" id="cp-2" autocomplete="new-password"></label>
      <div class="row" style="margin-top:10px"><button class="btn primary" id="cp-btn">變更密碼</button></div></form><p class="small overdue" id="cp-msg"></p>`);
    $('#cp-btn').onclick = async () => {
      try {
        if ($('#cp-1').value !== $('#cp-2').value) throw new Error('兩次輸入不一致');
        const j = await api('password', { current: $('#cp-0').value, next: $('#cp-1').value });
        SERVER.user = j.user; enterServerApp();
      } catch (e) { $('#cp-msg').textContent = e.message; }
    };
  }
  let pollTimer = null;
  async function enterServerApp() {
    await api('data');
    $('.top-tools').hidden = false;
    ui.site = 'all';
    render();
    // 每分鐘更新一次，讓多位護理師看到彼此的處理進度；正在輸入或開著對話框時不打斷
    clearInterval(pollTimer);
    pollTimer = setInterval(() => {
      const busy = $('#dlg').open || (document.activeElement && /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName));
      if (!busy) api('data', undefined, { poll: true }).then(() => render()).catch(() => {});
    }, 60000);
  }

  async function boot() {
    const me = await detectServer();
    if (me) {
      if (!me.user) return loginScreen();
      SERVER = { user: me.user, csrf: me.csrf };
      return me.user.mustChange ? changePasswordScreen() : enterServerApp();
    }
    const raw = load();
    if (raw && window.Vault.isEnvelope(raw)) await unlockScreen(raw);
    else db = raw;
  // 示範資料是以舊規則產生的：直接依新規則重新產生（保留設定）
  if (db && db.demo && (db.rulesVersion !== E.RULES_VERSION || db.schema !== E.SCHEMA)) { const keep = db.settings; db = window.Demo.generate(new Date()); if (keep) db.settings = Object.assign(db.settings, keep); save(); setTimeout(() => toast('分層規則已更新，示範資料已依新規則重新產生'), 300); }
  if (!db) { db = window.Demo.generate(new Date()); save(); }
  // 正式資料：舊版七步驟流程轉成四步驟（每案寫入處理紀錄）
  if (!db.demo && db.schema !== E.SCHEMA) { const n = E.migrateWorkflow(db); save(); if (n) setTimeout(() => toast(`流程已改為四步驟，${n} 筆追蹤案已轉換`), 300); }
  db.settings = db.settings || {};
  // 舊版預設的「個管師」名單換成 8 名社區護理師；使用者自訂的名單不動
  if (!db.settings.nurses || !db.settings.nurses.length || db.settings.nurses.every((n) => /^個管師/.test(n))) db.settings.nurses = DEFAULT_NURSES.slice();
    // 舊版留下的明文正式資料：要求立即設定通行密語加密
    if (sensitive() && !vaultKey) {
      render();
      while (!(await requirePassphrase())) { /* 必須設定才可繼續使用 */ }
    }
    render();
    armIdle();
  }

  // ───────────── 事件 ─────────────
  const bind = {
    dashboard() {
      $$('[data-lv]').forEach((a) => a.addEventListener('click', () => { ui.wl.levels = a.dataset.lv === 'green' ? [] : [a.dataset.lv]; }));
      $('#site-tbl-btn').onclick = () => { const t = $('#site-tbl'), c = $('#site-chart'); t.hidden = !t.hidden; c.hidden = !t.hidden; $('#site-tbl-btn').textContent = t.hidden ? '表格檢視' : '圖表檢視'; };
    },
    worklist() {
      $$('[data-lvf]').forEach((b) => (b.onclick = () => { const l = b.dataset.lvf, a = ui.wl.levels; ui.wl.levels = a.includes(l) ? a.filter((x) => x !== l) : [...a, l]; render(); }));
      $('#wl-state').onchange = (e) => { ui.wl.state = e.target.value; render(); };
      $('#wl-od').onchange = (e) => { ui.wl.overdue = e.target.checked; render(); };
      $('#wl-mine').onchange = (e) => { ui.wl.mine = e.target.checked; render(); };
      liveSearch('#wl-q', (v) => (ui.wl.q = v));
      $('#wl-export').onclick = () => {
        const now = new Date();
        exportCsv(`追蹤工作清單_${fmtD(nowISO()).replace(/\//g, '')}.csv`, ([['層級', '姓名', '識別', '據點', '異常項目', '階段', '下一步', '期限', '逾期', '負責'], ...worklistRows().map(({ e, p, s }) => [E.LEVEL_LABEL[e.level], pname(p), pid2(p), p.site, e.items.map((i) => `${E.ITEM_LABEL[i.key]}(${E.LEVEL_LABEL[i.level]})`).join(' '), E.STATE_LABEL[e.state], s.label, s.due ? fmtD(s.due) : '', s.overdue ? '是' : '', e.assignee || ''])]), '追蹤工作清單');
        void now;
      };
    },
    residents() {
      $$('[data-rsf]').forEach((b) => (b.onclick = () => { const l = b.dataset.rsf, a = ui.rs.levels; ui.rs.levels = a.includes(l) ? a.filter((x) => x !== l) : [...a, l]; render(); }));
      liveSearch('#rs-q', (v) => (ui.rs.q = v));
      const more = $('#rs-more'); if (more) more.onclick = () => { ui.rsLimit = (ui.rsLimit || 200) + 200; render(); };
    },
    p(id) {
      const p = IX.byPerson.get(id); if (!p) return;
      const ep = IX.open.get(id);
      $('#add-m').onclick = () => measurementDialog(p);
      const a2 = $('#add-m2'); if (a2) a2.onclick = () => measurementDialog(p);
      const sn = $('#show-nid'); if (sn) sn.onclick = () => { if (SERVER) { api(`persons/${p.id}/reveal`, {}).then((j) => { $('#nid').textContent = j.nationalId; sn.remove(); }).catch((e) => toast(e.message)); return; } $('#nid').textContent = p.nationalId; sn.remove(); audit('查看完整身分證號', `${p.name}（${p.id}）`); save(); };
      $$('[data-flag]').forEach((c) => (c.onchange = () => { if (SERVER) { srv(api(`persons/${p.id}/flags`, { patch: { [c.dataset.flag]: c.checked } }), '已更新風險註記；下次量測起依新註記判定'); return; } p[c.dataset.flag] = c.checked; save(); render(); toast('已更新風險註記；下次量測起依新註記判定'); }));
      const lr = $('#life-rx'); if (lr) lr.onclick = () => { const l = IX.latest(p.id); printRx(p, null, E.lifestylePrescription(p, l.ev)); };
      const sb = $('#spo2-base'); if (sb) sb.onchange = () => { if (SERVER) { srv(api(`persons/${p.id}/flags`, { patch: { spo2Baseline: sb.value === '' ? null : +sb.value } })); return; } p.spo2Baseline = sb.value === '' ? null : +sb.value; save(); };
      $$('[data-print-rx]').forEach((b) => (b.onclick = (e) => { e.preventDefault(); const ta = $('#ep-form textarea[name=rx]'); printRx(p, ta ? Object.assign({}, ep, { rx: { text: ta.value } }) : ep); }));
      if (!ep) return;
      $$('[data-act]').forEach((b) => (b.onclick = () => {
        const fd = new FormData($('#ep-form')); const payload = Object.fromEntries(fd.entries());
        if (SERVER) { srv(api(`episodes/${ep.id}/act`, { action: b.dataset.act, payload }), () => `已記錄：${E.STATE_LABEL[(db.episodes.find((x) => x.id === ep.id) || {}).state] || '完成'}`); return; }
        try {
          E.act(db, ep.id, b.dataset.act, payload, nowISO(), ui.user, sla());
          save(); render(); toast(`已記錄：${E.STATE_LABEL[db.episodes.find((x) => x.id === ep.id).state]}`);
        } catch (err) { toast(err.message); }
      }));
      $('#close-btn').onclick = () => {
        const reason = $('#close-reason').value;
        if (!confirm(`確定以「${reason}」結案？`)) return;
        if (SERVER) { srv(api(`episodes/${ep.id}/act`, { action: 'close', payload: { reason, note: $('#close-note').value, followupDate: $('#close-followup').value } }), '已結案'); return; }
        try { E.act(db, ep.id, 'close', { reason, note: $('#close-note').value, followupDate: $('#close-followup').value }, nowISO(), ui.user, sla()); audit('結案', `${p.name}：${reason}`); save(); render(); toast('已結案'); } catch (err) { toast(err.message); }
      };
    },
    quality() {
      $('#q-win').onchange = (e) => { ui.qWindow = +e.target.value; render(); };
      $('#q-export').onclick = () => {
        const now = new Date(), w = ui.qWindow;
        const sites = ['全部', ...new Set(persons().map((p) => p.site))];
        const rows = [['據點', '期間(天)', '指標', '分子', '分母', '比率', 'CI下限', 'CI上限']];
        for (const s of sites) {
          const q = E.quality(db, now, w, (e) => { const p = IX.byPerson.get(e.personId); return p && inSite(p) && (s === '全部' || p.site === s); });
          for (const [k, t] of [['redSameDay', '紅層當日處理率'], ['orangeConfirm', '橙層就醫確認率'], ['retest', '複測完成率'], ['improve', '降級(改善)率']]) rows.push([s, w || '全部', t, q[k].k, q[k].n, q[k].p === null ? '' : q[k].p.toFixed(4), q[k].lo === null ? '' : q[k].lo.toFixed(4), q[k].hi === null ? '' : q[k].hi.toFixed(4)]);
          rows.push([s, w || '全部', '未閉環逾期案數', q.unclosed, q.openCount, '', '', '']);
        }
        exportCsv('品質指標.csv', rows, '品質指標');
      };
    },
    import() {
      $('#roster-file').onchange = (e) => { const f = e.target.files[0]; if (f) readWorkbook(f).then(previewRoster).then(() => {
        $('#roster-go').onclick = async () => {
          if (SERVER) { srv(api('roster', { persons: pendingRoster.all }), (j) => { pendingRoster = null; return `已新增 ${j.result.add} 位、更新 ${j.result.upd} 位${j.result.denied ? `；${j.result.denied} 位不在你負責的據點，未匯入` : ''}`; }); return; }
          if (db.demo && !confirm('匯入正式名冊會清除示範資料，確定？')) return;
          const fresh = !vaultKey;
          if (fresh && !(await passphraseDialog('設定通行密語', '名冊含姓名、身分證號與電話，匯入前必須設定通行密語加密。'))) return;
          commitRoster(fresh);
        };
        $('#roster-issues').onclick = () => exportCsv('名冊問題清單.csv', [['工作表', '列', '姓名', '問題'], ...pendingRoster.issues.map((i) => [i.sheet, i.row, i.name, i.issues.join('；')])], '名冊問題清單');
      }).catch((err) => toast(err.message)); };
      $('#meas-file').onchange = (e) => {
        const f = e.target.files[0]; if (!f) return;
        $('#meas-preview').innerHTML = '<p class="small muted">讀取中…</p>';
        readWorkbook(f).then((wb) => { pendingMeas = { name: f.name, rows: wb.rows.get(wb.SheetNames[0]) }; return previewMeasurements(); }).catch((err) => { pendingMeas = null; $('#meas-preview').innerHTML = `<p class="small overdue">${esc(err.message)}</p>`; });
      };
      const mc = $('#meas-create'); if (mc) mc.onchange = () => { if (pendingMeas) previewMeasurements().catch((err) => toast(err.message)); };
      $('#tpl').onclick = () => download('量測匯入範本.csv', csv([M_COLS.map((c) => c[0]), [db.persons[0] ? (db.persons[0].demoId || '請填身分證號') : 'A123456789', '2026-10-30 09:15', 138, 86, 78, '', 96, 36.5, 112, '空腹', 135, 160, 48, '', '', 62.5, 86, 31.2, '']]), 'text/csv');
      if (SERVER) return;
      // 備份：正式資料一律加密匯出（用目前的通行密語）；示範資料為明文
      $('#bk-exp').onclick = async () => {
        const name = `健康站追蹤備份_${fmtD(nowISO()).replace(/\//g, '')}${sensitive() ? '_加密' : ''}.json`;
        if (sensitive()) {
          if (!vaultKey) { toast('請先設定通行密語'); return; }
          audit('匯出加密備份', name); save();
          download(name, JSON.stringify(await window.Vault.seal(vaultKey, db, 'chc-backup')), 'application/json');
        } else download(name, JSON.stringify(db), 'application/json');
      };
      $('#bk-imp').onchange = (e) => {
        const f = e.target.files[0]; if (!f) return;
        if (f.size > 50 * 1024 * 1024) { toast('備份檔過大'); return; }
        f.text().then(async (t) => {
          let d = JSON.parse(t), k = null;
          if (window.Vault.isEnvelope(d)) {
            const pw = prompt('這是加密備份，請輸入當時的通行密語'); if (!pw) return;
            const r = await window.Vault.open(d, pw, 'chc-backup'); d = r.data; k = r.k;
          }
          E.validateBackup(d);
          if (!confirm(`以備份覆蓋目前資料？（${d.persons.length} 位民眾、${d.episodes.length} 個追蹤輪次）`)) return;
          db = d;
          if (!db.demo && !vaultKey) vaultKey = k;
          if (sensitive() && !vaultKey && !(await passphraseDialog('設定通行密語', '還原的資料含個人資料，必須加密儲存。'))) { location.reload(); return; }
          if (!db.demo && db.schema !== E.SCHEMA) E.migrateWorkflow(db);
          audit('還原備份', f.name); save(); render(); toast('已還原備份');
        }).catch((err) => toast(err.message));
      };
      $('#demo-load').onclick = () => { if (!confirm('以示範資料覆蓋目前所有資料？（加密的正式資料會被刪除，請先匯出加密備份）')) return; db = window.Demo.generate(new Date()); vaultKey = null; save(); render(); };
      $('#wipe').onclick = () => { if (!confirm('清除全部資料（無法復原）？建議先匯出備份。')) return; audit('清除全部資料', ''); db = { persons: [], measurements: [], episodes: [], audit: db.audit, settings: db.settings, rulesVersion: E.RULES_VERSION, schema: E.SCHEMA }; save(); render(); };
    },
    888() {
      $$('[data-gap]').forEach((a) => (a.onclick = (e) => { e.preventDefault(); ui.gap888 = a.dataset.gap; render(); }));
      $('#g-gap').onchange = (e) => { ui.gap888 = e.target.value; render(); };
      $('#g-export').onclick = () => {
        const c = E.cascade888(db, new Date(), t888(), inSite);
        const rows = [['缺口', '姓名', '識別', '據點', '管理層級', '建議動作']];
        for (const [k, [t, a]] of Object.entries(GAPS)) for (const id of c.ids[k]) { const p = IX.byPerson.get(id); rows.push([t, pname(p), pid2(p), p.site, E.LEVEL_LABEL[IX.mgmt(id)] || '未量測', a]); }
        exportCsv('健康888缺口名單.csv', rows, '健康888缺口名單');
      };
    },
    rules() {
      $('#save-set').onclick = () => {
        const s = JSON.parse(JSON.stringify(sla()));
        $$('[data-sla]').forEach((i) => { const [a, b] = i.dataset.sla.split('.'); const v = i.value === '' ? null : Math.max(0, +i.value); if (b) s[a][b] = v; else s[a] = v; });
        const t8 = t888();
        $$('[data-t888]').forEach((i) => { const k = i.dataset.t888; if (i.value === '') return; t8[k] = k === 'entry' ? i.value : k === 'downgrade' ? +i.value : k === 'target' ? Math.min(100, Math.max(1, +i.value)) / 100 : Math.max(0, +i.value); });
        if (SERVER) { srv(api('settings', { sla: s, t888: t8 }), '設定已儲存'); return; }
        db.settings = Object.assign({}, db.settings, { t888: t8, sla: s, nurses: $('#nurses').value.split(/[,，、]/).map((x) => x.trim()).filter(Boolean) });
        save(); render(); toast('設定已儲存');
      };
      $('#mask').onchange = (e) => { ui.mask = e.target.checked; render(); };
      bindSiteNurse();
      if (SERVER) { bindServerSecurity(); return; }
      const cp = $('#chg-pass'); if (cp) cp.onclick = async () => { if (await passphraseDialog('變更通行密語', '設定新密語後，資料會立即以新金鑰重新加密；舊的加密備份仍需用舊密語開啟。')) { audit('變更通行密語', ''); save(); render(); toast('已變更通行密語'); } };
      const ae = $('#audit-exp'); if (ae) ae.onclick = () => exportCsv('稽核紀錄.csv', [['時間', '操作者', '動作', '內容'], ...(db.audit || []).map((a) => [a.at, a.user, a.action, a.detail])], '稽核紀錄');
    },
  };

  function liveSearch(sel, set) {
    const el = $(sel);
    el.oninput = () => { set(el.value); clearTimeout(liveSearch.h); liveSearch.h = setTimeout(() => { const pos = el.selectionStart; render(); const n = $(sel); n.focus(); n.setSelectionRange(pos, pos); }, 250); };
  }

  // 表單一律不送出（CSP 禁止內嵌 onsubmit）。按 Enter 時瀏覽器會先觸發預設按鈕的 click，這裡只需擋下送出；對話框表單保留原生關閉行為
  document.addEventListener('submit', (e) => { if (e.target.id !== 'dlg-form') e.preventDefault(); });
  document.addEventListener('click', (e) => {
    const tr = e.target.closest('tr[data-href]');
    if (tr && !e.target.closest('a,button,input,select')) location.hash = tr.dataset.href;
  });
  $('#site-filter').onchange = (e) => { ui.site = e.target.value; render(); };
  $('#user-sel').onchange = (e) => { ui.user = e.target.value; saveUI(); };
  $('#lock-btn').onclick = () => (SERVER ? api('logout', {}).finally(() => location.reload()) : lockNow('手動鎖定'));
  $('#theme-btn').onclick = () => {
    const cur = document.documentElement.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    document.documentElement.dataset.theme = cur === 'dark' ? 'light' : 'dark'; ui.theme = document.documentElement.dataset.theme; saveUI(); themeLabel();
  };
  if (ui.theme) document.documentElement.dataset.theme = ui.theme;
  function themeLabel() { const d = (document.documentElement.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')) === 'dark'; $('#theme-btn').textContent = d ? '淺色' : '深色'; }
  themeLabel();
  window.addEventListener('hashchange', () => {
    window.scrollTo(0, 0); render();
    // 伺服器模式：每次換頁都向伺服器取最新資料，看得到其他護理師剛做的處理（不延長閒置時間）
    if (SERVER && db) api('data', undefined, { poll: true }).then(() => render()).catch(() => {});
  });

  boot();
})();
