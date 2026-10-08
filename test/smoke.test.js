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
  for (const p of ['/', '/asset', '/asset/1', '/asset/1/modifica', '/asset/nuovo', '/persone', '/persone/1', '/movimenti', '/cespiti', '/importa', '/sim/nuova'])
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
  // sincronizzazione via API non configurata: messaggio chiaro, nessuna modifica
  assert.match(await (await post('/importa/workspace-api', { _csrf: t })).text(), /non configurata/);
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
  for (const u of ['/persone', '/movimenti', '/cespiti', '/']) assert.ok(await righe(u + (u === '/' ? '?xlsx=1' : '?xlsx=1')) >= 0, u);
  assert.strictEqual(await righe('/cespiti?xlsx=1'), 23);
});

test('albero per azienda: pagine, filtri fissi, antivirus e SIM come simboli, Excel', { skip }, async () => {
  const { query } = require('../src/db');
  const conta = async (url) => (await (await req(url)).text()).match(/(\d+) risultati/)?.[1];
  for (const u of ['/az/cart-armata', '/az/le-parole', '/az/cart-armata/pc', '/az/cart-armata/mac', '/az/cart-armata/telefono',
    '/az/cart-armata/persone', '/az/le-parole/persone']) assert.strictEqual((await req(u)).status, 200, u);
  // non esistono: azienda o tipologia inventate, antivirus sui Mac, SIM sui PC, tipologia che l'azienda non ha
  for (const u of ['/az/boh', '/az/cart-armata/boh', '/az/cart-armata/pc/antivirus', '/antivirus', '/sim', '/az/cart-armata/pc/sim', '/az/cart-armata/telefono/sim', '/az/le-parole/mac'])
    assert.strictEqual((await req(u)).status, 404, u);

  // i filtri sono imposti dal percorso: non si possono scavalcare dall'indirizzo
  const pc = (await query(`SELECT count(*)::int n FROM v_asset_vivi WHERE azienda = 'Cart''armata' AND tipologia = 'PC'`)).rows[0].n;
  assert.strictEqual(Number(await conta('/az/cart-armata/pc')), pc);
  assert.strictEqual(Number(await conta('/az/cart-armata/pc?azienda=Le%20parole&tipologia=Mac')), pc);

  // i numeri dell'albero coincidono con le liste
  const home = await (await req('/')).text();
  assert.match(home, new RegExp(`href="/az/cart-armata/pc"[^>]*>[\\s\\S]*?<span class="c">${pc}</span>`));
  // Excel: stessa selezione della pagina
  const xl = await req('/az/cart-armata/pc?xlsx=1');
  assert.match(xl.headers.get('content-disposition'), /asset-/);
  assert.strictEqual(Buffer.from(await xl.arrayBuffer()).subarray(0, 2).toString(), 'PK');
  // il modulo "nuovo asset" parte con azienda e tipologia della pagina
  const nuovo = await (await req('/asset/nuovo?azienda_id=1&tipologia=Mac')).text();
  assert.match(nuovo, /<option value="Mac" selected>/);
});

test('ordinamento: predefinito per persona (cognome), colonne ordinabili, valori non ammessi ignorati, Excel nello stesso ordine', { skip }, async () => {
  const { query } = require('../src/db');
  const ids = async (url, classe = 'r-asset') => [...(await (await req(url)).text()).matchAll(new RegExp(`class="riga ${classe}" href="/asset/(\\d+)`, 'g'))].map((m) => +m[1]);

  // predefinito: per cognome della persona, chi non ha una persona in fondo
  const atteso = (await query(`SELECT a.id FROM asset a JOIN stato_asset s ON s.nome = a.stato LEFT JOIN persona p ON p.id = a.persona_id
    WHERE NOT s.fuori ORDER BY lower(p.cognome) NULLS LAST, lower(p.nome) NULLS LAST, a.id`)).rows.map((r) => r.id);
  assert.deepStrictEqual(await ids('/asset'), atteso);
  const senza = new Set((await query('SELECT id FROM asset WHERE persona_id IS NULL')).rows.map((r) => r.id));
  const ordine = await ids('/asset'); const primo = ordine.findIndex((i) => senza.has(i));
  assert.ok(primo > 0 && ordine.slice(primo).every((i) => senza.has(i)), 'gli asset senza persona sono tutti in fondo');
  // anche in senso inverso gli assegnati restano per primi
  const inverso = await ids('/asset?ord=persona&dir=desc'); const p2 = inverso.findIndex((i) => senza.has(i));
  assert.ok(p2 > 0 && inverso.slice(p2).every((i) => senza.has(i)));
  // sequenza dei cognomi (senza ripetizioni) in senso inverso = esatto contrario dell'ordine crescente
  const cognome = (await query('SELECT a.id, lower(p.cognome) || \'|\' || lower(p.nome) AS c FROM asset a JOIN persona p ON p.id = a.persona_id')).rows.reduce((m, r) => m.set(r.id, r.c), new Map());
  const seq = (lista) => lista.map((i) => cognome.get(i)).filter(Boolean).filter((c, k, a) => k === 0 || a[k - 1] !== c);
  assert.deepStrictEqual(seq(inverso), seq(ordine).reverse());

  // per nome: nome e poi cognome della persona, chi non ha una persona in fondo
  const perNome = (await query(`SELECT a.id FROM asset a JOIN stato_asset s ON s.nome = a.stato LEFT JOIN persona p ON p.id = a.persona_id
    WHERE NOT s.fuori ORDER BY lower(p.nome) NULLS LAST, lower(p.cognome) NULLS LAST, a.id`)).rows.map((r) => r.id);
  assert.deepStrictEqual(await ids('/asset?ord=nome'), perNome);

  // importo decrescente e codice
  const imp = await ids('/asset?ord=importo&dir=desc');
  const val = (await query('SELECT id, importo FROM asset')).rows.reduce((m, r) => m.set(r.id, r.importo === null ? null : Number(r.importo)), new Map());
  const noti = imp.map((i) => val.get(i)).filter((v) => v !== null);
  assert.ok(noti.every((v, k) => k === 0 || noti[k - 1] >= v), 'importi in ordine decrescente');
  const cespId = (await query('SELECT a.id, c.numero FROM asset a LEFT JOIN cespite c ON c.id = a.cespite_id')).rows.reduce((m, r) => m.set(r.id, r.numero), new Map());
  const cc = (await ids('/asset?ord=cespite&dir=asc')).map((i) => cespId.get(i));
  const conCesp = cc.filter((v) => v !== null); assert.ok(conCesp.length > 20 && conCesp.every((v, k) => k === 0 || conCesp[k - 1] <= v), 'cespiti in ordine crescente');
  assert.ok(cc.indexOf(null) > conCesp.length - 1 || cc.slice(conCesp.length).every((v) => v === null), 'senza cespite in fondo');

  // valori non ammessi: stesso ordine del predefinito, nessun errore
  assert.deepStrictEqual(await ids("/asset?ord=boh&dir=su"), atteso);
  assert.strictEqual((await req("/asset?ord=persona';drop table asset;--&dir=desc")).status, 200);
  assert.ok((await query('SELECT count(*)::int n FROM asset')).rows[0].n > 0);

  // l'ordine vale anche per le pagine per azienda, per le SIM e resta nei link
  const pc = await ids('/az/cart-armata/pc?ord=importo&dir=asc');
  assert.ok(pc.length > 0);
  const html = await (await req('/az/cart-armata/pc?ord=importo&dir=asc&stato=Assegnato')).text();
  assert.match(html, /href="\/az\/cart-armata\/pc\?ord=importo&amp;dir=desc&amp;stato=Assegnato"/);   // clic sulla colonna attiva: inverte
  assert.match(html, /<b>▲<\/b>/);

  // Excel nello stesso ordine della pagina
  const xl = await req('/asset?ord=importo&dir=desc&xlsx=1');
  assert.strictEqual(xl.status, 200);
  assert.match(xl.headers.get('content-type'), /spreadsheetml/);
});


test('il codice interno AST non si vede; si usa il cespite; antivirus come simbolo e non più come pagina', { skip }, async () => {
  const { query } = require('../src/db');
  for (const u of ['/', '/asset', '/az/cart-armata', '/az/cart-armata/pc', '/az/cart-armata/telefono', '/az/cart-armata/persone', '/persone/1', '/movimenti', '/sim', '/asset/1', '/asset/1/modifica']) {
    const html = await (await req(u)).text();
    const visibile = html.replace(/<(textarea|option)[^>]*>[\s\S]*?<\/\1>/g, '').replace(/<div style="white-space:pre-wrap">[\s\S]*?<\/div>/g, ''); // note libere e menu: testo degli utenti
    assert.doesNotMatch(visibile, /AST-\d{3}/, `${u} mostra un codice AST`);
  }
  // la scheda dell'asset 1 mostra il suo cespite
  const c1 = (await query('SELECT c.numero FROM asset a JOIN cespite c ON c.id = a.cespite_id WHERE a.id = 1')).rows[0].numero;
  assert.match(await (await req('/asset/1')).text(), new RegExp(`Cespite ${c1}\\b`));
  // si cerca per cespite
  const trovati = await (await req(`/asset?q=${c1}`)).text();
  assert.match(trovati, new RegExp(`Cespite ${c1}\\b`));

  // simboli: uno per ogni PC/server controllato, stesso conto del database
  const html = await (await req('/az/cart-armata/pc')).text();
  const db = (await query(`SELECT v.antivirus, count(*)::int n FROM v_controllo_antivirus v JOIN asset a ON a.codice = v.codice
    WHERE v.azienda = 'Cart''armata' AND a.tipologia = 'PC' GROUP BY 1`)).rows.reduce((m, r) => m.set(r.antivirus, r.n), new Map());
  const righe = html.split('class="riga r-asset"').slice(1);
  const n = (cl) => righe.filter((r) => r.split('class="riga')[0].includes(`av-ico ${cl}"`)).length;
  assert.strictEqual(n('av-ok'), db.get('OK') || 0);
  assert.strictEqual(n('av-dv'), db.get('Da verificare') || 0);
  assert.strictEqual(n('av-no'), db.get('Mancante') || 0);
  // filtro "antivirus da sistemare"
  const prob = await (await req('/asset?av=problemi')).text();
  const nr = (prob.match(/class="riga r-asset"/g) || []).length;
  assert.strictEqual(nr, (await query("SELECT count(*)::int n FROM v_controllo_antivirus WHERE antivirus <> 'OK'")).rows[0].n);
  // sui Mac e sui telefoni nessun simbolo
  assert.doesNotMatch(await (await req('/az/cart-armata/mac')).text(), /av-ico av-/);
  assert.doesNotMatch(await (await req('/az/cart-armata/telefono')).text().then((t) => t.replace(/<style[\s\S]*?<\/style>/g, '')), /class="riga r-asset"[\s\S]{0,400}av-ico/);
  // la pagina antivirus non c'è più, né nel menu
  assert.strictEqual((await req('/antivirus')).status, 404);
  assert.doesNotMatch(await (await req('/')).text(), /href="\/antivirus|\/antivirus"/);
});


test('SIM come simbolo sul telefono, dettaglio nella scheda, niente pagina SIM; SIM senza telefono ritrovabili', { skip }, async () => {
  const { query } = require('../src/db');
  // la pagina e le voci di menu non ci sono più
  assert.strictEqual((await req('/sim')).status, 404);
  assert.strictEqual((await req('/az/cart-armata/telefono/sim')).status, 404);
  const home = await (await req('/')).text();
  assert.doesNotMatch(home, /href="\/sim"|Tutte le SIM|\/telefono\/sim/);

  // un simbolo per ogni telefono di Cart'armata che ha una SIM
  const html = await (await req('/az/cart-armata/telefono')).text();
  const righe = html.split('class="riga r-asset"').slice(1).map((r) => r.split('class="riga')[0]);
  const conSim = (await query(`SELECT count(*)::int n FROM asset a WHERE a.tipologia = 'Telefono' AND a.azienda_id = (SELECT id FROM azienda WHERE nome = 'Cart''armata')
    AND NOT (SELECT fuori FROM stato_asset WHERE nome = a.stato) AND EXISTS (SELECT 1 FROM sim s WHERE s.asset_id = a.id)`)).rows[0].n;
  assert.ok(conSim > 5);
  assert.strictEqual(righe.filter((r) => r.includes('class="sim-ico')).length, conSim);

  // la scheda del telefono mostra il dettaglio della SIM
  const t = (await query(`SELECT a.id, s.numero, s.operatore, s.piano FROM asset a JOIN sim s ON s.asset_id = a.id WHERE s.operatore IS NOT NULL AND s.piano IS NOT NULL ORDER BY a.id LIMIT 1`)).rows[0];
  const scheda = await (await req(`/asset/${t.id}`)).text();
  assert.match(scheda, /<h2>SIM /);
  assert.ok(scheda.includes(t.numero) && scheda.includes(t.operatore) && scheda.includes(t.piano));
  assert.match(scheda, new RegExp(`href="/sim/nuova\\?asset_id=${t.id}"`));
  // si trova il telefono dal numero della SIM
  assert.match(await (await req(`/asset?q=${t.numero}`)).text(), new RegExp(`href="/asset/${t.id}"`));

  // le SIM senza telefono stanno sulla pagina Telefono dell'azienda
  const libere = (await query(`SELECT count(*)::int n FROM sim WHERE asset_id IS NULL AND azienda_id = (SELECT id FROM azienda WHERE nome = 'Cart''armata')`)).rows[0].n;
  assert.ok(libere > 0);
  assert.match(html, new RegExp(`SIM non montate su un telefono <span class="mut">\\(${libere}\\)`));
  const nessuna = await (await req('/az/le-parole/telefono')).text();
  assert.doesNotMatch(nessuna, /SIM non montate/);

  // il modulo: senza telefono né azienda si rifiuta; con il telefono si torna alla sua scheda
  const tok = await csrf(`/sim/nuova?asset_id=${t.id}`);
  const rifiuto = await post('/sim/nuova', { _csrf: tok, numero: '3000000000', stato: 'Attiva' });
  assert.strictEqual(rifiuto.status, 400);
  assert.match(await rifiuto.text(), /telefono in cui è montata oppure l(?:'|&#39;)azienda/);
  const ok = await post('/sim/nuova', { _csrf: tok, numero: '3000000001', stato: 'Attiva', asset_id: String(t.id) });
  assert.strictEqual(ok.status, 302); assert.strictEqual(ok.headers.get('location'), `/asset/${t.id}`);
  await query(`DELETE FROM sim WHERE numero = '3000000001'`);
  // SIM senza telefono ma con azienda: si torna alla pagina Telefono dell'azienda
  const az = (await query(`SELECT id FROM azienda WHERE nome = 'Le parole'`)).rows[0].id;
  const ok2 = await post('/sim/nuova', { _csrf: tok, numero: '3000000002', stato: 'Attiva', azienda_id: String(az) });
  assert.strictEqual(ok2.headers.get('location'), '/az/le-parole/telefono');
  assert.match(await (await req('/az/le-parole/telefono')).text(), /SIM non montate su un telefono/);
  await query(`DELETE FROM sim WHERE numero = '3000000002'`);

  // l'Excel degli asset porta i dati della SIM
  assert.strictEqual((await req('/az/cart-armata/telefono?xlsx=1')).status, 200);
});


test('numeri di fattura senza ".0": dati di partenza e import da CSV', { skip }, async () => {
  const { query } = require('../src/db');
  // il database va caricato con l'import.sql aggiornato (o con migrazioni/003_numero_fattura.sql)
  assert.strictEqual((await query("SELECT count(*)::int n FROM fattura WHERE numero ~ '\\.0$'")).rows[0].n, 0);
  assert.match((await (await req('/asset/1')).text()), /<b>4198<\/b>/);

  // un CSV con "4198.0" (come lo esporta Excel) ritrova la fattura 4198 esistente e non ne crea una doppia
  const f = (await query("SELECT f.numero, to_char(f.data, 'DD/MM/YYYY') AS data, fo.nome FROM fattura f JOIN fornitore fo ON fo.id = f.fornitore_id WHERE f.numero = '4198'")).rows[0];
  const prima = (await query('SELECT count(*)::int n FROM fattura')).rows[0].n;
  const t = await csrf('/importa');
  const r = await post('/importa/fatture', { _csrf: t, csv: `Fornitore,Numero,Data,Asset\n${f.nome},4198.0,${f.data},` });
  assert.match(await r.text(), /0 fatture nuove/);
  assert.strictEqual((await query('SELECT count(*)::int n FROM fattura')).rows[0].n, prima);
});
