const { test } = require('node:test');
const assert = require('node:assert');
const zlib = require('node:zlib');
const { xlsx } = require('../src/xlsx');

// lettore minimale dello zip: nome -> contenuto
function leggiZip(buf) {
  const fine = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const n = buf.readUInt16LE(fine + 10); let o = buf.readUInt32LE(fine + 16); const out = {};
  for (let i = 0; i < n; i++) {
    const comp = buf.readUInt32LE(o + 20); const lungN = buf.readUInt16LE(o + 28); const lungE = buf.readUInt16LE(o + 30);
    const lungC = buf.readUInt16LE(o + 32); const loc = buf.readUInt32LE(o + 42);
    const nome = buf.toString('utf8', o + 46, o + 46 + lungN);
    const dati = loc + 30 + buf.readUInt16LE(loc + 26) + buf.readUInt16LE(loc + 28);
    out[nome] = zlib.inflateRawSync(buf.subarray(dati, dati + comp)).toString('utf8');
    o += 46 + lungN + lungE + lungC;
  }
  return out;
}

test('xlsx: struttura, tipi, escape e fogli multipli', () => {
  const f = leggiZip(xlsx([
    { nome: 'Uno', righe: [{ a: 'x & <y>', d: new Date('2026-10-08T12:00:00Z'), n: '12.5', f: '=CMD()' }, { a: null, d: null, n: null, f: true }],
      colonne: [{ h: 'A', v: (r) => r.a }, { h: 'Data', v: (r) => r.d, t: 'data' }, { h: 'Euro', v: (r) => r.n === null ? null : Number(r.n), t: 'euro' }, { h: 'F', v: (r) => r.f }] },
    { nome: 'Due/Tre?', righe: [], colonne: [{ h: 'Z', v: () => 1 }] },
  ]));
  assert.ok(f['[Content_Types].xml'] && f['xl/workbook.xml'] && f['xl/styles.xml'] && f['xl/worksheets/sheet2.xml']);
  assert.match(f['xl/workbook.xml'], /name="Uno"/);
  assert.match(f['xl/workbook.xml'], /name="Due Tre "/);                 // caratteri vietati nel nome foglio
  const s = f['xl/worksheets/sheet1.xml'];
  assert.match(s, /x &amp; &lt;y&gt;/);
  assert.match(s, /<c r="B2" s="2"><v>46303<\/v><\/c>/);                  // 08/10/2026
  assert.match(s, /<c r="C2" s="4"><v>12.5<\/v><\/c>/);
  assert.match(s, /t="inlineStr"><is><t xml:space="preserve">=CMD\(\)<\/t>/); // testo, non formula
  assert.match(s, /Sì/);
  assert.match(s, /<autoFilter ref="A1:D3"\/>/);
});
