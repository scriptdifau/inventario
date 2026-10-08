const router = require('express').Router();
const { pool } = require('../db');
const { parseCsv, col, parseData } = require('../csv');

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
        const forn = col(r, 'Fornitore', 'Supplier'); const num = col(r, 'Numero', 'N. fattura', 'Fattura');
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

// ---------- utenti Workspace (export CSV della console Admin) ----------
// Stesse regole di SincronizzaDipendenti.gs:
//  - abbinamento per parte locale dell'email (gli alias cambiano dominio, non nomecognome), poi per nome completo;
//  - `stato` (Attivo/Sospeso/Cessato) non viene mai sovrascritto: lo stato letto da Google va in `stato_workspace`;
//  - chi non ha riscontro in Workspace viene marcato "Non presente" e segnalato.
const norm = (t) => String(t || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z ]/g, '').replace(/\s+/g, ' ').trim();
const locale = (e) => String(e || '').toLowerCase().split('@')[0].split('+')[0].replace(/[^a-z0-9]/g, '');

router.post('/workspace', async (req, res, next) => {
  try {
    const righe = parseCsv(req.body.csv);
    const out = await transazione(async (c) => {
      const avvisi = []; const daRivedere = []; const spariti = []; const senzaAccount = [];
      let agg = 0; let nuovi = 0; let statiWs = 0;
      const persone = (await c.query('SELECT id, nome, cognome, email, stato, stato_workspace, reparto, data_ingresso FROM persona')).rows;
      const perLocale = new Map(); const perNome = new Map();
      for (const p of persone) {
        const lc = locale(p.email); const nm = norm(`${p.nome} ${p.cognome}`);
        if (lc && !perLocale.has(lc)) perLocale.set(lc, p);
        if (nm) { if (!perNome.has(nm)) perNome.set(nm, p); if (!perLocale.has(nm.replace(/ /g, ''))) perLocale.set(nm.replace(/ /g, ''), p); }
      }
      const visti = new Set(); const localiWs = new Set();
      for (const [i, r] of righe.entries()) {
        const email = (col(r, 'Email Address', 'Email', 'Indirizzo email') || '').toLowerCase();
        if (email) localiWs.add(locale(email));
      }
      for (const [i, r] of righe.entries()) {
        const n = i + 2;
        const email = (col(r, 'Email Address', 'Email', 'Indirizzo email') || '').toLowerCase();
        const nome = col(r, 'First Name', 'Nome'); const cognome = col(r, 'Last Name', 'Cognome');
        if (!email || !nome || !cognome) { avvisi.push(`Riga ${n}: email, nome o cognome mancante, saltata`); continue; }
        const raw = (col(r, 'Status', 'Stato') || 'Active').toLowerCase();
        const stato = /archiv/.test(raw) ? 'Cessato' : /suspend|sospes/.test(raw) ? 'Sospeso' : 'Attivo';
        const reparto = col(r, 'Department', 'Reparto');
        const creato = parseData(col(r, 'Creation Time', 'Creato', 'Data creazione'), 'mdy');
        let p = perLocale.get(locale(email)) || perNome.get(norm(`${nome} ${cognome}`));
        if (!p) {
          try {
            await c.query('SAVEPOINT s');
            const ins = await c.query(`INSERT INTO persona (nome, cognome, email, reparto, stato, stato_workspace, data_ingresso, note)
              VALUES ($1,$2,$3,$4,$5,$5,$6,$7) RETURNING id, nome, cognome, email, stato, stato_workspace, reparto, data_ingresso`,
              [nome, cognome, email, reparto, stato, creato && creato.slice(0, 10),
                `Aggiunto da Workspace il ${new Date().toLocaleDateString('it-IT', { timeZone: 'Europe/Rome' })}`]);
            visti.add(ins.rows[0].id); nuovi++;
          } catch (e) {
            await c.query('ROLLBACK TO s');
            if (e.code !== '23505') throw e;
            avvisi.push(`Riga ${n}: ${nome} ${cognome} duplica un'altra persona (email o nome già presenti), saltata`);
          }
          continue;
        }
        visti.add(p.id);
        try {
          await c.query('SAVEPOINT s');
          await c.query(`UPDATE persona SET email = $1, reparto = coalesce(reparto, $2), data_ingresso = coalesce(data_ingresso, $3::date),
              stato_workspace = $4 WHERE id = $5`, [email, reparto, creato && creato.slice(0, 10), stato, p.id]);
        } catch (e) {
          await c.query('ROLLBACK TO s');
          if (e.code !== '23505') throw e;
          avvisi.push(`Riga ${n}: l'email ${email} è già di un'altra persona, ${nome} ${cognome} non aggiornata`); continue;
        }
        agg++; if (p.stato_workspace !== stato) statiWs++;
        if (stato !== 'Attivo' && p.stato === 'Attivo') daRivedere.push(`${p.nome} ${p.cognome} (in Workspace: ${stato.toLowerCase()})`);
      }
      for (const p of persone) {
        if (visti.has(p.id)) continue;
        const lc = locale(p.email) || norm(`${p.nome} ${p.cognome}`).replace(/ /g, '');
        if (localiWs.has(lc)) continue;
        await c.query(`UPDATE persona SET stato_workspace = 'Non presente' WHERE id = $1`, [p.id]);
        (p.email ? spariti : senzaAccount).push(`${p.nome} ${p.cognome}`);
      }
      const elenco = (t, l) => l.length ? [`${t} (${l.length}): ${l.join(', ')}`] : [];
      return { riepilogo: `${agg} persone aggiornate (${statiWs} cambi di stato Workspace), ${nuovi} nuove. La colonna Stato non è stata toccata.`,
        avvisi: [...elenco('Attive qui ma non attive in Workspace', daRivedere), ...elenco('Spariti da Workspace (avevano un\'email)', spariti),
          ...elenco('Mai avuto un account', senzaAccount), ...avvisi] };
    });
    risposta(res, 'workspace', out);
  } catch (e) { next(e); }
});

module.exports = router;
