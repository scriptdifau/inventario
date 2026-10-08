// Regressione: dietro il proxy di SiteGround l'app riceve HTTP; senza il fix il cookie di sessione non veniva impostato
// e il login finiva in "Richiesta di login non valida".
const { test } = require('node:test');
const assert = require('node:assert');

test('produzione con BASE_URL https: il cookie di sessione viene impostato anche se il proxy non dice https', async () => {
  const salva = { ...process.env };
  Object.assign(process.env, { NODE_ENV: 'production', SESSION_SECRET: 'x', BASE_URL: 'https://esempio.test', GOOGLE_CLIENT_ID: 'id', GOOGLE_CLIENT_SECRET: 's' });
  const server = require('../src/app').creaApp().listen(0);
  try {
    const r = await fetch(`http://localhost:${server.address().port}/auth/login`, { redirect: 'manual' });
    assert.strictEqual(r.status, 302);
    assert.match(r.headers.get('location'), /accounts\.google\.com/);
    const cookie = r.headers.getSetCookie().join(';');
    assert.match(cookie, /inv=/);
    assert.match(cookie, /secure/i);
  } finally {
    server.close();
    for (const k of Object.keys(process.env)) if (!(k in salva)) delete process.env[k];
    Object.assign(process.env, salva);
  }
});
