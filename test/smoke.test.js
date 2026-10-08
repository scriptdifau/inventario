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
  for (const p of ['/', '/asset', '/asset/1', '/asset/1/modifica', '/asset/nuovo', '/persone', '/persone/1', '/sim', '/movimenti', '/antivirus'])
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
