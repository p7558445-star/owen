/*
 * 彰基社區智慧健康站：量測異常分層管理與閉環追蹤 — 規則與流程引擎
 *
 * 依據《彰基社區智慧健康站量測異常分層管理與閉環追蹤建議 v1》實作。
 * 本檔為純函式（不碰 DOM），瀏覽器以 window.Engine 使用，Node 以 require() 測試。
 * 文件未明定、需要解讀之處，皆以 ASSUMPTIONS 列出並在後台「規則對照」頁顯示。
 */
(function (root) {
  'use strict';

  // ───────────────────────── 層級 ─────────────────────────
  const LEVELS = ['green', 'yellow', 'orange', 'red'];
  const RANK = { na: -1, green: 0, yellow: 1, orange: 2, red: 3 };
  const LEVEL_LABEL = { na: '資料不足', green: '綠', yellow: '黃', orange: '橙', red: '紅' };
  const LEVEL_MEANING = {
    green: '正常或已達標：不需派案，回饋與例行量測',
    yellow: '偏高或邊緣，尚無轉介必要：健康處方，6 個月複測',
    orange: '異常，需醫師評估：4 週內轉介就醫並確認、健康處方，3 個月複測',
    red: '可能危及安全：當日處理，24 小時內確認就醫、健康處方，就醫後 2 週電訪確認',
  };
  const maxLevel = (levels) => levels.reduce((a, b) => (RANK[b] > RANK[a] ? b : a), 'na');

  const ITEMS = [
    { key: 'bp', label: '血壓', unit: 'mmHg' },
    { key: 'pulse', label: '脈搏與心律', unit: '次/分' },
    { key: 'spo2', label: '血氧', unit: '%' },
    { key: 'temp', label: '體溫', unit: '℃' },
    { key: 'glucose', label: '血糖', unit: 'mg/dL' },
    { key: 'lipid', label: '血脂', unit: 'mg/dL' },
    { key: 'mets', label: '代謝症候群', unit: '項' },
    { key: 'body', label: 'BMI・腰圍・體脂', unit: '' },
  ];
  const ITEM_LABEL = Object.fromEntries(ITEMS.map((i) => [i.key, i.label]));
  // 生活型態追蹤項目：照常判定層級並開健康處方，但不計入整體層級、不派案、不轉介
  const LIFESTYLE = ['body'];

  // 症狀代碼（App 端回報或護理師勾選）
  const SYMPTOMS = {
    chest_pain: '胸痛',
    severe_headache: '劇烈頭痛',
    slurred_speech: '言語不清',
    limb_weakness: '肢體無力',
    syncope: '暈厥',
    dyspnea: '呼吸困難',
    cyanosis: '嘴唇發紺',
    altered_consciousness: '意識改變',
    seizure: '抽搐',
    polyuria: '多尿',
    thirst: '口渴',
    nausea_vomiting: '噁心嘔吐',
    hypo_sx: '低血糖症狀（冒冷汗、手抖、心悸）',
    palpitation: '心悸・頭暈',
  };
  const SYMPTOM_BY_LABEL = Object.fromEntries(Object.entries(SYMPTOMS).map(([k, v]) => [v.replace(/（.*）/, ''), k]));

  // 文件未明定、本系統採用的解讀（臨床委員會應逐條確認）
  const ASSUMPTIONS = [
    '血壓分層採院內修訂版（2026/11）：綠 <140/90；黃 140–159 或 90–99；橙 160–179 或 100–109；紅 ≥180 或 ≥110。修訂版刪除了「≥160/100 合併症狀即列紅」，本系統改為橙層並標示「急」，提示立即評估。',
    'BMI・腰圍・體脂為生活型態追蹤：照常判定層級並開立健康處方，但不計入整體層級、不派案、不轉介。代謝症候群維持原流程（計入整體層級、派案、橙層轉介），其血壓判準仍採 ≥130/85。',
    '代謝症候群的血糖判準僅用空腹血糖；已服藥者該項視為符合。',
    '代謝症候群五項未量齊且已符合項數 <3 時，標示為「資料不足」或「至少黃」，不判綠。',
    '單次量測達紅層（血壓、心律、血氧）或需重測確認的橙層（心律、低體溫），先以「暫定」層級派案，不因等待重測而延誤；同一場次 60 分鐘內的重測會自動重新判定。',
    '脈搏 50–59 但有症狀：文件僅定義無症狀為黃，本系統升為橙。',
    '血糖 <70 但無症狀或未用藥：文件未定義，本系統暫列橙（需醫師評估），並提示補充糖分。',
    '血糖「飯後」閾值同時套用於「隨機」血糖。',
    '血糖紅層「合併多尿、口渴、噁心嘔吐」解讀為血糖 ≥200 且有上述症狀；意識改變合併任何血糖異常即列紅。',
    '血氧「合併呼吸困難、嘴唇發紺」解讀為血氧 <95 且有上述症狀即列紅。',
    '體溫「發燒/低體溫合併意識改變、呼吸困難、抽搐」解讀為體溫 ≥37.1 或 <36.0 且有上述症狀即列紅。',
    '體溫橙層「高齡」定義為 ≥65 歲；高齡、免疫低下或慢性病者當日就醫，其餘 48 小時內。',
    '只有總膽固醇而無 LDL/三酸甘油脂時，血脂不分層（文件閾值以 LDL、TG 定義）。尿酸目前文件未列，僅顯示不分層。',
    '派案（已通知）時限文件未規定，本系統預設紅 0 日、橙 3 日、黃 14 日；介入時限預設紅 0 日、橙 14 日、黃 90 日。可於設定調整。',
  ];

  // 處理時限（天），可由設定覆寫
  // 分層規則版本：閾值或計入整體層級的規則有變動時更新，後台據此提示重新判定開放中的追蹤案
  const RULES_VERSION = '2026-11-02';
  const REGRADE_CLOSE = '規則更新後重新判定為綠層';

  const DEFAULT_SLA = {
    notify: { red: 0, orange: 3, yellow: 14 },
    intervene: { red: 0, orange: 14, yellow: 90 },
    confirm: { red: 1, orange: 28, yellow: 90 },
    retest: { red: null, orange: 90, yellow: 180, green: 365 },
    phoneAfterVisit: 14,
    sessionMinutes: 60,
  };

  const CLOSE_REASONS = ['達標回例行量測', '已轉由醫師持續管理', '死亡', '遷出', '失聯', '拒絕'];

  // ───────────────────────── 小工具 ─────────────────────────
  const num = (v) => (v === null || v === undefined || v === '' || isNaN(+v) ? null : +v);
  const has = (sx, ...codes) => codes.some((c) => sx.includes(c));
  const within = (v, lo, hi) => v !== null && v >= lo && v <= hi;
  const fmt = (v, d = 0) => (v === null ? '—' : (+v).toFixed(d).replace(/\.0+$/, ''));

  function result(key, level, value, reason, extra = {}) {
    return Object.assign({ key, label: ITEM_LABEL[key], level, value, reason, provisional: false, notes: [], actions: [], timing: {} }, extra);
  }

  // 一個場次可能有多筆讀值（重測），取每項目依時間排序的序列
  function series(readings, field) {
    return readings.map((r) => num(r[field])).filter((v) => v !== null);
  }

  // ───────────────────────── 各項目判定 ─────────────────────────
  function evalBP(rs, sx) {
    const s = series(rs, 'sbp'), d = series(rs, 'dbp');
    if (!s.length || !d.length) return null;
    const sbp = s[s.length - 1], dbp = d[d.length - 1];
    const v = `${fmt(sbp)}/${fmt(dbp)}`;
    const bpSx = has(sx, 'chest_pain', 'severe_headache', 'slurred_speech', 'limb_weakness');
    // 院內修訂版（2026/11）：綠 <140/90；黃 140–159 或 90–99；橙 160–179 或 100–109；紅 ≥180 或 ≥110
    if (sbp >= 180 || dbp >= 110) {
      const r = result('bp', 'red', v, '≥180 或 ≥110', {
        actions: ['休息 5 分鐘後重測', bpSx ? '有症狀：立即撥 119' : '無症狀仍須當日就醫', '健康處方'],
      });
      if (s.length < 2 && !bpSx) { r.provisional = true; r.notes.push('單次量測，請休息 5 分鐘後重測；重測未降仍須當日就醫'); }
      if (bpSx) r.emergency = true;
      return r;
    }
    if (sbp >= 160 || dbp >= 100) {
      const r = result('bp', 'orange', v, '收縮壓 160–179 或舒張壓 100–109', { actions: ['轉介家醫科或心臟內科', '已服藥者回診調藥', '健康處方'] });
      if (bpSx) { r.emergency = true; r.notes.push('合併胸痛、劇烈頭痛、言語不清或肢體無力：請立即評估，必要時撥 119'); }
      return r;
    }
    if (sbp >= 140 || dbp >= 90) return result('bp', 'yellow', v, '收縮壓 140–159 或舒張壓 90–99', { actions: ['健康處方（減鹽、運動、體重控制）'] });
    return result('bp', 'green', v, '<140/90', { actions: ['回饋，維持生活型態'] });
  }

  function evalPulse(rs, sx) {
    const p = series(rs, 'pulse');
    const arr = rs.some((r) => r.arr === true || r.arr === 'Y' || r.arr === 1);
    if (!p.length && !arr) return null;
    const hr = p.length ? p[p.length - 1] : null;
    const v = hr === null ? '心律旗標' : fmt(hr) + (arr ? '（ARR）' : '');
    const redSx = has(sx, 'chest_pain', 'syncope', 'dyspnea');
    if (hr !== null && (hr < 40 || hr > 120 || ((hr < 60 || hr > 100) && redSx))) {
      const r = result('pulse', 'red', v, redSx ? '心率異常合併胸痛、暈厥或呼吸困難' : '<40 或 >120', {
        actions: ['立即休息', redSx ? '有症狀：撥 119' : '當日就醫', '健康處方'],
      });
      if (!redSx && p.length < 2) { r.provisional = true; r.notes.push('文件要求「持續」：請休息後重測確認'); }
      if (redSx) r.emergency = true;
      return r;
    }
    if (hr !== null && (hr < 50 || hr > 100)) {
      const r = result('pulse', 'orange', v, '<50 或 >100', { actions: ['詢問症狀、用藥（如 β 阻斷劑）、咖啡因、發燒', '持續或反覆者轉介並安排心電圖', '健康處方'] });
      if (p.length < 2) { r.provisional = true; r.notes.push('請休息 5–10 分鐘後重測，仍異常才確定橙層'); }
      return r;
    }
    if (arr) return result('pulse', 'orange', v, '設備心律旗標 ARR／疑似心房顫動', { actions: ['安排心電圖與醫師評估', '健康處方'], notes: ['確診者轉入慢性病管理'] });
    if (hr >= 50 && hr < 60) {
      if (has(sx, 'palpitation', 'syncope')) return result('pulse', 'orange', v, '50–59 且有症狀（系統解讀）', { actions: ['詢問症狀與用藥，轉介評估', '健康處方'] });
      return result('pulse', 'yellow', v, '50–59（無症狀）', { actions: ['觀察與衛教，不派案'] });
    }
    return result('pulse', 'green', v, '60–100', { actions: ['回饋'] });
  }

  function evalSpO2(rs, sx, person) {
    const o = series(rs, 'spo2');
    if (!o.length) return null;
    const x = o[o.length - 1];
    const v = fmt(x) + (o.length > 1 ? `（共 ${o.length} 次）` : '');
    if (x <= 90 || (x < 95 && has(sx, 'dyspnea', 'cyanosis'))) {
      const r = result('spo2', 'red', v, x <= 90 ? '≤90' : '血氧偏低合併呼吸困難或嘴唇發紺', { actions: ['立即坐姿休息', '撥 119 或當日送醫', '健康處方'] });
      if (x <= 90 && o.length < 2 && !has(sx, 'dyspnea', 'cyanosis')) { r.provisional = true; r.notes.push('請保暖、休息後重測，仍 ≤90 確定紅層'); }
      if (has(sx, 'dyspnea', 'cyanosis')) r.emergency = true;
      return r;
    }
    const base = num(person && person.spo2Baseline);
    if (person && person.copd && base !== null && x < base) {
      return result('spo2', 'orange', v, `低於慢性肺病個人基線 ${base}%`, { actions: ['轉介就醫評估呼吸與心臟問題', '健康處方'] });
    }
    if (x <= 94) {
      const lowRun = o.slice(-3).filter((y) => y >= 91 && y <= 94).length;
      if (o.length >= 3 && lowRun === 3) {
        return result('spo2', 'orange', v, '91–94 且重測 2 次仍低', { actions: ['轉介就醫評估呼吸與心臟問題', '健康處方'] });
      }
      return result('spo2', 'yellow', v, '91–94', {
        actions: ['保暖、休息後重測', '排除指尖冰冷、指甲油等干擾', '健康處方'],
        notes: [`現場需再重測 ${3 - o.length} 次；2 次重測仍 91–94 則升橙`],
        timing: { retestDays: 0 },
      });
    }
    return result('spo2', 'green', v, '95–100', { actions: ['回饋'] });
  }

  function evalTemp(rs, sx, person) {
    const t = series(rs, 'temp');
    if (!t.length) return null;
    const x = t[t.length - 1];
    const v = fmt(x, 1);
    const abnormal = x >= 37.1 || x < 36.0;
    if (x >= 39 || (abnormal && has(sx, 'altered_consciousness', 'dyspnea', 'seizure'))) {
      return result('temp', 'red', v, x >= 39 ? '≥39' : '發燒／低體溫合併意識改變、呼吸困難或抽搐', {
        actions: ['撥 119 或當日送醫', '健康處方'], emergency: has(sx, 'altered_consciousness', 'dyspnea', 'seizure'),
      });
    }
    const highRisk = !!(person && ((person.age !== null && person.age >= 65) || person.immuno || person.chronic));
    if (x >= 38) {
      return result('temp', 'orange', v, '≥38 且 <39', {
        actions: ['評估症狀與傳染病接觸史', highRisk ? '高齡／免疫低下／慢性病：當日就醫' : '24–48 小時內就醫', '健康處方'],
        timing: { confirmDays: highRisk ? 0 : 2 },
      });
    }
    if (x < 35) {
      const r = result('temp', 'orange', v, '<35（保暖 30 分鐘後重測仍 <35）', { actions: ['保暖並轉介就醫', '健康處方'], timing: { confirmDays: highRisk ? 0 : 2 } });
      if (t.length < 2) { r.provisional = true; r.notes.push('請保暖 30 分鐘後重測'); }
      return r;
    }
    if (abnormal) {
      return result('temp', 'yellow', v, '35.0–35.9 或 37.1–37.9', {
        actions: ['30 分鐘後重測', '觀察症狀與接觸史', '健康處方'], notes: ['重測正常則回綠'], timing: { retestDays: 0 },
      });
    }
    return result('temp', 'green', v, '36.0–37.0', { actions: ['回饋'] });
  }

  const GLU_TYPE = { fasting: '空腹', post: '飯後', random: '隨機' };
  function normGluType(t) {
    if (!t) return 'random';
    const s = String(t);
    if (/fast|空腹|AC/i.test(s)) return 'fasting';
    if (/post|飯後|PC/i.test(s)) return 'post';
    return 'random';
  }

  function evalGlucose(rs, sx, person) {
    const g = rs.filter((r) => num(r.glucose) !== null);
    if (!g.length) return null;
    const last = g[g.length - 1];
    const x = num(last.glucose), type = normGluType(last.glucoseType);
    const v = `${fmt(x)}（${GLU_TYPE[type]}）`;
    const onMed = !!(person && person.medDM);
    if (x >= 300 || (x >= 200 && has(sx, 'polyuria', 'thirst', 'nausea_vomiting')) || ((x >= 200 || x < 70) && has(sx, 'altered_consciousness')) || (onMed && x < 70 && has(sx, 'hypo_sx', 'altered_consciousness'))) {
      const hypo = x < 70;
      return result('glucose', 'red', v, hypo ? '用藥者低血糖 <70 並有症狀' : (x >= 300 ? '任何血糖 ≥300' : '高血糖合併多尿、口渴、噁心嘔吐或意識改變'), {
        actions: [hypo ? '立即補充約 15 公克糖' : '當日送醫', has(sx, 'altered_consciousness') ? '意識不清撥 119' : null, '健康處方'].filter(Boolean),
        emergency: has(sx, 'altered_consciousness'),
      });
    }
    if (x < 70) return result('glucose', 'orange', v, '<70（文件未定義，系統暫列橙）', { actions: ['補充糖分並觀察', '轉介醫師評估低血糖原因', '健康處方'] });
    const fasting = type === 'fasting';
    if (fasting ? x >= 126 : x >= 200) return result('glucose', 'orange', v, fasting ? '空腹血糖 ≥126' : '飯後／隨機血糖 ≥200', { actions: ['轉介家醫科或新陳代謝科', '健康處方'] });
    if (fasting ? x >= 100 : x >= 140) return result('glucose', 'yellow', v, fasting ? '空腹血糖 100–125' : '飯後／隨機血糖 140–199', { actions: ['控糖飲食、減少含糖飲料', '運動處方', '健康處方'] });
    return result('glucose', 'green', v, fasting ? '空腹血糖 <100' : '飯後血糖 <140', { actions: ['回饋'] });
  }

  function evalLipid(rs, sx) {
    const ldl = series(rs, 'ldl').pop() ?? null, tg = series(rs, 'tg').pop() ?? null, tc = series(rs, 'tc').pop() ?? null;
    if (ldl === null && tg === null) {
      if (tc === null) return null;
      return result('lipid', 'na', `總膽固醇 ${fmt(tc)}`, '僅有總膽固醇，文件以 LDL／TG 分層', { notes: ['建議抽血檢驗 LDL、TG、HDL'] });
    }
    const v = [ldl !== null ? `LDL ${fmt(ldl)}` : null, tg !== null ? `TG ${fmt(tg)}` : null].filter(Boolean).join('、');
    const cvSx = has(sx, 'chest_pain');
    if ((ldl !== null && ldl >= 190) || (tg !== null && tg >= 500) || cvSx) {
      const notes = [];
      if (ldl !== null && ldl >= 190) notes.push('LDL ≥190 需評估是否為家族性高膽固醇血症');
      return result('lipid', 'red', v, cvSx ? '急性心血管症狀' : 'LDL ≥190 或 TG ≥500', {
        actions: ['優先轉診', cvSx ? '有症狀：撥 119' : null, '健康處方'].filter(Boolean), notes,
        timing: { confirmDays: cvSx ? 0 : 7 }, emergency: cvSx,
      });
    }
    if ((ldl !== null && ldl >= 160) || (tg !== null && tg >= 200)) return result('lipid', 'orange', v, 'LDL 160–189 或 TG 200–499', { actions: ['轉介醫師評估是否用藥', '確認就醫', '健康處方'] });
    if ((ldl !== null && ldl >= 130) || (tg !== null && tg >= 150)) return result('lipid', 'yellow', v, 'LDL 130–159 或 TG 150–199', { actions: ['飲食（減少油炸、甜食、酒精）與運動處方', '健康處方'] });
    return result('lipid', 'green', v, 'LDL <130；TG <150', { actions: ['回饋與維持衛教'] });
  }

  // 代謝症候群（國健署 5 項，符合 3 項以上；本項無紅層）
  function evalMetS(rs, sx, person) {
    const sex = person && person.sex;
    const last = (f) => series(rs, f).pop() ?? null;
    const waist = last('waist'), sbp = last('sbp'), dbp = last('dbp'), tg = last('tg'), hdl = last('hdl');
    const fpgReading = rs.filter((r) => num(r.glucose) !== null && normGluType(r.glucoseType) === 'fasting').pop();
    const fpg = fpgReading ? num(fpgReading.glucose) : null;
    const comps = [
      { name: '腰圍', met: waist === null || !sex ? null : waist >= (sex === 'M' ? 90 : 80) },
      { name: '血壓', met: person && person.medHTN ? true : sbp === null ? null : sbp >= 130 || dbp >= 85 },
      { name: '空腹血糖', met: person && person.medDM ? true : fpg === null ? null : fpg >= 100 },
      { name: '三酸甘油脂', met: person && person.medLipid ? true : tg === null ? null : tg >= 150 },
      { name: 'HDL', met: hdl === null || !sex ? null : hdl < (sex === 'M' ? 40 : 50) },
    ];
    const known = comps.filter((c) => c.met !== null);
    if (!known.length) return null;
    const n = known.filter((c) => c.met).length;
    const missing = comps.filter((c) => c.met === null).map((c) => c.name);
    const v = `${n} 項` + (missing.length ? `（缺 ${missing.join('、')}）` : '');
    const metList = comps.filter((c) => c.met).map((c) => c.name).join('、');
    if (n >= 3) return result('mets', 'orange', v, `符合 ≥3 項：${metList}`, { actions: ['納入代謝症候群防治', '轉介家醫科或新陳代謝科評估', '飲食、運動處方', '健康處方'] });
    if (n >= 1) return result('mets', 'yellow', v, `符合 ${n} 項：${metList}`, { actions: ['針對異常項目衛教', '健康處方'], notes: missing.length ? ['資料未齊，可能低估'] : [] });
    if (missing.length) return result('mets', 'na', v, '已量項目皆未符合，但資料不齊');
    return result('mets', 'green', v, '0 項', { actions: ['回饋'] });
  }

  function evalBody(rs, sx, person) {
    const last = (f) => series(rs, f).pop() ?? null;
    const sex = person && person.sex;
    const h = num(person && person.heightCm), w = last('weight'), waist = last('waist'), bf = last('bodyFat');
    const devBmi = last('bmi');
    const bmi = h && w ? w / Math.pow(h / 100, 2) : devBmi;
    if (bmi === null && waist === null && bf === null) return null;
    const parts = [], why = [];
    let lv = 'green';
    const bump = (l, reason) => { if (RANK[l] > RANK[lv]) lv = l; if (l !== 'green') why.push(reason); };
    if (bmi !== null) {
      parts.push(`BMI ${bmi.toFixed(1)}`);
      if (bmi >= 27) bump('orange', `BMI ≥27（${bmi >= 35 ? '重度' : bmi >= 30 ? '中度' : '輕度'}肥胖）`);
      else if (bmi >= 24) bump('yellow', 'BMI 24–26.9（過重）');
      else if (bmi < 18.5) bump('yellow', 'BMI <18.5（過輕）');
    }
    if (waist !== null && sex) {
      parts.push(`腰圍 ${fmt(waist)}`);
      if (waist >= (sex === 'M' ? 90 : 80)) bump('yellow', `腰圍${sex === 'M' ? '男 ≥90' : '女 ≥80'}`);
    }
    if (bf !== null && sex) {
      parts.push(`體脂 ${fmt(bf, 1)}%`);
      const [lo, g, y] = sex === 'M' ? [10, 20, 25] : [20, 30, 35];
      if (bf > y) bump('orange', `體脂${sex === 'M' ? '男 >25%' : '女 >35%'}`);
      else if (bf < lo) bump('orange', `體脂${sex === 'M' ? '男 <10%' : '女 <20%'}`);
      else if (bf > g) bump('yellow', `體脂${sex === 'M' ? '男 20–25%' : '女 30–35%'}`);
    }
    const actions = { green: ['回饋'], yellow: ['營養與運動處方', bmi !== null && bmi < 18.5 ? '評估是否為不明原因體重下降或肌少症' : null, '健康處方'].filter(Boolean), orange: ['建立體重管理計畫（生活型態追蹤，不轉介）', '營養與運動處方', '健康處方'] }[lv];
    return result('body', lv, parts.join('、'), why.join('；') || '達標', { actions, bmi });
  }

  const EVALUATORS = { bp: evalBP, pulse: evalPulse, spo2: evalSpO2, temp: evalTemp, glucose: evalGlucose, lipid: evalLipid, mets: evalMetS, body: evalBody };

  // 各項目的數值（供健康處方依院內文件的數值類別選內容）
  function itemData(key, rs, r) {
    const last = (f) => { const v = series(rs, f); return v.length ? v[v.length - 1] : null; };
    switch (key) {
      case 'bp': return { sbp: last('sbp'), dbp: last('dbp') };
      case 'pulse': return { hr: last('pulse') };
      case 'spo2': return { x: last('spo2') };
      case 'temp': return { x: last('temp') };
      case 'glucose': { const g = rs.filter((m) => num(m.glucose) !== null).pop(); return { x: g ? num(g.glucose) : null, fasting: !!g && normGluType(g.glucoseType) === 'fasting', a1c: last('hba1c') }; }
      case 'lipid': return { tc: last('tc'), tg: last('tg'), hdl: last('hdl'), ldl: last('ldl') };
      case 'mets': { const n = parseInt(r.value, 10); return { n: isNaN(n) ? null : n }; }
      case 'body': return { bmi: r.bmi ?? null, bf: last('bodyFat'), waist: last('waist') };
      default: return {};
    }
  }

  /**
   * 判定一個量測場次。
   * @param person {sex:'M'|'F', age, heightCm, copd, spo2Baseline, immuno, chronic, medHTN, medDM, medLipid}
   * @param readings 同一場次內依時間排序的量測紀錄
   */
  function evaluateSession(person, readings) {
    const sx = [...new Set(readings.flatMap((r) => r.symptoms || []))];
    const items = {};
    for (const it of ITEMS) {
      const r = EVALUATORS[it.key](readings, sx, person);
      if (r) items[it.key] = r;
    }
    for (const k of LIFESTYLE) if (items[k]) items[k].lifestyle = true;
    for (const k of Object.keys(items)) items[k].data = itemData(k, readings, items[k]);
    const graded = Object.values(items).filter((r) => r.level !== 'na' && !r.lifestyle);
    const life = Object.values(items).filter((r) => r.level !== 'na' && r.lifestyle);
    const overall = graded.length ? maxLevel(graded.map((r) => r.level)) : 'na';
    return {
      overall,
      lifestyle: life.length ? maxLevel(life.map((r) => r.level)) : 'na',
      items,
      symptoms: sx,
      emergency: graded.some((r) => r.emergency),
      provisional: graded.some((r) => r.provisional && r.level === overall),
      abnormal: graded.filter((r) => RANK[r.level] >= 1).map((r) => r.key),
    };
  }

  // ───────────────────────── 場次分組 ─────────────────────────
  function groupSessions(measurements, minutes = DEFAULT_SLA.sessionMinutes) {
    const sorted = [...measurements].sort((a, b) => new Date(a.at) - new Date(b.at));
    const out = [];
    for (const m of sorted) {
      const cur = out[out.length - 1];
      if (cur && new Date(m.at) - new Date(cur.readings[cur.readings.length - 1].at) <= minutes * 60000) cur.readings.push(m);
      else out.push({ id: 's_' + m.id, at: m.at, readings: [m] });
    }
    return out;
  }

  // ───────────────────────── 日期 ─────────────────────────
  const DAY = 86400000;
  function startOfDay(d) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }
  function endOfDay(d) { const x = new Date(d); x.setHours(23, 59, 59, 999); return x; }
  function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
  function dueBy(from, days) { return days === null || days === undefined ? null : endOfDay(addDays(from, days)).toISOString(); }
  function sameDay(a, b) { const x = new Date(a), y = new Date(b); return x.getFullYear() === y.getFullYear() && x.getMonth() === y.getMonth() && x.getDate() === y.getDate(); }
  function ageAt(birth, at) {
    if (!birth) return null;
    const b = new Date(birth), t = new Date(at);
    let a = t.getFullYear() - b.getFullYear();
    if (t.getMonth() < b.getMonth() || (t.getMonth() === b.getMonth() && t.getDate() < b.getDate())) a--;
    return a;
  }

  // ───────────────────────── 閉環流程 ─────────────────────────
  // 每一輪四步驟：偵測 → 通知 → 介入（健康處方）→ 確認（就醫或完成處方），之後回到偵測反覆。
  // 下一輪由量測自動開啟：
  //   1. 量測高於本輪層級 → 立即開新一輪（升級）
  //   2. 到了複測日（黃 6 個月、橙 3 個月、紅：就醫後 2 週）之後回站量測，仍異常 → 開新一輪；
  //      新一輪層級取「最近 2 次量測」的較高者（連續 2 次較低才降級）
  //   複測日前、未升高的量測只記錄，不開新輪。
  const OPEN_STATES = ['detected', 'notified', 'intervened'];
  const STATES = ['detected', 'notified', 'intervened', 'confirmed'];
  const STATE_LABEL = { detected: '偵測', notified: '通知', intervened: '介入', confirmed: '確認', closed: '結案' };
  const isOpen = (e) => OPEN_STATES.includes(e.state);

  function personCtx(person, at) {
    return Object.assign({}, person, { age: ageAt(person.birth, at) });
  }

  function computeDue(ep, sla, items) {
    const lv = ep.level, from = ep.levelAt || ep.detectedAt;
    const atLevel = items.filter((i) => i.level === lv);
    const minT = (k, dflt) => atLevel.reduce((m, i) => (i.timing && i.timing[k] !== undefined ? Math.min(m, i.timing[k]) : m), dflt ?? Infinity);
    const confirmDays = minT('confirmDays', sla.confirm[lv]);
    return {
      notify: dueBy(from, sla.notify[lv]),
      intervene: dueBy(from, Math.min(sla.intervene[lv], confirmDays)),
      confirm: dueBy(from, confirmDays),
    };
  }

  let seq = 0;
  const uid = (p) => `${p}_${Date.now().toString(36)}${(++seq).toString(36)}${Math.random().toString(36).slice(2, 6)}`;

  function log(ep, at, type, text, by) { ep.log.push({ at, type, text, by: by || '系統' }); }

  function summarizeItems(ev) {
    return Object.values(ev.items).filter((r) => RANK[r.level] >= 1).map((r) => ({ key: r.key, level: r.level, value: r.value, reason: r.reason, provisional: r.provisional, timing: r.lifestyle ? {} : r.timing, lifestyle: !!r.lifestyle, data: r.data }));
  }

  function newEpisode(db, person, session, ev, at, sla, level, why, basis) {
    const prev = db.episodes.filter((e) => e.personId === person.id);
    const lv = level || ev.overall;
    const ep = {
      id: uid('ep'), personId: person.id, cycle: prev.length + 1, parentId: prev.length ? prev[prev.length - 1].id : null,
      level: lv, initialLevel: lv, items: summarizeItems(ev), emergency: ev.emergency, provisional: ev.provisional,
      state: 'detected', detectedAt: session.at, levelAt: at, detectSessionId: session.id, levelSessionId: session.id, basisSessionIds: basis || [session.id], createdAt: at,
      sessions: [session.id], log: [],
    };
    ep.due = computeDue(ep, sla, ep.items);
    log(ep, session.at, 'detected', `偵測：${LEVEL_LABEL[lv]}層（${ep.items.filter((i) => i.level === ev.overall && !i.lifestyle).map((i) => ITEM_LABEL[i.key]).join('、')}）${why ? '｜' + why : ''}`);
    db.episodes.push(ep);
    return ep;
  }

  function openEpisode(db, personId) {
    return db.episodes.find((e) => e.personId === personId && isOpen(e));
  }
  function lastEpisode(db, personId) {
    const es = db.episodes.filter((e) => e.personId === personId);
    return es[es.length - 1];
  }

  function sessionsOf(db, personId, sla) {
    return groupSessions(db.measurements.filter((m) => m.personId === personId), sla.sessionMinutes);
  }

  // 複測日：黃、橙依時限；紅為就醫日後 2 週（電訪確認）
  function nextDueOf(ep, sla, visitDate, at) {
    if (ep.level === 'red') return dueBy(visitDate || at, sla.phoneAfterVisit);
    return dueBy(ep.levelAt || ep.detectedAt, sla.retest[ep.level]);
  }

  /**
   * 規則更新後，依目前規則重新判定所有進行中的追蹤輪次。
   * 只重新評估「決定本輪層級的那次量測」（開案或升級時的場次），不用最近一次量測，以免繞過「連續 2 次才降級」。
   * 層級改變寫入處理紀錄；重新判定為綠層者以系統原因結案。
   */
  function regradeOpen(db, now, slaOverride, by) {
    const sla = Object.assign({}, DEFAULT_SLA, slaOverride || {});
    const at = now || new Date().toISOString();
    const changes = [];
    for (const ep of db.episodes.filter(isOpen)) {
      const person = db.persons.find((p) => p.id === ep.personId);
      if (!person) continue;
      // 決定本輪層級的量測：開案／升級時的場次；複測開輪則為「最近 2 次」
      const ids = ep.basisSessionIds || [ep.levelSessionId || ep.detectSessionId];
      const ss = sessionsOf(db, ep.personId, sla).filter((x) => ids.includes(x.id));
      if (!ss.length) continue;
      const ev = ss.map((x) => evaluateSession(personCtx(person, x.at), x.readings)).reduce((a, b) => (RANK[b.overall] > RANK[a.overall] ? b : a));
      const prev = ep.level;
      const items = summarizeItems(ev);
      if (RANK[ev.overall] <= 0) {
        log(ep, at, 'closed', `規則更新（${RULES_VERSION}）：開案量測依新規則未達異常，系統結案（原 ${LEVEL_LABEL[prev]}層）`, by);
        ep.state = 'closed';
        ep.close = { at, reason: REGRADE_CLOSE, by: by || '系統' };
        changes.push({ id: ep.id, personId: ep.personId, from: prev, to: 'green' });
        continue;
      }
      const sameItems = JSON.stringify(items.map((i) => i.key + i.level)) === JSON.stringify(ep.items.map((i) => i.key + i.level));
      if (ev.overall === prev && sameItems) continue;
      ep.items = items; ep.emergency = ev.emergency; ep.provisional = ev.provisional;
      if (ev.overall !== prev) {
        ep.level = ev.overall; ep.levelAt = at;
        ep.due = computeDue(ep, sla, ep.items);
        log(ep, at, RANK[ev.overall] > RANK[prev] ? 'upgraded' : 'regraded', `規則更新（${RULES_VERSION}）：開案（或升級）時的量測依新規則重新判定 ${LEVEL_LABEL[prev]} → ${LEVEL_LABEL[ev.overall]}`, by);
        changes.push({ id: ep.id, personId: ep.personId, from: prev, to: ev.overall });
      } else {
        log(ep, at, 'regraded', `規則更新（${RULES_VERSION}）：異常項目依新規則更新，層級維持${LEVEL_LABEL[prev]}`, by);
      }
    }
    db.rulesVersion = RULES_VERSION;
    return changes;
  }

  /**
   * 新量測進來後重新評估（設備 / App 回傳或手動輸入時呼叫）。回傳本次場次判定與相關的追蹤輪次。
   */
  function ingest(db, personId, now, slaOverride) {
    const sla = Object.assign({}, DEFAULT_SLA, slaOverride || {});
    const person = db.persons.find((p) => p.id === personId);
    const sessions = sessionsOf(db, personId, sla);
    const session = sessions[sessions.length - 1];
    if (!session) return null;
    const ev = evaluateSession(personCtx(person, session.at), session.readings);
    person.lastLevel = ev.overall;
    person.lastSessionAt = session.at;
    const at = now || new Date().toISOString();
    let ep = openEpisode(db, personId);

    if (ep) {
      const sameSession = ep.sessions.includes(session.id) || ep.detectSessionId === session.id;
      if (!sameSession) ep.sessions.push(session.id);
      // 同一場次內的重測：直接以最新判定取代（重測正常可回綠）
      if (sameSession && ['detected', 'notified'].includes(ep.state)) {
        if (ev.overall !== ep.level) {
          const prev = ep.level;
          if (RANK[ev.overall] <= 0) {
            log(ep, at, 'closed', `同場次重測已回綠，系統結案（原 ${LEVEL_LABEL[prev]}層）`);
            ep.state = 'closed';
            ep.close = { at, reason: '同場次重測正常', by: '系統' };
            return { ev, episode: ep };
          }
          ep.level = ev.overall; ep.levelAt = at; ep.levelSessionId = session.id; ep.basisSessionIds = [session.id];
          log(ep, at, RANK[ev.overall] > RANK[prev] ? 'upgraded' : 'regraded', `同場次重測：${LEVEL_LABEL[prev]} → ${LEVEL_LABEL[ev.overall]}`);
        }
        ep.items = summarizeItems(ev); ep.emergency = ev.emergency; ep.provisional = ev.provisional;
        ep.due = computeDue(ep, sla, ep.items);
        return { ev, episode: ep };
      }
      // 本輪進行中又量到更高層級：本輪升級，回到「偵測」重新通知
      if (RANK[ev.overall] > RANK[ep.level]) {
        const prev = ep.level;
        ep.level = ev.overall; ep.levelAt = at; ep.levelSessionId = session.id; ep.basisSessionIds = [session.id]; ep.items = summarizeItems(ev); ep.emergency = ev.emergency; ep.provisional = ev.provisional;
        ep.state = 'detected';
        ep.due = computeDue(ep, sla, ep.items);
        delete ep.notify; delete ep.intervene;
        log(ep, at, 'upgraded', `新量測升級：${LEVEL_LABEL[prev]} → ${LEVEL_LABEL[ev.overall]}，回到偵測、重新通知`);
        return { ev, episode: ep };
      }
      log(ep, at, 'measured', `新量測（${LEVEL_LABEL[ev.overall]}層）`);
      return { ev, episode: ep };
    }

    // 沒有進行中的輪次
    const last = lastEpisode(db, personId);
    if (!last || last.state !== 'confirmed') {
      if (RANK[ev.overall] >= 1) ep = newEpisode(db, person, session, ev, at, sla);
      return { ev, episode: ep };
    }
    // 上一輪已確認：升高立即開新輪；到複測日後回站則依最近 2 次量測決定
    if (RANK[ev.overall] > RANK[last.level]) {
      last.recheck = last.recheck || { at: session.at, level: ev.overall, kind: 'upgrade' };
      ep = newEpisode(db, person, session, ev, at, sla, ev.overall, `高於上一輪（${LEVEL_LABEL[last.level]}），開新一輪`);
      return { ev, episode: ep };
    }
    if (last.nextDue && new Date(session.at) >= startOfDay(last.nextDue)) {
      const recent = sessions.slice(-2).map((s) => evaluateSession(personCtx(person, s.at), s.readings).overall).filter((l) => l !== 'na');
      const lv = recent.length ? maxLevel(recent) : ev.overall;
      if (!last.recheck) last.recheck = { at: session.at, level: lv, kind: 'due' };
      if (RANK[lv] >= 1) {
        const why = RANK[lv] < RANK[last.level] ? `複測：連續 2 次低於上一輪，降為${LEVEL_LABEL[lv]}層` : `複測仍為${LEVEL_LABEL[lv]}層，開新一輪`;
        ep = newEpisode(db, person, session, ev, at, sla, lv, why, sessions.slice(-2).map((x) => x.id));
      } else {
        log(last, at, 'rechecked', '複測：最近 2 次皆為綠層，回到例行量測');
        last.nextDue = null;
      }
      return { ev, episode: ep };
    }
    log(last, at, 'measured', `複測日前量測（${LEVEL_LABEL[ev.overall]}層），未開新輪`);
    return { ev, episode: last };
  }

  /**
   * 社區護理師操作。action ∈ notify|intervene|confirm|close
   */
  function act(db, epId, action, payload, now, by, slaOverride) {
    const sla = Object.assign({}, DEFAULT_SLA, slaOverride || {});
    const ep = db.episodes.find((e) => e.id === epId);
    if (!ep) throw new Error('找不到追蹤案');
    if (!isOpen(ep)) throw new Error('本輪已完成，下一輪會在複測或升級時自動開始');
    const at = now || new Date().toISOString();
    const p = payload || {};
    switch (action) {
      case 'notify':
        if (ep.state !== 'detected') throw new Error('目前不是「偵測」步驟');
        if (p.assignee) ep.assignee = p.assignee;
        ep.notify = { at, method: p.method || '電話', by };
        ep.state = 'notified';
        log(ep, at, 'notified', `通知民眾（${ep.notify.method}）${ep.assignee ? '｜負責：' + ep.assignee : ''}${p.note ? '：' + p.note : ''}`, by); break;
      case 'intervene':
        if (ep.state !== 'notified') throw new Error('需先完成通知');
        if (!p.rx) throw new Error('只要有異常就要完成健康處方');
        ep.intervene = { at, by, note: p.note || '' };
        ep.rx = { at, text: p.rx, by };
        ep.state = 'intervened';
        log(ep, at, 'intervened', `介入：開立健康處方${p.note ? '：' + p.note : ''}`, by); break;
      case 'confirm': {
        if (ep.state !== 'intervened') throw new Error('需先完成介入');
        const needVisit = RANK[ep.level] >= 2;
        if (needVisit && !p.visitDate) throw new Error('橙／紅層需登記就醫日期');
        ep.confirm = { at, by, type: needVisit ? 'visit' : 'rx', visitDate: p.visitDate || null, facility: p.facility || '', result: p.result || '' };
        ep.state = 'confirmed';
        ep.nextDue = nextDueOf(ep, sla, p.visitDate, at);
        log(ep, at, 'confirmed', (needVisit ? `確認就醫：${p.visitDate} ${p.facility || ''} ${p.result || ''}`.trim() : '確認完成健康處方／衛教') + `｜下次複測：${ep.nextDue.slice(0, 10)}`, by); break;
      }
      case 'close': // 非臨床結案：死亡、遷出、失聯、拒絕；或已轉由醫師持續管理（需回診日期）
        if (!CLOSE_REASONS.includes(p.reason) || p.reason === '達標回例行量測') throw new Error('結案原因限：已轉由醫師持續管理、死亡、遷出、失聯、拒絕');
        if (p.reason === '已轉由醫師持續管理' && !p.followupDate) throw new Error('轉由醫師持續管理需登記回診日期');
        ep.close = { at, reason: p.reason, followupDate: p.followupDate || null, by };
        ep.state = 'closed';
        log(ep, at, 'closed', `結案（${p.reason}）${p.note ? '：' + p.note : ''}`, by); break;
      default:
        throw new Error('未知操作 ' + action);
    }
    return ep;
  }

  // 下一步與是否逾期
  function nextStep(ep, now) {
    const t = new Date(now || Date.now());
    const mk = (label, due) => ({ label, due, overdue: !!due && new Date(due) < t, daysLeft: due ? Math.round((startOfDay(due) - startOfDay(t)) / DAY) : null });
    switch (ep.state) {
      case 'detected': return mk(ep.level === 'red' ? '當日通知民眾' : '通知民眾', ep.due.notify);
      case 'notified': return mk('介入：開立健康處方', ep.due.intervene);
      case 'intervened': return mk(RANK[ep.level] >= 2 ? (ep.level === 'red' ? '確認 24 小時內就醫' : '確認 4 週內就醫') : '確認完成健康處方', ep.due.confirm);
      case 'confirmed': return mk(ep.level === 'red' ? '就醫後 2 週電訪並請回站複測' : '請民眾回站複測', ep.nextDue);
      default: return mk('—', null);
    }
  }

  // 資料結構版本：2 = 四步驟循環（偵測、通知、介入、確認）
  const SCHEMA = 2;
  // 舊版七步驟資料轉成四步驟：待派案→偵測；已複測→確認；判定→確認（附複測結果）或結案
  function migrateWorkflow(db) {
    if (db.schema === SCHEMA) return 0;
    let n = 0;
    for (const e of db.episodes) {
      const was = e.state;
      if (was === 'pending' || was === 'detected') e.state = 'detected';
      else if (was === 'confirmed' || was === 'retested') {
        e.state = 'confirmed';
        e.nextDue = e.nextDue || (e.phone && e.phone.due) || (e.due && e.due.retest) || null;
        if (e.retest && e.retest.level) e.recheck = { at: e.retest.at, level: e.retest.level, kind: 'due' };
      } else if (was === 'judged') {
        const j = e.judge || {};
        if (j.outcome === 'close' && j.reason !== '達標回例行量測') { e.state = 'closed'; e.close = { at: j.at, reason: j.reason, followupDate: j.followupDate || null, by: j.by }; }
        else { e.state = 'confirmed'; e.nextDue = null; e.recheck = { at: j.at, level: j.toLevel || 'green', kind: 'due' }; }
      }
      if (e.due) delete e.due.retest;
      if (was !== e.state) { e.log.push({ at: new Date().toISOString(), type: 'migrated', text: `流程改為四步驟：「${was}」轉為「${STATE_LABEL[e.state]}」`, by: '系統' }); n++; }
    }
    db.schema = SCHEMA;
    return n;
  }

  // 上一輪已確認、複測日已過但尚未回站的民眾（「待回站複測」提醒）
  function recheckOverdue(db, now) {
    const t = new Date(now || Date.now());
    const out = [];
    const lastBy = new Map();
    for (const e of db.episodes) lastBy.set(e.personId, e);
    for (const e of lastBy.values()) {
      if (e.state !== 'confirmed' || !e.nextDue || e.recheck) continue;
      if (new Date(e.nextDue) < t) out.push(e);
    }
    return out;
  }

  // ───────────────────────── 統計 ─────────────────────────
  // Wilson score 95% CI（比例在小樣本或接近 0/1 時比 Wald 穩定）
  function wilson(k, n, z = 1.959964) {
    if (!n) return { p: null, lo: null, hi: null, k, n };
    const p = k / n, z2 = z * z, den = 1 + z2 / n;
    const c = (p + z2 / (2 * n)) / den, h = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / den;
    return { p, lo: Math.max(0, c - h), hi: Math.min(1, c + h), k, n };
  }

  function firstLog(ep, type) { return ep.log.find((l) => l.type === type); }

  /**
   * 品質指標：紅層當日處理率、橙層就醫確認率、複測完成率、降級（改善）率、未閉環個案數與原因
   * windowDays：以偵測日落在期間內的追蹤輪次為母群
   */
  function quality(db, now, windowDays, filter) {
    const t = new Date(now || Date.now());
    const since = windowDays ? addDays(t, -windowDays) : new Date(0);
    const eps = db.episodes.filter((e) => new Date(e.detectedAt) >= since && (!filter || filter(e)));
    const gone = (e) => e.close && ['死亡', '遷出'].includes(e.close.reason);

    const red = eps.filter((e) => e.initialLevel === 'red');
    const redSameDay = red.filter((e) => { const iv = firstLog(e, 'intervened'); return iv && sameDay(iv.at, e.detectedAt); });

    const orangeDue = eps.filter((e) => e.initialLevel === 'orange' && (e.confirm || (e.due.confirm && new Date(e.due.confirm) < t)) && !gone(e));
    const orangeOk = orangeDue.filter((e) => e.confirm && e.confirm.type === 'visit' && new Date(e.confirm.at) <= new Date(e.due.confirm));

    // 複測完成：已確認、複測日已過的輪次中，之後有回站量測（含複測日前提早升級者）
    const retestDue = eps.filter((e) => e.state === 'confirmed' && e.nextDue && new Date(e.nextDue) < t);
    const retestDone = retestDue.filter((e) => e.recheck);

    // 降級（改善）：已有複測結果的輪次中，複測層級低於本輪
    const rechecked = eps.filter((e) => e.state === 'confirmed' && e.recheck);
    const improved = rechecked.filter((e) => RANK[e.recheck.level] < RANK[e.level]);

    const open = db.episodes.filter((e) => isOpen(e) && (!filter || filter(e)));
    const stuck = open.map((e) => ({ e, s: nextStep(e, t) })).filter((x) => x.s.overdue);
    const byReason = {};
    for (const x of stuck) {
      const k = `停在「${STATE_LABEL[x.e.state]}」：${x.s.label}逾期`;
      byReason[k] = (byReason[k] || 0) + 1;
    }
    const waiting = recheckOverdue(db, t).filter((e) => !filter || filter(e));
    if (waiting.length) byReason['已確認、複測日已過未回站'] = waiting.length;
    const closeReasons = {};
    for (const e of eps.filter((e) => e.state === 'closed')) closeReasons[e.close.reason] = (closeReasons[e.close.reason] || 0) + 1;

    return {
      redSameDay: wilson(redSameDay.length, red.length),
      orangeConfirm: wilson(orangeOk.length, orangeDue.length),
      retest: wilson(retestDone.length, retestDue.length),
      improve: wilson(improved.length, rechecked.length),
      openCount: open.length,
      unclosed: stuck.length + waiting.length,
      unclosedReasons: byReason,
      closeReasons,
      episodes: eps.length,
    };
  }

  // ───────────────────────── 健康處方 ─────────────────────────
  const rxLib = () => (typeof module !== 'undefined' && module.exports ? require('./rx-library.js') : root.RxLibrary);

  // 單一項目的處方段落：依院內文件的數值類別；文件未涵蓋時改用系統暫用文字並標註
  function rxSection(i, sex) {
    const lib = rxLib();
    const head = `■ ${ITEM_LABEL[i.key]}：${i.value}（${LEVEL_LABEL[i.level]}${i.lifestyle ? '・生活型態追蹤' : ''}）`;
    const cats = lib ? lib.lookup(i.key, i.data, sex, true, i.level) : [];
    if (!cats.length) {
      const tpl = (RX[i.key] && RX[i.key][i.level]) || [];
      return [head, '  （院內衛教文件未涵蓋此數值範圍，以下為系統暫用內容）', ...tpl.map((t) => '  ・' + t)];
    }
    const out = [head];
    for (const c of cats) {
      out.push(`  【${c.title}】`);
      if (c.status.length) out.push('  您目前的狀況：' + c.status.join(''));
      if (c.advice.length) { out.push('  健康建議：'); c.advice.forEach((t) => out.push('   ・' + t)); }
      if (c.tip.length) out.push('  日常保健小提醒：' + c.tip.join(''));
      if (c.visit.length && (!c.visitLevels || c.visitLevels.includes(i.level))) out.push('  就醫建議：' + c.visit.join(''));
    }
    return out;
  }

  function disclaimer() {
    const lib = rxLib();
    return lib ? ['', ...lib.DISCLAIMER.map((d) => '⚠ ' + d)] : [];
  }

  function prescription(person, ep) {
    const lines = [`${person.name} 健康處方（${LEVEL_LABEL[ep.level]}層，第 ${ep.cycle} 輪）`, ''];
    const items = ep.items.slice().sort((a, b) => (a.lifestyle - b.lifestyle) || (RANK[b.level] - RANK[a.level]));
    for (const i of items) lines.push(...rxSection(i, person.sex), '');
    const plan = {
      red: ['今日就醫；無症狀仍須當日就醫，護理師將於 24 小時內確認就醫。', '就醫後 2 週內護理師將電話關懷確認。', '如出現胸痛、呼吸困難、意識改變、言語不清或肢體無力，請立即撥打 119。'],
      orange: ['請於 4 週內就醫，護理師將確認您的就醫情形。', '請於 3 個月內回健康站複測。'],
      yellow: ['目前不需轉介就醫，請依上方建議調整生活習慣。', '請於 6 個月內回健康站複測。'],
    }[ep.level] || [];
    if (plan.length) { lines.push('追蹤計畫：'); plan.forEach((t) => lines.push('  ・' + t)); }
    lines.push(...disclaimer());
    return lines.join('\n');
  }

  function lifestylePrescription(person, ev) {
    const its = LIFESTYLE.map((k) => ev.items[k]).filter((r) => r && RANK[r.level] >= 1);
    const lines = [`${person.name} 健康處方（生活型態追蹤）`, ''];
    for (const i of its) lines.push(...rxSection(i, person.sex), '');
    lines.push('追蹤：請持續到健康站量測腰圍、體重與體脂。', ...disclaimer());
    return lines.join('\n');
  }

  const RX = {
    bp: {
      yellow: ['每日鹽分 <6 公克（少醃漬、加工品、湯汁）', '每週累積 150 分鐘中等強度運動（快走、騎腳踏車）', '戒菸、節制飲酒，維持理想體重', '在家早晚各量一次血壓並記錄'],
      orange: ['4 週內至家醫科或心臟內科就醫；已服藥者回診調藥', '每日早晚量血壓並記錄，就醫時攜帶', '減鹽、規律運動'],
      red: ['今日就醫；出現胸痛、劇烈頭痛、言語不清、肢體無力立即撥 119', '依醫囑服藥，勿自行停藥'],
    },
    pulse: {
      yellow: ['留意頭暈、心悸、疲倦等症狀，若出現請告知護理師', '若有服用 β 阻斷劑，回診時告知醫師'],
      orange: ['4 週內就醫並安排心電圖', '減少咖啡因與酒精；記錄心悸發生時間'],
      red: ['今日就醫；胸痛、暈厥、呼吸困難立即撥 119'],
    },
    spo2: {
      yellow: ['量測前手部保暖、去除指甲油', '下次量測前休息 5 分鐘再量'],
      orange: ['4 週內就醫評估呼吸與心臟功能', '慢性肺病者依醫囑使用吸入劑'],
      red: ['今日就醫；呼吸困難、嘴唇發紺立即撥 119'],
    },
    temp: {
      yellow: ['多補充水分、休息，30 分鐘後重測', '留意咳嗽、喉嚨痛等症狀並戴口罩'],
      orange: ['依建議時限就醫，告知接觸史', '多喝水、休息、戴口罩'],
      red: ['今日送醫；意識改變、抽搐、呼吸困難立即撥 119'],
    },
    glucose: {
      yellow: ['少喝含糖飲料、精緻澱粉減量，三餐定時', '餐後散步 15–30 分鐘', '每週 150 分鐘運動'],
      orange: ['4 週內至家醫科或新陳代謝科就醫', '控糖飲食與運動處方'],
      red: ['低血糖：立即補充約 15 公克糖（半杯果汁或 3 顆方糖），15 分鐘後再量', '高血糖：今日就醫；意識不清撥 119'],
    },
    lipid: {
      yellow: ['減少油炸、甜食、酒精，多吃蔬菜與全穀', '每週 150 分鐘運動'],
      orange: ['4 週內就醫評估是否用藥', '飲食與運動處方'],
      red: ['1 週內優先轉診（有症狀當日）', 'LDL ≥190 請評估家族性高膽固醇血症，家人亦宜檢查'],
    },
    mets: {
      yellow: ['針對異常項目調整飲食與運動', '腰圍目標：男 <90 公分、女 <80 公分'],
      orange: ['納入代謝症候群防治計畫，4 週內就醫評估', '飲食、運動處方，3 個月後複測'],
    },
    body: {
      yellow: ['均衡飲食、足夠蛋白質；每週 150 分鐘運動加阻力訓練', '過輕者注意是否有不明原因體重下降'],
      orange: ['建立體重管理計畫：飲食記錄、每週 150 分鐘運動加阻力訓練', '目標 3–6 個月減重 5%'],
    },
  };

  // ───────────────────────── 名冊匯入正規化 ─────────────────────────
  const ID_LETTER = { A: 10, B: 11, C: 12, D: 13, E: 14, F: 15, G: 16, H: 17, I: 34, J: 18, K: 19, L: 20, M: 21, N: 22, O: 35, P: 23, Q: 24, R: 25, S: 26, T: 27, U: 28, V: 29, W: 32, X: 30, Y: 31, Z: 33 };
  function validTwId(s) {
    if (!s) return false;
    const id = String(s).trim().toUpperCase();
    if (!/^[A-Z][1289]\d{8}$/.test(id)) return false;
    const n = ID_LETTER[id[0]];
    let sum = Math.floor(n / 10) + (n % 10) * 9;
    for (let i = 1; i < 9; i++) sum += +id[i] * (9 - i);
    sum += +id[9];
    return sum % 10 === 0;
  }
  const looksLikeId = (s) => /^[A-Z][1289]\d{8}$/.test(String(s || '').trim().toUpperCase());

  function pad(n) { return String(n).padStart(2, '0'); }
  function parseBirth(v, today) {
    const now = today ? new Date(today) : new Date();
    const issues = [];
    if (v === null || v === undefined || v === '') return { value: null, issues: ['生日空白'] };
    if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(v)) v = v.slice(0, 10); // 本地日期＋時間＋時區：只取日期
    let y, m, d;
    if (v instanceof Date) { y = v.getFullYear(); m = v.getMonth() + 1; d = v.getDate(); }
    else if (typeof v === 'number' && v > 10000 && v < 80000) { const x = new Date(Math.round((v - 25569) * DAY)); y = x.getUTCFullYear(); m = x.getUTCMonth() + 1; d = x.getUTCDate(); }
    else {
      const s = String(v).trim().replace(/[年月]/g, '-').replace(/日/g, '').replace(/[.,*／/\\\s]+/g, '-');
      let mm = s.match(/^(\d{1,4})-(\d{1,2})-(\d{1,2})$/);
      if (!mm && /^\d{7,8}$/.test(s)) mm = [s, s.slice(0, s.length - 4), s.slice(-4, -2), s.slice(-2)];
      if (!mm) return { value: null, issues: [`生日無法解析：${String(v).slice(0, 12)}`] };
      y = +mm[1]; m = +mm[2]; d = +mm[3];
      if (mm[1].length <= 3 && y <= 150) { y += 1911; issues.push('民國年已轉西元'); }
      else if (mm[1].length === 4 && mm[1][0] === '0') return { value: null, issues: [`生日年份可疑：${String(v)}`] };
    }
    if (y > 2100) { y -= 1911; issues.push('年份疑似重複加 1911，已校正'); }
    if (y < 1900 || y > now.getFullYear()) return { value: null, issues: [`生日年份可疑：${y}`] };
    const dt = new Date(y, m - 1, d);
    if (dt.getMonth() !== m - 1 || dt.getDate() !== d) return { value: null, issues: [`生日日期不存在：${y}-${m}-${d}`] };
    const iso = `${y}-${pad(m)}-${pad(d)}`;
    const age = ageAt(iso, now);
    if (age < 18 || age > 115) issues.push(`年齡 ${age} 歲，請確認`);
    return { value: iso, issues };
  }

  // rows：二維陣列（第一列可能是標題）；回傳 {persons, issues, skipped}
  function parseRoster(rows, sheetName, today) {
    const headerIdx = rows.findIndex((r) => r && String(r[0] || '').trim().startsWith('個案姓名'));
    const start = headerIdx >= 0 ? headerIdx + 1 : 0;
    const persons = [], issues = [];
    let skipped = 0;
    const defaultSite = String(sheetName || '').replace(/^\d+[-_]/, '');
    for (let i = start; i < rows.length; i++) {
      const r = (rows[i] || []).map((c) => (c instanceof Date ? c : c === null || c === undefined ? '' : String(c).trim()));
      const name = String(r[0] || '').replace(/\s+/g, '');
      if (!name || /^\d+$/.test(name)) { if (r.some((c) => c !== '')) skipped++; continue; }
      const rowIssues = [];
      let id = String(r[5] || '').toUpperCase();
      if (!looksLikeId(id)) {
        const alt = r.map((c) => String(c).toUpperCase()).find(looksLikeId);
        if (alt) { id = alt; rowIssues.push('身分證號不在「識別值」欄，已自動找到'); }
        else { rowIssues.push('找不到有效身分證號'); id = ''; }
      }
      if (id && !validTwId(id)) rowIssues.push('身分證號檢查碼不符');
      let sex = { 男: 'M', 女: 'F', M: 'M', F: 'F' }[String(r[1]).toUpperCase()] || null;
      if (id) {
        const g = id[1] === '1' || id[1] === '8' ? 'M' : 'F';
        if (!sex) { sex = g; rowIssues.push('性別空白，依身分證號推定'); }
        else if (sex !== g) rowIssues.push('性別與身分證號不一致');
      } else if (!sex) rowIssues.push('性別空白');
      const b = parseBirth(r[2], today);
      rowIssues.push(...b.issues);
      let h = num(r[3]);
      if (h !== null && h > 0 && h < 3) { h = Math.round(h * 1000) / 10; rowIssues.push('身高以公尺填寫，已轉公分'); }
      if (h === null) rowIssues.push('身高空白');
      else if (h < 120 || h > 200) rowIssues.push(`身高 ${h} 公分，請確認`);
      const phone = String(r[6] || '').replace(/[^\d#]/g, '');
      persons.push({ name, sex, birth: b.value, heightCm: h, nationalId: id || null, phone: phone || null, site: String(r[7] || '').trim() || defaultSite, sheet: sheetName, row: i + 1 });
      if (rowIssues.length) issues.push({ sheet: sheetName, row: i + 1, name, issues: rowIssues });
    }
    return { persons, issues, skipped };
  }

  // ───────────────────────── 輸入驗證（資料完整性與安全） ─────────────────────────
  // 生理上合理的範圍；超出者視為輸入或設備錯誤，拒收
  const RANGES = { sbp: [50, 300], dbp: [20, 200], pulse: [20, 250], spo2: [50, 100], temp: [30, 45], glucose: [10, 1000], ldl: [10, 500], tg: [10, 5000], hdl: [5, 200], tc: [50, 800], ua: [0.5, 20], weight: [20, 300], bmi: [8, 80], waist: [30, 200], bodyFat: [2, 75], hba1c: [3, 20] };
  const RANGE_LABEL = { sbp: '收縮壓', dbp: '舒張壓', pulse: '脈搏', spo2: '血氧', temp: '體溫', glucose: '血糖', ldl: 'LDL', tg: '三酸甘油脂', hdl: 'HDL', tc: '總膽固醇', ua: '尿酸', weight: '體重', bmi: 'BMI', waist: '腰圍', bodyFat: '體脂率', hba1c: 'HbA1c' };
  function validateMeasurement(m) {
    const issues = [];
    for (const [k, [lo, hi]] of Object.entries(RANGES)) {
      if (m[k] === undefined || m[k] === null || m[k] === '') continue;
      const v = Number(m[k]);
      if (!isFinite(v) || v < lo || v > hi) issues.push(`${RANGE_LABEL[k]} ${m[k]} 超出合理範圍（${lo}–${hi}）`);
    }
    if (m.sbp != null && m.dbp != null && Number(m.dbp) >= Number(m.sbp)) issues.push('舒張壓不可高於或等於收縮壓');
    const t = new Date(m.at);
    if (isNaN(t)) issues.push('量測時間無法解析');
    else if (t - Date.now() > 5 * 60000) issues.push('量測時間在未來');
    return issues;
  }

  // 還原備份：只接受預期的結構、ID 格式與列舉值，防止竄改的備份檔注入內容
  const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/;
  const LEVEL_SET = new Set(['green', 'yellow', 'orange', 'red', 'na']);
  const STATE_SET = new Set(['detected', 'notified', 'intervened', 'confirmed', 'closed', 'pending', 'retested', 'judged']);
  function validateBackup(d) {
    const bad = (msg) => { throw new Error('備份檔驗證失敗：' + msg); };
    if (!d || typeof d !== 'object' || Array.isArray(d)) bad('格式不正確');
    for (const k of ['persons', 'measurements', 'episodes']) if (!Array.isArray(d[k])) bad(`缺少 ${k}`);
    if (d.persons.length > 200000 || d.measurements.length > 5000000 || d.episodes.length > 2000000) bad('資料量異常');
    const ids = new Set();
    for (const p of d.persons) {
      if (!p || !SAFE_ID.test(String(p.id))) bad('民眾編號格式不正確');
      if (typeof p.name !== 'string' || p.name.length > 50) bad('姓名格式不正確');
      if (p.sex != null && !['M', 'F'].includes(p.sex)) bad('性別格式不正確');
      if (p.site != null && (typeof p.site !== 'string' || p.site.length > 60)) bad('據點格式不正確');
      if (p.nationalId != null && !/^[A-Z][1289]\d{8}$/.test(p.nationalId)) bad('身分證號格式不正確');
      ids.add(p.id);
    }
    for (const m of d.measurements) {
      if (!m || !SAFE_ID.test(String(m.id)) || !ids.has(m.personId)) bad('量測紀錄對應不到民眾');
      if (isNaN(new Date(m.at))) bad('量測時間格式不正確');
      for (const k of Object.keys(RANGES)) if (m[k] != null && typeof m[k] !== 'number') bad('量測數值格式不正確');
    }
    for (const e of d.episodes) {
      if (!e || !SAFE_ID.test(String(e.id)) || !ids.has(e.personId)) bad('追蹤案對應不到民眾');
      if (!LEVEL_SET.has(e.level) || !LEVEL_SET.has(e.initialLevel || e.level)) bad('層級格式不正確');
      if (!STATE_SET.has(e.state)) bad('追蹤狀態格式不正確');
      if (!Array.isArray(e.log) || !Array.isArray(e.items)) bad('追蹤案內容不完整');
      for (const i of e.items) if (!ITEM_LABEL[i.key] || !LEVEL_SET.has(i.level)) bad('異常項目格式不正確');
    }
    return true;
  }

  // ───────────────────────── 資料匯入（單機版與伺服器版共用） ─────────────────────────
  // 欄位別名：依序比對，越前面越優先（例如「量測時間」優先於「更新時間」）
  const IMPORT_ALIAS = {
    id: ['識別值', '身分證', '證號', '個案編號', 'id'], at: ['量測時間', '測量時間', '時間', '日期'],
    sbp: ['收縮壓', 'sbp'], dbp: ['舒張壓', 'dbp'], pulse: ['脈搏', '心率', 'pulse', 'hr'],
    arr: ['心律旗標', 'arr', '心律', '房顫'], afib: ['afib', '心房顫動'],
    spo2: ['血氧', 'spo2'], temp: ['體溫', 'temp'], glucoseType: ['血糖類型', '血糖種類', '餐別'], glucose: ['血糖', 'glucose'],
    ldl: ['ldl', '低密度'], tg: ['三酸甘油', 'tg'], hdl: ['hdl', '高密度'], tc: ['總膽固醇', 'tc'], ua: ['尿酸', 'ua'],
    weight: ['體重', 'weight'], bmi: ['bmi'], waist: ['腰圍', 'waist'], bodyFat: ['體脂率', '體脂', 'fat'], symptoms: ['症狀'],
    name: ['姓名'], birth: ['生日', '出生'], sex: ['性別'],
  };
  const NUM_FIELDS = ['sbp', 'dbp', 'pulse', 'spo2', 'temp', 'glucose', 'ldl', 'tg', 'hdl', 'tc', 'ua', 'weight', 'bmi', 'waist', 'bodyFat'];
  // 排除會被誤認的欄位（例如「脈壓差」不是脈搏、「總體脂量」不是體脂率、「最高值」優先順序較低）
  const AVOID = { pulse: /最高|最低|脈壓/, glucose: /類|餐別/, bodyFat: /量\s*\(|kg/i, spo2: /最高/, at: /更新/ };
  const FLAG_YES = /^(y|yes|1|是|true|arr|afib|有|〇|○|●|◯|v|✓|✔)$/i;

  // 找標題列：前 15 列中同時有「識別值」與「量測時間」類欄位的那一列（報表常在前幾列放單位名稱、查詢期間）
  function findHeader(rows) {
    for (let i = 0; i < Math.min(15, rows.length); i++) {
      const h = (rows[i] || []).map((x) => String(x ?? '').trim().toLowerCase());
      const has = (k) => h.some((x) => x && IMPORT_ALIAS[k].some((a) => x.includes(a.toLowerCase())) && !(AVOID[k] && AVOID[k].test(x)));
      if (has('id') && has('at')) return i;
    }
    return -1;
  }
  // 欄位對應：同名欄位出現多次時（例如兩個「體重」），取有資料最多的那一欄
  function mapColumns(rows, hi) {
    const head = rows[hi].map((h) => String(h ?? '').trim().toLowerCase());
    const body = rows.slice(hi + 1, hi + 501);
    const filled = (j) => body.reduce((n, r) => n + (r && r[j] !== '' && r[j] !== null && r[j] !== undefined && r[j] !== '-' ? 1 : 0), 0);
    const col = {}, used = new Set();
    for (const [k, al] of Object.entries(IMPORT_ALIAS)) {
      let best = -1;
      for (const a of al) {
        const cands = head.map((h, j) => j).filter((j) => !used.has(j) && head[j].includes(a.toLowerCase()) && !(AVOID[k] && AVOID[k].test(head[j])));
        if (cands.length) { best = cands.reduce((x, y) => (filled(y) > filled(x) ? y : x)); break; }
      }
      // 血氧：報表只有最高／最低值時，取最低值（較保守）
      if (best < 0 && k === 'spo2') { const j = head.findIndex((h, jj) => !used.has(jj) && h.includes('血氧') && h.includes('最低')); if (j >= 0) best = j; }
      if (best >= 0) { col[k] = best; used.add(best); }
    }
    return col;
  }

  // 名冊合併：以身分證號比對，已存在者更新基本資料。allow(site) 可限制只能寫入有權限的據點
  function mergeRoster(db, roster, allow) {
    const byId = new Map(db.persons.filter((p) => p.nationalId).map((p) => [p.nationalId, p]));
    let add = 0, upd = 0, denied = 0;
    for (const r of roster) {
      if (allow && !allow(r.site)) { denied++; continue; }
      const ex = r.nationalId && byId.get(r.nationalId);
      if (ex) {
        if (allow && !allow(ex.site)) { denied++; continue; }
        Object.assign(ex, { name: r.name, sex: r.sex || ex.sex, birth: r.birth || ex.birth, heightCm: r.heightCm ?? ex.heightCm, phone: r.phone || ex.phone, site: r.site });
        upd++; continue;
      }
      const p = { id: uid('p'), name: r.name, sex: r.sex, birth: r.birth, heightCm: r.heightCm, nationalId: r.nationalId, phone: r.phone, site: r.site };
      db.persons.push(p); if (p.nationalId) byId.set(p.nationalId, p); add++;
    }
    return { add, upd, denied };
  }

  // 量測檔（第一列為標題）轉為量測紀錄並依時間逐筆判定。canWrite(person) 可限制據點權限
  function importMeasurementRows(db, rows, slaOverride, canWrite, opts) {
    const hi = findHeader(rows);
    if (hi < 0) throw new Error('找不到「識別值」（或 ID、身分證號）與「量測時間」欄位；請確認檔案前 15 列內有欄位標題列');
    const col = mapColumns(rows, hi);
    const createMissing = opts && opts.createMissing;
    const dryRun = opts && opts.dryRun; // 預覽：只統計，不寫入任何資料
    const key = new Map();
    for (const p of db.persons) { if (p.nationalId) key.set(p.nationalId, p); if (p.demoId) key.set(p.demoId, p); }
    const exist = new Set(db.measurements.map((m) => m.personId + '|' + m.at));
    const unmatched = new Set(); let bad = 0, dup = 0, invalid = 0, denied = 0, created = 0; const add = [];
    for (const r of rows.slice(hi + 1)) {
      if (!Array.isArray(r) || r.every((c) => c === '' || c === null)) continue;
      const rid = String(r[col.id] ?? '').trim().toUpperCase();
      if (!rid) continue;
      let p = key.get(rid);
      // 名冊沒有的民眾：選擇自動建檔時，以量測檔的姓名、性別、生日建立（只接受有效格式的身分證號）
      if (!p && createMissing && /^[A-Z][1289]\d{8}$/.test(rid)) {
        const sx = col.sex !== undefined ? String(r[col.sex] ?? '').trim().toUpperCase() : '';
        const b = col.birth !== undefined ? parseBirth(r[col.birth]).value : null;
        p = { id: uid('p'), name: col.name !== undefined ? String(r[col.name] ?? '').replace(/\s+/g, '').slice(0, 50) || '（未填）' : '（未填）', sex: { 男: 'M', 女: 'F', M: 'M', F: 'F' }[sx] || (rid[1] === '1' || rid[1] === '8' ? 'M' : 'F'), birth: b, heightCm: null, nationalId: rid, phone: null, site: (opts && opts.site) || '未分據點' };
        if (canWrite && !canWrite(p)) { denied++; continue; }
        if (!dryRun) db.persons.push(p);
        key.set(rid, p); created++;
      }
      if (!p) { unmatched.add(rid); continue; }
      if (canWrite && !canWrite(p)) { denied++; continue; }
      const t = r[col.at] instanceof Date ? r[col.at] : new Date(String(r[col.at]).replace(/\//g, '-').replace(' ', 'T'));
      if (isNaN(t)) { bad++; continue; }
      const m = { id: uid('m'), personId: p.id, at: t.toISOString(), source: 'import' };
      for (const k of NUM_FIELDS) if (col[k] !== undefined && r[col[k]] !== '' && r[col[k]] !== null && !isNaN(+r[col[k]])) m[k] = +r[col[k]];
      if ((col.arr !== undefined && FLAG_YES.test(String(r[col.arr] ?? '').trim())) || (col.afib !== undefined && FLAG_YES.test(String(r[col.afib] ?? '').trim()))) m.arr = true;
      if (col.glucoseType !== undefined && m.glucose !== undefined) m.glucoseType = String(r[col.glucoseType] || '隨機').slice(0, 10);
      if (col.symptoms !== undefined && r[col.symptoms]) m.symptoms = String(r[col.symptoms]).split(/[、,，;；]/).map((x) => SYMPTOM_BY_LABEL[x.trim()] || null).filter(Boolean);
      if (exist.has(m.personId + '|' + m.at)) { dup++; continue; }
      if (validateMeasurement(m).length) { invalid++; continue; }
      exist.add(m.personId + '|' + m.at);
      add.push(m);
    }
    add.sort((a, b) => new Date(a.at) - new Date(b.at));
    const LABEL = { id: '識別值', at: '量測時間', sbp: '收縮壓', dbp: '舒張壓', pulse: '脈搏', arr: '心律旗標', afib: 'AFib', spo2: '血氧', temp: '體溫', glucoseType: '血糖類型', glucose: '血糖', ldl: 'LDL', tg: '三酸甘油脂', hdl: 'HDL', tc: '總膽固醇', ua: '尿酸', weight: '體重', bmi: 'BMI', waist: '腰圍', bodyFat: '體脂率', symptoms: '症狀', name: '姓名', birth: '生日', sex: '性別' };
    const summary = {
      dup, bad, invalid, denied, created, headerRow: hi + 1, columns: Object.keys(col), columnLabels: Object.keys(col).map((k) => LABEL[k] || k),
      people: new Set(add.map((m) => m.personId)).size,
      from: add.length ? add[0].at : null, to: add.length ? add[add.length - 1].at : null,
      unmatched: [...unmatched].map(maskId),
    };
    if (dryRun) return Object.assign(summary, { added: add.length, dryRun: true });
    const last = new Map();
    for (const m of add) { db.measurements.push(m); const res = ingest(db, m.personId, m.at, slaOverride); if (res) last.set(m.personId, res.ev.overall); }
    const levels = { red: 0, orange: 0, yellow: 0 };
    for (const l of last.values()) if (l in levels) levels[l]++;
    return Object.assign(summary, { added: add.length, levels });
  }

  function maskId(id) { return id ? id.slice(0, 2) + '****' + id.slice(-4) : '—'; }
  function maskName(n) { if (!n) return ''; const a = [...n]; return a.length <= 2 ? a[0] + 'Ｏ' : a[0] + 'Ｏ'.repeat(a.length - 2) + a[a.length - 1]; }

  // ───────────────────────── 健康 888 ─────────────────────────
  // 只看三高項目（血壓、血糖、血脂）；每個場次的「三高層級」取這三項中最高者。
  // 找得出：名冊民眾中，健康站量測三高項目至少 1 次
  // 要介入：至少一次三高層級達黃層以上的民眾中，進入管理流程（三高項目的追蹤案）
  // 有改善：至少一次三高層級達橙層以上的民眾中，曾經降級過
  //         降級＝之後的量測低於先前最高層級；預設需連續 2 個場次（與文件「連續 2 次才降級」一致）
  const KEYS_888 = ['bp', 'glucose', 'lipid'];
  const DEFAULT_888 = { lookbackDays: 365, entry: 'notified', downgrade: 2, target: 0.8 };
  const ENTRY_888 = { notified: '已通知（派案並通知民眾）', intervened: '已介入（完成健康處方）', confirmed: '已確認（就醫或完成處方）' };
  const DOWNGRADE_888 = { 2: '連續 2 個場次低於先前最高層級', 1: '任 1 個場次低於先前最高層級' };

  function level888(ev) {
    const ls = KEYS_888.map((k) => ev.items[k]).filter((r) => r && r.level !== 'na').map((r) => r.level);
    return ls.length ? maxLevel(ls) : 'na';
  }

  // 首次達橙層以上之後，是否曾降級
  function improved888(levels, need) {
    const first = levels.findIndex((l) => RANK[l] >= 2);
    if (first < 0) return false;
    let peak = levels[first], run = 0;
    for (const l of levels.slice(first + 1)) {
      if (l === 'na') continue;
      if (RANK[l] < RANK[peak]) { if (++run >= need) return true; } else run = 0;
      if (RANK[l] > RANK[peak]) peak = l;
    }
    return false;
  }

  function cascade888(db, now, opts, filter) {
    const o = Object.assign({}, DEFAULT_888, opts || {});
    const t = new Date(now || Date.now());
    const since = o.lookbackDays ? addDays(t, -o.lookbackDays) : new Date(0);
    const inWin = (iso) => iso && new Date(iso) >= since && new Date(iso) <= t;
    const persons = db.persons.filter((p) => !filter || filter(p));
    const mBy = new Map(), eBy = new Map();
    for (const m of db.measurements) { if (!mBy.has(m.personId)) mBy.set(m.personId, []); mBy.get(m.personId).push(m); }
    for (const e of db.episodes) { if (!eBy.has(e.personId)) eBy.set(e.personId, []); eBy.get(e.personId).push(e); }
    const ids = { unscreened: [], yellowUnmanaged: [], orangeNotImproved: [] };
    let screened = 0, visits = 0, everY = 0, mgY = 0, everO = 0, imp = 0;
    for (const p of persons) {
      const levels = groupSessions(mBy.get(p.id) || []).filter((s) => inWin(s.at))
        .map((s) => level888(evaluateSession(personCtx(p, s.at), s.readings))).filter((l) => l !== 'na');
      if (!levels.length) { ids.unscreened.push(p.id); continue; }
      screened++; visits += levels.length;
      const top = maxLevel(levels);
      if (RANK[top] < 1) continue;
      everY++;
      const managed = (eBy.get(p.id) || []).some((e) => e.items.some((i) => KEYS_888.includes(i.key) && RANK[i.level] >= 1) && e.log.some((l) => l.type === o.entry && inWin(l.at)));
      if (managed) mgY++; else ids.yellowUnmanaged.push(p.id);
      if (RANK[top] >= 2) {
        everO++;
        if (improved888(levels, +o.downgrade || 2)) imp++; else ids.orangeNotImproved.push(p.id);
      }
    }
    const need = (k, n) => Math.max(0, Math.ceil(o.target * n - 1e-9) - k);
    return {
      opts: o, registered: persons.length, visits,
      find: Object.assign(wilson(screened, persons.length), { need: need(screened, persons.length) }),
      intervene: Object.assign(wilson(mgY, everY), { need: need(mgY, everY) }),
      improve: Object.assign(wilson(imp, everO), { need: need(imp, everO) }),
      ids,
    };
  }

  const Engine = {
    LEVELS, RANK, LEVEL_LABEL, LEVEL_MEANING, ITEMS, ITEM_LABEL, SYMPTOMS, SYMPTOM_BY_LABEL, ASSUMPTIONS, DEFAULT_SLA, CLOSE_REASONS,
    STATES, OPEN_STATES, STATE_LABEL, isOpen, recheckOverdue, SCHEMA, migrateWorkflow, GLU_TYPE, RX, DEFAULT_888, ENTRY_888, DOWNGRADE_888, KEYS_888, cascade888,
    LIFESTYLE, lifestylePrescription, RANGES, validateMeasurement, validateBackup, mergeRoster, importMeasurementRows, IMPORT_ALIAS, RULES_VERSION, REGRADE_CLOSE, regradeOpen,
    maxLevel, evaluateSession, groupSessions, ingest, act, nextStep, quality, wilson, prescription,
    parseRoster, parseBirth, validTwId, maskId, maskName, ageAt, addDays, sameDay, normGluType, uid,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = Engine;
  else root.Engine = Engine;
})(typeof window !== 'undefined' ? window : globalThis);
