const test = require('node:test');
const assert = require('node:assert');
const { utentiWorkspace, mappa, configurata, chiave } = require('../src/directory');

test('mappa: stati, reparto e data di creazione', () => {
  const u = { primaryEmail: 'Mario.Rossi@Terre.it', name: { givenName: 'Mario', familyName: 'Rossi' }, suspended: false,
    organizations: [{ department: 'Redazione', primary: true }], creationTime: '2024-03-05T10:11:12.000Z' };
  assert.deepStrictEqual(mappa(u), { email: 'mario.rossi@terre.it', nome: 'Mario', cognome: 'Rossi', stato: 'Attivo', reparto: 'Redazione', creato: '2024-03-05' });
  assert.strictEqual(mappa({ ...u, suspended: true }).stato, 'Sospeso');
  assert.strictEqual(mappa({ ...u, suspended: true, archived: true }).stato, 'Cessato');
  assert.strictEqual(mappa({ primaryEmail: 'a@terre.it', name: {} }).reparto, null);
});

test('utentiWorkspace: scorre le pagine e scarta gli utenti incompleti', async () => {
  const url = [];
  const pagine = [
    { users: [{ primaryEmail: 'a@terre.it', name: { givenName: 'A', familyName: 'Uno' } }, { primaryEmail: 'senza.nome@terre.it', name: {} }], nextPageToken: 'p2' },
    { users: [{ primaryEmail: 'b@terre.it', name: { givenName: 'B', familyName: 'Due' }, suspended: true }] },
  ];
  const r = await utentiWorkspace({}, async (u) => { url.push(u); return pagine[url.length - 1]; });
  assert.deepStrictEqual(r.utenti.map((x) => [x.email, x.stato]), [['a@terre.it', 'Attivo'], ['b@terre.it', 'Sospeso']]);
  assert.strictEqual(r.avvisi.length, 1);
  assert.match(url[0], /customer=my_customer/); assert.match(url[1], /pageToken=p2/);
});

test('configurazione e chiave (JSON o base64)', () => {
  assert.strictEqual(configurata({}), false);
  assert.strictEqual(configurata({ GOOGLE_SA_KEY: '{}', WORKSPACE_ADMIN_EMAIL: 'x@terre.it' }), true);
  const k = JSON.stringify({ client_email: 'sa@p.iam.gserviceaccount.com', private_key: 'KEY' });
  assert.strictEqual(chiave({ GOOGLE_SA_KEY: k }).client_email, 'sa@p.iam.gserviceaccount.com');
  assert.strictEqual(chiave({ GOOGLE_SA_KEY: Buffer.from(k).toString('base64') }).private_key, 'KEY');
  assert.throws(() => chiave({ GOOGLE_SA_KEY: '{"a":1}' }), /non è valida/);
  assert.strictEqual(chiave({}), null);
  const vuoto = require('path').join(require('os').tmpdir(), 'chiave-vuota-' + process.pid + '.json');
  require('fs').writeFileSync(vuoto, '\n');
  assert.throws(() => chiave({ GOOGLE_SA_KEY_FILE: vuoto }), /è vuoto/);
  require('fs').unlinkSync(vuoto);
});
