/*
 * 最小化 xlsx／csv 讀取器：不依賴任何第三方程式庫，只用瀏覽器內建的 DecompressionStream 與 DOMParser。
 * 取代 SheetJS 0.18.5（CVE-2023-30533 原型污染、CVE-2024-22363 ReDoS），並消除 CDN 供應鏈風險。
 *
 * 防護：
 *  - 檔案大小、單一檔案解壓後大小、總解壓大小都有上限（防 zip bomb），解壓時邊讀邊計數，超過即中止
 *  - 檔名與欄位一律存入 Map，不用一般物件當字典（防原型污染）
 *  - XML 以 DOMParser 解析：瀏覽器不載入外部實體（無 XXE）、不執行內容
 *  - 列數、欄數上限，避免記憶體耗盡
 * 只支援 .xlsx（Office Open XML）與 .csv；舊版 .xls 請先另存為 .xlsx。
 */
(function (root) {
  'use strict';

  const LIMITS = { fileBytes: 20 * 1024 * 1024, entryBytes: 64 * 1024 * 1024, totalBytes: 160 * 1024 * 1024, rows: 200000, cols: 1024, sheets: 64 };

  function fail(msg) { throw new Error(msg); }

  // ── ZIP 目錄 ──
  function zipIndex(buf) {
    const dv = new DataView(buf);
    let eocd = -1;
    for (let i = buf.byteLength - 22; i >= Math.max(0, buf.byteLength - 65557); i--) {
      if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) fail('不是有效的 .xlsx 檔（找不到 ZIP 目錄）');
    const count = dv.getUint16(eocd + 10, true);
    let p = dv.getUint32(eocd + 16, true);
    const files = new Map();
    const dec = new TextDecoder();
    for (let k = 0; k < count; k++) {
      if (p + 46 > buf.byteLength || dv.getUint32(p, true) !== 0x02014b50) fail('ZIP 目錄損毀');
      const flags = dv.getUint16(p + 8, true);
      const method = dv.getUint16(p + 10, true);
      const csize = dv.getUint32(p + 20, true), usize = dv.getUint32(p + 24, true);
      const nl = dv.getUint16(p + 28, true), xl = dv.getUint16(p + 30, true), cl = dv.getUint16(p + 32, true);
      const lho = dv.getUint32(p + 42, true);
      if (flags & 0x1) fail('不支援加密的 Excel 檔，請先移除密碼');
      const name = dec.decode(new Uint8Array(buf, p + 46, nl));
      files.set(name, { method, csize, usize, lho });
      p += 46 + nl + xl + cl;
    }
    return files;
  }

  async function readCapped(stream, cap) {
    const reader = stream.getReader();
    const parts = [];
    let n = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      n += value.length;
      if (n > cap) { await reader.cancel(); fail('檔案解壓後過大，已中止（疑似壓縮炸彈）'); }
      parts.push(value);
    }
    const out = new Uint8Array(n);
    let o = 0;
    for (const v of parts) { out.set(v, o); o += v.length; }
    return out;
  }

  async function entryBytes(buf, f, budget) {
    const dv = new DataView(buf);
    if (f.lho + 30 > buf.byteLength || dv.getUint32(f.lho, true) !== 0x04034b50) fail('ZIP 檔頭損毀');
    const start = f.lho + 30 + dv.getUint16(f.lho + 26, true) + dv.getUint16(f.lho + 28, true);
    if (start + f.csize > buf.byteLength) fail('ZIP 內容不完整');
    const data = new Uint8Array(buf, start, f.csize);
    const cap = Math.min(LIMITS.entryBytes, budget.left);
    let out;
    if (f.method === 0) { if (data.length > cap) fail('檔案內容過大'); out = data; }
    else if (f.method === 8) {
      if (typeof DecompressionStream === 'undefined') fail('瀏覽器版本過舊，無法讀取 Excel（請改用新版 Chrome、Edge 或 Safari）');
      out = await readCapped(new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw')), cap);
    } else fail('不支援的壓縮格式');
    budget.left -= out.length;
    return out;
  }

  async function xml(buf, files, name, budget) {
    const f = files.get(name);
    if (!f) return null;
    const text = new TextDecoder().decode(await entryBytes(buf, f, budget));
    const doc = new DOMParser().parseFromString(text, 'application/xml');
    if (doc.getElementsByTagName('parsererror').length) fail('Excel 內容格式錯誤：' + name);
    return doc;
  }

  const kids = (el, tag) => Array.from(el ? el.getElementsByTagName(tag) : []);
  const attr = (el, a) => (el ? el.getAttribute(a) : null);

  // 共用字串：只取 <t>，略過注音／拼音 <rPh>
  function sharedStrings(doc) {
    if (!doc) return [];
    return kids(doc, 'si').map((si) => kids(si, 't').filter((t) => !(t.parentNode && t.parentNode.nodeName === 'rPh')).map((t) => t.textContent).join(''));
  }

  // 日期格式判斷：內建 14–22、27–36、45–47、50–58（含中文日期），或自訂格式含 y／m／d／e
  const BUILTIN_DATE = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 45, 46, 47, 50, 51, 52, 53, 54, 55, 56, 57, 58]);
  function dateStyles(doc) {
    if (!doc) return [];
    const custom = new Map();
    for (const nf of kids(doc, 'numFmt')) custom.set(+attr(nf, 'numFmtId'), attr(nf, 'formatCode') || '');
    const xfsEl = kids(doc, 'cellXfs')[0];
    return kids(xfsEl, 'xf').map((xf) => {
      const id = +attr(xf, 'numFmtId') || 0;
      if (BUILTIN_DATE.has(id)) return true;
      const code = custom.get(id);
      if (!code) return false;
      const bare = code.replace(/"[^"]*"|\[[^\]]*\]|\\./g, '');
      return /[ymde]/i.test(bare) && !/^general$/i.test(bare.trim());
    });
  }

  function serialToDate(v, date1904) {
    const ms = Math.round((v + (date1904 ? 1462 : 0) - 25569) * 86400000);
    const u = new Date(ms);
    return new Date(u.getUTCFullYear(), u.getUTCMonth(), u.getUTCDate(), u.getUTCHours(), u.getUTCMinutes(), u.getUTCSeconds());
  }

  function colIndex(ref) {
    let n = 0;
    for (const ch of ref) { const c = ch.charCodeAt(0); if (c < 65 || c > 90) break; n = n * 26 + (c - 64); }
    return n - 1;
  }

  function sheetRows(doc, ss, isDate, date1904) {
    const rows = [];
    for (const row of kids(doc, 'row')) {
      const r = (+attr(row, 'r') || rows.length + 1) - 1;
      if (r >= LIMITS.rows) fail(`工作表超過 ${LIMITS.rows} 列`);
      const out = [];
      let next = 0;
      for (const c of kids(row, 'c')) {
        const ref = attr(c, 'r');
        const ci = ref ? colIndex(ref) : next;
        next = ci + 1;
        if (ci < 0 || ci >= LIMITS.cols) continue;
        const t = attr(c, 't');
        const vEl = kids(c, 'v')[0];
        const raw = vEl ? vEl.textContent : null;
        let val = '';
        if (t === 's') val = ss[+raw] ?? '';
        else if (t === 'inlineStr') val = kids(c, 't').map((x) => x.textContent).join('');
        else if (t === 'str' || t === 'e') val = raw ?? '';
        else if (t === 'b') val = raw === '1';
        else if (t === 'd') val = raw ? new Date(raw) : '';
        else if (raw !== null && raw !== '') {
          const num = Number(raw);
          val = isNaN(num) ? raw : (isDate[+attr(c, 's') || 0] ? serialToDate(num, date1904) : num);
        }
        out[ci] = val;
      }
      for (let i = 0; i < out.length; i++) if (out[i] === undefined) out[i] = '';
      rows[r] = out;
    }
    for (let i = 0; i < rows.length; i++) if (!rows[i]) rows[i] = [];
    return rows;
  }

  // 回傳 { SheetNames: [...], rows: Map(name -> 二維陣列) }
  async function readXlsx(buf) {
    if (buf.byteLength > LIMITS.fileBytes) fail('檔案超過 20 MB');
    const files = zipIndex(buf);
    const budget = { left: LIMITS.totalBytes };
    const wb = await xml(buf, files, 'xl/workbook.xml', budget);
    if (!wb) fail('不是 Excel 活頁簿（找不到 xl/workbook.xml）；舊版 .xls 請先另存為 .xlsx');
    const rels = await xml(buf, files, 'xl/_rels/workbook.xml.rels', budget);
    const target = new Map(kids(rels, 'Relationship').map((r) => [attr(r, 'Id'), attr(r, 'Target')]));
    const ss = sharedStrings(await xml(buf, files, 'xl/sharedStrings.xml', budget));
    const isDate = dateStyles(await xml(buf, files, 'xl/styles.xml', budget));
    const pr = kids(wb, 'workbookPr')[0];
    const date1904 = pr && /^(1|true)$/i.test(attr(pr, 'date1904') || '');
    const sheets = kids(wb, 'sheet').slice(0, LIMITS.sheets);
    const SheetNames = [], rows = new Map();
    for (const sh of sheets) {
      const name = attr(sh, 'name') || `工作表${SheetNames.length + 1}`;
      const rid = sh.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id') || attr(sh, 'r:id');
      let t = target.get(rid) || '';
      t = t.startsWith('/') ? t.slice(1) : 'xl/' + t.replace(/^\.\//, '');
      const doc = await xml(buf, files, t, budget);
      if (!doc) continue;
      SheetNames.push(name);
      rows.set(name, sheetRows(doc, ss, isDate, date1904));
    }
    return { SheetNames, rows };
  }

  // ── CSV（RFC 4180）：UTF-8 優先，非 UTF-8 時改用 Big5（台灣版 Excel 預設） ──
  function decodeText(buf) {
    const u8 = new Uint8Array(buf);
    try { return new TextDecoder('utf-8', { fatal: true }).decode(u8).replace(/^﻿/, ''); }
    catch (e) { return new TextDecoder('big5').decode(u8); }
  }
  function parseCsv(text) {
    const rows = [];
    let row = [], f = '', q = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (q) {
        if (ch === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += ch;
      } else if (ch === '"') q = true;
      else if (ch === ',') { row.push(f); f = ''; }
      else if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && text[i + 1] === '\n') i++;
        row.push(f); rows.push(row); row = []; f = '';
        if (rows.length > LIMITS.rows) fail(`CSV 超過 ${LIMITS.rows} 列`);
      } else f += ch;
    }
    if (f !== '' || row.length) { row.push(f); rows.push(row); }
    return rows;
  }

  async function readFile(file) {
    if (file.size > LIMITS.fileBytes) fail('檔案超過 20 MB');
    const buf = await file.arrayBuffer();
    if (/\.csv$/i.test(file.name)) { const rows = parseCsv(decodeText(buf)); return { SheetNames: ['CSV'], rows: new Map([['CSV', rows]]) }; }
    if (/\.xls$/i.test(file.name)) fail('不支援舊版 .xls，請在 Excel 另存為 .xlsx');
    return readXlsx(buf);
  }

  const XlsxReader = { readFile, readXlsx, parseCsv, decodeText, LIMITS };
  if (typeof module !== 'undefined' && module.exports) module.exports = XlsxReader;
  else root.XlsxReader = XlsxReader;
})(typeof window !== 'undefined' ? window : globalThis);
