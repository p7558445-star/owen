// 執行：node health-tracking/tests/engine.test.js
const assert = require('assert');
const E = require('../engine.js');

let pass = 0;
function t(name, fn) {
  try { fn(); pass++; } catch (e) { console.error('✗', name, '\n ', e.message); process.exitCode = 1; }
}
const P = { sex: 'M', age: 70, heightCm: 165 };
const F = { sex: 'F', age: 50, heightCm: 155 };
const at = (min = 0) => new Date(Date.UTC(2026, 9, 1, 2, min)).toISOString();
const lv = (readings, person = P) => E.evaluateSession(person, readings.map((r, i) => Object.assign({ id: 'r' + i, at: at(i * 5) }, r)));
const item = (k, readings, person) => lv(readings, person).items[k];

// ── 血壓（院內修訂版：綠 <140/90；黃 140–159／90–99；橙 160–179／100–109；紅 ≥180／≥110）
t('BP green 139/89', () => assert.equal(item('bp', [{ sbp: 139, dbp: 89 }]).level, 'green'));
t('BP yellow by SBP 140', () => assert.equal(item('bp', [{ sbp: 140, dbp: 75 }]).level, 'yellow'));
t('BP yellow by DBP 90', () => assert.equal(item('bp', [{ sbp: 120, dbp: 90 }]).level, 'yellow'));
t('BP yellow upper 159/99', () => assert.equal(item('bp', [{ sbp: 159, dbp: 99 }]).level, 'yellow'));
t('BP orange by SBP 160', () => assert.equal(item('bp', [{ sbp: 160, dbp: 80 }]).level, 'orange'));
t('BP orange by DBP 100', () => assert.equal(item('bp', [{ sbp: 130, dbp: 100 }]).level, 'orange'));
t('BP orange upper 179/109', () => assert.equal(item('bp', [{ sbp: 179, dbp: 109 }]).level, 'orange'));
t('BP red 180 provisional on single reading', () => { const r = item('bp', [{ sbp: 180, dbp: 95 }]); assert.equal(r.level, 'red'); assert.ok(r.provisional); });
t('BP red by DBP 110', () => assert.equal(item('bp', [{ sbp: 165, dbp: 110 }]).level, 'red'));
t('BP red confirmed after retest', () => { const r = item('bp', [{ sbp: 185, dbp: 95 }, { sbp: 181, dbp: 96 }]); assert.equal(r.level, 'red'); assert.ok(!r.provisional); });
t('BP retest drops to orange', () => assert.equal(item('bp', [{ sbp: 185, dbp: 95 }, { sbp: 165, dbp: 92 }]).level, 'orange'));
t('BP 165/95 + chest pain = orange, flagged emergency', () => { const r = item('bp', [{ sbp: 165, dbp: 95, symptoms: ['chest_pain'] }]); assert.equal(r.level, 'orange'); assert.ok(r.emergency); });
t('BP 185/95 + chest pain = red emergency, not provisional', () => { const r = item('bp', [{ sbp: 185, dbp: 95, symptoms: ['chest_pain'] }]); assert.equal(r.level, 'red'); assert.ok(r.emergency); assert.ok(!r.provisional); });

// ── 脈搏
t('pulse green', () => assert.equal(item('pulse', [{ pulse: 72 }]).level, 'green'));
t('pulse 55 asymptomatic yellow', () => assert.equal(item('pulse', [{ pulse: 55 }]).level, 'yellow'));
t('pulse 105 orange provisional', () => { const r = item('pulse', [{ pulse: 105 }]); assert.equal(r.level, 'orange'); assert.ok(r.provisional); });
t('pulse ARR orange', () => assert.equal(item('pulse', [{ pulse: 80, arr: true }]).level, 'orange'));
t('pulse 125 red', () => assert.equal(item('pulse', [{ pulse: 125 }]).level, 'red'));
t('pulse 105 + syncope red', () => assert.equal(item('pulse', [{ pulse: 105, symptoms: ['syncope'] }]).level, 'red'));

// ── 血氧
t('SpO2 96 green', () => assert.equal(item('spo2', [{ spo2: 96 }]).level, 'green'));
t('SpO2 93 single yellow', () => assert.equal(item('spo2', [{ spo2: 93 }]).level, 'yellow'));
t('SpO2 93 x3 orange', () => assert.equal(item('spo2', [{ spo2: 93 }, { spo2: 92 }, { spo2: 94 }]).level, 'orange'));
t('SpO2 93 then 96 green', () => assert.equal(item('spo2', [{ spo2: 93 }, { spo2: 96 }]).level, 'green'));
t('SpO2 90 red', () => assert.equal(item('spo2', [{ spo2: 90 }]).level, 'red'));
t('SpO2 below COPD baseline orange', () => assert.equal(item('spo2', [{ spo2: 92 }], Object.assign({ copd: true, spo2Baseline: 93 }, P)).level, 'orange'));

// ── 體溫
t('temp 36.5 green', () => assert.equal(item('temp', [{ temp: 36.5 }]).level, 'green'));
t('temp 37.5 yellow', () => assert.equal(item('temp', [{ temp: 37.5 }]).level, 'yellow'));
t('temp 38.2 orange, elderly same day', () => { const r = item('temp', [{ temp: 38.2 }]); assert.equal(r.level, 'orange'); assert.equal(r.timing.confirmDays, 0); });
t('temp 38.2 orange, young 48h', () => assert.equal(item('temp', [{ temp: 38.2 }], F).timing.confirmDays, 2));
t('temp 34.6 orange', () => assert.equal(item('temp', [{ temp: 34.6 }]).level, 'orange'));
t('temp 39 red', () => assert.equal(item('temp', [{ temp: 39.0 }]).level, 'red'));
t('temp 37.6 + seizure red', () => assert.equal(item('temp', [{ temp: 37.6, symptoms: ['seizure'] }]).level, 'red'));

// ── 血糖
t('FPG 99 green', () => assert.equal(item('glucose', [{ glucose: 99, glucoseType: '空腹' }]).level, 'green'));
t('FPG 110 yellow', () => assert.equal(item('glucose', [{ glucose: 110, glucoseType: '空腹' }]).level, 'yellow'));
t('FPG 126 orange', () => assert.equal(item('glucose', [{ glucose: 126, glucoseType: '空腹' }]).level, 'orange'));
t('PC 180 yellow', () => assert.equal(item('glucose', [{ glucose: 180, glucoseType: '飯後' }]).level, 'yellow'));
t('PC 200 orange', () => assert.equal(item('glucose', [{ glucose: 200, glucoseType: '飯後' }]).level, 'orange'));
t('any 300 red', () => assert.equal(item('glucose', [{ glucose: 300, glucoseType: '空腹' }]).level, 'red'));
t('on-med hypo with symptoms red', () => assert.equal(item('glucose', [{ glucose: 62, symptoms: ['hypo_sx'] }], Object.assign({ medDM: true }, P)).level, 'red'));
t('hypo w/o symptoms orange (assumption)', () => assert.equal(item('glucose', [{ glucose: 65 }]).level, 'orange'));

// ── 血脂
t('lipid green', () => assert.equal(item('lipid', [{ ldl: 120, tg: 140 }]).level, 'green'));
t('lipid TG 160 yellow', () => assert.equal(item('lipid', [{ ldl: 120, tg: 160 }]).level, 'yellow'));
t('lipid LDL 170 orange', () => assert.equal(item('lipid', [{ ldl: 170 }]).level, 'orange'));
t('lipid LDL 190 red, 7 days', () => { const r = item('lipid', [{ ldl: 190 }]); assert.equal(r.level, 'red'); assert.equal(r.timing.confirmDays, 7); });
t('lipid TC only = na', () => assert.equal(item('lipid', [{ tc: 230 }]).level, 'na'));

// ── 代謝症候群
t('MetS 3 items orange', () => assert.equal(item('mets', [{ waist: 92, sbp: 132, dbp: 80, tg: 160, hdl: 45, glucose: 95, glucoseType: '空腹' }]).level, 'orange'));
t('MetS 0 with all data green', () => assert.equal(item('mets', [{ waist: 85, sbp: 120, dbp: 70, tg: 100, hdl: 55, glucose: 90, glucoseType: '空腹' }]).level, 'green'));
t('MetS 0 incomplete = na', () => assert.equal(item('mets', [{ waist: 85, sbp: 120, dbp: 70 }]).level, 'na'));
t('MetS uses 130/85 not 130/80', () => assert.equal(item('mets', [{ waist: 92, sbp: 125, dbp: 82, tg: 160, hdl: 55, glucose: 90, glucoseType: '空腹' }]).value.startsWith('2'), true));

// ── 體位
t('BMI 22 green', () => assert.equal(item('body', [{ weight: 60 }]).level, 'green'));
t('BMI 25 yellow', () => assert.equal(item('body', [{ weight: 68 }]).level, 'yellow'));
t('BMI 28 orange', () => assert.equal(item('body', [{ weight: 76 }]).level, 'orange'));
t('female body fat 36 orange', () => assert.equal(item('body', [{ weight: 52, bodyFat: 36 }], F).level, 'orange'));
t('male body fat 9 orange', () => assert.equal(item('body', [{ weight: 60, bodyFat: 9 }]).level, 'orange'));

// ── 生活型態項目不計入整體層級
t('body excluded from overall', () => {
  const ev = lv([{ sbp: 120, dbp: 70, weight: 80 }]);
  assert.equal(ev.items.body.level, 'orange'); assert.equal(ev.overall, 'green'); assert.equal(ev.lifestyle, 'orange');
});
t('lifestyle-only abnormal opens no episode', () => {
  const db = { persons: [{ id: 'p1', name: 'x', sex: 'M', birth: '1950-01-01', heightCm: 165 }], measurements: [{ id: 'a', personId: 'p1', at: '2026-01-01T01:00:00Z', sbp: 120, dbp: 70, weight: 80 }], episodes: [] };
  const r = E.ingest(db, 'p1', '2026-01-01T01:00:00Z');
  assert.equal(r.episode, undefined); assert.equal(db.episodes.length, 0);
  assert.ok(E.lifestylePrescription(db.persons[0], r.ev).includes('BMI'));
});
t('lifestyle items ride along in the prescription of a BP episode', () => {
  const db = { persons: [{ id: 'p1', name: 'x', sex: 'M', birth: '1950-01-01', heightCm: 165 }], measurements: [{ id: 'a', personId: 'p1', at: '2026-01-01T01:00:00Z', sbp: 165, dbp: 80, weight: 80 }], episodes: [] };
  const { episode: ep } = E.ingest(db, 'p1', '2026-01-01T01:00:00Z');
  assert.equal(ep.level, 'orange'); assert.ok(E.prescription(db.persons[0], ep).includes('生活型態追蹤'));
  assert.equal(new Date(ep.due.confirm) - new Date('2026-01-01T01:00:00Z') > 20 * 864e5, true, 'lifestyle timing does not shorten BP deadlines');
});

t('MetS still counts toward overall and opens an episode with referral', () => {
  const ev = lv([{ waist: 92, sbp: 132, dbp: 80, tg: 160, hdl: 45, glucose: 95, glucoseType: '空腹' }]);
  assert.equal(ev.items.mets.level, 'orange'); assert.ok(!ev.items.mets.lifestyle); assert.equal(ev.overall, 'orange');
  assert.ok(ev.items.mets.actions.some((a) => a.includes('轉介')));
});

// ── 整體層級取最高
t('overall = max', () => assert.equal(lv([{ sbp: 145, dbp: 70, glucose: 130, glucoseType: '空腹', spo2: 97 }]).overall, 'orange'));

// ── 閉環流程
function db0() { return { persons: [{ id: 'p1', name: '測試', sex: 'M', birth: '1950-01-01', heightCm: 165 }], measurements: [], episodes: [] }; }
const add = (db, at, v) => { db.measurements.push(Object.assign({ id: 'm' + db.measurements.length, personId: 'p1', at }, v)); return E.ingest(db, 'p1', at); };
const D = (d, h = 9) => new Date(2026, 0, d, h).toISOString();

const loop = (db, ep, at, visit) => { E.act(db, ep.id, 'notify', {}, at); E.act(db, ep.id, 'intervene', { rx: 'x' }, at); E.act(db, ep.id, 'confirm', visit ? { visitDate: visit } : {}, at); };
const DT = (y, m, d) => new Date(y, m - 1, d, 9).toISOString();

t('one round: detect -> notify -> intervene -> confirm', () => {
  const db = db0();
  const { episode: ep } = add(db, D(1), { sbp: 165, dbp: 85 });
  assert.equal(ep.level, 'orange'); assert.equal(ep.state, 'detected');
  assert.throws(() => E.act(db, ep.id, 'intervene', { rx: 'x' }, D(2)), /通知/);
  E.act(db, ep.id, 'notify', { method: '電話', assignee: '社區護理師 甲' }, D(2), '社區護理師 甲');
  assert.throws(() => E.act(db, ep.id, 'intervene', {}, D(2)), /健康處方/);
  E.act(db, ep.id, 'intervene', { rx: E.prescription(db.persons[0], ep) }, D(3));
  assert.throws(() => E.act(db, ep.id, 'confirm', {}, D(10)), /就醫日期/);
  E.act(db, ep.id, 'confirm', { visitDate: '2026-01-15', facility: '彰基' }, D(16));
  assert.equal(ep.state, 'confirmed');
  assert.equal(ep.nextDue.slice(0, 10), new Date(2026, 3, 1, 23, 59).toISOString().slice(0, 10), 'orange re-check 90 days from detection');
  assert.throws(() => E.act(db, ep.id, 'notify', {}, D(17)), /本輪已完成/);
});

t('readings before the re-check date do not open a new round', () => {
  const db = db0();
  const { episode: ep } = add(db, D(1), { sbp: 165, dbp: 85 });
  loop(db, ep, D(2), '2026-01-03');
  add(db, D(10), { sbp: 166, dbp: 85 });
  add(db, D(20), { sbp: 150, dbp: 85 });
  assert.equal(db.episodes.length, 1);
});

t('higher reading after confirmation opens a new round immediately', () => {
  const db = db0();
  const { episode: ep } = add(db, D(1), { sbp: 145, dbp: 70 });
  loop(db, ep, D(2));
  const { episode: n } = add(db, D(10), { sbp: 182, dbp: 100 });
  assert.equal(db.episodes.length, 2); assert.equal(n.level, 'red'); assert.equal(n.state, 'detected'); assert.equal(n.cycle, 2);
  assert.equal(ep.recheck.kind, 'upgrade');
});

t('after re-check date: still abnormal opens next round; downgrade needs 2 consecutive lower', () => {
  const db = db0();
  const { episode: ep } = add(db, DT(2026, 1, 1), { sbp: 165, dbp: 85 });
  loop(db, ep, DT(2026, 1, 2), '2026-01-03');
  add(db, DT(2026, 3, 20), { sbp: 120, dbp: 70 });        // 複測日前：綠
  const { episode: n } = add(db, DT(2026, 4, 5), { sbp: 145, dbp: 80 }); // 複測日後：黃；最近 2 次 = 綠、黃 → 黃
  assert.equal(db.episodes.length, 2); assert.equal(n.level, 'yellow'); assert.equal(ep.recheck.level, 'yellow');
  assert.ok(n.log[0].text.includes('降為黃層'));
});

t('after re-check date: one lower reading keeps the level (no single-reading downgrade)', () => {
  const db = db0();
  const { episode: ep } = add(db, DT(2026, 1, 1), { sbp: 165, dbp: 85 });
  loop(db, ep, DT(2026, 1, 2), '2026-01-03');
  add(db, DT(2026, 3, 20), { sbp: 168, dbp: 85 });        // 複測日前：仍橙
  const { episode: n } = add(db, DT(2026, 4, 5), { sbp: 150, dbp: 80 }); // 複測日後：黃；最近 2 次 = 橙、黃 → 橙
  assert.equal(n.level, 'orange');
});

t('after re-check date: two green readings return to routine without a new round', () => {
  const db = db0();
  const { episode: ep } = add(db, DT(2026, 1, 1), { sbp: 145, dbp: 80 });
  loop(db, ep, DT(2026, 1, 2));
  add(db, DT(2026, 6, 25), { sbp: 120, dbp: 70 });
  add(db, DT(2026, 7, 5), { sbp: 122, dbp: 72 });
  assert.equal(db.episodes.length, 1); assert.equal(ep.recheck.level, 'green'); assert.equal(ep.nextDue, null);
});

t('upgrade during an open round goes back to detect', () => {
  const db = db0();
  const { episode: ep } = add(db, D(1), { sbp: 145, dbp: 70 });
  E.act(db, ep.id, 'notify', {}, D(2));
  add(db, D(5), { sbp: 182, dbp: 100 });
  assert.equal(ep.level, 'red'); assert.equal(ep.state, 'detected'); assert.equal(ep.notify, undefined);
});

t('same-session retest normal auto-closes', () => {
  const db = db0();
  const { episode: ep } = add(db, D(1, 9), { temp: 37.4 });
  assert.equal(ep.level, 'yellow');
  add(db, new Date(new Date(D(1, 9)).getTime() + 30 * 60000).toISOString(), { temp: 36.8 });
  assert.equal(ep.state, 'closed'); assert.equal(ep.close.reason, '同場次重測正常');
});

t('red: re-check 2 weeks after visit, physician close needs follow-up date', () => {
  const db = db0();
  const { episode: ep } = add(db, D(1), { glucose: 320, glucoseType: '隨機' });
  assert.equal(ep.level, 'red');
  assert.ok(new Date(ep.due.confirm) - new Date(D(1)) < 2 * 86400000);
  loop(db, ep, D(1, 11), '2026-01-01');
  assert.equal(ep.nextDue.slice(0, 10), '2026-01-15');
  assert.equal(E.nextStep(ep, D(2)).label, '就醫後 2 週電訪並請回站複測');
  const q = E.quality(db, D(20), null);
  assert.equal(q.redSameDay.k, 1); assert.equal(q.redSameDay.n, 1);
  const db2 = db0(); const { episode: e2 } = add(db2, D(1), { sbp: 185, dbp: 100 });
  assert.throws(() => E.act(db2, e2.id, 'close', { reason: '已轉由醫師持續管理' }, D(2)), /回診日期/);
  E.act(db2, e2.id, 'close', { reason: '已轉由醫師持續管理', followupDate: '2026-02-01' }, D(2));
  assert.equal(e2.state, 'closed');
});

t('overdue step and re-check reminders count as unclosed', () => {
  const db = db0();
  const { episode: ep } = add(db, D(1), { sbp: 165, dbp: 85 });
  E.act(db, ep.id, 'notify', {}, D(2));
  assert.ok(E.nextStep(ep, D(30)).overdue);
  assert.equal(E.quality(db, D(30), null).unclosed, 1);
  const db2 = db0(); const { episode: e2 } = add(db2, DT(2026, 1, 1), { sbp: 145, dbp: 80 }); loop(db2, e2, DT(2026, 1, 2));
  assert.equal(E.recheckOverdue(db2, DT(2026, 8, 1)).length, 1);
  const q = E.quality(db2, DT(2026, 8, 1), null);
  assert.equal(q.unclosed, 1); assert.equal(q.retest.n, 1); assert.equal(q.retest.k, 0);
});

// ── 健康 888（只看三高）
t('888 find: registered vs measured a 3-high item at least once', () => {
  const db = db0(); db.persons.push({ id: 'p2', name: 'B', sex: 'F', birth: '1950-01-01' });
  add(db, D(1), { sbp: 120, dbp: 70 });
  db.measurements.push({ id: 'x', personId: 'p2', at: D(1), spo2: 97, temp: 36.5 }); // 非三高項目
  const c = E.cascade888(db, D(2));
  assert.equal(c.find.k, 1); assert.equal(c.find.n, 2); assert.deepEqual(c.ids.unscreened, ['p2']);
});
t('888 intervene: only 3-high abnormalities count', () => {
  const db = db0();
  add(db, D(1), { sbp: 120, dbp: 70, temp: 37.5, weight: 70 }); // 體溫黃、BMI 黃，但三高綠
  assert.equal(E.cascade888(db, D(2)).intervene.n, 0);
  const { episode: ep } = add(db, D(5), { sbp: 165, dbp: 85 });
  let c = E.cascade888(db, D(6));
  assert.equal(c.intervene.n, 1); assert.equal(c.intervene.k, 0);
  E.act(db, ep.id, 'notify', {}, D(7));
  assert.equal(E.cascade888(db, D(8)).intervene.k, 1);
  assert.equal(E.cascade888(db, D(8), { entry: 'intervened' }).intervene.k, 0);
});
t('888 improve: two consecutive sessions below peak, ignoring non-3-high items', () => {
  const db = db0();
  add(db, D(1), { sbp: 165, dbp: 85 });                 // 橙
  add(db, D(10), { sbp: 145, dbp: 75, weight: 76 });    // 三高黃（BMI 橙不影響）
  let c = E.cascade888(db, D(11));
  assert.equal(c.improve.n, 1); assert.equal(c.improve.k, 0, 'one lower session is not enough');
  assert.equal(E.cascade888(db, D(11), { downgrade: 1 }).improve.k, 1, 'single-session option');
  add(db, D(20), { sbp: 128, dbp: 76 });                // 綠
  assert.equal(E.cascade888(db, D(21)).improve.k, 1);
});
t('888 improve: rise resets the run and raises the peak', () => {
  const db = db0();
  add(db, D(1), { sbp: 165, dbp: 85 });   // 橙
  add(db, D(5), { sbp: 145, dbp: 75 });   // 黃
  add(db, D(10), { sbp: 182, dbp: 112 }); // 紅：新高峰
  add(db, D(15), { sbp: 165, dbp: 85 });  // 橙（低於紅）
  assert.equal(E.cascade888(db, D(16)).improve.k, 0);
  add(db, D(20), { sbp: 162, dbp: 85 });  // 橙（連續第 2 次低於紅）
  assert.equal(E.cascade888(db, D(21)).improve.k, 1);
});
t('888: same-session retest back to green is not counted as yellow', () => {
  const db = db0();
  add(db, D(1, 9), { glucose: 110, glucoseType: '空腹' });
  add(db, new Date(new Date(D(1, 9)).getTime() + 30 * 60000).toISOString(), { glucose: 95, glucoseType: '空腹' });
  assert.equal(E.cascade888(db, D(2)).intervene.n, 0);
});

// ── 健康處方（院內文件）
t('rx uses hospital library by measured value', () => {
  const db = { persons: [{ id: 'p1', name: 'x', sex: 'F', birth: '1950-01-01', heightCm: 155 }], measurements: [{ id: 'a', personId: 'p1', at: '2026-01-01T01:00:00Z', sbp: 145, dbp: 82, ldl: 165, tg: 120, hdl: 55 }], episodes: [] };
  const { episode: ep } = E.ingest(db, 'p1', '2026-01-01T01:00:00Z');
  const rx = E.prescription(db.persons[0], ep);
  assert.ok(rx.includes('【高血壓警示】')); assert.ok(rx.includes('【LDL高風險】')); assert.ok(!rx.includes('【三酸甘油脂正常】'));
  assert.ok(rx.includes('目前不需轉介就醫') === false && rx.includes('請於 4 週內就醫'));
  assert.equal((rx.match(/⚠ /g) || []).length, 3, 'disclaimers once');
});
t('rx falls back and says so when the document has no category', () => {
  const db = { persons: [{ id: 'p1', name: 'x', sex: 'M', birth: '1950-01-01', heightCm: 165 }], measurements: [{ id: 'a', personId: 'p1', at: '2026-01-01T01:00:00Z', temp: 37.5 }], episodes: [] };
  const { episode: ep } = E.ingest(db, 'p1', '2026-01-01T01:00:00Z');
  assert.ok(E.prescription(db.persons[0], ep).includes('院內衛教文件未涵蓋'));
});

t('BP prescription follows revised tiers, not the document 130/80 cut-off', () => {
  const mk = (sbp, dbp) => { const db = { persons: [{ id: 'p1', name: 'x', sex: 'F', birth: '1950-01-01' }], measurements: [{ id: 'a', personId: 'p1', at: '2026-01-01T01:00:00Z', sbp, dbp, glucose: 110, glucoseType: '空腹' }], episodes: [] }; const { episode: ep } = E.ingest(db, 'p1', '2026-01-01T01:00:00Z'); return E.prescription(db.persons[0], ep); };
  assert.ok(!mk(135, 85).includes('高血壓警示'), '135/85 is green: no BP section');
  const y = mk(145, 85); assert.ok(y.includes('【高血壓警示】') && !y.includes('心臟內科接受進一步評估'), 'yellow: no referral line');
  const o = mk(165, 85); assert.ok(o.includes('心臟內科接受進一步評估'), 'orange: referral line');
});

t('regradeOpen applies new rules to open episodes and logs it', () => {
  const db = db0();
  const { episode: ep } = add(db, D(1), { sbp: 165, dbp: 80 });
  ep.level = 'red'; ep.initialLevel = 'red'; // 模擬舊規則留下的層級
  const db2 = db0(); const { episode: e2 } = add(db2, D(1), { sbp: 143, dbp: 70 }); e2.level = 'orange';
  const db3 = db0(); const { episode: e3 } = add(db3, D(1), { sbp: 135, dbp: 70, glucose: 110, glucoseType: '空腹' }); e3.items = [{ key: 'bp', level: 'orange' }]; e3.level = 'orange';
  let ch = E.regradeOpen(db, D(2));
  assert.equal(ep.level, 'orange'); assert.ok(ep.log.some((l) => l.text.includes('規則更新'))); assert.equal(ch.length, 1);
  E.regradeOpen(db2, D(2)); assert.equal(e2.level, 'yellow', '143/70 is yellow under revised tiers');
  E.regradeOpen(db3, D(2)); assert.equal(e3.level, 'yellow'); assert.deepEqual(e3.items.map((i) => i.key), ['glucose', 'mets'], 'BP no longer abnormal; fasting 110 counts for glucose and one MetS criterion');
  const db4 = db0(); const { episode: e4 } = add(db4, D(1), { sbp: 125, dbp: 70 }); assert.equal(e4, undefined);
  const db5 = db0(); const { episode: e5 } = add(db5, D(1), { sbp: 145, dbp: 70 }); db5.measurements[0].sbp = 120; // 數值改變後已不異常
  E.regradeOpen(db5, D(2)); assert.equal(e5.state, 'closed'); assert.equal(e5.close.reason, E.REGRADE_CLOSE);
  assert.equal(db.rulesVersion, E.RULES_VERSION);
});
t('regradeOpen keeps the highest level since the case opened (no silent downgrade)', () => {
  const db = db0();
  const { episode: ep } = add(db, D(1), { sbp: 165, dbp: 80 }); // 橙
  add(db, D(5), { sbp: 120, dbp: 70 });                         // 之後一次正常
  E.regradeOpen(db, D(6));
  assert.equal(ep.level, 'orange', 'one normal reading must not downgrade via regrade');
  assert.equal(ep.state, 'detected');
});

// ── 資安：輸入驗證
t('validateMeasurement rejects implausible values', () => {
  assert.deepEqual(E.validateMeasurement({ at: '2026-01-01T00:00:00Z', sbp: 130, dbp: 80 }), []);
  assert.equal(E.validateMeasurement({ at: '2026-01-01T00:00:00Z', sbp: 1500, dbp: 80 }).length, 1);
  assert.ok(E.validateMeasurement({ at: '2026-01-01T00:00:00Z', sbp: 80, dbp: 90 })[0].includes('舒張壓'));
  assert.ok(E.validateMeasurement({ at: 'x', temp: 36 })[0].includes('時間'));
  assert.ok(E.validateMeasurement({ at: new Date(Date.now() + 864e5).toISOString(), temp: 36 })[0].includes('未來'));
});
t('validateBackup accepts generated data and rejects injection attempts', () => {
  const D2 = require('../demo.js'); const good = D2.generate(new Date(2026, 10, 3, 10));
  assert.ok(E.validateBackup(JSON.parse(JSON.stringify(good))));
  const evil = JSON.parse(JSON.stringify(good)); evil.persons[0].id = 'x" onmouseover="alert(1)';
  assert.throws(() => E.validateBackup(evil), /編號/);
  const evil2 = JSON.parse(JSON.stringify(good)); evil2.episodes[0].level = 'red);background:url(//x)';
  assert.throws(() => E.validateBackup(evil2), /層級/);
  const evil3 = JSON.parse(JSON.stringify(good)); evil3.measurements[0].sbp = '<img src=x>';
  assert.throws(() => E.validateBackup(evil3), /數值/);
  assert.throws(() => E.validateBackup({ persons: [] }), /缺少/);
});

// ── 量測匯入：院內九合一報表格式
t('import: device report layout (header on row 4, duplicate columns, 〇 flags, 餐別, min SpO2)', () => {
  const H = ['ID', '姓名', '小站編號', '生日', '性別', '量測時間', '更新時間', '時區', '收縮壓 (mmHg)', '舒張壓 (mmHg)', '脈壓差 (mmHg)', '脈搏 (BPM)', 'ARR', 'AFib', 'PC', 'IHB', '血氧 最高值 (％)', '血氧 最低值 (％)', '脈搏 最高值 (BPM)', '脈搏 最低值 (BPM)', 'ACT (LEVEL)', '血糖(mg/dL)', '餐別', '身高 (cm)', '體重 (kg)', '體重 (kg)', 'BMI', '體脂率 (%)', '總體脂量 (kg)', '肌肉率 (%)', '肌肉量 (kg)', '內臟脂肪 (LEVEL)', '骨骼肌率 (%)', '水份率 (%)', '基礎代謝率 (kcal/day)', '骨量 (kg)', '體溫 (℃)', '總膽固醇 (mg/dL)', '三酸甘油脂 (mg/dL)', '高密度脂蛋白 (mg/dL)', '低密度脂蛋白 (mg/dL)', '腰圍 (cm)'];
  const row = (id, t, o) => { const r = H.map(() => ''); const set = (h, v) => { r[H.indexOf(h)] = v; }; set('ID', id); set('姓名', '測試者'); set('生日', '1950-03-04'); set('性別', 'F'); set('量測時間', t); set('更新時間', '2026-10-30 10:00'); for (const [k, v] of Object.entries(o)) { if (k === '體重2') r[25] = v; else set(k, v); } return r; };
  const rows = [['彰化基督教醫院社區健康促進中心'], ['查詢時間：20260727-20261028'], ['個人資料', '', '', '', '', '', '', '', '血壓'], H,
    row('A123456789', new Date(2026, 9, 1, 9, 0), { '收縮壓 (mmHg)': 165, '舒張壓 (mmHg)': 88, '脈壓差 (mmHg)': 77, '脈搏 (BPM)': 72, 'ARR': '-', 'AFib': '〇', '血氧 最高值 (％)': 98, '血氧 最低值 (％)': 93, '血糖(mg/dL)': 110, '餐別': '空腹', '體重2': 60, 'BMI': 25.3, '體脂率 (%)': 31, '總體脂量 (kg)': 18.6, '體溫 (℃)': 36.5 }),
    row('B223456787', new Date(2026, 9, 2, 9, 0), { '收縮壓 (mmHg)': 120, '舒張壓 (mmHg)': 70, 'ARR': '〇', 'AFib': '-' })];
  const db = { persons: [{ id: 'p1', name: 'x', sex: 'F', birth: '1950-03-04', nationalId: 'A123456789', site: 'A' }], measurements: [], episodes: [] };
  const r = E.importMeasurementRows(db, rows);
  assert.equal(r.headerRow, 4); assert.equal(r.added, 1); assert.deepEqual(r.unmatched, ['B2****6787']);
  const m = db.measurements[0];
  assert.equal(m.sbp, 165); assert.equal(m.pulse, 72, 'not 脈壓差'); assert.equal(m.spo2, 93, 'lowest SpO2'); assert.equal(m.arr, true, 'AFib 〇');
  assert.equal(m.glucoseType, '空腹'); assert.equal(m.weight, 60, 'the filled 體重 column'); assert.equal(m.bmi, 25.3); assert.equal(m.bodyFat, 31, 'not 總體脂量'); assert.equal(m.temp, 36.5);
  assert.equal(new Date(m.at).getDate(), 1, '量測時間, not 更新時間');
  const ev = E.evaluateSession({ sex: 'F', age: 76 }, [m]);
  assert.equal(ev.items.body.bmi, 25.3, 'device BMI used when height unknown');
  const db2 = { persons: [], measurements: [], episodes: [] };
  const r2 = E.importMeasurementRows(db2, rows, null, null, { createMissing: true });
  const db3 = { persons: [], measurements: [], episodes: [] };
  const pre = E.importMeasurementRows(db3, rows, null, null, { createMissing: true, dryRun: true });
  assert.equal(pre.added, 2); assert.equal(pre.created, 2); assert.equal(pre.people, 2);
  assert.equal(db3.persons.length + db3.measurements.length + db3.episodes.length, 0, 'dry run writes nothing');
  assert.ok(pre.columnLabels.includes('量測時間') && pre.from && pre.to);
  assert.equal(r2.created, 2); assert.equal(db2.persons[1].sex, 'F'); assert.equal(db2.persons[0].birth, '1950-03-04'); assert.equal(db2.persons[0].site, '未分據點');
});

// ── 據點名稱對照與負責護理師
t('site aliases normalise roster names', () => {
  assert.equal(E.normalizeSite('秀水頭前'), '頭前社區'); assert.equal(E.normalizeSite('金齡關懷協會-37'), '永福教會松年團契');
  assert.equal(E.normalizeSite('鶴鳴社區'), '鶴鳴社區'); assert.equal(E.normalizeSite('X站', { X站: 'Y站' }), 'Y站');
  const db = { persons: [], measurements: [], episodes: [] };
  E.mergeRoster(db, [{ name: 'a', nationalId: 'A123456789', site: '金齡關懷協會-5' }, { name: 'b', nationalId: 'B223456787', site: '金齡關懷協會-6' }]);
  assert.deepEqual([...new Set(db.persons.map((p) => p.site))], ['永福教會松年團契'], 'one site, not one per person');
});
t('parse site-nurse sheet: header detection, placeholder 新工', () => {
  const r = E.parseSiteNurseSheet([['2027年社區護理師'], ['編號', '社區', '負責護理師'], [1, '頭前社區', '陳佩君'], [2, '中庄社區', '新工'], [3, '大同社區', ' 陳佩君 ']]);
  assert.equal(r.headerRow, 2); assert.equal(r.map['大同社區'], '陳佩君'); assert.equal(r.map['中庄社區'], null);
  assert.deepEqual(r.nurses, ['陳佩君']); assert.ok(r.issues[0].includes('中庄社區'));
});
t('new rounds auto-assigned to the site nurse; open rounds reassigned with a log entry', () => {
  const db = { persons: [{ id: 'p1', name: 'x', sex: 'M', birth: '1950-01-01', site: '頭前社區' }], measurements: [], episodes: [], settings: { siteNurse: { 頭前社區: '陳佩君' } } };
  db.measurements.push({ id: 'm1', personId: 'p1', at: '2026-12-01T01:00:00Z', sbp: 165, dbp: 85 });
  const { episode: ep } = E.ingest(db, 'p1', '2026-12-01T01:00:00Z');
  assert.equal(ep.assignee, '陳佩君');
  db.settings.siteNurse = { 頭前社區: '林芷彤' };
  assert.equal(E.applySiteNurses(db, '2027-01-01T00:00:00Z', '管理者', '2027 名單'), 1);
  assert.equal(ep.assignee, '林芷彤'); assert.ok(ep.log[ep.log.length - 1].text.includes('陳佩君 → 林芷彤'));
});

// ── 期限從匯入日起算
t('import: deadlines start at import time; detection date stays the measurement date', () => {
  const rows = [['識別值', '量測時間', '收縮壓', '舒張壓'], ['A123456789', '2026-07-01 09:00', 185, 100]];
  const db = { persons: [{ id: 'p1', name: 'x', sex: 'M', birth: '1950-01-01', nationalId: 'A123456789', site: 'A' }], measurements: [], episodes: [] };
  E.importMeasurementRows(db, rows, null, null, { now: '2026-11-04T02:00:00.000Z' });
  const ep = db.episodes[0];
  assert.equal(ep.level, 'red'); assert.equal(new Date(ep.detectedAt).getMonth(), 6, 'detected in July');
  assert.ok(!E.nextStep(ep, '2026-11-04T05:00:00.000Z').overdue, 'not overdue right after import');
  assert.ok(E.nextStep(ep, '2026-11-06T05:00:00.000Z').overdue, 'red still due the same day as import');
});
t('restartClock: only untouched overdue rounds, logged', () => {
  const db = db0();
  const { episode: a } = add(db, D(1), { sbp: 165, dbp: 85 });
  const db2 = db0(); const { episode: b2 } = add(db2, D(1), { sbp: 165, dbp: 85 }); E.act(db2, b2.id, 'notify', {}, D(2));
  assert.equal(E.restartClock(db, D(60), null, 'x', true), 1, 'dry run counts');
  assert.equal(a.due.notify < D(60), true);
  E.restartClock(db, D(60), null, '管理者');
  assert.ok(!E.nextStep(a, D(60)).overdue); assert.ok(a.log[a.log.length - 1].text.includes('重新起算'));
  assert.equal(E.restartClock(db2, D(60)), 0, 'handled rounds keep their real timeline');
});

// ── 統計
t('wilson', () => { const w = E.wilson(8, 10); assert.ok(Math.abs(w.lo - 0.4902) < 0.001 && Math.abs(w.hi - 0.9433) < 0.001); });

// ── 名冊正規化
t('ID checksum', () => { assert.ok(E.validTwId('A123456789')); assert.ok(!E.validTwId('A123456788')); });
t('birth ROC', () => assert.equal(E.parseBirth('40.07.20').value, '1951-07-20'));
t('birth ROC comma', () => assert.equal(E.parseBirth('40,10,20').value, '1951-10-20'));
t('birth western dots', () => assert.equal(E.parseBirth('1947.06.20').value, '1947-06-20'));
t('birth +1911 twice', () => assert.equal(E.parseBirth(new Date(3858, 1, 28)).value, '1947-02-28'));
t('birth 0934 flagged', () => assert.equal(E.parseBirth('0934-10-21').value, null));
t('birth star sep', () => assert.equal(E.parseBirth('1959*10-10').value, '1959-10-10'));
t('roster: id in wrong column, meters, sex from id', () => {
  const rows = [['個案姓名＊', '性別＊', '生日＊', '身高＊', '身份識別類型＊', '識別值＊', '手機號碼', '所屬據點＊'], ['王小明', '', '1950-01-01', 1.62, 'A123456789', '1', '0912', '測試據點']];
  const r = E.parseRoster(rows, '1-測試');
  const p = r.persons[0];
  assert.equal(p.nationalId, 'A123456789'); assert.equal(p.heightCm, 162); assert.equal(p.sex, 'M');
  assert.equal(r.issues[0].issues.length, 3);
});

console.log(`${pass} passed${process.exitCode ? ', some FAILED' : ''}`);
