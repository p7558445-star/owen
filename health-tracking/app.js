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
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(db)); return true; }
    catch (e) { toast('無法儲存到瀏覽器（空間不足或已停用），請先匯出備份'); return false; }
  }
  const t888 = () => { const x = (db.settings && db.settings.t888) || {}; return Object.assign({}, E.DEFAULT_888, x, { bp: Object.assign({}, E.DEFAULT_888.bp, x.bp || {}) }); };
  const sla = () => Object.assign({}, E.DEFAULT_SLA, (db.settings && db.settings.sla) || {});
  const nurses = () => (db.settings && db.settings.nurses && db.settings.nurses.length ? db.settings.nurses : ['個管師']);

  // 每次渲染重建索引
  let IX = null;
  function index() {
    const byPerson = new Map(), open = new Map(), mByP = new Map();
    for (const p of db.persons) byPerson.set(p.id, p);
    for (const m of db.measurements) { if (!mByP.has(m.personId)) mByP.set(m.personId, []); mByP.get(m.personId).push(m); }
    for (const e of db.episodes) if (e.state !== 'judged') open.set(e.personId, e);
    const evalCache = new Map();
    IX = {
      byPerson, open, mByP,
      sessions(pid) { return E.groupSessions(mByP.get(pid) || [], sla().sessionMinutes); },
      latest(pid) {
        if (evalCache.has(pid)) return evalCache.get(pid);
        const ss = this.sessions(pid); const s = ss[ss.length - 1];
        const r = s ? { session: s, ev: E.evaluateSession(ctx(byPerson.get(pid), s.at), s.readings) } : null;
        evalCache.set(pid, r); return r;
      },
      mgmt(pid) { const e = open.get(pid); if (e) return e.level; const l = this.latest(pid); return l ? (l.ev.overall === 'na' ? 'green' : 'green') : 'none'; },
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
  function csv(rows) { return '﻿' + rows.map((r) => r.map((c) => { const s = String(c ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; }).join(',')).join('\r\n'); }

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
    const ns = nurses(); if (!ns.includes(ui.user)) ui.user = ns[0];
    $('#user-sel').innerHTML = ns.map((n) => `<option ${n === ui.user ? 'selected' : ''}>${esc(n)}</option>`).join('');
    const route = (location.hash.slice(2) || 'dashboard').split('/')[0];
    const now = new Date();
    const overdue = db.episodes.filter((e) => e.state !== 'judged' && inSite(IX.byPerson.get(e.personId)) && E.nextStep(e, now).overdue).length;
    $('#tabs').innerHTML = ROUTES.map(([k, t]) => `<a href="#/${k}" class="${route === k || (route === 'p' && k === 'residents') ? 'on' : ''}">${t}${k === 'worklist' && overdue ? ` <span class="badge" title="逾期案件">${overdue}</span>` : ''}</a>`).join('');
  }

  function render() {
    index(); shell();
    const [route, arg] = (location.hash.slice(2) || 'dashboard').split('/');
    const app = $('#app');
    const banner = db.demo ? `<div class="banner no-print">目前顯示的是<strong>虛構示範資料</strong>（${db.persons.length} 位合成民眾），用來展示分層與閉環流程。正式使用請到「資料匯入」清除示範資料並匯入名冊。</div>` : '';
    const views = { dashboard, worklist, residents, p: caseView, quality: qualityView, 888: view888, import: importView, rules: rulesView };
    app.innerHTML = banner + (views[route] || dashboard)(arg);
    (bind[route] || (() => {}))(arg);
    saveUI();
  }

  // ───────────── 總覽 ─────────────
  function dashboard() {
    const now = new Date();
    const ps = persons();
    const cnt = { red: 0, orange: 0, yellow: 0, green: 0, none: 0 };
    for (const p of ps) cnt[IX.mgmt(p.id)]++;
    const openEps = db.episodes.filter((e) => e.state !== 'judged' && inSite(IX.byPerson.get(e.personId)));
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
    const stateRows = ['pending', 'notified', 'intervened', 'confirmed', 'retested'].map((st) => ({ name: E.STATE_LABEL[st], v: openEps.filter((e) => e.state === st).length }));
    const q = E.quality(db, now, ui.qWindow, (e) => inSite(IX.byPerson.get(e.personId)));

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
        <div class="card"><h2>今日</h2><div class="grid g2">
          <div><div class="muted small">今日新偵測異常</div><div class="k-val tnum" style="font-size:24px;font-weight:700">${today}</div></div>
          <div><div class="muted small">本月量測人次</div><div class="k-val tnum" style="font-size:24px;font-weight:700">${visits}</div></div>
        </div></div>
        <div class="card"><h2>開放追蹤案停留階段</h2><p class="small muted" style="margin:0 0 6px">每一案都必須走到「判定」，不能停在「已通知」</p>${simpleBars(stateRows, ' 案')}</div>
      </div>
    </div>
    <div class="grid g2" style="margin-top:12px">
      <div class="card"><div class="row spread"><h2>各據點管理層級分布</h2><button class="btn sm" id="site-tbl-btn" type="button">表格檢視</button></div>
        <div id="site-chart">${stackedBars(siteRows)}</div>
        <div id="site-tbl" hidden><div class="tbl-wrap"><table><thead><tr><th>據點</th>${LV_ORDER.map((l) => `<th class="num">${E.LEVEL_LABEL[l]}</th>`).join('')}<th class="num">合計</th></tr></thead><tbody>${siteRows.map((r) => `<tr><td>${esc(r.name)}</td>${LV_ORDER.map((l) => `<td class="num">${r[l]}</td>`).join('')}<td class="num">${r.total}</td></tr>`).join('')}</tbody></table></div></div>
      </div>
      <div class="card"><div class="row spread"><h2>品質指標（近 ${ui.qWindow} 天）</h2><a href="#/quality" class="small">詳細 →</a></div>
        <div class="grid g2">${[['紅層當日處理率', q.redSameDay], ['橙層就醫確認率', q.orangeConfirm], ['複測完成率', q.retest], ['降級（達標）率', q.improve]].map(([t, w]) => `<div><div class="muted small">${t}</div><div class="tnum" style="font-size:22px;font-weight:700">${pct(w)}</div><div class="small muted tnum">${w.k}/${w.n}　${ci(w)}</div></div>`).join('')}</div>
        <p class="small" style="margin:10px 0 0">未閉環逾期個案：<strong class="${q.unclosed ? 'overdue' : ''}">${q.unclosed}</strong> 案</p>
      </div>
    </div>`;
  }

  // ───────────── 工作清單 ─────────────
  function worklistRows() {
    const now = new Date(), f = ui.wl, q = f.q.trim();
    return db.episodes.filter((e) => e.state !== 'judged').map((e) => ({ e, p: IX.byPerson.get(e.personId), s: E.nextStep(e, now) }))
      .filter(({ e, p, s }) => p && inSite(p) && (!f.levels.length || f.levels.includes(e.level)) && (f.state === 'all' || e.state === f.state) && (!f.overdue || s.overdue) && (!f.mine || e.assignee === ui.user)
        && (!q || p.name.includes(q) || (p.nationalId || '').includes(q.toUpperCase()) || (p.demoId || '').includes(q.toUpperCase())))
      .sort((a, b) => (b.s.overdue - a.s.overdue) || E.RANK[b.e.level] - E.RANK[a.e.level] || (new Date(a.s.due || 8.64e15) - new Date(b.s.due || 8.64e15)));
  }
  function worklist() {
    const f = ui.wl, rows = worklistRows();
    return `<h1>追蹤工作清單</h1>
    <div class="filters">
      <div class="chips" role="group" aria-label="層級">${['red', 'orange', 'yellow'].map((l) => `<button type="button" class="chip" data-lvf="${l}" aria-pressed="${f.levels.includes(l)}">${E.LEVEL_LABEL[l]}層</button>`).join('')}</div>
      <select id="wl-state" aria-label="階段"><option value="all">全部階段</option>${['pending', 'notified', 'intervened', 'confirmed', 'retested'].map((s) => `<option value="${s}" ${f.state === s ? 'selected' : ''}>${E.STATE_LABEL[s]}</option>`).join('')}</select>
      <label class="row small"><input type="checkbox" id="wl-od" ${f.overdue ? 'checked' : ''}>只看逾期</label>
      <label class="row small"><input type="checkbox" id="wl-mine" ${f.mine ? 'checked' : ''}>只看派給我</label>
      <input type="search" id="wl-q" placeholder="搜尋姓名或證號" value="${esc(f.q)}">
      <span class="muted small" style="margin-left:auto">${rows.length} 案</span>
      <button class="btn sm" id="wl-export" type="button">匯出 CSV</button>
    </div>
    ${rows.length ? `<div class="tbl-wrap"><table><thead><tr><th>層級</th><th>民眾</th><th>據點</th><th>異常項目（目前層級）</th><th>階段</th><th>下一步</th><th>期限</th><th>負責</th></tr></thead><tbody>
    ${rows.map(({ e, p, s }) => `<tr class="click" data-href="#/p/${p.id}"><td>${lv(e.level)}${e.provisional ? ' <span class="tag warn" data-tip="單次量測，需重測確認">暫定</span>' : ''}${e.emergency ? ' <span class="tag bad">急</span>' : ''}${e.cycle > 1 ? `<div class="small muted">第 ${e.cycle} 週期</div>` : ''}</td>
      <td><strong>${esc(pname(p))}</strong><div class="small muted">${esc(pid2(p))}・${p.sex === 'M' ? '男' : p.sex === 'F' ? '女' : '—'} ${E.ageAt(p.birth, new Date()) ?? '—'} 歲</div></td>
      <td class="small">${esc(p.site)}</td>
      <td class="small">${e.items.map((i) => `<span class="lv ${i.level}" style="margin:0 4px 4px 0" data-tip="${esc(`${i.value}｜${i.reason}`)}">${E.ITEM_LABEL[i.key]}</span>`).join('')}</td>
      <td class="small">${E.STATE_LABEL[e.state]}</td><td class="small">${esc(s.label)}</td><td class="small">${dueText(s)}</td><td class="small">${esc(e.assignee || '未派')}</td></tr>`).join('')}
    </tbody></table></div>` : '<div class="card empty">沒有符合條件的追蹤案</div>'}`;
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
    ${shown.map(({ p, m, l }) => { const e = IX.open.get(p.id); return `<tr class="click" data-href="#/p/${p.id}"><td>${m === 'none' ? '<span class="lv na">未量測</span>' : lv(m)}</td><td><strong>${esc(pname(p))}</strong><div class="small muted">${esc(pid2(p))}</div></td><td class="small">${esc(p.site)}</td><td class="small tnum">${l ? fmtD(l.session.at) : '—'}</td>${E.ITEMS.map((i) => `<td style="text-align:center">${l ? dot(l.ev.items[i.key]) : dot(null)}</td>`).join('')}<td class="small">${e ? E.STATE_LABEL[e.state] : '<span class="muted">—</span>'}</td></tr>`; }).join('')}
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
    const past = db.episodes.filter((e) => e.personId === id && e.state === 'judged').sort((a, b) => new Date(b.detectedAt) - new Date(a.detectedAt));
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
        ${ep ? episodeCard(p, ep, now) : `<div class="card"><h2>追蹤狀態</h2><p>${lv(l ? (l.ev.overall === 'na' ? 'na' : l.ev.overall) : 'na')} 目前沒有開放中的追蹤案。${l && E.RANK[l.ev.overall] <= 0 ? '回饋與例行量測即可。' : ''}</p></div>`}
        <div class="card"><div class="row spread"><h2>最近一次量測判定</h2><span class="small muted">${l ? fmtDT(l.session.at) + (l.session.readings.length > 1 ? `・含 ${l.session.readings.length - 1} 次重測` : '') : ''}</span></div>
          ${l ? `<div class="tbl-wrap"><table><thead><tr><th>項目</th><th>數值</th><th>層級</th><th>判定依據</th><th>處理建議</th></tr></thead><tbody>
          ${E.ITEMS.map((it) => { const r = l.ev.items[it.key]; return r ? `<tr><td>${it.label}</td><td class="tnum">${esc(r.value)}</td><td>${lv(r.level)}${r.provisional ? ' <span class="tag warn">暫定</span>' : ''}</td><td class="small">${esc(r.reason)}${r.notes.length ? `<div class="small" style="color:var(--warn-ink)">${r.notes.map(esc).join('<br>')}</div>` : ''}</td><td class="small">${r.actions.map(esc).join('、')}</td></tr>` : `<tr><td>${it.label}</td><td colspan="4" class="muted small">本次未量測</td></tr>`; }).join('')}
          </tbody></table></div>${l.ev.symptoms.length ? `<p class="small">回報症狀：${l.ev.symptoms.map((s) => E.SYMPTOMS[s] || s).join('、')}</p>` : ''}` : '<div class="empty">尚無量測資料</div>'}
        </div>
        <div class="card"><h2>趨勢</h2><p class="small muted" style="margin-top:-6px">點的顏色為該次量測的層級；虛線為分層閾值。滑過可看數值。</p>
          <div class="grid g2">
            <div><h3>血壓（mmHg）</h3><div class="legend"><span>— 實線 收縮壓</span><span>- - 虛線 舒張壓</span></div>${lineChart({ series: [series('bp', 'sbp', '收縮壓'), series('bp', 'dbp', '舒張壓', { dash: true })], refs: [{ v: 140, label: '140', level: 'orange' }, { v: 90, label: '90', level: 'orange' }] })}</div>
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
          <h3 style="margin-top:12px">健康888：已加入醫師三高照護網</h3>
          <div class="chips">${E.DOMAINS_888.map((d) => `<label class="chip"><input type="checkbox" data-care="${d.key}" ${p.careNet && p.careNet[d.key] ? 'checked' : ''} style="margin-right:4px">${d.label}</label>`).join('')}</div>
          <p class="small muted">例如已收案於健保三高／糖尿病共照、代謝症候群防治計畫，或由固定醫師追蹤。轉介就醫並確認就醫者，系統會自動視為已入網。</p>
          <div class="row" style="margin-top:6px"><button class="btn sm" type="button" id="counsel-btn">記錄生活型態諮詢</button><span class="small muted">${(p.counsel || []).length ? '最近：' + fmtD(p.counsel[p.counsel.length - 1].at) : '開立健康處方即自動計入'}</span></div>
        </div>
        <div class="card"><h2>追蹤週期紀錄</h2>
          ${past.length ? past.map((e) => `<details style="margin-bottom:6px"><summary>${lv(e.initialLevel)} 第 ${e.cycle} 週期・${fmtD(e.detectedAt)}・${E.OUTCOME_LABEL[e.judge.outcome]}${e.judge.reason ? '（' + esc(e.judge.reason) + '）' : ''}</summary>${timeline(e)}${e.rx ? `<div class="rx small" style="margin-top:6px">${esc(e.rx.text)}</div>` : ''}</details>`).join('') : '<p class="muted small">尚無已判定的週期</p>'}
        </div>
      </div>
    </div>`;
  }

  function timeline(e) { return `<ul class="timeline">${e.log.slice().reverse().map((x) => `<li><time class="tnum">${fmtDT(x.at)}</time>${esc(x.text)} <span class="muted small">${esc(x.by)}</span></li>`).join('')}</ul>`; }

  function episodeCard(p, ep, now) {
    const s = E.nextStep(ep, now);
    const order = ['detected', 'pending', 'notified', 'intervened', 'confirmed', 'retested', 'judged'];
    const ci = order.indexOf(ep.state);
    const steps = order.map((st, i) => `<div class="step ${i < ci ? 'done' : i === ci ? 'cur' : ''}">${E.STATE_LABEL[st]}</div>`).join('');
    const nurseOpts = nurses().map((n) => `<option ${n === (ep.assignee || ui.user) ? 'selected' : ''}>${esc(n)}</option>`).join('');
    const needVisit = E.RANK[ep.level] >= 2;
    let form = '';
    switch (ep.state) {
      case 'pending':
        form = `<div class="form-grid"><label class="f">派案給<select name="assignee">${nurseOpts}</select></label><label class="f">通知方式<select name="method"><option>電話</option><option>App 推播</option><option>現場</option><option>家訪</option><option>簡訊</option></select></label></div>
          <label class="f" style="margin-top:8px">通知內容／備註<input type="text" name="note" placeholder="例：已電話告知量測結果與就醫建議"></label>
          <button class="btn primary" style="margin-top:10px" data-act="notify">派案並記錄已通知</button>`; break;
      case 'notified':
        form = `<label class="f">健康處方（必填，可修改）<textarea name="rx">${esc(E.prescription(p, ep))}</textarea></label>
          <label class="f" style="margin-top:8px">介入紀錄<input type="text" name="note" placeholder="例：衛教飲食與運動、評估用藥狀況"></label>
          <div class="row" style="margin-top:10px"><button class="btn primary" data-act="intervene">完成介入與健康處方</button><button class="btn" data-print-rx>列印處方</button></div>`; break;
      case 'intervened':
        form = needVisit ? `<div class="form-grid"><label class="f">就醫日期<input type="date" name="visitDate" required></label><label class="f">就醫院所／科別<input type="text" name="facility" placeholder="彰基家醫科"></label></div>
          <label class="f" style="margin-top:8px">就醫結果<input type="text" name="result" placeholder="例：開始用藥、安排心電圖"></label>
          <button class="btn primary" style="margin-top:10px" data-act="confirm">確認已就醫</button>`
          : `<p class="small">黃層：確認民眾已收到並理解健康處方（衛教完成）。</p><label class="f">備註<input type="text" name="result"></label><button class="btn primary" style="margin-top:10px" data-act="confirm">確認完成健康處方</button>`; break;
      case 'confirmed':
        form = ep.level === 'red'
          ? `<p class="small">就醫日：${esc(ep.confirm.visitDate || '')}。請於 ${fmtD(ep.phone && ep.phone.due)} 前電訪。</p><label class="f">電訪內容<input type="text" name="note" placeholder="例：已規律服藥，症狀改善"></label><button class="btn primary" style="margin-top:10px" data-act="phone">完成電訪確認</button>`
          : `<p class="small">等待民眾於 <strong>${fmtD(ep.due.retest)}</strong> 前回健康站複測；新量測回傳後會自動進入「已複測」。</p><button class="btn" type="button" id="add-m2">手動登錄複測</button>`; break;
      case 'retested': {
        const sg = ep.suggestion;
        form = `${ep.retest && ep.retest.level ? `<p class="small">複測結果：${lv(ep.retest.level)}（${fmtD(ep.retest.at)}）</p>` : ''}${sg ? `<p class="small banner" style="margin:6px 0">系統建議：${esc(sg.text)}</p>` : ''}
          <div class="form-grid"><label class="f">判定<select name="outcome" id="j-out">${Object.entries(E.OUTCOME_LABEL).map(([k, v]) => `<option value="${k}" ${sg && sg.outcome === k ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
          <label class="f">新層級<select name="toLevel">${LV_ORDER.map((x) => `<option value="${x}" ${(sg ? sg.toLevel : ep.level) === x ? 'selected' : ''}>${E.LEVEL_LABEL[x]}</option>`).join('')}</select></label>
          <label class="f">結案原因<select name="reason"><option value="">（非結案免填）</option>${E.CLOSE_REASONS.map((r) => `<option ${sg && sg.reason === r ? 'selected' : ''}>${r}</option>`).join('')}</select></label>
          <label class="f">回診日期（轉由醫師管理必填）<input type="date" name="followupDate"></label></div>
          <p class="small muted">達標後連續 2 次維持才降級；慢性病不直接結案，請選「已轉由醫師持續管理」並登記回診日期。維持／升級／降級（非綠）會自動開啟下一追蹤週期。</p>
          <button class="btn primary" data-act="judge">送出判定</button>`; break;
      }
    }
    const dueRows = [['通知', ep.due.notify, ep.notify && ep.notify.at], ['介入＋處方', ep.due.intervene, ep.intervene && ep.intervene.at], [needVisit ? '確認就醫' : '確認處方', ep.due.confirm, ep.confirm && ep.confirm.at], ep.level === 'red' ? ['電訪', ep.phone && ep.phone.due, ep.phone && ep.phone.at] : ['複測', ep.due.retest, ep.retest && ep.retest.at]];
    return `<div class="card" style="border-left:4px solid var(--lv-${ep.level})">
      <div class="row spread"><h2 style="margin:0">${lv(ep.level)} 追蹤中・第 ${ep.cycle} 週期${ep.provisional ? ' <span class="tag warn">暫定，需重測確認</span>' : ''}</h2><span class="small muted">偵測 ${fmtDT(ep.detectedAt)}・負責 ${esc(ep.assignee || '未派')}</span></div>
      <p class="small" style="margin:6px 0">${esc(E.LEVEL_MEANING[ep.level])}</p>
      <div class="chips" style="margin-bottom:8px">${ep.items.map((i) => `<span class="lv ${i.level}" data-tip="${esc(i.reason)}">${E.ITEM_LABEL[i.key]} ${esc(i.value)}</span>`).join('')}</div>
      <div class="stepper" aria-label="閉環流程">${steps}</div>
      <div class="grid g2" style="margin-top:10px">
        <div><h3>下一步：${esc(s.label)}</h3><div class="small">${dueText(s)}</div></div>
        <div class="tbl-wrap"><table class="small"><thead><tr><th>節點</th><th>期限</th><th>完成</th></tr></thead><tbody>${dueRows.map(([n, d, done]) => `<tr><td>${n}</td><td class="tnum">${d ? fmtD(d) : '—'}</td><td class="tnum">${done ? '✓ ' + fmtD(done) : (d && new Date(d) < now ? '<span class="overdue">逾期</span>' : '—')}</td></tr>`).join('')}</tbody></table></div>
      </div>
      <form id="ep-form" class="no-print" style="margin-top:12px" onsubmit="return false">${form}</form>
      <details class="no-print" style="margin-top:12px"><summary class="small">提前結案（死亡、遷出、失聯、拒絕）</summary>
        <div class="row" style="margin-top:8px"><select id="close-reason">${['失聯', '拒絕', '遷出', '死亡'].map((r) => `<option>${r}</option>`).join('')}</select><input type="text" id="close-note" placeholder="說明（如：3 次電訪未接）"><button class="btn danger" type="button" id="close-btn">結案</button></div>
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
        ${n('ldl', 'LDL')}${n('tg', '三酸甘油脂')}${n('hdl', 'HDL')}${n('tc', '總膽固醇')}${n('ua', '尿酸', 0.1)}${n('weight', '體重 kg', 0.1)}${n('waist', '腰圍 cm', 0.1)}${n('bodyFat', '體脂 %', 0.1)}${n('hba1c', 'HbA1c %（抽血）', 0.1)}
      </div>
      <h3 style="margin-top:12px">症狀</h3><div class="chips">${Object.entries(E.SYMPTOMS).map(([k, v]) => `<label class="chip"><input type="checkbox" name="sx" value="${k}" style="margin-right:4px">${v}</label>`).join('')}</div>
      <p class="small muted">同一場次（60 分鐘內）的重測會合併判定；例如血氧 91–94 需重測 2 次。</p>`,
    [{ label: '取消' }, { label: '儲存並判定', primary: true, onClick: (b) => {
      const fd = new FormData($('#dlg-form'));
      const m = { id: E.uid('m'), personId: p.id, at: new Date(fd.get('at')).toISOString(), source: 'manual', symptoms: fd.getAll('sx') };
      for (const k of ['sbp', 'dbp', 'pulse', 'spo2', 'temp', 'glucose', 'ldl', 'tg', 'hdl', 'tc', 'ua', 'weight', 'waist', 'bodyFat', 'hba1c']) { const v = fd.get(k); if (v !== '' && v !== null) m[k] = +v; }
      if (fd.get('arr')) m.arr = true;
      if (m.glucose !== undefined) m.glucoseType = fd.get('glucoseType');
      if (Object.keys(m).length <= 5 && !m.arr) throw new Error('請至少輸入一項數值');
      if ((m.sbp === undefined) !== (m.dbp === undefined)) throw new Error('血壓請同時輸入收縮壓與舒張壓');
      db.measurements.push(m);
      const r = E.ingest(db, p.id, m.at, sla());
      save(); render();
      toast(`已判定：${E.LEVEL_LABEL[r.ev.overall]}層${r.ev.emergency ? '，有警示症狀請立即處理' : ''}`);
    } }]);
  }

  function printRx(p, ep) {
    const text = ep.rx ? ep.rx.text : E.prescription(p, ep);
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
      redSameDay: ['紅層當日處理率', '分母：期間內初判為紅層的追蹤週期；分子：偵測當日即完成「已介入」者。'],
      orangeConfirm: ['橙層就醫確認率', '分母：初判橙層且 4 週期限已到或已確認者（排除死亡、遷出）；分子：期限內確認就醫者。'],
      retest: ['複測完成率', '分母：黃／橙層複測期限已到者（排除死亡、遷出）；分子：已有複測紀錄者。'],
      improve: ['降級（達標）率', '分母：期間內完成臨床判定者（排除死亡、遷出、失聯、拒絕、同場次重測正常）；分子：判定降級或達標結案者。'],
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
    <div class="card" style="margin-top:12px"><h2>各據點</h2><div class="tbl-wrap"><table><thead><tr><th>據點</th><th class="num">追蹤週期</th>${Object.values(defs).map(([t]) => `<th class="num">${t}</th>`).join('')}<th class="num">未閉環逾期</th></tr></thead><tbody>
      ${bySite.map(({ s, q }) => `<tr><td>${esc(s)}</td><td class="num">${q.episodes}</td>${Object.keys(defs).map((k) => `<td class="num" data-tip="${esc(ci(q[k]) || '分母為 0')}">${pct(q[k])}<span class="muted small"> ${q[k].k}/${q[k].n}</span></td>`).join('')}<td class="num ${q.unclosed ? 'overdue' : ''}">${q.unclosed}</td></tr>`).join('')}
    </tbody></table></div>
    <p class="small muted">95% 信賴區間採 Wilson score 法。各據點分母多半很小（常 &lt;30），區間很寬，跨據點排名請看區間是否重疊，不要只比點估計。</p></div>`;
  }

  // ───────────── 健康 888 ─────────────
  const GAPS = {
    notJoined: ['已找出、未入網', '轉介就醫並確認；若已有固定醫師或已收案共照，於個案頁勾選「已加入照護網」'],
    notCounselled: ['已入網、未接受生活型態諮詢', '開立健康處方，或於個案頁「記錄生活型態諮詢」'],
    notControlled: ['已諮詢、未達控制', '回診調藥、強化飲食運動處方，3 個月內複測'],
    noData: ['已諮詢、近期無量測', '邀請回健康站量測，或補登抽血 HbA1c／LDL'],
  };
  function median(xs) { if (!xs.length) return null; const a = xs.slice().sort((x, y) => x - y), m = a.length >> 1; return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2; }
  function q1q3(xs) { if (xs.length < 4) return null; const a = xs.slice().sort((x, y) => x - y), q = (p) => { const i = (a.length - 1) * p, lo = Math.floor(i); return a[lo] + (a[Math.ceil(i)] - a[lo]) * (i - lo); }; return [q(0.25), q(0.75)]; }

  function view888() {
    const now = new Date(), o = t888();
    const c = E.cascade888(db, now, o, inSite);
    const q = E.quality(db, now, o.lookbackDays, (e) => inSite(IX.byPerson.get(e.personId)));
    const lag = db.episodes.filter((e) => inSite(IX.byPerson.get(e.personId)) && e.intervene && new Date(e.detectedAt) >= E.addDays(now, -o.lookbackDays)).map((e) => (new Date(e.intervene.at) - new Date(e.detectedAt)) / 864e5);
    const med = median(lag), iqr = q1q3(lag);
    const g = Object.assign({ d: 'htn', gap: 'notJoined' }, ui.g888);
    const D = c.domains;
    const stage = (label, w, n0, need, prevLabel) => {
      const k = w.k, n = w.n;
      const width = n0 ? (k / n0) * 100 : 0, tick = n0 ? (0.8 * n / n0) * 100 : 0;
      return `<div class="bar-row" style="grid-template-columns:72px minmax(0,1fr) 128px"><span>${label}</span>
        <div style="position:relative;height:14px"><div class="seg neutral" style="width:${Math.max(width, k ? 1 : 0)}%;height:14px;border-radius:4px" data-tip="${esc(`${label} ${k} 人／${prevLabel} ${n} 人`)}"></div>${n ? `<div style="position:absolute;top:-3px;left:${tick}%;width:2px;height:20px;background:var(--ink)" data-tip="${esc(`80% 目標：${Math.ceil(0.8 * n - 1e-9)} 人`)}"></div>` : ''}</div>
        <span class="small tnum" style="text-align:right"><strong>${pct(w)}</strong> ${k}/${n}<br><span class="${need ? 'overdue' : 'muted'}">${n ? (need ? `差 ${need} 人達 80%` : '✓ 已達 80%') : '—'}</span></span></div>`;
    };
    const card = (d) => `<div class="card"><div class="row spread"><h2 style="margin:0">${d.label}</h2><span class="small muted">找出 ${d.identified} 人</span></div>
      <div style="margin-top:10px">${stage('入網', d.joined, d.identified, d.need.joined, '找出')}${stage('諮詢', d.counselled, d.identified, d.need.counselled, '入網')}${stage('達標', d.controlled, d.identified, d.need.controlled, '諮詢')}</div>
      <p class="small" style="margin:8px 0 0">整體達標（達標／找出）：<strong>${pct(d.overall)}</strong> <span class="muted">${d.overall.k}/${d.overall.n}　目標 51.2%</span></p>
      <p class="small muted" style="margin:2px 0 0">${['joined', 'counselled', 'controlled'].map((k, i) => `${['入網', '諮詢', '達標'][i]} ${ci(d[k]) || '—'}`).join('<br>')}</p></div>`;
    const rows = (D[g.d].ids[g.gap] || []).map((id) => IX.byPerson.get(id)).filter(Boolean);
    const val = (w) => `${pct(w)} <span class="muted">${w.k}/${w.n}</span>`;
    const ind = [
      ['找出', '三高個案加入照護網率（入網／找出）', `高血壓 ${val(D.htn.joined)}<br>高血糖 ${val(D.dm.joined)}<br>高血脂 ${val(D.lipid.joined)}`,
        [['篩檢涵蓋率（12 個月內量過三高項目／名冊）', val(c.screened)], ['橙層就醫確認率（4 週內）', val(q.orangeConfirm)]]],
      ['介入', '入網者接受生活型態諮詢率（諮詢／入網）', `高血壓 ${val(D.htn.counselled)}<br>高血糖 ${val(D.dm.counselled)}<br>高血脂 ${val(D.lipid.counselled)}`,
        [['紅層當日處理率', val(q.redSameDay)], ['偵測到介入天數（中位數 [IQR]）', med === null ? '—' : `${med.toFixed(1)} 天${iqr ? ` [${iqr[0].toFixed(1)}–${iqr[1].toFixed(1)}]` : ''}　n=${lag.length}`]]],
      ['達標', '諮詢者控制良好率（達標／諮詢）', `高血壓 ${val(D.htn.controlled)}<br>高血糖 ${val(D.dm.controlled)}<br>高血脂 ${val(D.lipid.controlled)}`,
        [['複測完成率', val(q.retest)], ['降級（達標）率', val(q.improve)], ['整體達標率（達標／找出，目標 51.2%）', `高血壓 ${pct(D.htn.overall)}・高血糖 ${pct(D.dm.overall)}・高血脂 ${pct(D.lipid.overall)}`]]],
    ];
    return `<div class="row spread"><h1>健康888（三高防治）</h1><span class="small muted">觀察期近 ${o.lookbackDays} 天・${ui.site === 'all' ? '全部據點' : esc(ui.site)}・<a href="#/rules">調整參數</a></span></div>
    <p class="small" style="margin-top:-6px">國健署「三高防治 888」：8 成三高個案加入照護網 → 其中 8 成接受生活型態諮詢 → 其中 8 成控制良好。三段都是<strong>條件比率</strong>（分母為上一段人數），三段都達 80% 時，整體為 0.8³ = 51.2%。</p>
    <div class="grid g3">${E.DOMAINS_888.map((d) => card(D[d.key])).join('')}</div>
    <div class="card" style="margin-top:12px"><h2>建議指標：找出／介入／達標</h2><div class="tbl-wrap"><table class="small"><thead><tr><th>階段</th><th>主指標（888）</th><th>目前值</th><th>輔助過程指標</th><th>目前值</th></tr></thead><tbody>
      ${ind.map(([s, main, v, sub]) => sub.map((x, i) => `<tr>${i ? '' : `<td rowspan="${sub.length}"><strong>${s}</strong></td><td rowspan="${sub.length}">${main}</td><td rowspan="${sub.length}" class="tnum">${v}</td>`}<td>${x[0]}</td><td class="tnum">${x[1]}</td></tr>`).join('')).join('')}
    </tbody></table></div>
    <p class="small muted">主指標對應 888 的三個 8 成；輔助指標是可每週追蹤的前導指標。主指標反映結果、變動較慢；輔助指標可及早顯示哪一段開始卡住。</p></div>
    <div class="card" style="margin-top:12px"><div class="row spread"><h2 style="margin:0">缺口名單</h2>
      <div class="row"><select id="g-d">${E.DOMAINS_888.map((d) => `<option value="${d.key}" ${g.d === d.key ? 'selected' : ''}>${d.label}</option>`).join('')}</select>
      <select id="g-gap">${Object.entries(GAPS).map(([k, [t]]) => `<option value="${k}" ${g.gap === k ? 'selected' : ''}>${t}（${D[g.d].ids[k].length}）</option>`).join('')}</select>
      <button class="btn sm" id="g-export" type="button">匯出 CSV</button></div></div>
      <p class="small">建議動作：${GAPS[g.gap][1]}</p>
      ${rows.length ? `<div class="tbl-wrap"><table><thead><tr><th>民眾</th><th>據點</th><th>管理層級</th><th>最近量測</th><th>用藥</th><th>追蹤階段</th></tr></thead><tbody>${rows.map((p) => { const l = IX.latest(p.id), e = IX.open.get(p.id), m = IX.mgmt(p.id); return `<tr class="click" data-href="#/p/${p.id}"><td><strong>${esc(pname(p))}</strong><div class="small muted">${esc(pid2(p))}</div></td><td class="small">${esc(p.site)}</td><td>${m === 'none' ? '<span class="lv na">未量測</span>' : lv(m)}</td><td class="small tnum">${l ? fmtD(l.session.at) : '—'}</td><td class="small">${[p.medHTN && '降壓', p.medDM && '降糖', p.medLipid && '降脂'].filter(Boolean).join('、') || '—'}</td><td class="small">${e ? E.STATE_LABEL[e.state] : '—'}</td></tr>`; }).join('')}</tbody></table></div>` : '<div class="empty">此缺口目前沒有個案</div>'}
    </div>
    <details class="card" style="margin-top:12px"><summary><strong>指標定義</strong></summary><ul class="small">
      <li><strong>找出（分母）</strong>：觀察期內符合任一條件：服用該類藥物；社區量測 ≥${o.minAbnormalSessions} 個場次達橙層以上（血壓 ≥140/90、空腹 ≥126 或飯後 ≥200、LDL ≥160 或 TG ≥200）；HbA1c ≥6.5%（僅高血糖）。單次異常不計入，以降低偽陽性。</li>
      <li><strong>入網</strong>：個案頁勾選「已加入醫師三高照護網」；或觀察期內該項目的橙／紅層已確認就醫；或以「已轉由醫師持續管理」結案。</li>
      <li><strong>生活型態諮詢</strong>：觀察期內針對該項目（或代謝症候群）開立健康處方，或手動記錄生活型態諮詢。</li>
      <li><strong>控制良好</strong>：最近 ${o.recentDays} 天內最後一次量測：血壓 &lt;${o.bp.sbp}/${o.bp.dbp}；HbA1c &lt;${o.hba1c}%（無 HbA1c 時以空腹血糖 70–&lt;${o.fpg} 或飯後 70–&lt;${o.nonFasting} 代替）；LDL &lt;${o.ldl}。近期無量測者不列入達標分子，另列「近期無量測」缺口。</li>
      <li>社區設備的指尖血糖不能取代 HbA1c；LDL 目標應依心血管風險分級（例如糖尿病或已有心血管疾病者更嚴格），此處用單一門檻只是社區篩檢層級的近似。</li>
      <li>信賴區間採 Wilson score 法。</li></ul></details>`;
  }

  // ───────────── 資料匯入 ─────────────
  const M_COLS = [['識別值', 'id'], ['量測時間', 'at'], ['收縮壓', 'sbp'], ['舒張壓', 'dbp'], ['脈搏', 'pulse'], ['心律旗標', 'arr'], ['血氧', 'spo2'], ['體溫', 'temp'], ['血糖', 'glucose'], ['血糖類型', 'glucoseType'], ['LDL', 'ldl'], ['三酸甘油脂', 'tg'], ['HDL', 'hdl'], ['總膽固醇', 'tc'], ['尿酸', 'ua'], ['體重', 'weight'], ['腰圍', 'waist'], ['體脂率', 'bodyFat'], ['HbA1c', 'hba1c'], ['症狀', 'symptoms']];
  const ALIAS = { id: ['識別值', '身分證', '證號', '個案編號', 'id'], at: ['量測時間', '時間', '日期'], sbp: ['收縮壓', 'sbp'], dbp: ['舒張壓', 'dbp'], pulse: ['脈搏', '心率', 'pulse', 'hr'], arr: ['心律', 'arr', '房顫'], spo2: ['血氧', 'spo2'], temp: ['體溫', 'temp'], glucoseType: ['血糖類型', '血糖種類'], glucose: ['血糖', 'glucose'], ldl: ['ldl', '低密度'], tg: ['三酸甘油', 'tg'], hdl: ['hdl', '高密度'], tc: ['總膽固醇', 'tc'], ua: ['尿酸', 'ua'], weight: ['體重', 'weight'], waist: ['腰圍', 'waist'], bodyFat: ['體脂', 'fat'], hba1c: ['hba1c', '糖化'], symptoms: ['症狀'] };
  let pendingRoster = null;

  function importView() {
    return `<h1>資料匯入</h1>
    <div class="grid g2">
      <div class="card"><h2>1. 民眾名冊（優活雲批次建立個案名單）</h2>
        <p class="small">支援目前各據點填寫的 Excel 格式（每個工作表一個據點）。系統會自動校正：民國年、年份重複加 1911、身高以公尺填寫、身分證號填錯欄位，並以身分證號去重。</p>
        <input type="file" id="roster-file" accept=".xlsx,.xls">
        <div id="roster-preview"></div>
      </div>
      <div class="card"><h2>2. 量測資料（九合一設備／App 匯出）</h2>
        <p class="small">CSV 或 Excel，每列一次量測，以「識別值」（身分證號或示範編號）對應民眾。同一人 60 分鐘內的多筆視為同一場次重測。匯入後依時間順序逐筆判定並開案。</p>
        <div class="row"><input type="file" id="meas-file" accept=".csv,.xlsx,.xls"><button class="btn sm" id="tpl" type="button">下載欄位範本</button></div>
        <div id="meas-preview"></div>
        <details class="small" style="margin-top:8px"><summary>欄位說明</summary><p>${M_COLS.map(([c]) => c).join('、')}。<br>血糖類型填「空腹／飯後／隨機」；心律旗標填 Y；症狀以「、」分隔，可用：${Object.values(E.SYMPTOMS).map((s) => s.replace(/（.*）/, '')).join('、')}。<br>正式串接時建議由 App 後端以 API 即時推送同樣欄位，而非人工匯檔。</p></details>
      </div>
    </div>
    <div class="card" style="margin-top:12px"><h2>備份與重設</h2>
      <p class="small">資料目前只存在<strong>這台電腦的這個瀏覽器</strong>。請定期匯出備份；正式上線需改接院內資料庫（見說明文件）。</p>
      <div class="row"><button class="btn" id="bk-exp" type="button">匯出備份（JSON）</button><label class="btn">匯入備份<input type="file" id="bk-imp" accept=".json" hidden></label>
      <button class="btn" id="demo-load" type="button">重新載入示範資料</button><button class="btn danger" id="wipe" type="button">清除全部資料</button></div>
    </div>`;
  }

  function readWorkbook(file) {
    return file.arrayBuffer().then((buf) => {
      if (!window.XLSX) throw new Error('Excel 解析元件未載入（需網路連線）');
      return XLSX.read(buf, { type: 'array', cellDates: true });
    });
  }

  function previewRoster(wb) {
    const sheets = wb.SheetNames.map((n) => ({ name: n, ...E.parseRoster(XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, raw: true, defval: '' }), n) }));
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

  function commitRoster() {
    if (!pendingRoster) return;
    if (db.demo) { db = { persons: [], measurements: [], episodes: [], settings: db.settings }; }
    const byId = new Map(db.persons.filter((p) => p.nationalId).map((p) => [p.nationalId, p]));
    let add = 0, upd = 0;
    for (const r of pendingRoster.all) {
      const ex = r.nationalId && byId.get(r.nationalId);
      if (ex) { Object.assign(ex, { name: r.name, sex: r.sex || ex.sex, birth: r.birth || ex.birth, heightCm: r.heightCm ?? ex.heightCm, phone: r.phone || ex.phone, site: r.site }); upd++; continue; }
      const p = { id: E.uid('p'), name: r.name, sex: r.sex, birth: r.birth, heightCm: r.heightCm, nationalId: r.nationalId, phone: r.phone, site: r.site };
      db.persons.push(p); if (p.nationalId) byId.set(p.nationalId, p); add++;
    }
    pendingRoster = null; save(); render(); toast(`已新增 ${add} 位、更新 ${upd} 位`);
  }

  function importMeasurements(rows) {
    const head = rows[0].map((h) => String(h).trim().toLowerCase());
    const col = {};
    for (const [k, al] of Object.entries(ALIAS)) {
      const i = head.findIndex((h, j) => al.some((a) => h.includes(a.toLowerCase())) && !Object.values(col).includes(j) && !(k === 'glucose' && h.includes('類')));
      if (i >= 0) col[k] = i;
    }
    if (col.id === undefined || col.at === undefined) throw new Error('找不到「識別值」或「量測時間」欄位');
    const key = new Map();
    for (const p of db.persons) { if (p.nationalId) key.set(p.nationalId, p); if (p.demoId) key.set(p.demoId, p); }
    const exist = new Set(db.measurements.map((m) => m.personId + '|' + m.at));
    const unmatched = new Set(); let bad = 0, dup = 0; const add = [];
    for (const r of rows.slice(1)) {
      if (!r || r.every((c) => c === '' || c === null)) continue;
      const p = key.get(String(r[col.id]).trim().toUpperCase());
      if (!p) { unmatched.add(String(r[col.id])); continue; }
      const t = r[col.at] instanceof Date ? r[col.at] : new Date(String(r[col.at]).replace(/\//g, '-').replace(' ', 'T'));
      if (isNaN(t)) { bad++; continue; }
      const m = { id: E.uid('m'), personId: p.id, at: t.toISOString(), source: 'import' };
      for (const k of ['sbp', 'dbp', 'pulse', 'spo2', 'temp', 'glucose', 'ldl', 'tg', 'hdl', 'tc', 'ua', 'weight', 'waist', 'bodyFat', 'hba1c']) if (col[k] !== undefined && r[col[k]] !== '' && r[col[k]] !== null && !isNaN(+r[col[k]])) m[k] = +r[col[k]];
      if (col.arr !== undefined && /^(y|yes|1|是|true|arr)/i.test(String(r[col.arr]))) m.arr = true;
      if (col.glucoseType !== undefined && m.glucose !== undefined) m.glucoseType = String(r[col.glucoseType] || '隨機');
      if (col.symptoms !== undefined && r[col.symptoms]) m.symptoms = String(r[col.symptoms]).split(/[、,，;；]/).map((s) => E.SYMPTOM_BY_LABEL[s.trim()] || null).filter(Boolean);
      if (exist.has(m.personId + '|' + m.at)) { dup++; continue; }
      add.push(m);
    }
    add.sort((a, b) => new Date(a.at) - new Date(b.at));
    const last = new Map();
    for (const m of add) { db.measurements.push(m); const r = E.ingest(db, m.personId, m.at, sla()); if (r) last.set(m.personId, r.ev.overall); }
    const lv = { red: 0, orange: 0, yellow: 0 };
    for (const l of last.values()) if (l in lv) lv[l]++;
    save(); render();
    $('#meas-preview').innerHTML = `<p class="small">已匯入 <strong>${add.length}</strong> 筆（重複略過 ${dup}、時間無法解析 ${bad}、找不到民眾 ${unmatched.size} 人）。本次最新判定異常：紅 ${lv.red}、橙 ${lv.orange}、黃 ${lv.yellow} 人。</p>${unmatched.size ? `<p class="small muted">找不到的識別值：${[...unmatched].slice(0, 20).map((x) => esc(E.maskId(x))).join('、')}${unmatched.size > 20 ? '…' : ''}</p>` : ''}`;
  }

  // ───────────── 規則與設定 ─────────────
  function rulesView() {
    const s = sla(), t8 = t888();
    const T = [
      ['血壓（mmHg）', '收縮壓 <130 且舒張壓 <80', '收縮壓 130–139 或舒張壓 80–89', '≥140 或 ≥90', '≥180 或 ≥110；或 ≥160/100 並有胸痛、劇烈頭痛、言語不清、肢體無力'],
      ['脈搏與心律（次/分）', '60–100', '50–59（無症狀）', '<50 或 >100（休息 5–10 分鐘後重測仍異常）；設備心律旗標 ARR／疑似房顫', '<40 或 >120 持續；或合併胸痛、暈厥、呼吸困難'],
      ['血氧（%）', '95–100', '91–94', '91–94 且重測 2 次仍低；或低於慢性肺病者個人基線', '≤90（重測仍低）；或合併呼吸困難、嘴唇發紺'],
      ['體溫（℃）', '36.0–37.0', '35.0–35.9 或 37.1–37.9', '≥38 且 <39；<35（保暖 30 分鐘後重測仍 <35）', '≥39；或發燒／低體溫合併意識改變、呼吸困難、抽搐'],
      ['血糖（mg/dL）', '空腹 <100；飯後 <140', '空腹 100–125；飯後 140–199', '空腹 ≥126；飯後 ≥200', '任何 ≥300；或合併多尿、口渴、噁心嘔吐、意識改變；或用藥者 <70 並有症狀'],
      ['血脂（mg/dL）', 'LDL <130；TG <150', 'LDL 130–159；或 TG 150–199', 'LDL 160–189；或 TG 200–499', 'LDL ≥190；或 TG ≥500；或急性心血管症狀（1 週內，有症狀當日）'],
      ['代謝症候群（5 項）', '0 項', '1–2 項', '≥3 項', '（無紅層）'],
      ['BMI・腰圍・體脂', 'BMI 18.5–23.9；腰圍達標；體脂男 10–20%、女 20–30%', 'BMI <18.5 或 24–26.9；腰圍男 ≥90、女 ≥80；體脂男 20–25%、女 30–35%', 'BMI ≥27；體脂男 >25%、女 >35%；或男 <10%、女 <20%', '（無紅層）'],
    ];
    const num = (path, v) => `<input type="number" min="0" style="width:64px" data-sla="${path}" value="${v ?? ''}">`;
    return `<h1>分層規則與設定</h1>
    <div class="card"><h2>四層級定義</h2><div class="tbl-wrap"><table><thead><tr><th>層級</th><th>意義</th><th>處理</th><th>追蹤方式</th></tr></thead><tbody>
      <tr><td>${lv('green')}</td><td>正常或已達標</td><td>不需派案</td><td>回饋與例行量測</td></tr>
      <tr><td>${lv('yellow')}</td><td>偏高或邊緣，尚無轉介必要</td><td>健康處方</td><td>6 個月複測</td></tr>
      <tr><td>${lv('orange')}</td><td>異常，需醫師評估</td><td>4 週內轉介就醫，並確認有就醫、健康處方</td><td>3 個月複測</td></tr>
      <tr><td>${lv('red')}</td><td>可能危及安全</td><td>當日處理，24 小時內確認就醫、健康處方</td><td>就醫後 2 週電訪確認</td></tr>
    </tbody></table></div><p class="small muted">整體層級取各項目中最高者；只要有異常就要完成健康處方。依據：《彰基社區智慧健康站量測異常分層管理與閉環追蹤建議 v1》。</p></div>
    <div class="card" style="margin-top:12px"><h2>各項目閾值</h2><div class="tbl-wrap"><table class="small"><thead><tr><th>項目</th><th>${lv('green')}</th><th>${lv('yellow')}</th><th>${lv('orange')}</th><th>${lv('red')}</th></tr></thead><tbody>${T.map((r) => `<tr>${r.map((c, i) => (i ? `<td>${esc(c)}</td>` : `<td><strong>${esc(c)}</strong></td>`)).join('')}</tr>`).join('')}</tbody></table></div></div>
    <div class="card" style="margin-top:12px"><h2>閉環流程</h2><p>偵測 → 待派案 → 已通知 → 已介入（含健康處方）→ 已確認（就醫或完成處方）→ 已複測（紅層為就醫後電訪）→ 判定（降級、維持、升級、結案）</p>
      <ul class="small"><li>每一筆個案都必須走到「判定」，不能停在「已通知」。</li><li>新量測高於目前層級時立即升級並重新派案；達標後連續 2 次維持才降級。</li><li>慢性病不直接結案；結案原因限於：${E.CLOSE_REASONS.join('、')}（轉由醫師管理需登記回診日期）。</li></ul></div>
    <div class="card" style="margin-top:12px"><h2>系統解讀（請臨床委員會確認）</h2><ol class="small">${E.ASSUMPTIONS.map((a) => `<li>${esc(a)}</li>`).join('')}</ol></div>
    <div class="card" style="margin-top:12px"><h2>健康888 參數</h2>
      <p class="small muted">國健署目標為 8 成入網、8 成接受生活型態諮詢、8 成控制良好；「控制良好」的社區端數值未見公開明文，以下為預設，請依院內共識調整。</p>
      <div class="form-grid">
        <label class="f">控制：收縮壓 &lt;<input type="number" data-t888="bp.sbp" value="${t8.bp.sbp}"></label>
        <label class="f">控制：舒張壓 &lt;<input type="number" data-t888="bp.dbp" value="${t8.bp.dbp}"></label>
        <label class="f">控制：HbA1c &lt;（%）<input type="number" step="0.1" data-t888="hba1c" value="${t8.hba1c}"></label>
        <label class="f">無 HbA1c：空腹血糖 &lt;<input type="number" data-t888="fpg" value="${t8.fpg}"></label>
        <label class="f">無 HbA1c：飯後／隨機 &lt;<input type="number" data-t888="nonFasting" value="${t8.nonFasting}"></label>
        <label class="f">控制：LDL &lt;<input type="number" data-t888="ldl" value="${t8.ldl}"></label>
        <label class="f">找出：異常場次數 ≥<input type="number" min="1" data-t888="minAbnormalSessions" value="${t8.minAbnormalSessions}"></label>
        <label class="f">觀察期（天）<input type="number" data-t888="lookbackDays" value="${t8.lookbackDays}"></label>
        <label class="f">控制判定需最近（天）內有量測<input type="number" data-t888="recentDays" value="${t8.recentDays}"></label>
      </div></div>
    <div class="card" style="margin-top:12px"><h2>處理時限設定（天）</h2>
      <div class="tbl-wrap"><table class="small"><thead><tr><th>節點</th><th>紅</th><th>橙</th><th>黃</th></tr></thead><tbody>
        <tr><td>派案並通知</td><td>${num('notify.red', s.notify.red)}</td><td>${num('notify.orange', s.notify.orange)}</td><td>${num('notify.yellow', s.notify.yellow)}</td></tr>
        <tr><td>介入＋健康處方</td><td>${num('intervene.red', s.intervene.red)}</td><td>${num('intervene.orange', s.intervene.orange)}</td><td>${num('intervene.yellow', s.intervene.yellow)}</td></tr>
        <tr><td>確認就醫／處方</td><td>${num('confirm.red', s.confirm.red)}</td><td>${num('confirm.orange', s.confirm.orange)}</td><td>${num('confirm.yellow', s.confirm.yellow)}</td></tr>
        <tr><td>複測</td><td>就醫後 ${num('phoneAfterVisit', s.phoneAfterVisit)} 天電訪</td><td>${num('retest.orange', s.retest.orange)}</td><td>${num('retest.yellow', s.retest.yellow)}</td></tr>
      </tbody></table></div>
      <p class="small muted">0 表示當日。修改只影響之後新開或重新判定的追蹤案。</p>
      <label class="f" style="margin-top:8px">個管師名單（以逗號分隔）<input type="text" id="nurses" value="${esc(nurses().join('，'))}"></label>
      <div class="row" style="margin-top:8px"><button class="btn primary" id="save-set" type="button">儲存設定</button><label class="row small"><input type="checkbox" id="mask" ${ui.mask ? 'checked' : ''}>畫面遮蔽姓名（簡報／螢幕分享用）</label></div>
    </div>`;
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
        download(`追蹤工作清單_${fmtD(nowISO()).replace(/\//g, '')}.csv`, csv([['層級', '姓名', '識別', '據點', '異常項目', '階段', '下一步', '期限', '逾期', '負責'], ...worklistRows().map(({ e, p, s }) => [E.LEVEL_LABEL[e.level], pname(p), pid2(p), p.site, e.items.map((i) => `${E.ITEM_LABEL[i.key]}(${E.LEVEL_LABEL[i.level]})`).join(' '), E.STATE_LABEL[e.state], s.label, s.due ? fmtD(s.due) : '', s.overdue ? '是' : '', e.assignee || ''])]), 'text/csv');
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
      const sn = $('#show-nid'); if (sn) sn.onclick = () => { $('#nid').textContent = p.nationalId; sn.remove(); };
      $$('[data-flag]').forEach((c) => (c.onchange = () => { p[c.dataset.flag] = c.checked; save(); render(); toast('已更新風險註記；下次量測起依新註記判定'); }));
      $$('[data-care]').forEach((c) => (c.onchange = () => { p.careNet = Object.assign({}, p.careNet, { [c.dataset.care]: c.checked }); save(); toast('已更新照護網註記'); }));
      $('#counsel-btn').onclick = () => dialog('記錄生活型態諮詢（健康888）', `<p class="small">適用於未經異常開案、但已完成飲食、運動、戒菸酒、用藥遵從等生活型態諮詢者（例如血壓已控制的入網個案）。</p><div class="chips">${E.DOMAINS_888.map((d) => `<label class="chip"><input type="checkbox" name="dom" value="${d.key}" checked style="margin-right:4px">${d.label}</label>`).join('')}</div><label class="f" style="margin-top:8px">諮詢內容<input type="text" name="note" placeholder="例：減鹽、每週運動 150 分鐘、規律服藥"></label>`,
        [{ label: '取消' }, { label: '儲存', primary: true, onClick: () => { const fd = new FormData($('#dlg-form')); const doms = fd.getAll('dom'); if (!doms.length) throw new Error('請至少選一項'); p.counsel = (p.counsel || []).concat({ at: nowISO(), by: ui.user, domains: doms, note: fd.get('note') || '' }); save(); render(); toast('已記錄生活型態諮詢'); } }]);
      const sb = $('#spo2-base'); if (sb) sb.onchange = () => { p.spo2Baseline = sb.value === '' ? null : +sb.value; save(); };
      $$('[data-print-rx]').forEach((b) => (b.onclick = (e) => { e.preventDefault(); const ta = $('#ep-form textarea[name=rx]'); printRx(p, ta ? Object.assign({}, ep, { rx: { text: ta.value } }) : ep); }));
      if (!ep) return;
      $$('[data-act]').forEach((b) => (b.onclick = () => {
        const fd = new FormData($('#ep-form')); const payload = Object.fromEntries(fd.entries());
        try {
          E.act(db, ep.id, b.dataset.act, payload, nowISO(), ui.user, sla());
          save(); render(); toast(`已記錄：${E.STATE_LABEL[db.episodes.find((x) => x.id === ep.id).state]}`);
        } catch (err) { toast(err.message); }
      }));
      $('#close-btn').onclick = () => {
        const reason = $('#close-reason').value;
        if (!confirm(`確定以「${reason}」結案？`)) return;
        try { E.act(db, ep.id, 'close', { reason, note: $('#close-note').value }, nowISO(), ui.user, sla()); save(); render(); toast('已結案'); } catch (err) { toast(err.message); }
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
          for (const [k, t] of [['redSameDay', '紅層當日處理率'], ['orangeConfirm', '橙層就醫確認率'], ['retest', '複測完成率'], ['improve', '降級(達標)率']]) rows.push([s, w || '全部', t, q[k].k, q[k].n, q[k].p === null ? '' : q[k].p.toFixed(4), q[k].lo === null ? '' : q[k].lo.toFixed(4), q[k].hi === null ? '' : q[k].hi.toFixed(4)]);
          rows.push([s, w || '全部', '未閉環逾期案數', q.unclosed, q.openCount, '', '', '']);
        }
        download('品質指標.csv', csv(rows), 'text/csv');
      };
    },
    import() {
      $('#roster-file').onchange = (e) => { const f = e.target.files[0]; if (f) readWorkbook(f).then(previewRoster).then(() => {
        $('#roster-go').onclick = () => { if (db.demo && !confirm('匯入正式名冊會清除示範資料，確定？')) return; commitRoster(); };
        $('#roster-issues').onclick = () => download('名冊問題清單.csv', csv([['工作表', '列', '姓名', '問題'], ...pendingRoster.issues.map((i) => [i.sheet, i.row, i.name, i.issues.join('；')])]), 'text/csv');
      }).catch((err) => toast(err.message)); };
      $('#meas-file').onchange = (e) => { const f = e.target.files[0]; if (!f) return; readWorkbook(f).then((wb) => importMeasurements(XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: true, defval: '' }))).catch((err) => toast(err.message)); };
      $('#tpl').onclick = () => download('量測匯入範本.csv', csv([M_COLS.map((c) => c[0]), [db.persons[0] ? (db.persons[0].demoId || '請填身分證號') : 'A123456789', '2026-10-30 09:15', 138, 86, 78, '', 96, 36.5, 112, '空腹', 135, 160, 48, '', '', 62.5, 86, 31.2, '']]), 'text/csv');
      $('#bk-exp').onclick = () => download(`健康站追蹤備份_${fmtD(nowISO()).replace(/\//g, '')}.json`, JSON.stringify(db), 'application/json');
      $('#bk-imp').onchange = (e) => { const f = e.target.files[0]; if (!f) return; f.text().then((t) => { const d = JSON.parse(t); if (!d.persons || !d.episodes) throw new Error('不是有效的備份檔'); if (!confirm('以備份覆蓋目前資料？')) return; db = d; save(); render(); toast('已還原備份'); }).catch((err) => toast(err.message)); };
      $('#demo-load').onclick = () => { if (!confirm('以示範資料覆蓋目前所有資料？')) return; db = window.Demo.generate(new Date()); save(); render(); };
      $('#wipe').onclick = () => { if (!confirm('清除全部資料（無法復原）？建議先匯出備份。')) return; db = { persons: [], measurements: [], episodes: [], settings: db.settings }; save(); render(); };
    },
    888() {
      const set = (k, v) => { ui.g888 = Object.assign({ d: 'htn', gap: 'notJoined' }, ui.g888, { [k]: v }); render(); };
      $('#g-d').onchange = (e) => set('d', e.target.value);
      $('#g-gap').onchange = (e) => set('gap', e.target.value);
      $('#g-export').onclick = () => {
        const c = E.cascade888(db, new Date(), t888(), inSite);
        const rows = [['疾病別', '缺口', '姓名', '識別', '據點', '管理層級', '建議動作']];
        for (const d of E.DOMAINS_888) for (const [k, [t, a]] of Object.entries(GAPS)) for (const id of c.domains[d.key].ids[k]) { const p = IX.byPerson.get(id); rows.push([d.label, t, pname(p), pid2(p), p.site, E.LEVEL_LABEL[IX.mgmt(id)] || '未量測', a]); }
        download('健康888缺口名單.csv', csv(rows), 'text/csv');
      };
    },
    rules() {
      $('#save-set').onclick = () => {
        const s = JSON.parse(JSON.stringify(sla()));
        $$('[data-sla]').forEach((i) => { const [a, b] = i.dataset.sla.split('.'); const v = i.value === '' ? null : Math.max(0, +i.value); if (b) s[a][b] = v; else s[a] = v; });
        const t8 = JSON.parse(JSON.stringify(t888()));
        $$('[data-t888]').forEach((i) => { if (i.value === '') return; const [a, b] = i.dataset.t888.split('.'); if (b) t8[a][b] = +i.value; else t8[a] = +i.value; });
        db.settings = Object.assign({}, db.settings, { t888: t8, sla: s, nurses: $('#nurses').value.split(/[,，、]/).map((x) => x.trim()).filter(Boolean) });
        save(); render(); toast('設定已儲存');
      };
      $('#mask').onchange = (e) => { ui.mask = e.target.checked; render(); };
    },
  };

  function liveSearch(sel, set) {
    const el = $(sel);
    el.oninput = () => { set(el.value); clearTimeout(liveSearch.h); liveSearch.h = setTimeout(() => { const pos = el.selectionStart; render(); const n = $(sel); n.focus(); n.setSelectionRange(pos, pos); }, 250); };
  }

  document.addEventListener('click', (e) => {
    const tr = e.target.closest('tr[data-href]');
    if (tr && !e.target.closest('a,button,input,select')) location.hash = tr.dataset.href;
  });
  $('#site-filter').onchange = (e) => { ui.site = e.target.value; render(); };
  $('#user-sel').onchange = (e) => { ui.user = e.target.value; saveUI(); };
  $('#theme-btn').onclick = () => {
    const cur = document.documentElement.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    document.documentElement.dataset.theme = cur === 'dark' ? 'light' : 'dark'; ui.theme = document.documentElement.dataset.theme; saveUI(); themeLabel();
  };
  if (ui.theme) document.documentElement.dataset.theme = ui.theme;
  function themeLabel() { const d = (document.documentElement.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')) === 'dark'; $('#theme-btn').textContent = d ? '淺色' : '深色'; }
  themeLabel();
  window.addEventListener('hashchange', () => { window.scrollTo(0, 0); render(); });

  db = load();
  if (!db) { db = window.Demo.generate(new Date()); save(); }
  db.settings = db.settings || { nurses: ['個管師'] };
  render();
})();
