const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { leggiXml, leggiPdf, classifica, seriali, nomeBreve, estraiXml } = require('../src/fattura');

const xml = fs.readFileSync(path.join(__dirname, 'fixtures', 'fattura.xml'), 'utf8');

test('FatturaPA: intestazione, righe, seriali dai riferimenti', () => {
  const [f] = leggiXml(xml);
  assert.strictEqual(f.fornitore, 'EFFESISTEMI S.R.L. A SOCIO UNICO'); assert.strictEqual(f.cessionario, "CART'ARMATA EDIZIONI SRL");
  assert.strictEqual(f.numero, 'ZZ-255/2026'); assert.strictEqual(f.data, '2026-09-30'); assert.strictEqual(f.totale, 2570.2); assert.strictEqual(f.tipoDocumento, 'TD01');
  assert.strictEqual(f.righe.length, 3);
  assert.deepStrictEqual([f.righe[0].quantita, f.righe[0].prezzoUnitario, f.righe[0].importo], [2, 700, 1400]);
  assert.strictEqual(f.righe[0].descrizione, 'Notebook HP ProBook 440 G6 14"');
  assert.deepStrictEqual(seriali(f.righe[1].descrizione, ...f.righe[1].riferimenti), ['ZZIMEI1234567']);
});

test('XML firmato (.p7m) e in base64: si estrae la fattura dentro', () => {
  const p7m = '0\x82\x05\x1c\x06\x09*\x86H\x86\xf7\r\x01\x07\x02' + xml + '\x00\x01\x02binario';
  assert.strictEqual(leggiXml(p7m)[0].numero, 'ZZ-255/2026');
  assert.strictEqual(leggiXml(Buffer.from(xml).toString('base64'))[0].numero, 'ZZ-255/2026');
  assert.strictEqual(estraiXml('non è una fattura'), null);
  assert.deepStrictEqual(leggiXml('<html>niente</html>'), []);
});

test('classificazione, marca e nomi dei fornitori', () => {
  assert.deepStrictEqual(classifica('Notebook HP ProBook 440 G6'), { tipologia: 'PC', marca: 'HP', servizio: false });
  assert.strictEqual(classifica('MacBook Pro 14').tipologia, 'Mac'); assert.strictEqual(classifica('MacBook Pro 14').marca, 'Apple');
  assert.strictEqual(classifica('iPhone 15').tipologia, 'Telefono'); assert.strictEqual(classifica('Monitor Dell 24"').tipologia, 'Monitor');
  assert.strictEqual(classifica('Spedizione').servizio, true); assert.strictEqual(classifica('Cavo HDMI').tipologia, 'Altro');
  assert.strictEqual(nomeBreve('EFFESISTEMI S.R.L. A SOCIO UNICO'), 'Effesistemi'); assert.strictEqual(nomeBreve('Wind Tre S.p.A.'), 'Wind Tre');
});

test('PDF: numero, data, totale e righe con quantità e importi', () => {
  const t = ['Effesistemi S.r.l.', 'P.IVA 01234567890', 'Fattura n. 255/2026', 'Data 30/09/2026', 'Descrizione Q.tà Prezzo Importo',
    'Notebook HP ProBook 440 G6 2 700,00 1.400,00', 'Spedizione 10,00', 'Imponibile 1.410,00', 'Totale documento 1.720,20'].join('\n');
  const f = leggiPdf(t);
  assert.strictEqual(f.numero, '255/2026'); assert.strictEqual(f.data, '2026-09-30'); assert.strictEqual(f.totale, 1720.2); assert.strictEqual(f.piva, '01234567890');
  assert.strictEqual(f.fornitore, 'Effesistemi S.r.l.');
  assert.deepStrictEqual(f.righe.map((r) => [r.descrizione, r.quantita, r.prezzoUnitario, r.importo]),
    [['Notebook HP ProBook 440 G6', 2, 700, 1400], ['Spedizione', 1, 10, 10]]);
  assert.ok(f.righe.every((r) => r.incerta));
});
