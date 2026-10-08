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
