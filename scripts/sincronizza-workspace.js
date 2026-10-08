#!/usr/bin/env node
// Sincronizza le persone con Google Workspace (Directory API). Da lanciare a mano o da cron, per esempio ogni notte:
//   cd <cartella app_source> && node scripts/sincronizza-workspace.js
// Variabili: dall'ambiente; in più legge il file indicato da ENV_FILE (utile da cron, dove le variabili del pannello
// non ci sono) e il .env della cartella dell'app. Le variabili già presenti hanno la precedenza.
const path = require('path');
const { caricaEnv } = require('../src/env');
if (process.env.ENV_FILE) caricaEnv(process.env.ENV_FILE);
caricaEnv(path.join(__dirname, '..', '.env'));

const { utentiWorkspace, configurata } = require('../src/directory');
const { sincronizza } = require('../src/workspace');
const { pool } = require('../src/db');

(async () => {
  if (!configurata()) throw new Error('mancano GOOGLE_SA_KEY (o GOOGLE_SA_KEY_FILE) e WORKSPACE_ADMIN_EMAIL');
  const letti = await utentiWorkspace();
  if (!letti.utenti.length) throw new Error('Google non ha restituito nessun utente: sincronizzazione annullata');
  const r = await sincronizza(letti.utenti, letti.avvisi);
  console.log(`${new Date().toISOString()} workspace ok: ${r.riepilogo}`);
  r.avvisi.forEach((a) => console.log('  - ' + a));
})().catch((e) => { console.error(`${new Date().toISOString()} workspace ERRORE: ${e.message}`); process.exitCode = 1; })
  .finally(() => pool.end());
