// Lettura degli utenti da Google Workspace con la Directory API (account di servizio + delega a livello di dominio).
// Variabili: GOOGLE_SA_KEY (JSON della chiave, anche in base64) oppure GOOGLE_SA_KEY_FILE (percorso del file JSON),
// WORKSPACE_ADMIN_EMAIL (amministratore da impersonare), WORKSPACE_CUSTOMER (facoltativa, default my_customer).
const fs = require('fs');
const { JWT } = require('google-auth-library');

const SCOPE = 'https://www.googleapis.com/auth/admin.directory.user.readonly';
const URL = 'https://admin.googleapis.com/admin/directory/v1/users';

function chiave(env = process.env) {
  let t = env.GOOGLE_SA_KEY;
  if (!t && env.GOOGLE_SA_KEY_FILE) {
    t = fs.readFileSync(env.GOOGLE_SA_KEY_FILE, 'utf8');
    if (!t.trim()) throw new Error(`Il file della chiave è vuoto (${env.GOOGLE_SA_KEY_FILE}): va ricaricato`);
  }
  if (!t) return null;
  t = t.trim();
  if (!t.startsWith('{')) t = Buffer.from(t, 'base64').toString('utf8');
  const k = JSON.parse(t);
  if (!k.client_email || !k.private_key) throw new Error('La chiave dell\'account di servizio non è valida (mancano client_email o private_key)');
  return k;
}

const configurata = (env = process.env) => !!((env.GOOGLE_SA_KEY || env.GOOGLE_SA_KEY_FILE) && env.WORKSPACE_ADMIN_EMAIL);

// utente della Directory API -> riga per sincronizza()
function mappa(u) {
  const nome = u.name && u.name.givenName; const cognome = u.name && u.name.familyName;
  const org = (u.organizations || []).find((o) => o.primary) || (u.organizations || [])[0];
  return {
    email: String(u.primaryEmail || '').toLowerCase(), nome, cognome,
    stato: u.archived ? 'Cessato' : u.suspended ? 'Sospeso' : 'Attivo',
    reparto: (org && org.department) || null,
    creato: u.creationTime ? String(u.creationTime).slice(0, 10) : null,
  };
}

// richiedi(url) -> oggetto JSON; di default usa l'account di servizio (iniettabile nei test)
function richiestaGoogle(env = process.env) {
  const k = chiave(env);
  if (!k || !env.WORKSPACE_ADMIN_EMAIL) throw new Error('Sincronizzazione Workspace non configurata (GOOGLE_SA_KEY / WORKSPACE_ADMIN_EMAIL)');
  const jwt = new JWT({ email: k.client_email, key: k.private_key, scopes: [SCOPE], subject: env.WORKSPACE_ADMIN_EMAIL });
  return async (url) => (await jwt.request({ url })).data;
}

async function utentiWorkspace(env = process.env, richiedi = richiestaGoogle(env)) {
  const avvisi = []; const out = []; let token = '';
  do {
    const q = new URLSearchParams({ customer: env.WORKSPACE_CUSTOMER || 'my_customer', maxResults: '500', orderBy: 'email', projection: 'full' });
    if (token) q.set('pageToken', token);
    const r = await richiedi(`${URL}?${q}`);
    for (const u of r.users || []) {
      const m = mappa(u);
      if (!m.email || !m.nome || !m.cognome) { avvisi.push(`${u.primaryEmail || '(senza email)'}: nome, cognome o email mancante, saltato`); continue; }
      out.push(m);
    }
    token = r.nextPageToken || '';
  } while (token);
  return { utenti: out, avvisi };
}

module.exports = { utentiWorkspace, mappa, configurata, chiave, SCOPE };
