/*
 * 資料加密保管：只用瀏覽器內建 Web Crypto，不依賴第三方程式庫。
 *  - AES-256-GCM（含完整性驗證：資料被竄改或密語錯誤都會解密失敗）
 *  - 金鑰由通行密語經 PBKDF2-HMAC-SHA256 600,000 次衍生（OWASP 2023 建議值），每份資料隨機 16 位元組 salt
 *  - 每次加密使用新的隨機 12 位元組 IV
 *  - 金鑰設為不可匯出（non-extractable），只存在記憶體；關閉或鎖定頁面即消失
 * 遺失通行密語即無法還原資料（沒有後門），請由單位主管另行保管。
 */
(function (root) {
  'use strict';
  const ITER = 600000;
  const MIN_LEN = 12;
  const enc = new TextEncoder(), dec = new TextDecoder();
  const b64 = (u8) => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); };
  const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
  const subtle = () => {
    if (!root.crypto || !root.crypto.subtle) throw new Error('此瀏覽器或開啟方式不支援加密（需要 https、localhost 或直接開啟檔案）');
    return root.crypto.subtle;
  };

  function checkPassphrase(p) {
    if (typeof p !== 'string' || p.length < MIN_LEN) throw new Error(`通行密語至少 ${MIN_LEN} 個字元（建議用一句好記的話）`);
    if (/^(.)\1+$/.test(p)) throw new Error('通行密語不可全為相同字元');
  }

  async function deriveKey(passphrase, salt, iter) {
    const base = await subtle().importKey('raw', enc.encode(passphrase.normalize('NFC')), 'PBKDF2', false, ['deriveKey']);
    return subtle().deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: iter }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  }

  // 產生新金鑰（設定或變更密語時）
  async function createKey(passphrase) {
    checkPassphrase(passphrase);
    const salt = root.crypto.getRandomValues(new Uint8Array(16));
    return { key: await deriveKey(passphrase, salt, ITER), salt, iter: ITER };
  }

  const isEnvelope = (o) => !!o && o.vault === 1 && typeof o.ct === 'string' && typeof o.iv === 'string' && typeof o.salt === 'string';

  async function seal(k, obj, aad) {
    const iv = root.crypto.getRandomValues(new Uint8Array(12));
    const ct = new Uint8Array(await subtle().encrypt({ name: 'AES-GCM', iv, additionalData: enc.encode(aad || 'chc-tracking') }, k.key, enc.encode(JSON.stringify(obj))));
    return { vault: 1, alg: 'AES-256-GCM', kdf: 'PBKDF2-SHA256', iter: k.iter, salt: b64(k.salt), iv: b64(iv), ct: b64(ct), at: new Date().toISOString() };
  }

  // 以密語開啟；回傳 { data, k }（k 供之後加密使用，沿用同一 salt）
  async function open(envelope, passphrase, aad) {
    if (!isEnvelope(envelope)) throw new Error('不是加密資料');
    const iter = +envelope.iter;
    if (!(iter >= 100000 && iter <= 10000000)) throw new Error('加密參數不正確');
    const salt = unb64(envelope.salt);
    const key = await deriveKey(passphrase, salt, iter);
    let pt;
    try { pt = await subtle().decrypt({ name: 'AES-GCM', iv: unb64(envelope.iv), additionalData: enc.encode(aad || 'chc-tracking') }, key, unb64(envelope.ct)); }
    catch (e) { throw new Error('通行密語錯誤，或資料已被竄改'); }
    return { data: JSON.parse(dec.decode(pt)), k: { key, salt, iter } };
  }

  const Vault = { createKey, seal, open, isEnvelope, checkPassphrase, ITER, MIN_LEN };
  if (typeof module !== 'undefined' && module.exports) module.exports = Vault;
  else root.Vault = Vault;
})(typeof window !== 'undefined' ? window : globalThis);
