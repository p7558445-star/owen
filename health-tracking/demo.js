/*
 * 示範資料產生器：全部為隨機合成的虛構民眾，不含任何真實個資。
 * 以固定亂數種子產生，模擬約 9 個月的量測與護理師處理（含部分逾期、停在已通知的個案），
 * 讓後台的分層、閉環與品質指標可以直接操作展示。
 */
(function (root) {
  'use strict';
  const E = root.Engine || (typeof require !== 'undefined' ? require('./engine.js') : null);

  const SITES = ['頭前社區', '鶴鳴社區', '安東社區', '永芳社區', '長樂社區', '彰化教會', '金齡關懷協會', '成功社區', '向陽社區', '介壽社區', '瑪玉據點', '建寶社區', '光復社區', '阿夷社區', '鎮平社區', '寶廍社區'];
  const NURSES = ['個管師 甲', '個管師 乙', '個管師 丙'];
  const SUR = '陳林黃張李王吳劉蔡楊許鄭謝洪郭邱曾廖賴徐周葉蘇莊呂江何蕭羅高'.split('');
  const GF = '秀美玉麗淑金春月英珠雪鳳琴蘭桂惠素碧'.split('');
  const GM = '明志文雄國榮清德輝正義昌坤福春進財永'.split('');

  function rng(seed) {
    let a = seed >>> 0;
    const r = () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    r.n = (m, s) => { const u = 1 - r(), v = r(); return m + s * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
    r.pick = (a) => a[Math.floor(r() * a.length)];
    r.int = (lo, hi) => lo + Math.floor(r() * (hi - lo + 1));
    return r;
  }
  const r1 = (x) => Math.round(x * 10) / 10;
  const DAY = 86400000;

  function generate(today, perSite) {
    const R = rng(20261030);
    const end = new Date(today || Date.now());
    const db = { persons: [], measurements: [], episodes: [], demo: true };
    let mid = 0;
    SITES.forEach((site, si) => {
      const n = perSite || R.int(7, 13);
      for (let k = 0; k < n; k++) {
        const sex = R() < 0.62 ? 'F' : 'M';
        const age = Math.max(52, Math.min(96, Math.round(R.n(74, 8))));
        const by = end.getFullYear() - age;
        const p = {
          id: `p${si}_${k}`, name: R.pick(SUR) + R.pick(sex === 'F' ? GF : GM) + R.pick(sex === 'F' ? GF : GM),
          sex, birth: `${by}-${String(R.int(1, 12)).padStart(2, '0')}-${String(R.int(1, 28)).padStart(2, '0')}`,
          heightCm: r1(sex === 'M' ? R.n(164, 6) : R.n(153, 5.5)), nationalId: null, demoId: `DEMO-${String(si + 1).padStart(2, '0')}${String(k + 1).padStart(2, '0')}`,
          phone: null, site, chronic: R() < 0.55, immuno: R() < 0.04, copd: R() < 0.05, medHTN: false, medDM: false, medLipid: false,
        };
        if (p.copd) p.spo2Baseline = 93;
        // 個人基線
        const B = {
          sbp: R.n(127, 14), dbp: R.n(74, 8), pulse: R.n(74, 9), arr: R() < 0.03, spo2: Math.min(99, R.n(97, 1.1)) - (p.copd ? 3 : 0),
          fpg: Math.exp(R.n(Math.log(97), 0.16)), ldl: R.n(112, 28), tg: Math.exp(R.n(Math.log(108), 0.35)), hdl: R.n(sex === 'M' ? 46 : 55, 11),
          bmi: R.n(23.4, 2.8), bf: sex === 'M' ? R.n(19, 3.5) : R.n(28.5, 3.5),
        };
        p.medHTN = B.sbp > 145 && R() < 0.6; p.medDM = B.fpg > 125 && R() < 0.6; p.medLipid = B.ldl > 150 && R() < 0.4;
        p.careNet = { htn: p.medHTN && R() < 0.5, dm: p.medDM && R() < 0.6, lipid: p.medLipid && R() < 0.3 };
        if ((p.medHTN || p.medDM) && R() < 0.25) p.counsel = [{ at: new Date(end.getTime() - R.int(20, 200) * DAY).toISOString(), by: '個管師 甲', domains: ['htn', 'dm', 'lipid'], note: '減鹽、規律運動、按時服藥' }];
        db.persons.push(p);

        let t = new Date(end.getTime() - R.int(30, 270) * DAY);
        t.setHours(R.int(8, 11), R.int(0, 59), 0, 0);
        let improve = 0;
        while (t < end) {
          // 一個場次
          const sx = [];
          const sbp = Math.round(B.sbp - improve * 6 + R.n(0, 8)), dbp = Math.round(B.dbp - improve * 3 + R.n(0, 5));
          const spike = R() < 0.025;
          const m = {
            id: 'dm' + mid++, personId: p.id, at: t.toISOString(), source: 'device',
            sbp: spike ? sbp + 45 : sbp, dbp: spike ? dbp + 18 : dbp,
            pulse: Math.round(B.pulse + R.n(0, 6)), arr: B.arr && R() < 0.7,
            spo2: Math.round(Math.min(100, B.spo2 + R.n(0, 1) - (R() < 0.03 ? 5 : 0))),
            temp: r1(R() < 0.03 ? R.n(38.1, 0.4) : R.n(36.45, 0.25)),
            weight: r1(B.bmi * Math.pow(p.heightCm / 100, 2) - improve * 0.8 + R.n(0, 0.4)),
            waist: Math.round(B.bmi * (sex === 'M' ? 3.6 : 3.3) + R.n(0, 2)),
            bodyFat: r1(B.bf + R.n(0, 1)),
            symptoms: sx,
          };
          const gType = R.pick(['空腹', '空腹', '飯後', '隨機']);
          const g = gType === '空腹' ? B.fpg - improve * 6 : B.fpg * 1.45;
          m.glucose = Math.round(g + R.n(0, 10)); m.glucoseType = gType;
          if (R() < 0.35) { m.ldl = Math.round(B.ldl - improve * 8 + R.n(0, 8)); m.tg = Math.round(B.tg * Math.exp(R.n(0, 0.12))); m.hdl = Math.round(B.hdl + R.n(0, 3)); }
          if (spike && R() < 0.3) sx.push('severe_headache');
          if (p.medDM && R() < 0.3) m.hba1c = r1(Math.max(5.6, 6.2 + (B.fpg - 110) / 30 - improve * 0.2 + R.n(0, 0.3)));
          db.measurements.push(m);
          // 血氧或體溫偏差時，現場重測
          if (m.spo2 <= 94 || (m.temp >= 37.1 && m.temp < 38)) {
            const rt = new Date(t.getTime() + 20 * 60000);
            const re = { id: 'dm' + mid++, personId: p.id, at: rt.toISOString(), source: 'device', spo2: m.spo2 <= 94 ? Math.min(99, m.spo2 + R.int(0, 3)) : undefined, temp: m.temp >= 37.1 ? r1(m.temp - R() * 0.8) : undefined };
            db.measurements.push(re);
          }
          t = new Date(t.getTime() + R.int(14, 60) * DAY);
          if (R() < 0.35) improve = Math.min(2, improve + 0.5);
        }
      }
    });

    // 依時間順序重播：量測進站即 ingest，期間模擬護理師作業
    const byPerson = {};
    for (const m of db.measurements) (byPerson[m.personId] = byPerson[m.personId] || []).push(m);
    const all = db.measurements; db.measurements = [];
    for (const p of db.persons) {
      const ms = (byPerson[p.id] || []).sort((a, b) => new Date(a.at) - new Date(b.at));
      const nurse = NURSES[db.persons.indexOf(p) % NURSES.length];
      const stall = R() < 0.1; // 少數個案停在已通知，供未閉環指標展示
      for (let i = 0; i < ms.length; i++) {
        db.measurements.push(ms[i]);
        E.ingest(db, p.id, ms[i].at);
        const nextAt = i + 1 < ms.length ? new Date(ms[i + 1].at) : end;
        if (i + 1 < ms.length && new Date(ms[i + 1].at) - new Date(ms[i].at) < 3600000) continue; // 同場次重測尚未結束
        simulate(db, p, nurse, new Date(ms[i].at), nextAt, end, R, stall);
      }
    }
    void all;
    db.settings = { nurses: NURSES.slice() };
    return db;
  }

  function simulate(db, p, nurse, from, until, end, R, stall) {
    for (let guard = 0; guard < 8; guard++) {
      const ep = db.episodes.find((e) => e.personId === p.id && e.state !== 'judged');
      if (!ep) return;
      const base = new Date(Math.max(from, new Date(ep.levelAt || ep.detectedAt)));
      const lag = (lo, hi) => new Date(base.getTime() + (lo + R() * (hi - lo)) * DAY + R.int(1, 6) * 3600000);
      let at, action, payload = {};
      const L = ep.level;
      switch (ep.state) {
        case 'pending': at = L === 'red' ? lag(0, R() < 0.85 ? 0.2 : 1.5) : L === 'orange' ? lag(0, 6) : lag(1, 20); action = 'notify'; payload = { method: R.pick(['電話', '電話', 'App 推播', '現場']), assignee: nurse }; break;
        case 'notified': if (stall) return; at = L === 'red' ? lag(0, R() < 0.8 ? 0.2 : 2) : L === 'orange' ? lag(0, 5) : lag(3, 60); action = 'intervene'; payload = { rx: E.prescription(p, ep) }; break;
        case 'intervened': at = L === 'red' ? lag(0, R() < 0.85 ? 0.8 : 3) : L === 'orange' ? (R() < 0.75 ? lag(5, 18) : lag(30, 50)) : lag(5, 70); action = 'confirm';
          payload = { visitDate: at.toISOString().slice(0, 10), facility: R.pick(['彰基本院', '鹿基', '社區診所', '家醫科診所']), result: R.pick(['已就醫，追蹤中', '開始用藥', '調整用藥', '醫師建議觀察']) }; break;
        case 'confirmed': if (L !== 'red') return; at = new Date(new Date(ep.phone.due).getTime() - R.int(0, 5) * DAY); action = 'phone'; payload = { note: R.pick(['已規律服藥', '已回診，醫師持續追蹤', '症狀改善']) }; break;
        case 'retested': {
          at = lag(0, 5);
          const s = ep.suggestion || (L === 'red' ? { outcome: R() < 0.6 ? 'close' : 'downgrade', toLevel: 'orange', reason: '已轉由醫師持續管理' } : { outcome: 'maintain', toLevel: L });
          action = 'judge';
          payload = { outcome: s.outcome, toLevel: s.toLevel, reason: s.reason || '' };
          if (s.outcome === 'close') {
            payload.reason = L === 'red' || p.chronic ? '已轉由醫師持續管理' : (s.reason || '達標回例行量測');
            if (payload.reason === '已轉由醫師持續管理') payload.followupDate = new Date(at.getTime() + 30 * DAY).toISOString().slice(0, 10);
          }
          break;
        }
        default: return;
      }
      if (at >= until || at >= end) return;
      try { E.act(db, ep.id, action, payload, at.toISOString(), nurse); } catch (e) { return; }
      from = at;
    }
  }

  const Demo = { generate, SITES, NURSES };
  if (typeof module !== 'undefined' && module.exports) module.exports = Demo;
  else root.Demo = Demo;
})(typeof window !== 'undefined' ? window : globalThis);
