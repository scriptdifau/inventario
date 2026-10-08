// Richiede un database con schema.sql + import.sql caricati: DATABASE_URL=... npm test
const { test, before, after } = require('node:test');
const assert = require('node:assert');

process.env.DEV_LOGIN_EMAIL = 'test@terre.it';
process.env.SESSION_SECRET = 'test';
const skip = !process.env.DATABASE_URL && 'DATABASE_URL non impostata';

let server, base, cookie = '';
const req = async (path, opts = {}) => {
  const r = await fetch(base + path, { redirect: 'manual', ...opts, headers: { cookie, ...(opts.headers || {}) } });
  const set = r.headers.getSetCookie().map((c) => c.split(';')[0]);
  if (set.length) { const m = new Map(cookie.split('; ').filter(Boolean).map((c) => c.split(/=(.*)/s).slice(0, 2))); set.forEach((c) => { const [k, v] = c.split(/=(.*)/s); m.set(k, v); }); cookie = [...m].map(([k, v]) => `${k}=${v}`).join('; '); }
  return r;
};
const post = (path, body) => req(path, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(body) });
const csrf = async (path) => (await (await req(path)).text()).match(/name="_csrf" value="([^"]+)"/)[1];

before(async () => {
  if (skip) return;
  const { creaApp } = require('../src/app');
  server = creaApp().listen(0);
  base = 'http://localhost:' + server.address().port;
});
after(async () => { if (server) server.close(); if (!skip) await require('../src/db').pool.end(); });

test('nessuna pagina pubblica', { skip }, async () => {
  assert.strictEqual((await req('/asset')).status, 302);
  assert.strictEqual((await req('/healthz')).status, 200);
  assert.strictEqual((await req('/auth/login')).status, 302); // dev login
});

test('pagine principali', { skip }, async () => {
  for (const p of ['/', '/asset', '/asset/1', '/asset/1/modifica', '/asset/nuovo', '/persone', '/persone/1', '/sim', '/movimenti', '/antivirus', '/cespiti', '/importa'])
    assert.strictEqual((await req(p)).status, 200, p);
  assert.strictEqual((await req('/asset/99999')).status, 404);
});

test('CSRF obbligatorio', { skip }, async () => {
  assert.strictEqual((await post('/persone/nuova', { nome: 'X', cognome: 'Y' })).status, 403);
});

test('modifica asset: il trigger registra il movimento; stato incoerente rifiutato', { skip }, async () => {
  const { query } = require('../src/db');
  const a = (await query(`SELECT id FROM asset WHERE stato = 'Disponibile' AND tipologia = 'PC' LIMIT 1`)).rows[0];
  if (!a) return;
  const t = await csrf(`/asset/${a.id}/modifica`);
  const form = (await query('SELECT tipologia, azienda_id FROM asset WHERE id = $1', [a.id])).rows[0];
  const base = { _csrf: t, tipologia: form.tipologia, azienda_id: form.azienda_id };
  const r = await post(`/asset/${a.id}/modifica`, { ...base, stato: 'Assegnato' }); // senza persona
  assert.strictEqual(r.status, 400);
  const prima = (await query('SELECT count(*)::int n FROM movimento WHERE asset_id = $1', [a.id])).rows[0].n;
  const ok = await post(`/asset/${a.id}/modifica`, { ...base, stato: 'Da verificare', note: 'test' });
  assert.strictEqual(ok.status, 302);
  const dopo = (await query('SELECT count(*)::int n FROM movimento WHERE asset_id = $1', [a.id])).rows[0].n;
  assert.strictEqual(dopo, prima + 1);
  await query(`DELETE FROM movimento WHERE asset_id = $1 AND id = (SELECT max(id) FROM movimento WHERE asset_id = $1)`, [a.id]);
  await query(`UPDATE asset SET stato = 'Disponibile', note = NULL WHERE id = $1`, [a.id]);
  await query(`DELETE FROM movimento WHERE asset_id = $1 AND id = (SELECT max(id) FROM movimento WHERE asset_id = $1)`, [a.id]);
});

test('import CSV: antivirus, fatture, workspace', { skip }, async () => {
  const { query } = require('../src/db');
  const t = await csrf('/importa');
  // antivirus: nuovo report, poi ripristino
  const avPrima = (await query('SELECT max(id) m FROM antivirus_import')).rows[0].m;
  let r = await post('/importa/antivirus', { _csrf: t, nome: 't.csv', csv: 'Dispositivo,Stato,Ultimo rilevato\nPC-TEST,Protetto,10/08/2026 10:00\nPC-TEST,Protetto,10/08/2026 10:00' });
  assert.strictEqual(r.status, 200);
  assert.match(await r.text(), /1 dispositivi importati/);
  await query('DELETE FROM antivirus_import WHERE id > $1', [avPrima]);
  // intestazioni dell'export reale della console (Nome, SO, Indirizzo IP locale…)
  r = await post('/importa/antivirus', { _csrf: t, csv: 'Nome,Stato,Ultimo rilevato,Utente in uso,SO,Indirizzo IP locale,Indirizzo MAC\nPC-X,Protetto,09/16/2026 09:53,u,Windows 11,10.0.0.1,AA' });
  assert.match(await r.text(), /1 dispositivi importati/);
  const d = (await query('SELECT * FROM antivirus_dispositivo WHERE import_id > $1', [avPrima])).rows[0];
  assert.strictEqual(d.sistema_operativo, 'Windows 11'); assert.strictEqual(d.ip_locale, '10.0.0.1');
  await query('DELETE FROM antivirus_import WHERE id > $1', [avPrima]);
  // fatture + workspace dentro una verifica non distruttiva: CSV vuoto/invalidi
  r = await post('/importa/fatture', { _csrf: t, csv: 'Fornitore,Numero,Data,Asset\nZZ Test,9999,08/10/2026,AST-999' });
  assert.match(await r.text(), /AST-999 non esiste/);
  await query(`DELETE FROM fattura WHERE numero = '9999'`); await query(`DELETE FROM fornitore WHERE nome = 'ZZ Test'`);
  r = await post('/importa/workspace', { _csrf: t, csv: 'First Name [Required],Last Name [Required],Email Address [Required],Status [READ ONLY]\nZz,Test,zz.test@terre.it,Active' });
  assert.match(await r.text(), /1 nuove/);
  // alias su altro dominio: stessa persona, nessun duplicato
  r = await post('/importa/workspace', { _csrf: t, csv: 'First Name,Last Name,Email Address,Status\nZz,Test,zz.test@falacosagiusta.org,Suspended' });
  const html = await r.text();
  assert.match(html, /1 persone aggiornate/);
  assert.match(html, /Attive qui ma non attive/);
  assert.strictEqual((await query(`SELECT count(*)::int n FROM persona WHERE nome = 'Zz'`)).rows[0].n, 1);
  await query(`DELETE FROM persona WHERE nome = 'Zz'`);
  await query(`UPDATE persona SET stato_workspace = NULL`);
  assert.strictEqual((await post('/importa/antivirus', { _csrf: t, csv: 'x\n' })).status, 400);
});

test('export Excel: ogni vista, anche filtrata', { skip }, async () => {
  const zlib = require('node:zlib');
  const righe = async (url) => {
    const r = await req(url);
    assert.strictEqual(r.status, 200, url);
    assert.match(r.headers.get('content-type'), /spreadsheetml/);
    assert.match(r.headers.get('content-disposition'), /attachment; filename=".*\.xlsx"/);
    const buf = Buffer.from(await r.arrayBuffer());
    assert.strictEqual(buf.subarray(0, 2).toString(), 'PK');
    const fine = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06])); let o = buf.readUInt32LE(fine + 16); let xml = '';
    for (let i = 0; i < buf.readUInt16LE(fine + 10); i++) {
      const lungN = buf.readUInt16LE(o + 28); const nome = buf.toString('utf8', o + 46, o + 46 + lungN); const loc = buf.readUInt32LE(o + 42);
      if (nome === 'xl/worksheets/sheet1.xml') { const d = loc + 30 + buf.readUInt16LE(loc + 26) + buf.readUInt16LE(loc + 28);
        xml = zlib.inflateRawSync(buf.subarray(d, d + buf.readUInt32LE(o + 20))).toString('utf8'); }
      o += 46 + lungN + buf.readUInt16LE(o + 30) + buf.readUInt16LE(o + 32);
    }
    return (xml.match(/<row /g) || []).length - 1;       // meno l'intestazione
  };
  const tutti = await righe('/asset?xlsx=1');
  const assegnati = await righe('/asset?stato=Assegnato&xlsx=1');
  assert.ok(tutti > 50 && assegnati > 0 && assegnati < tutti, `${assegnati} < ${tutti}`);
  const html = await (await req('/asset?stato=Assegnato')).text();
  assert.match(html, /href="\/asset\?stato=Assegnato&amp;xlsx=1"/);          // il link conserva i filtri
  for (const u of ['/persone', '/sim', '/movimenti', '/antivirus', '/cespiti', '/']) assert.ok(await righe(u + (u === '/' ? '?xlsx=1' : '?xlsx=1')) >= 0, u);
  assert.strictEqual(await righe('/cespiti?xlsx=1'), 23);
});

test('albero per azienda: pagine, filtri fissi, antivirus sotto PC/Server, SIM sotto Telefono, Excel', { skip }, async () => {
  const { query } = require('../src/db');
  const conta = async (url) => (await (await req(url)).text()).match(/(\d+) risultati/)?.[1];
  for (const u of ['/az/cart-armata', '/az/le-parole', '/az/cart-armata/pc', '/az/cart-armata/mac', '/az/cart-armata/telefono',
    '/az/cart-armata/pc/antivirus', '/az/cart-armata/server/antivirus', '/az/cart-armata/telefono/sim', '/az/le-parole/telefono/sim',
    '/az/cart-armata/persone', '/az/le-parole/persone']) assert.strictEqual((await req(u)).status, 200, u);
  // non esistono: azienda o tipologia inventate, antivirus sui Mac, SIM sui PC, tipologia che l'azienda non ha
  for (const u of ['/az/boh', '/az/cart-armata/boh', '/az/cart-armata/mac/antivirus', '/az/cart-armata/pc/sim', '/az/le-parole/mac'])
    assert.strictEqual((await req(u)).status, 404, u);

  // i filtri sono imposti dal percorso: non si possono scavalcare dall'indirizzo
  const pc = (await query(`SELECT count(*)::int n FROM v_asset_vivi WHERE azienda = 'Cart''armata' AND tipologia = 'PC'`)).rows[0].n;
  assert.strictEqual(Number(await conta('/az/cart-armata/pc')), pc);
  assert.strictEqual(Number(await conta('/az/cart-armata/pc?azienda=Le%20parole&tipologia=Mac')), pc);

  // i numeri dell'albero coincidono con le liste
  const home = await (await req('/')).text();
  assert.match(home, new RegExp(`href="/az/cart-armata/pc"[^>]*>[\\s\\S]*?<span class="c">${pc}</span>`));
  const sim = (await query(`SELECT count(*)::int n FROM sim s WHERE coalesce((SELECT a.azienda_id FROM asset a WHERE a.id = s.asset_id), s.azienda_id) = (SELECT id FROM azienda WHERE nome = 'Cart''armata')`)).rows[0].n;
  assert.strictEqual(Number(await conta('/az/cart-armata/telefono/sim')), sim);
  // nessuna SIM, persona o asset resta fuori dall'albero (tranne chi non ha proprio un'azienda)
  const totSim = (await query('SELECT count(*)::int n FROM sim')).rows[0].n;
  const sommaSim = Number(await conta('/az/cart-armata/telefono/sim')) + Number(await conta('/az/le-parole/telefono/sim'));
  const orfane = (await query(`SELECT count(*)::int n FROM sim s WHERE coalesce((SELECT a.azienda_id FROM asset a WHERE a.id = s.asset_id), s.azienda_id) IS NULL`)).rows[0].n;
  assert.strictEqual(sommaSim + orfane, totSim);

  // Excel: stessa selezione della pagina
  const xl = await req('/az/cart-armata/pc?xlsx=1');
  assert.match(xl.headers.get('content-disposition'), /asset-/);
  assert.strictEqual(Buffer.from(await xl.arrayBuffer()).subarray(0, 2).toString(), 'PK');
  assert.match((await req('/az/cart-armata/pc/antivirus?xlsx=1')).headers.get('content-disposition'), /antivirus-/);
  // il modulo "nuovo asset" parte con azienda e tipologia della pagina
  const nuovo = await (await req('/asset/nuovo?azienda_id=1&tipologia=Mac')).text();
  assert.match(nuovo, /<option value="Mac" selected>/);
});
