const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { caricaEnv } = require('../src/env');

test('caricaEnv: CRLF, virgolette, commenti, export, "=" nel valore; non sovrascrive l\'ambiente', () => {
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'env-')), '.env');
  fs.writeFileSync(f, 'T_ID="abc"\r\n# commento\r\nexport T_PORT=4555 # porta\r\nT_SEG=a=b\r\nT_GIA=nuovo\r\n');
  process.env.T_GIA = 'esistente';
  try {
    assert.strictEqual(caricaEnv(f), true);
    assert.deepStrictEqual([process.env.T_ID, process.env.T_PORT, process.env.T_SEG, process.env.T_GIA], ['abc', '4555', 'a=b', 'esistente']);
    assert.strictEqual(caricaEnv(f + '.manca'), false);
  } finally { for (const k of ['T_ID', 'T_PORT', 'T_SEG', 'T_GIA']) delete process.env[k]; }
});
