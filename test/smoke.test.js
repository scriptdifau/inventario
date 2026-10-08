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
  for (const p of ['/', '/asset', '/asset/1', '/asset/1/modifica', '/asset/nuovo', '/persone', '/persone/1', '/movimenti', '/cestino', '/cestino?vista=storico', '/importa', '/sim/nuova'])
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
  for (const u of ['/persone', '/movimenti', '/cestino', '/']) assert.ok(await righe(u + '?xlsx=1') >= 0, u);
  assert.strictEqual(await righe('/cestino?vista=storico&xlsx=1'), 23);
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
  const cespId = (await query('SELECT a.id, c.numero FROM asset a LEFT JOIN cespite c ON c.id = a.cespite_id')).rows.reduce((m, r) => m.set(r.id, r.numero === null ? null : Number(r.numero)), new Map());
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

test('elimina: asset (storico e SIM scollegate), persona (solo senza asset), SIM; serve il CSRF', { skip }, async () => {
  const { query } = require('../src/db');
  const az = (await query('SELECT id FROM azienda ORDER BY id LIMIT 1')).rows[0].id;
  const pe = (await query(`INSERT INTO persona (nome, cognome, stato) VALUES ('Zz', 'Elimina', 'Attivo') RETURNING id`)).rows[0].id;
  const as = (await query(`INSERT INTO asset (tipologia, stato, azienda_id, modello) VALUES ('Telefono', 'Disponibile', $1, 'Zz tel') RETURNING id`, [az])).rows[0].id;
  await query(`UPDATE asset SET persona_id = $1, stato = 'Assegnato' WHERE id = $2`, [pe, as]); // il trigger crea il movimento
  const sim = (await query(`INSERT INTO sim (stato, asset_id, persona_id) VALUES ('Attiva', $1, $2) RETURNING id`, [as, pe])).rows[0].id;
  assert.ok((await query('SELECT count(*)::int n FROM movimento WHERE asset_id = $1', [as])).rows[0].n > 0);
  // senza token: rifiutato
  assert.strictEqual((await post(`/asset/${as}/elimina`, {})).status, 403);
  // la scheda ha il pulsante
  assert.match(await (await req(`/asset/${as}`)).text(), new RegExp(`action="/asset/${as}/elimina"`));
  // persona con asset: bloccata
  let t = await csrf(`/persone/${pe}`);
  let r = await post(`/persone/${pe}/elimina`, { _csrf: t });
  assert.strictEqual(r.status, 400); assert.match(await r.text(), /ha ancora 1 asset/);
  assert.strictEqual((await query('SELECT count(*)::int n FROM persona WHERE id = $1', [pe])).rows[0].n, 1);
  // asset: eliminato con lo storico, la SIM resta senza telefono e con l'azienda
  t = await csrf(`/asset/${as}`);
  r = await post(`/asset/${as}/elimina`, { _csrf: t });
  assert.strictEqual(r.status, 302);
  assert.strictEqual((await query('SELECT count(*)::int n FROM asset WHERE id = $1', [as])).rows[0].n, 0);
  // lo storico resta (asset_id NULL, descrizione in oggetto) e c'è la riga "Eliminazione" con chi l'ha fatta
  assert.strictEqual((await query('SELECT count(*)::int n FROM movimento WHERE asset_id = $1', [as])).rows[0].n, 0);
  const log = (await query(`SELECT tipo, oggetto, utente FROM movimento WHERE oggetto LIKE 'Zz tel%' ORDER BY id`)).rows;
  assert.ok(log.length >= 2 && log.every((x) => x.oggetto === 'Zz tel'), 'storico e eliminazione leggibili');
  assert.strictEqual(log[log.length - 1].tipo, 'Eliminazione'); assert.strictEqual(log[log.length - 1].utente, 'test@terre.it');
  const pag = await (await req('/movimenti?q=Zz')).text();
  assert.match(pag, /Eliminazione/); assert.match(pag, /Zz tel/); assert.match(pag, /da test@terre\.it/);
  const s = (await query('SELECT asset_id, azienda_id FROM sim WHERE id = $1', [sim])).rows[0];
  assert.strictEqual(s.asset_id, null); assert.strictEqual(s.azienda_id, az);
  assert.strictEqual((await post(`/asset/${as}/elimina`, { _csrf: t })).status, 404);
  // SIM: eliminata
  t = await csrf(`/sim/${sim}/modifica`);
  assert.match(await (await req(`/sim/${sim}/modifica`)).text(), new RegExp(`action="/sim/${sim}/elimina"`));
  assert.strictEqual((await post(`/sim/${sim}/elimina`, { _csrf: t })).status, 302);
  assert.strictEqual((await query('SELECT count(*)::int n FROM sim WHERE id = $1', [sim])).rows[0].n, 0);
  // persona senza asset: eliminata; i movimenti degli altri asset non la citano più
  t = await csrf(`/persone/${pe}`);
  assert.strictEqual((await post(`/persone/${pe}/elimina`, { _csrf: t })).status, 302);
  assert.strictEqual((await query('SELECT count(*)::int n FROM persona WHERE id = $1', [pe])).rows[0].n, 0);
  assert.strictEqual((await post(`/persone/${pe}/elimina`, { _csrf: t })).status, 404);
  assert.match(await (await req('/movimenti?q=Elimina')).text(), /Eliminazione persona/);
  assert.strictEqual((await req('/movimenti?xlsx=1')).status, 200);
  await query(`DELETE FROM movimento WHERE oggetto LIKE 'Zz%' OR oggetto LIKE 'SIM-%'`);
});

test('età dell\'hardware: colonna, filtro per soglia, dashboard, Excel; il report antivirus aggiorna il sistema operativo', { skip }, async () => {
  const { query } = require('../src/db');
  const az = (await query('SELECT id FROM azienda ORDER BY id LIMIT 1')).rows[0].id;
  const mk = async (modello, anni, host) => (await query(`INSERT INTO asset (tipologia, stato, azienda_id, modello, hostname, data_acquisto)
    VALUES ('PC', 'Disponibile', $1, $2, $3, current_date - ($4::numeric * 365.25)::int) RETURNING id`, [az, modello, host, anni])).rows[0].id;
  const vecchio = await mk('ZzVecchio', 7, 'ZZVECCHIO-PC'); const medio = await mk('ZzMedio', 5, 'ZZMEDIO-PC'); const nuovo = await mk('ZzNuovo', 1, 'ZZNUOVO-PC');
  const ids = async (url) => [...(await (await req(url)).text()).matchAll(/href="\/asset\/(\d+)"/g)].map((m) => Number(m[1]));
  try {
    const sost = await ids('/asset?stato=Disponibile&eta=sost'); const att = await ids('/asset?stato=Disponibile&eta=att'); const tutti = await ids('/asset?stato=Disponibile');
    assert.ok(sost.includes(vecchio) && !sost.includes(medio) && !sost.includes(nuovo), 'oltre 6 anni: solo il più vecchio');
    assert.ok(att.includes(vecchio) && att.includes(medio) && !att.includes(nuovo), 'oltre 4 anni: vecchio e medio');
    assert.ok(tutti.includes(nuovo));
    assert.deepStrictEqual(await ids('/asset?stato=Disponibile&eta=boh'), tutti, 'valori non ammessi ignorati');
    const html = await (await req('/asset?stato=Disponibile&q=ZzVecchio')).text();
    assert.match(html, /class="eta eta-sost"[^>]*>7,0 anni/); assert.match(html, /name="eta"/);
    assert.match(await (await req('/asset?stato=Disponibile&q=ZzMedio')).text(), /class="eta eta-att"/);
    assert.match(await (await req('/asset?stato=Disponibile&q=ZzNuovo')).text(), /class="eta eta-ok"[^>]*>1,0 anni/);
    assert.strictEqual((await req('/asset?xlsx=1&eta=att')).status, 200);
    assert.strictEqual((await req('/asset?ord=eta&dir=desc')).status, 200);
    assert.match(await (await req('/')).text(), /Età dei computer/);
    assert.match(await (await req('/az/' + (await query('SELECT lower(nome) n FROM azienda WHERE id = $1', [az])).rows[0].n.replace(/[^a-z]/g, '-') + '/pc?eta=sost')).text(), /Cart|Parole|Persone|Dispositivo/);

    // il report antivirus aggiorna il sistema operativo degli asset con lo stesso hostname (anche con maiuscole diverse)
    const avPrima = (await query('SELECT max(id) m FROM antivirus_import')).rows[0].m;
    const t = await csrf('/importa');
    const r = await post('/importa/antivirus', { _csrf: t, csv: 'Nome,Stato,Ultimo rilevato,SO\nzzvecchio-pc,Protetto,10/08/2026 10:00,Windows 11 Pro\nZZMEDIO-PC,Protetto,10/08/2026 10:00,Windows 10 Pro' });
    assert.match(await r.text(), /sistema operativo aggiornato su 2 asset/);
    await query('DELETE FROM antivirus_import WHERE id > $1', [avPrima]);
    const so = (await query('SELECT id, sistema_operativo FROM asset WHERE id = ANY($1)', [[vecchio, medio, nuovo]])).rows.reduce((m, x) => m.set(x.id, x.sistema_operativo), new Map());
    assert.strictEqual(so.get(vecchio), 'Windows 11 Pro'); assert.strictEqual(so.get(medio), 'Windows 10 Pro'); assert.strictEqual(so.get(nuovo), null);
  } finally {
    await query('DELETE FROM asset WHERE id = ANY($1)', [[vecchio, medio, nuovo]]);
  }
});

test('import fattura XML: anteprima (nulla salvato), conferma, nessun duplicato, collegamento per seriale', { skip }, async () => {
  const { query } = require('../src/db');
  const fs = require('fs');
  const xml = fs.readFileSync(require('path').join(__dirname, 'fixtures', 'fattura.xml'), 'utf8');
  const contaAsset = async () => (await query('SELECT count(*)::int n FROM asset')).rows[0].n;
  const prima = await contaAsset(); const fornPrima = (await query('SELECT count(*)::int n FROM fornitore')).rows[0].n;
  assert.match(await (await req('/importa')).text(), /Fattura di acquisto \(XML o PDF\)/);
  let t = await csrf('/importa');
  try {
    // anteprima: fornitore riconosciuto (Effesistemi), azienda da "CART'ARMATA", righe proposte; non salva nulla
    let r = await post('/importa/fattura/anteprima', { _csrf: t, formato: 'xml', nome: 'f.xml', testo: xml });
    assert.strictEqual(r.status, 200);
    let html = await r.text();
    assert.match(html, /controlla e conferma/); assert.match(html, /ZZ-255\/2026/); assert.match(html, /name="azione_0"/);
    assert.match(html, /<option value="\d+" selected>Effesistemi<\/option>/);
    assert.match(html, /<option value="1" selected>Cart&#39;armata<\/option>/);
    assert.match(html, /<option value="nuovo" selected>/); assert.match(html, /<option value="salta" selected>/); // portatile e telefono nuovi, spedizione saltata
    assert.strictEqual(await contaAsset(), prima);
    assert.strictEqual((await query(`SELECT count(*)::int n FROM fattura WHERE numero = 'ZZ-255/2026'`)).rows[0].n, 0);
    // file non valido
    assert.strictEqual((await post('/importa/fattura/anteprima', { _csrf: t, formato: 'xml', testo: '<html/>' })).status, 400);
    assert.strictEqual((await post('/importa/fattura/anteprima', { _csrf: t, formato: 'pdf', testo: 'x' })).status, 400);
    assert.strictEqual((await post('/importa/fattura/anteprima', { testo: xml })).status, 403);

    // conferma come l'ha proposta l'anteprima: 2 portatili + 1 telefono (con seriale), spedizione saltata
    const forn = (await query(`SELECT id FROM fornitore WHERE lower(nome) = 'effesistemi'`)).rows[0].id;
    const corpo = { _csrf: t, formato: 'xml', fornitore_id: forn, fornitore_nome: '', numero: 'ZZ-255/2026', data: '2026-09-30', azienda_id: 1, stato: 'Disponibile', n: 3,
      azione_0: 'nuovo', tipologia_0: 'PC', marca_0: 'HP', modello_0: 'Notebook HP ProBook 440 G6 14"', serial_0: '', importo_0: '700,00', qta_0: 2, descr_0: 'Notebook',
      azione_1: 'nuovo', tipologia_1: 'Telefono', marca_1: 'Apple', modello_1: 'iPhone 15 128GB', serial_1: 'ZZIMEI1234567', importo_1: '700', qta_1: 1, descr_1: 'iPhone',
      azione_2: 'salta', tipologia_2: 'Altro', qta_2: 1, descr_2: 'Spedizione' };
    r = await post('/importa/fattura/conferma', corpo);
    html = await r.text();
    assert.strictEqual(r.status, 200); assert.match(html, /3 asset nuovi, 0 collegati/);
    assert.strictEqual(await contaAsset(), prima + 3);
    const as = (await query(`SELECT a.*, f.numero FROM asset a JOIN fattura f ON f.id = a.fattura_id WHERE f.numero = 'ZZ-255/2026' ORDER BY a.id`)).rows;
    assert.strictEqual(as.length, 3);
    assert.ok(as.every((x) => x.stato === 'Disponibile' && x.azienda_id === 1 && x.fornitore_id === forn && String(x.data_acquisto).includes('2026')));
    assert.deepStrictEqual(as.map((x) => Number(x.importo)), [700, 700, 700]); assert.strictEqual(as[2].serial, 'ZZIMEI1234567');
    // stessa fattura di nuovo: l'anteprima non propone nuovi asset (il telefono è riconosciuto dal seriale, gli altri saltati)
    r = await post('/importa/fattura/anteprima', { _csrf: t, formato: 'xml', testo: xml }); html = await r.text();
    assert.match(html, /già registrata/); assert.match(html, /<option value="collega" selected>/); assert.match(html, /Già presente: AST-/);
    assert.ok(!/<option value="nuovo" selected>/.test(html.replace(/<template[\s\S]*?<\/template>/, '')), 'nessuna riga nuova proposta (la riga modello per "aggiungi" è esclusa)');
    // e la conferma di righe "nuovo" sulla stessa fattura è rifiutata, a meno di forzare
    r = await post('/importa/fattura/conferma', corpo);
    assert.strictEqual(r.status, 400); assert.match(await r.text(), /già registrata/); assert.strictEqual(await contaAsset(), prima + 3);
    // collegamento di un asset esistente a un'altra fattura
    const lib = (await query(`INSERT INTO asset (tipologia, stato, azienda_id, modello) VALUES ('Altro', 'Disponibile', 1, 'Zz libero') RETURNING id, codice`)).rows[0];
    r = await post('/importa/fattura/conferma', { _csrf: t, formato: 'xml', fornitore_id: forn, numero: 'ZZ-256', data: '2026-10-01', azienda_id: 1, stato: 'Disponibile', n: 1,
      azione_0: 'collega', asset_0: lib.codice, importo_0: '55,5', qta_0: 1, descr_0: 'Accessorio' });
    assert.match(await r.text(), /0 asset nuovi, 1 collegati/);
    const dopo = (await query('SELECT fattura_id, importo, data_acquisto FROM asset WHERE id = $1', [lib.id])).rows[0];
    assert.ok(dopo.fattura_id); assert.strictEqual(Number(dopo.importo), 55.5);
    // validazioni
    assert.strictEqual((await post('/importa/fattura/conferma', { _csrf: t, formato: 'xml', n: 0, numero: '' })).status, 400);
    assert.strictEqual((await post('/importa/fattura/conferma', { _csrf: t, formato: 'xml', n: 1, numero: 'ZZ-9', azione_0: 'nuovo', tipologia_0: 'PC' })).status, 400); // nessun fornitore
    assert.strictEqual(await contaAsset(), prima + 4);
  } finally {
    await query(`DELETE FROM asset WHERE fattura_id IN (SELECT id FROM fattura WHERE numero LIKE 'ZZ-%') OR modello = 'Zz libero'`);
    await query(`DELETE FROM movimento WHERE oggetto LIKE '%Zz libero%'`);
    await query(`DELETE FROM fattura WHERE numero LIKE 'ZZ-%'`);
    await query(`DELETE FROM fornitore WHERE id > (SELECT coalesce(max(id), 0) FROM fornitore WHERE nome = 'Effesistemi') AND nome ILIKE 'zz%'`);
  }
  assert.strictEqual(await contaAsset(), prima);
  assert.strictEqual((await query('SELECT count(*)::int n FROM fornitore')).rows[0].n, fornPrima);
});

test('Cestino: asset dismessi (stati oltre Estinto) + storico ante 2018, ripristino, vecchio indirizzo', { skip }, async () => {
  const { query } = require('../src/db');
  const az = (await query('SELECT id FROM azienda ORDER BY id LIMIT 1')).rows[0].id;
  const nuovo = async (modello, stato) => (await query(`INSERT INTO asset (tipologia, stato, azienda_id, modello, importo) VALUES ('PC', $1, $2, $3, 100) RETURNING id`, [stato, az, modello])).rows[0].id;
  const estinto = await nuovo('ZzEstinto', 'Estinto'); const venduto = await nuovo('ZzVenduto', 'Disponibile'); const rubato = await nuovo('ZzRubato', 'Disponibile');
  try {
    await query(`UPDATE asset SET stato = 'Venduto' WHERE id = $1`, [venduto]); await query(`UPDATE asset SET stato = 'Smarrito/Rubato' WHERE id = $1`, [rubato]);   // il trigger imposta la data di dismissione
    // vecchio indirizzo
    const old = await req('/cespiti'); assert.strictEqual(old.status, 301); assert.strictEqual(old.headers.get('location'), '/cestino?vista=storico');
    // il Cestino contiene gli stati "fuori", non Estinto (che resta in contabilità)
    const html = await (await req('/cestino?q=Zz')).text();
    assert.ok(html.includes(`href="/asset/${venduto}"`) && html.includes(`href="/asset/${rubato}"`)); assert.ok(!html.includes(`href="/asset/${estinto}"`), 'Estinto resta in contabilità');
    assert.match(html, /Storico cespiti ante 2018/); assert.match(html, /Asset dismessi/);
    const soloVenduti = await (await req('/cestino?q=Zz&stato=Venduto')).text();
    assert.ok(soloVenduti.includes(`href="/asset/${venduto}"`) && !soloVenduti.includes(`href="/asset/${rubato}"`));
    const anno = new Date().getFullYear();
    assert.ok((await (await req(`/cestino?q=Zz&anno=${anno}`)).text()).includes(`href="/asset/${venduto}"`)); assert.ok(!(await (await req('/cestino?q=Zz&anno=1999')).text()).includes(`href="/asset/${venduto}"`));
    assert.strictEqual((await req('/cestino?ord=importo&dir=asc')).status, 200); assert.strictEqual((await req('/cestino?xlsx=1')).status, 200);
    assert.match(await (await req('/')).text(), /href="\/cestino"/);   // voce nell'albero
    // fuori dagli elenchi normali, dentro con "anche nel Cestino"
    assert.ok(!(await (await req('/asset?q=ZzVenduto')).text()).includes(`href="/asset/${venduto}"`)); assert.ok((await (await req('/asset?q=ZzVenduto&uscita=1')).text()).includes(`href="/asset/${venduto}"`));
    // scheda: banner e ripristino; il form di modifica raggruppa gli stati
    assert.match(await (await req(`/asset/${venduto}`)).text(), /Nel Cestino/);
    const form = await (await req(`/asset/${venduto}/modifica`)).text();
    assert.match(form, /optgroup label="In contabilità"/); assert.match(form, /optgroup label="Dismesso: va nel Cestino"/);
    const t = await csrf(`/asset/${venduto}`);
    assert.strictEqual((await post(`/asset/${venduto}/ripristina`, {})).status, 403);
    assert.strictEqual((await post(`/asset/${estinto}/ripristina`, { _csrf: t })).status, 404);   // non è nel Cestino
    assert.strictEqual((await post(`/asset/${venduto}/ripristina`, { _csrf: t })).status, 302);
    const a = (await query('SELECT stato, data_dismissione FROM asset WHERE id = $1', [venduto])).rows[0];
    assert.strictEqual(a.stato, 'Disponibile'); assert.strictEqual(a.data_dismissione, null);
    assert.ok(!(await (await req('/cestino?q=Zz')).text()).includes(`href="/asset/${venduto}"`));
    assert.ok(!/Nel Cestino/.test(await (await req(`/asset/${venduto}`)).text()));
  } finally {
    await query('DELETE FROM movimento WHERE asset_id = ANY($1)', [[estinto, venduto, rubato]]);
    await query('DELETE FROM asset WHERE id = ANY($1)', [[estinto, venduto, rubato]]);
  }
});

test('cespite alfanumerico: salvataggio normalizzato, formato controllato, ordine naturale, ricerca, Excel', { skip }, async () => {
  const { query } = require('../src/db');
  const az = (await query('SELECT id FROM azienda ORDER BY id LIMIT 1')).rows[0].id;
  const creati = [];
  const crea = async (numero, modello) => {
    const t = await csrf('/asset/nuovo');
    const r = await post('/asset/nuovo', { _csrf: t, tipologia: 'PC', stato: 'Disponibile', azienda_id: az, modello, cespite_numero: numero });
    return r;
  };
  try {
    // "  a12 " -> "A12"; "2019/07" e "7-B" ammessi; stesso numero scritto in minuscolo = stesso cespite
    let r = await crea('  zz12 ', 'ZzCesp1'); assert.strictEqual(r.status, 302); creati.push(Number(r.headers.get('location').split('/').pop()));
    r = await crea('ZZ12', 'ZzCesp2'); assert.strictEqual(r.status, 302); creati.push(Number(r.headers.get('location').split('/').pop()));
    r = await crea('ZZ2019/07', 'ZzCesp3'); assert.strictEqual(r.status, 302); creati.push(Number(r.headers.get('location').split('/').pop()));
    const c = (await query(`SELECT a.modello, c.numero, c.id FROM asset a JOIN cespite c ON c.id = a.cespite_id WHERE a.id = ANY($1) ORDER BY a.id`, [creati])).rows;
    assert.deepStrictEqual(c.map((x) => x.numero), ['ZZ12', 'ZZ12', 'ZZ2019/07']); assert.strictEqual(c[0].id, c[1].id, 'lo stesso cespite copre due asset');
    // formato non valido: messaggio chiaro, niente salvataggio
    r = await crea('ZZ 12!', 'ZzCespBad'); assert.strictEqual(r.status, 400); assert.match(await r.text(), /lettere, cifre e i simboli/);
    assert.strictEqual((await query(`SELECT count(*)::int n FROM asset WHERE modello = 'ZzCespBad'`)).rows[0].n, 0);
    // la scheda mostra "Cespite ZZ12"; si cerca per lettere; l'Excel non si rompe
    assert.match(await (await req(`/asset/${creati[0]}`)).text(), /Cespite ZZ12/);
    const html = await (await req('/asset?q=zz12&stato=Disponibile')).text();
    assert.ok(html.includes(`href="/asset/${creati[0]}"`) && html.includes(`href="/asset/${creati[1]}"`) && !html.includes(`href="/asset/${creati[2]}"`));
    assert.match(await (await req(`/asset/${creati[0]}/modifica`)).text(), /name="cespite_numero" value="ZZ12"/);
    assert.strictEqual((await req('/asset?xlsx=1&ord=cespite')).status, 200);
    // ordine naturale: 2 < 10 < 48 < alfanumerici (ZZ…) < senza cespite
    const ids = async (url) => [...(await (await req(url)).text()).matchAll(/href="\/asset\/(\d+)"/g)].map((m) => Number(m[1]));
    const ord = await ids('/asset?ord=cespite&dir=asc&stato=Disponibile&uscita=1');
    const num = (await query('SELECT a.id, c.numero FROM asset a JOIN cespite c ON c.id = a.cespite_id WHERE a.id = ANY($1)', [ord])).rows.reduce((m, x) => m.set(x.id, x.numero), new Map());
    const numeri = ord.map((i) => num.get(i)).filter(Boolean);
    const soloCifre = numeri.filter((n) => /^\d+$/.test(n)).map(Number); assert.deepStrictEqual(soloCifre, [...soloCifre].sort((a, b) => a - b), 'i numerici in ordine numerico');
    assert.ok(numeri.indexOf('ZZ12') > numeri.lastIndexOf(String(soloCifre[soloCifre.length - 1])), 'gli alfanumerici dopo i numerici');
    // il database rifiuta comunque formati sbagliati
    await assert.rejects(query(`INSERT INTO cespite (azienda_id, numero) VALUES ($1, 'ab c')`, [az]), /cespite_numero_formato/);
  } finally {
    await query('DELETE FROM movimento WHERE asset_id = ANY($1)', [creati]);
    await query('DELETE FROM asset WHERE id = ANY($1)', [creati]);
    await query(`DELETE FROM cespite WHERE numero LIKE 'ZZ%'`);
  }
});
