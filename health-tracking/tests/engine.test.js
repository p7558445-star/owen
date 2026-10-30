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

// ── 血壓
t('BP green', () => assert.equal(item('bp', [{ sbp: 128, dbp: 79 }]).level, 'green'));
t('BP yellow by SBP only (或)', () => assert.equal(item('bp', [{ sbp: 135, dbp: 75 }]).level, 'yellow'));
t('BP yellow by DBP only', () => assert.equal(item('bp', [{ sbp: 120, dbp: 85 }]).level, 'yellow'));
t('BP orange', () => assert.equal(item('bp', [{ sbp: 140, dbp: 70 }]).level, 'orange'));
t('BP orange DBP 90', () => assert.equal(item('bp', [{ sbp: 120, dbp: 90 }]).level, 'orange'));
t('BP red 180 provisional on single reading', () => { const r = item('bp', [{ sbp: 182, dbp: 95 }]); assert.equal(r.level, 'red'); assert.ok(r.provisional); });
t('BP red confirmed after retest', () => { const r = item('bp', [{ sbp: 185, dbp: 95 }, { sbp: 181, dbp: 96 }]); assert.equal(r.level, 'red'); assert.ok(!r.provisional); });
t('BP retest drops to orange', () => assert.equal(item('bp', [{ sbp: 185, dbp: 95 }, { sbp: 165, dbp: 92 }]).level, 'orange'));
t('BP 165/95 + chest pain = red emergency', () => { const r = item('bp', [{ sbp: 165, dbp: 95, symptoms: ['chest_pain'] }]); assert.equal(r.level, 'red'); assert.ok(r.emergency); });
t('BP 165/95 without symptoms = orange', () => assert.equal(item('bp', [{ sbp: 165, dbp: 95 }]).level, 'orange'));

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

// ── 整體層級取最高
t('overall = max', () => assert.equal(lv([{ sbp: 135, dbp: 70, glucose: 130, glucoseType: '空腹', spo2: 97 }]).overall, 'orange'));

// ── 閉環流程
function db0() { return { persons: [{ id: 'p1', name: '測試', sex: 'M', birth: '1950-01-01', heightCm: 165 }], measurements: [], episodes: [] }; }
const add = (db, at, v) => { db.measurements.push(Object.assign({ id: 'm' + db.measurements.length, personId: 'p1', at }, v)); return E.ingest(db, 'p1', at); };
const D = (d, h = 9) => new Date(2026, 0, d, h).toISOString();

t('full orange loop with 2-consecutive downgrade', () => {
  const db = db0();
  const { episode: ep } = add(db, D(1), { sbp: 150, dbp: 85 });
  assert.equal(ep.level, 'orange'); assert.equal(ep.state, 'pending');
  E.act(db, ep.id, 'notify', { method: '電話' }, D(2), '護理師A');
  assert.throws(() => E.act(db, ep.id, 'intervene', {}, D(2)), /健康處方/);
  E.act(db, ep.id, 'intervene', { rx: E.prescription(db.persons[0], ep) }, D(3), '護理師A');
  assert.throws(() => E.act(db, ep.id, 'confirm', {}, D(10)), /就醫日期/);
  E.act(db, ep.id, 'confirm', { visitDate: '2026-01-15', facility: '彰基' }, D(16), '護理師A');
  add(db, D(20), { sbp: 128, dbp: 78 }); // 第 1 次達綠
  assert.equal(ep.state, 'retested');
  assert.equal(ep.suggestion.outcome, 'maintain');
  add(db, D(28), { sbp: 126, dbp: 76 }); // 第 2 次達綠
  assert.equal(ep.suggestion.outcome, 'close');
  E.act(db, ep.id, 'judge', { outcome: 'close', reason: '達標回例行量測' }, D(28), '護理師A');
  assert.equal(ep.state, 'judged');
});

t('upgrade during open episode resets to pending', () => {
  const db = db0();
  const { episode: ep } = add(db, D(1), { sbp: 135, dbp: 70 });
  assert.equal(ep.level, 'yellow');
  E.act(db, ep.id, 'notify', {}, D(2));
  add(db, D(5), { sbp: 182, dbp: 100 });
  assert.equal(ep.level, 'red'); assert.equal(ep.state, 'pending');
});

t('same-session retest normal auto-closes', () => {
  const db = db0();
  const { episode: ep } = add(db, D(1, 9), { temp: 37.4 });
  assert.equal(ep.level, 'yellow');
  add(db, new Date(new Date(D(1, 9)).getTime() + 30 * 60000).toISOString(), { temp: 36.8 });
  assert.equal(ep.state, 'judged'); assert.equal(ep.judge.reason, '同場次重測正常');
});

t('red loop: phone follow-up then judge needs follow-up date for physician', () => {
  const db = db0();
  const { episode: ep } = add(db, D(1), { glucose: 320, glucoseType: '隨機' });
  assert.equal(ep.level, 'red');
  assert.ok(new Date(ep.due.confirm) - new Date(D(1)) < 2 * 86400000);
  E.act(db, ep.id, 'notify', {}, D(1, 10));
  E.act(db, ep.id, 'intervene', { rx: 'x' }, D(1, 11));
  E.act(db, ep.id, 'confirm', { visitDate: '2026-01-01' }, D(1, 15));
  assert.equal(E.nextStep(ep, D(2)).label, '就醫後 2 週電訪確認');
  E.act(db, ep.id, 'phone', { note: '已就醫用藥' }, D(14));
  assert.throws(() => E.act(db, ep.id, 'judge', { outcome: 'close', reason: '已轉由醫師持續管理' }, D(14)), /回診日期/);
  E.act(db, ep.id, 'judge', { outcome: 'close', reason: '已轉由醫師持續管理', followupDate: '2026-02-01' }, D(14));
  const q = E.quality(db, D(20), null);
  assert.equal(q.redSameDay.k, 1); assert.equal(q.redSameDay.n, 1);
});

t('maintain opens next cycle', () => {
  const db = db0();
  const { episode: ep } = add(db, D(1), { glucose: 110, glucoseType: '空腹' });
  E.act(db, ep.id, 'notify', {}, D(2)); E.act(db, ep.id, 'intervene', { rx: 'x' }, D(3)); E.act(db, ep.id, 'confirm', {}, D(4));
  add(db, D(25), { glucose: 112, glucoseType: '空腹' });
  E.act(db, ep.id, 'judge', { outcome: 'maintain', toLevel: 'yellow' }, D(25));
  const next = db.episodes.find((e) => e.parentId === ep.id);
  assert.equal(next.cycle, 2); assert.equal(next.state, 'pending');
});

t('overdue: notified but no intervention', () => {
  const db = db0();
  const { episode: ep } = add(db, D(1), { sbp: 150, dbp: 85 });
  E.act(db, ep.id, 'notify', {}, D(2));
  assert.ok(E.nextStep(ep, D(30)).overdue);
  const q = E.quality(db, D(30), null);
  assert.equal(q.unclosed, 1);
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
