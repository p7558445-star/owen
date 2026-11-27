// 執行：node health-tracking/tests/vault.test.js
const assert = require('assert');
const V = require('../vault.js');
(async () => {
  let pass = 0;
  const t = async (name, fn) => { try { await fn(); pass++; } catch (e) { console.error('✗', name, '\n ', e.message); process.exitCode = 1; } };
  const data = { persons: [{ id: 'p1', name: '王小明', nationalId: 'A123456789' }] };
  const k = await V.createKey('這是一句測試用的通行密語');
  await t('round trip', async () => { const env = await V.seal(k, data); const r = await V.open(env, '這是一句測試用的通行密語'); assert.deepEqual(r.data, data); });
  await t('ciphertext has no plaintext', async () => { const env = await V.seal(k, data); const s = JSON.stringify(env); assert.ok(!s.includes('A123456789') && !s.includes('王小明')); assert.equal(env.alg, 'AES-256-GCM'); assert.equal(env.iter, 600000); });
  await t('fresh IV each time', async () => { const a = await V.seal(k, data), b = await V.seal(k, data); assert.notEqual(a.iv, b.iv); assert.notEqual(a.ct, b.ct); });
  await t('wrong passphrase fails', async () => { const env = await V.seal(k, data); await assert.rejects(V.open(env, '錯誤的通行密語錯誤的'), /密語錯誤/); });
  await t('tampered ciphertext fails', async () => { const env = await V.seal(k, data); const ct = Buffer.from(env.ct, 'base64'); ct[5] ^= 1; env.ct = ct.toString('base64'); await assert.rejects(V.open(env, '這是一句測試用的通行密語'), /竄改/); });
  await t('tampered parameters fail', async () => { const env = await V.seal(k, data); env.iter = 1000; await assert.rejects(V.open(env, '這是一句測試用的通行密語'), /參數/); });
  await t('weak passphrase rejected', async () => { await assert.rejects(V.createKey('short'), /至少/); await assert.rejects(V.createKey('aaaaaaaaaaaaaa'), /相同字元/); });
  console.log(`${pass} passed${process.exitCode ? ', some FAILED' : ''}`);
})();
