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
    '血壓黃層文件寫「130–139 且 80–89」，若照字面 135/75 將無層級；本系統採「收縮壓 130–139 或舒張壓 80–89（且未達橙）」。',
    '血壓黃層「若 ≥130/80 則升橙」與橙層閾值 ≥140/90 不一致，本系統以複測達 ≥140/90 才升橙；請臨床委員會確認原意。',
    '代謝症候群的血壓判準採國健署標準 ≥130/85（與血壓分層 130/80 不同），血糖判準僅用空腹血糖；已服藥者該項視為符合。',
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
    if (sbp >= 180 || dbp >= 110 || ((sbp >= 160 || dbp >= 100) && bpSx)) {
      const r = result('bp', 'red', v, sbp >= 180 || dbp >= 110 ? '≥180 或 ≥110' : '≥160/100 並有胸痛、劇烈頭痛、言語不清或肢體無力', {
        actions: ['休息 5 分鐘後重測', bpSx ? '有症狀：立即撥 119' : '無症狀仍須當日就醫', '健康處方'],
      });
      if (s.length < 2 && !bpSx) { r.provisional = true; r.notes.push('單次量測，請休息 5 分鐘後重測；重測未降仍須當日就醫'); }
      if (bpSx) r.emergency = true;
      return r;
    }
    if (sbp >= 140 || dbp >= 90) return result('bp', 'orange', v, '≥140 或 ≥90', { actions: ['轉介家醫科或心臟內科', '已服藥者回診調藥', '健康處方'] });
    if (sbp >= 130 || dbp >= 80) return result('bp', 'yellow', v, '收縮壓 130–139 或舒張壓 80–89', { actions: ['健康處方（減鹽、運動、體重控制）'] });
    return result('bp', 'green', v, '<130/80', { actions: ['回饋，維持生活型態'] });
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
    const bmi = h && w ? w / Math.pow(h / 100, 2) : null;
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
    const actions = { green: ['回饋'], yellow: ['營養與運動處方', bmi !== null && bmi < 18.5 ? '評估是否為不明原因體重下降或肌少症' : null, '健康處方'].filter(Boolean), orange: ['轉介營養師或肥胖門診', '建立體重管理計畫', '健康處方'] }[lv];
    return result('body', lv, parts.join('、'), why.join('；') || '達標', { actions, bmi });
  }

  const EVALUATORS = { bp: evalBP, pulse: evalPulse, spo2: evalSpO2, temp: evalTemp, glucose: evalGlucose, lipid: evalLipid, mets: evalMetS, body: evalBody };

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
    const graded = Object.values(items).filter((r) => r.level !== 'na');
    const overall = graded.length ? maxLevel(graded.map((r) => r.level)) : 'na';
    return {
      overall,
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
  // 偵測 → 待派案 → 已通知 → 已介入 → 已確認（就醫或完成處方）→ 已複測 → 判定
  const STATES = ['detected', 'pending', 'notified', 'intervened', 'confirmed', 'retested', 'judged'];
  const STATE_LABEL = { detected: '偵測', pending: '待派案', notified: '已通知', intervened: '已介入', confirmed: '已確認', retested: '已複測', judged: '判定' };
  const OUTCOME_LABEL = { downgrade: '降級', maintain: '維持', upgrade: '升級', close: '結案' };

  function personCtx(person, at) {
    return Object.assign({}, person, { age: ageAt(person.birth, at) });
  }

  function computeDue(ep, sla, items) {
    const lv = ep.level, from = ep.levelAt || ep.detectedAt;
    const atLevel = items.filter((i) => i.level === lv);
    const minT = (k, dflt) => atLevel.reduce((m, i) => (i.timing && i.timing[k] !== undefined ? Math.min(m, i.timing[k]) : m), dflt ?? Infinity);
    const confirmDays = minT('confirmDays', sla.confirm[lv]);
    const retestDays = minT('retestDays', sla.retest[lv] ?? Infinity);
    return {
      notify: dueBy(from, sla.notify[lv]),
      intervene: dueBy(from, Math.min(sla.intervene[lv], confirmDays)),
      confirm: dueBy(from, confirmDays),
      retest: retestDays === Infinity ? null : dueBy(from, retestDays),
    };
  }

  let seq = 0;
  const uid = (p) => `${p}_${Date.now().toString(36)}${(++seq).toString(36)}${Math.random().toString(36).slice(2, 6)}`;

  function log(ep, at, type, text, by) { ep.log.push({ at, type, text, by: by || '系統' }); }

  function summarizeItems(ev) {
    return Object.values(ev.items).filter((r) => RANK[r.level] >= 1).map((r) => ({ key: r.key, level: r.level, value: r.value, reason: r.reason, provisional: r.provisional, timing: r.timing }));
  }

  function newEpisode(db, person, session, ev, at, parent, sla) {
    const ep = {
      id: uid('ep'), personId: person.id, cycle: parent ? parent.cycle + 1 : 1, parentId: parent ? parent.id : null,
      level: ev.overall, initialLevel: ev.overall, items: summarizeItems(ev), emergency: ev.emergency, provisional: ev.provisional,
      state: 'pending', detectedAt: session.at, levelAt: at, detectSessionId: session.id, createdAt: at,
      sessions: [session.id], log: [],
    };
    ep.due = computeDue(ep, sla, ep.items);
    log(ep, session.at, 'detected', `偵測：${LEVEL_LABEL[ep.level]}層（${ep.items.filter((i) => i.level === ep.level).map((i) => ITEM_LABEL[i.key]).join('、')}）`);
    log(ep, at, 'pending', '進入待派案');
    db.episodes.push(ep);
    return ep;
  }

  function openEpisode(db, personId) {
    return db.episodes.find((e) => e.personId === personId && e.state !== 'judged');
  }

  function sessionsOf(db, personId, sla) {
    return groupSessions(db.measurements.filter((m) => m.personId === personId), sla.sessionMinutes);
  }

  /**
   * 新量測進來後重新評估該個案（設備 / App 回傳或手動輸入時呼叫）。
   * 回傳本次場次的判定結果。
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

    if (!ep) {
      if (RANK[ev.overall] >= 1) ep = newEpisode(db, person, session, ev, at, null, sla);
      return { ev, episode: ep };
    }

    const sameSession = ep.sessions.includes(session.id) || ep.detectSessionId === session.id;
    if (!sameSession) ep.sessions.push(session.id);

    // 同一場次內的重測：直接以最新判定取代（重測正常可回綠）
    if (sameSession && ['pending', 'notified'].includes(ep.state)) {
      if (ev.overall !== ep.level) {
        const prev = ep.level;
        if (RANK[ev.overall] <= 0) {
          ep.level = ev.overall === 'na' ? prev : 'green';
          log(ep, at, 'judged', `同場次重測已回綠，系統結案（原 ${LEVEL_LABEL[prev]}層）`);
          ep.state = 'judged';
          ep.judge = { at, outcome: 'close', reason: '同場次重測正常', toLevel: 'green', by: '系統' };
          return { ev, episode: ep };
        }
        ep.level = ev.overall; ep.levelAt = at;
        log(ep, at, RANK[ev.overall] > RANK[prev] ? 'upgraded' : 'regraded', `同場次重測：${LEVEL_LABEL[prev]} → ${LEVEL_LABEL[ev.overall]}`);
      }
      ep.items = summarizeItems(ev); ep.emergency = ev.emergency; ep.provisional = ev.provisional;
      ep.due = computeDue(ep, sla, ep.items);
      return { ev, episode: ep };
    }

    // 新場次
    if (RANK[ev.overall] > RANK[ep.level] && ['pending', 'notified', 'intervened', 'confirmed'].includes(ep.state)) {
      const prev = ep.level;
      ep.level = ev.overall; ep.levelAt = at; ep.items = summarizeItems(ev); ep.emergency = ev.emergency; ep.provisional = ev.provisional;
      ep.state = 'pending';
      ep.due = computeDue(ep, sla, ep.items);
      delete ep.notify; delete ep.intervene; delete ep.confirm;
      log(ep, at, 'upgraded', `新量測升級：${LEVEL_LABEL[prev]} → ${LEVEL_LABEL[ev.overall]}，重新派案`);
      return { ev, episode: ep };
    }
    if (['confirmed', 'retested'].includes(ep.state) || (ep.level === 'red' && ep.phone && ep.phone.at)) {
      ep.state = 'retested';
      ep.retest = { at: session.at, sessionId: session.id, level: ev.overall };
      log(ep, at, 'retested', `已複測：${LEVEL_LABEL[ev.overall]}層`);
      ep.suggestion = suggestJudgement(db, ep, sla);
      return { ev, episode: ep };
    }
    log(ep, at, 'measured', `新量測（${LEVEL_LABEL[ev.overall]}層），流程尚未到複測階段`);
    return { ev, episode: ep };
  }

  // 降級規則：達標後連續 2 次維持才降級；升級立即；慢性病不直接結案
  function suggestJudgement(db, ep, sla) {
    const person = db.persons.find((p) => p.id === ep.personId);
    const sessions = sessionsOf(db, ep.personId, sla).filter((s) => new Date(s.at) > new Date(ep.detectedAt) && s.id !== ep.detectSessionId);
    const levels = sessions.map((s) => evaluateSession(personCtx(person, s.at), s.readings).overall).filter((l) => l !== 'na');
    if (!levels.length) return null;
    const lastLv = levels[levels.length - 1];
    if (RANK[lastLv] > RANK[ep.level]) return { outcome: 'upgrade', toLevel: lastLv, text: `複測 ${LEVEL_LABEL[lastLv]}層，高於目前層級，建議升級` };
    if (RANK[lastLv] === RANK[ep.level]) return { outcome: 'maintain', toLevel: ep.level, text: '複測層級未變，建議維持並開啟下一追蹤週期' };
    let run = 0;
    for (let i = levels.length - 1; i >= 0 && RANK[levels[i]] < RANK[ep.level]; i--) run++;
    if (run >= 2) {
      const to = maxLevel(levels.slice(-2));
      if (to === 'green') return { outcome: 'close', toLevel: 'green', reason: '達標回例行量測', text: '連續 2 次達綠層，建議結案回例行量測（慢性病者請改選「已轉由醫師持續管理」）' };
      return { outcome: 'downgrade', toLevel: to, text: `連續 2 次低於目前層級，建議降級為 ${LEVEL_LABEL[to]}層` };
    }
    return { outcome: 'maintain', toLevel: ep.level, text: `複測 ${LEVEL_LABEL[lastLv]}層，但需連續 2 次達標才降級，建議維持並縮短複測` };
  }

  /**
   * 護理師操作。action ∈ assign|notify|intervene|confirm|phone|retestManual|judge
   */
  function act(db, epId, action, payload, now, by, slaOverride) {
    const sla = Object.assign({}, DEFAULT_SLA, slaOverride || {});
    const ep = db.episodes.find((e) => e.id === epId);
    if (!ep) throw new Error('找不到追蹤案');
    if (ep.state === 'judged') throw new Error('此追蹤案已判定，請於下一週期操作');
    const at = now || new Date().toISOString();
    const p = payload || {};
    switch (action) {
      case 'assign':
        ep.assignee = p.assignee; log(ep, at, 'assign', `派案給 ${p.assignee}`, by); break;
      case 'notify':
        if (ep.state !== 'pending') throw new Error('僅待派案可執行通知');
        if (p.assignee) ep.assignee = p.assignee;
        ep.notify = { at, method: p.method || '電話', by };
        ep.state = 'notified';
        log(ep, at, 'notified', `已通知民眾（${ep.notify.method}）${p.note ? '：' + p.note : ''}`, by); break;
      case 'intervene':
        if (ep.state !== 'notified') throw new Error('需先完成通知');
        if (!p.rx) throw new Error('只要有異常就要完成健康處方');
        ep.intervene = { at, by, note: p.note || '' };
        ep.rx = { at, text: p.rx, by };
        ep.state = 'intervened';
        log(ep, at, 'intervened', `已介入並開立健康處方${p.note ? '：' + p.note : ''}`, by); break;
      case 'confirm': {
        if (ep.state !== 'intervened') throw new Error('需先完成介入');
        const needVisit = RANK[ep.level] >= 2;
        if (needVisit && !p.visitDate) throw new Error('橙／紅層需登記就醫日期');
        ep.confirm = { at, by, type: needVisit ? 'visit' : 'rx', visitDate: p.visitDate || null, facility: p.facility || '', result: p.result || '' };
        ep.state = 'confirmed';
        if (ep.level === 'red') ep.phone = { due: dueBy(p.visitDate || at, sla.phoneAfterVisit) };
        if (ep.level !== 'red') ep.due.retest = ep.due.retest || dueBy(ep.levelAt || ep.detectedAt, sla.retest[ep.level]);
        log(ep, at, 'confirmed', needVisit ? `已確認就醫：${p.visitDate} ${p.facility || ''} ${p.result || ''}`.trim() : '已確認完成健康處方／衛教', by); break;
      }
      case 'phone':
        if (ep.level !== 'red' || ep.state !== 'confirmed') throw new Error('電訪確認適用於已確認就醫的紅層');
        ep.phone = Object.assign(ep.phone || {}, { at, note: p.note || '', by });
        ep.state = 'retested';
        ep.retest = { at, level: null, byPhone: true };
        log(ep, at, 'phone', `就醫後電訪確認：${p.note || '完成'}`, by); break;
      case 'judge': {
        if (ep.state !== 'retested') throw new Error('需完成複測（紅層為電訪）才能判定');
        const outcome = p.outcome;
        if (!OUTCOME_LABEL[outcome]) throw new Error('判定結果不正確');
        if (outcome === 'close') {
          if (!CLOSE_REASONS.includes(p.reason)) throw new Error('結案原因限：' + CLOSE_REASONS.join('、'));
          if (p.reason === '已轉由醫師持續管理' && !p.followupDate) throw new Error('轉由醫師持續管理需登記回診日期');
        }
        ep.judge = { at, outcome, toLevel: p.toLevel || ep.level, reason: p.reason || '', followupDate: p.followupDate || null, by };
        ep.state = 'judged';
        log(ep, at, 'judged', `判定：${OUTCOME_LABEL[outcome]}${p.reason ? '（' + p.reason + '）' : ''}${outcome !== 'close' ? ' → ' + LEVEL_LABEL[ep.judge.toLevel] + '層' : ''}`, by);
        if (outcome !== 'close') {
          const to = ep.judge.toLevel;
          if (to === 'green') break; // 降到綠：回例行量測，不再開案
          const person = db.persons.find((x) => x.id === ep.personId);
          const items = ep.items.map((i) => Object.assign({}, i, { level: RANK[i.level] > RANK[to] ? to : i.level }));
          const next = {
            id: uid('ep'), personId: person.id, cycle: ep.cycle + 1, parentId: ep.id, level: to, initialLevel: to, items,
            state: 'pending', detectedAt: at, levelAt: at, detectSessionId: ep.retest && ep.retest.sessionId, createdAt: at, sessions: [], log: [],
          };
          next.due = computeDue(next, sla, items);
          log(next, at, 'pending', `第 ${next.cycle} 週期（${OUTCOME_LABEL[outcome]}自上一週期）`, by);
          db.episodes.push(next);
          ep.judge.nextId = next.id;
        }
        break;
      }
      case 'close': // 任何階段的非臨床結案：死亡、遷出、失聯、拒絕
        if (!['死亡', '遷出', '失聯', '拒絕'].includes(p.reason)) throw new Error('提前結案原因限：死亡、遷出、失聯、拒絕');
        ep.judge = { at, outcome: 'close', toLevel: ep.level, reason: p.reason, by };
        ep.state = 'judged';
        log(ep, at, 'judged', `結案（${p.reason}）${p.note ? '：' + p.note : ''}`, by); break;
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
      case 'pending': return mk(ep.level === 'red' ? '當日派案並通知民眾' : '派案並通知民眾', ep.due.notify);
      case 'notified': return mk('介入並開立健康處方', ep.due.intervene);
      case 'intervened': return mk(RANK[ep.level] >= 2 ? (ep.level === 'red' ? '24 小時內確認就醫' : '確認 4 週內就醫') : '確認完成健康處方／衛教', ep.due.confirm);
      case 'confirmed':
        if (ep.level === 'red') return mk('就醫後 2 週電訪確認', ep.phone && ep.phone.due);
        return mk('到期複測', ep.due.retest);
      case 'retested': return mk('判定：降級／維持／升級／結案', null);
      default: return mk('—', null);
    }
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
   * 品質指標：紅層當日處理率、橙層就醫確認率、複測完成率、降級（達標）率、未閉環個案數與原因
   * windowDays：以偵測日落在期間內的追蹤週期為母群
   */
  function quality(db, now, windowDays, filter) {
    const t = new Date(now || Date.now());
    const since = windowDays ? addDays(t, -windowDays) : new Date(0);
    const eps = db.episodes.filter((e) => new Date(e.detectedAt) >= since && (!filter || filter(e)));

    const red = eps.filter((e) => e.initialLevel === 'red');
    const redSameDay = red.filter((e) => { const iv = firstLog(e, 'intervened'); return iv && sameDay(iv.at, e.detectedAt); });

    const orangeDue = eps.filter((e) => e.initialLevel === 'orange' && (e.confirm || (e.due.confirm && new Date(e.due.confirm) < t)) && !(e.judge && ['死亡', '遷出'].includes(e.judge.reason)));
    const orangeOk = orangeDue.filter((e) => e.confirm && e.confirm.type === 'visit' && new Date(e.confirm.at) <= new Date(e.due.confirm));

    const retestDue = eps.filter((e) => e.level !== 'red' && e.due.retest && new Date(e.due.retest) < t && !(e.judge && ['死亡', '遷出'].includes(e.judge.reason)));
    const retestDone = retestDue.filter((e) => e.retest);

    const judged = eps.filter((e) => e.state === 'judged' && e.judge && !['死亡', '遷出', '失聯', '拒絕'].includes(e.judge.reason) && e.judge.reason !== '同場次重測正常');
    const improved = judged.filter((e) => e.judge.outcome === 'downgrade' || (e.judge.outcome === 'close' && e.judge.reason === '達標回例行量測'));

    const open = db.episodes.filter((e) => e.state !== 'judged' && (!filter || filter(e)));
    const stuck = open.map((e) => ({ e, s: nextStep(e, t) })).filter((x) => x.s.overdue);
    const byReason = {};
    for (const x of stuck) {
      const k = `停在「${STATE_LABEL[x.e.state]}」：${x.s.label}逾期`;
      byReason[k] = (byReason[k] || 0) + 1;
    }
    const closeReasons = {};
    for (const e of eps.filter((e) => e.state === 'judged' && e.judge.outcome === 'close')) closeReasons[e.judge.reason] = (closeReasons[e.judge.reason] || 0) + 1;

    return {
      redSameDay: wilson(redSameDay.length, red.length),
      orangeConfirm: wilson(orangeOk.length, orangeDue.length),
      retest: wilson(retestDone.length, retestDue.length),
      improve: wilson(improved.length, judged.length),
      openCount: open.length,
      unclosed: stuck.length,
      unclosedReasons: byReason,
      closeReasons,
      episodes: eps.length,
    };
  }

  // ───────────────────────── 健康處方 ─────────────────────────
  function prescription(person, ep) {
    const lines = [`${person.name} 健康處方（${LEVEL_LABEL[ep.level]}層，第 ${ep.cycle} 週期）`, ''];
    for (const i of ep.items) {
      const tpl = RX[i.key] && RX[i.key][i.level];
      lines.push(`■ ${ITEM_LABEL[i.key]}：${i.value}（${LEVEL_LABEL[i.level]}）`);
      if (tpl) tpl.forEach((t) => lines.push('  ・' + t));
    }
    const follow = { red: '就醫後 2 週內護理師將電話關懷確認', orange: '請於 4 週內就醫，3 個月內回健康站複測', yellow: '請於 6 個月內回健康站複測' }[ep.level];
    lines.push('', '追蹤：' + follow);
    if (ep.level === 'red') lines.push('如出現胸痛、呼吸困難、意識改變、言語不清或肢體無力，請立即撥打 119。');
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
      orange: ['轉介營養師或肥胖門診，建立體重管理計畫', '目標 3–6 個月減重 5%'],
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

  function maskId(id) { return id ? id.slice(0, 2) + '****' + id.slice(-4) : '—'; }
  function maskName(n) { if (!n) return ''; const a = [...n]; return a.length <= 2 ? a[0] + 'Ｏ' : a[0] + 'Ｏ'.repeat(a.length - 2) + a[a.length - 1]; }

  // ───────────────────────── 健康 888（三高防治 888 計畫） ─────────────────────────
  // 國家目標：8 成三高個案加入照護網 → 其中 8 成接受生活型態諮詢 → 其中 8 成控制良好（整體 0.8³ = 51.2%）。
  // 官方的「控制良好」數值與社區端的納入定義未見公開明文，以下皆為可調參數。
  const DEFAULT_888 = {
    lookbackDays: 365,        // 找出／介入的觀察期
    recentDays: 180,          // 判斷控制所需的最近量測期限
    minAbnormalSessions: 2,   // 社區量測需 ≥2 個場次達橙層以上才算「找出」（降低單次量測偽陽性）
    bp: { sbp: 130, dbp: 80 },
    hba1c: 7,                 // 有 HbA1c 時優先使用
    fpg: 130,                 // 無 HbA1c 時：空腹血糖 70–<130
    nonFasting: 180,          // 無 HbA1c 時：飯後／隨機血糖 70–<180
    ldl: 100,
  };
  const DOMAINS_888 = [
    { key: 'htn', label: '高血壓', item: 'bp', med: 'medHTN' },
    { key: 'dm', label: '高血糖', item: 'glucose', med: 'medDM' },
    { key: 'lipid', label: '高血脂', item: 'lipid', med: 'medLipid' },
  ];

  function controlled888(domain, ms, o, t) {
    const recent = addDays(t, -o.recentDays);
    const last = (f, pred) => ms.filter((m) => num(m[f]) !== null && new Date(m.at) >= recent && new Date(m.at) <= t && (!pred || pred(m))).pop();
    if (domain === 'htn') {
      const m = last('sbp'); if (!m) return null;
      return num(m.sbp) < o.bp.sbp && num(m.dbp) < o.bp.dbp;
    }
    if (domain === 'dm') {
      const a = last('hba1c'); if (a) return num(a.hba1c) < o.hba1c;
      const g = last('glucose'); if (!g) return null;
      const x = num(g.glucose);
      return x >= 70 && x < (normGluType(g.glucoseType) === 'fasting' ? o.fpg : o.nonFasting);
    }
    const l = last('ldl'); if (!l) return null;
    return num(l.ldl) < o.ldl;
  }

  /**
   * 健康 888 照護串聯（cascade）。filter(person) 用於據點篩選。
   * 回傳 screened（篩檢涵蓋率）與各疾病別：找出人數、入網率、諮詢率、控制率、整體達標率、各缺口名單。
   */
  function cascade888(db, now, opts, filter) {
    const o = Object.assign({}, DEFAULT_888, opts || {}, { bp: Object.assign({}, DEFAULT_888.bp, (opts && opts.bp) || {}) });
    const t = new Date(now || Date.now()), since = addDays(t, -o.lookbackDays);
    const inWin = (iso) => iso && new Date(iso) >= since && new Date(iso) <= t;
    const persons = db.persons.filter((p) => !filter || filter(p));
    const mBy = new Map(), eBy = new Map();
    for (const m of db.measurements) { if (!mBy.has(m.personId)) mBy.set(m.personId, []); mBy.get(m.personId).push(m); }
    for (const e of db.episodes) { if (!eBy.has(e.personId)) eBy.set(e.personId, []); eBy.get(e.personId).push(e); }
    const rows = persons.map((p) => {
      const ms = (mBy.get(p.id) || []).slice().sort((a, b) => new Date(a.at) - new Date(b.at));
      const evs = groupSessions(ms).filter((s) => inWin(s.at)).map((s) => evaluateSession(personCtx(p, s.at), s.readings));
      return { p, ms, evs, eps: eBy.get(p.id) || [] };
    });
    const screened = rows.filter((r) => r.evs.some((ev) => ev.items.bp || ev.items.glucose || ev.items.lipid)).length;
    const out = { screened: wilson(screened, persons.length), unscreened: rows.filter((r) => !r.evs.some((ev) => ev.items.bp || ev.items.glucose || ev.items.lipid)).map((r) => r.p.id), domains: {}, opts: o };
    for (const d of DOMAINS_888) {
      const ids = { identified: [], notJoined: [], notCounselled: [], notControlled: [], noData: [], controlled: [] };
      let j = 0, c = 0, k = 0;
      for (const r of rows) {
        const abn = r.evs.filter((ev) => ev.items[d.item] && RANK[ev.items[d.item].level] >= 2).length;
        const a1c = d.key === 'dm' && r.ms.some((m) => num(m.hba1c) !== null && num(m.hba1c) >= 6.5 && inWin(m.at));
        if (!(r.p[d.med] || abn >= o.minAbnormalSessions || a1c)) continue;
        ids.identified.push(r.p.id);
        const touches = (e) => e.items.some((i) => i.key === d.item);
        const joined = !!(r.p.careNet && r.p.careNet[d.key]) || r.eps.some((e) => touches(e) && ((e.confirm && e.confirm.type === 'visit' && inWin(e.confirm.at)) || (e.judge && e.judge.reason === '已轉由醫師持續管理' && inWin(e.judge.at))));
        if (!joined) { ids.notJoined.push(r.p.id); continue; }
        j++;
        const counselled = r.eps.some((e) => e.rx && inWin(e.rx.at) && (touches(e) || e.items.some((i) => i.key === 'mets'))) || (r.p.counsel || []).some((x) => inWin(x.at) && (!x.domains || x.domains.includes(d.key)));
        if (!counselled) { ids.notCounselled.push(r.p.id); continue; }
        c++;
        const ok = controlled888(d.key, r.ms, o, t);
        if (ok === null) { ids.noData.push(r.p.id); continue; }
        if (ok) { k++; ids.controlled.push(r.p.id); } else ids.notControlled.push(r.p.id);
      }
      const n = ids.identified.length;
      const need = (x, den) => Math.max(0, Math.ceil(0.8 * den - 1e-9) - x);
      out.domains[d.key] = {
        label: d.label, identified: n,
        joined: wilson(j, n), counselled: wilson(c, j), controlled: wilson(k, c), overall: wilson(k, n),
        need: { joined: need(j, n), counselled: need(c, j), controlled: need(k, c) },
        ids,
      };
    }
    return out;
  }

  const Engine = {
    LEVELS, RANK, LEVEL_LABEL, LEVEL_MEANING, ITEMS, ITEM_LABEL, SYMPTOMS, SYMPTOM_BY_LABEL, ASSUMPTIONS, DEFAULT_SLA, CLOSE_REASONS,
    STATES, STATE_LABEL, OUTCOME_LABEL, GLU_TYPE, RX, DEFAULT_888, DOMAINS_888, cascade888,
    maxLevel, evaluateSession, groupSessions, ingest, act, nextStep, suggestJudgement, quality, wilson, prescription,
    parseRoster, parseBirth, validTwId, maskId, maskName, ageAt, addDays, sameDay, normGluType, uid,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = Engine;
  else root.Engine = Engine;
})(typeof window !== 'undefined' ? window : globalThis);
