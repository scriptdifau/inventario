const router = require('express').Router();
const { pool } = require('../db');
const { sincronizza } = require('../workspace');
const { utentiWorkspace, configurata } = require('../directory');
const { parseCsv, col, parseData, numeroDocumento } = require('../csv');

const FORMATI = {
  antivirus: 'export della console antivirus: Nome (o Dispositivo), Stato, Ultimo rilevato, Utente in uso, SO, Indirizzo IP locale, Indirizzo MAC',
  fatture: 'Fornitore, Numero, Data, Asset (codici AST-xxx separati da spazio, ; o |)',
  workspace: 'export utenti della console Admin: First Name, Last Name, Email Address, Status (opzionali: Department, Creation Time)',
};

router.get('/', (req, res) => res.render('importa', { formati: FORMATI, esito: null }));

// esegue fn(client) in transazione; fn restituisce { ok, avvisi }
async function transazione(fn) {
  const c = await pool.connect();
  try { await c.query('BEGIN'); const r = await fn(c); await c.query('COMMIT'); return r; }
  catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; }
  finally { c.release(); }
}

function risposta(res, tipo, esito) { res.render('importa', { formati: FORMATI, esito: { tipo, ...esito } }); }

// ---------- antivirus ----------
// Ogni upload è un nuovo import (lo storico resta); la vista usa l'ultimo.
// L'import è datato come il dispositivo visto più di recente (convenzione di importa.py), non "adesso",
// così la soglia dei 20 giorni resta riferita alla data del report.
router.post('/antivirus', async (req, res, next) => {
  try {
    const righe = parseCsv(req.body.csv);
    const avvisi = []; const visti = new Set(); const dati = [];
    righe.forEach((r, i) => {
      const disp = col(r, 'Dispositivo', 'Nome', 'Device', 'Nome dispositivo');
      if (!disp) { avvisi.push(`Riga ${i + 2}: dispositivo mancante, saltata`); return; }
      if (visti.has(disp.toUpperCase())) { avvisi.push(`Riga ${i + 2}: ${disp} doppio, tenuta la prima`); return; }
      visti.add(disp.toUpperCase());
      const raw = col(r, 'Ultimo rilevato', 'Last seen');
      const ultimo = parseData(raw, 'mdy');   // il report esporta mm/gg/aaaa
      if (raw && !ultimo) avvisi.push(`Riga ${i + 2}: data non riconosciuta (${raw})`);
      dati.push([disp, col(r, 'Stato', 'Status'), col(r, 'Utente in uso', 'Utente'), col(r, 'Sistema operativo', 'SO', 'OS'), ultimo,
        col(r, 'IP locale', 'Indirizzo IP locale', 'IP'), col(r, 'MAC', 'Indirizzo MAC')]);
    });
    if (!dati.length) return risposta(res.status(400), 'antivirus', { errore: 'Nessun dispositivo riconosciuto nel CSV.', avvisi });
    const max = dati.map((d) => d[4]).filter(Boolean).sort().pop() || null;
    const out = await transazione(async (c) => {
      const imp = await c.query('INSERT INTO antivirus_import (importato, file_nome) VALUES (coalesce($1::timestamptz, now()), $2) RETURNING id',
        [max, (req.body.nome || 'upload').slice(0, 200)]);
      for (const d of dati)
        await c.query(`INSERT INTO antivirus_dispositivo (import_id, dispositivo, stato, utente, sistema_operativo, ultimo_rilevato, ip_locale, mac)
                       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`, [imp.rows[0].id, ...d]);
      const k = await c.query(`SELECT antivirus, count(*)::int n FROM v_controllo_antivirus GROUP BY 1 ORDER BY 1`);
      return { riepilogo: `${dati.length} dispositivi importati. Controllo: ` + k.rows.map((x) => `${x.antivirus} ${x.n}`).join(', ') };
    });
    risposta(res, 'antivirus', { ...out, avvisi });
  } catch (e) { next(e); }
});

// ---------- fatture ----------
router.post('/fatture', async (req, res, next) => {
  try {
    const righe = parseCsv(req.body.csv);
    const out = await transazione(async (c) => {
      const avvisi = []; let nFatt = 0; let nAsset = 0;
      for (const [i, r] of righe.entries()) {
        const n = i + 2;
        const forn = col(r, 'Fornitore', 'Supplier'); const num = numeroDocumento(col(r, 'Numero', 'N. fattura', 'Fattura'));
        if (!forn || !num) { avvisi.push(`Riga ${n}: fornitore o numero mancante, saltata`); continue; }
        const rawData = col(r, 'Data');
        const data = parseData(rawData, 'dmy');
        if (rawData && !data) { avvisi.push(`Riga ${n}: data non riconosciuta (${rawData}), saltata`); continue; }
        const dataSql = data ? data.slice(0, 10) : null;
        let f = await c.query('SELECT id FROM fornitore WHERE lower(nome) = lower($1)', [forn]);
        if (!f.rows[0]) { f = await c.query('INSERT INTO fornitore (nome) VALUES ($1) RETURNING id', [forn]); avvisi.push(`Fornitore nuovo creato: ${forn}`); }
        const fid = f.rows[0].id;
        // chiave: fornitore + numero + data (IS NOT DISTINCT FROM: la data può mancare)
        let fa = await c.query('SELECT id FROM fattura WHERE fornitore_id = $1 AND numero = $2 AND data IS NOT DISTINCT FROM $3::date', [fid, num, dataSql]);
        if (!fa.rows[0]) { fa = await c.query('INSERT INTO fattura (fornitore_id, numero, data) VALUES ($1,$2,$3) RETURNING id', [fid, num, dataSql]); nFatt++; }
        const codici = (col(r, 'Asset', 'Asset collegati', 'Codici asset') || '').split(/[\s;,|]+/).filter(Boolean);
        for (const cod of codici) {
          const m = cod.toUpperCase().match(/^AST-(\d+)$/);
          if (!m) { avvisi.push(`Riga ${n}: codice asset non valido (${cod})`); continue; }
          const a = await c.query('SELECT id, fornitore_id, fattura_id FROM asset WHERE id = $1 FOR UPDATE', [+m[1]]);
          const as = a.rows[0];
          if (!as) { avvisi.push(`Riga ${n}: ${cod} non esiste`); continue; }
          if (as.fornitore_id && as.fornitore_id !== fid) { avvisi.push(`Riga ${n}: ${cod} ha un altro fornitore, non collegato`); continue; }
          if (as.fattura_id && as.fattura_id !== fa.rows[0].id) { avvisi.push(`Riga ${n}: ${cod} è già collegato a un'altra fattura, non toccato`); continue; }
          await c.query('UPDATE asset SET fornitore_id = $1, fattura_id = $2 WHERE id = $3', [fid, fa.rows[0].id, as.id]);
          nAsset++;
        }
      }
      return { riepilogo: `${nFatt} fatture nuove, ${nAsset} asset collegati.`, avvisi };
    });
    risposta(res, 'fatture', out);
  } catch (e) { next(e); }
});

// ---------- utenti Workspace ----------
// Regole di abbinamento in src/workspace.js (le stesse di SincronizzaDipendenti.gs); qui l'origine è l'export CSV della console Admin.
router.post('/workspace', async (req, res, next) => {
  try {
    const righe = parseCsv(req.body.csv);
    const avvisi = []; const utenti = [];
    for (const [i, r] of righe.entries()) {
      const n = i + 2;
      const email = (col(r, 'Email Address', 'Email', 'Indirizzo email') || '').toLowerCase();
      const nome = col(r, 'First Name', 'Nome'); const cognome = col(r, 'Last Name', 'Cognome');
      if (!email || !nome || !cognome) { avvisi.push(`Riga ${n}: email, nome o cognome mancante, saltata`); continue; }
      const raw = (col(r, 'Status', 'Stato') || 'Active').toLowerCase();
      const creato = parseData(col(r, 'Creation Time', 'Creato', 'Data creazione'), 'mdy');
      utenti.push({ riga: n, email, nome, cognome, reparto: col(r, 'Department', 'Reparto'), creato: creato && creato.slice(0, 10),
        stato: /archiv/.test(raw) ? 'Cessato' : /suspend|sospes/.test(raw) ? 'Sospeso' : 'Attivo' });
    }
    risposta(res, 'workspace', await sincronizza(utenti, avvisi));
  } catch (e) { next(e); }
});

// stessa sincronizzazione, letta direttamente da Google (Directory API)
router.post('/workspace-api', async (req, res, next) => {
  try {
    if (!configurata()) return risposta(res, 'workspace', { errore: 'Sincronizzazione automatica non configurata: mancano GOOGLE_SA_KEY (o GOOGLE_SA_KEY_FILE) e WORKSPACE_ADMIN_EMAIL.' });
    let letti;
    try { letti = await utentiWorkspace(); } catch (e) {
      return risposta(res, 'workspace', { errore: 'Google ha rifiutato la richiesta: ' + (e.message || e) });
    }
    risposta(res, 'workspace', await sincronizza(letti.utenti, letti.avvisi));
  } catch (e) { next(e); }
});

module.exports = router;
