// Sincronizzazione persone <- utenti Google Workspace (da CSV della console o dalla Directory API).
// Stesse regole di SincronizzaDipendenti.gs:
//  - abbinamento per parte locale dell'email (gli alias cambiano dominio, non nomecognome), poi per nome completo;
//  - `stato` (Attivo/Sospeso/Cessato) non viene mai sovrascritto: lo stato letto da Google va in `stato_workspace`;
//  - chi non ha riscontro in Workspace viene marcato "Non presente" e segnalato.
const { pool } = require('./db');

const norm = (t) => String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z ]/g, '').replace(/\s+/g, ' ').trim();
const locale = (e) => String(e || '').toLowerCase().split('@')[0].split('+')[0].replace(/[^a-z0-9]/g, '');

// utenti: [{ riga, email, nome, cognome, stato: 'Attivo'|'Sospeso'|'Cessato', reparto, creato: 'YYYY-MM-DD'|null }]
// avvisiIniziali: avvisi già raccolti da chi ha letto la sorgente (righe scartate…)
async function sincronizza(utenti, avvisiIniziali = []) {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const r = await applica(c, utenti, avvisiIniziali);
    await c.query('COMMIT');
    return r;
  } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; } finally { c.release(); }
}

async function applica(c, utenti, avvisiIniziali) {
  const avvisi = [...avvisiIniziali]; const daRivedere = []; const spariti = []; const senzaAccount = [];
  let agg = 0; let nuovi = 0; let statiWs = 0;
  const persone = (await c.query('SELECT id, nome, cognome, email, stato, stato_workspace, reparto, data_ingresso FROM persona')).rows;
  const perLocale = new Map(); const perNome = new Map();
  for (const p of persone) {
    const lc = locale(p.email); const nm = norm(`${p.nome} ${p.cognome}`);
    if (lc && !perLocale.has(lc)) perLocale.set(lc, p);
    if (nm) { if (!perNome.has(nm)) perNome.set(nm, p); if (!perLocale.has(nm.replace(/ /g, ''))) perLocale.set(nm.replace(/ /g, ''), p); }
  }
  const visti = new Set(); const localiWs = new Set(utenti.map((u) => locale(u.email)));
  for (const u of utenti) {
    const { riga: n, email, nome, cognome, stato, reparto, creato } = u;
    let p = perLocale.get(locale(email)) || perNome.get(norm(`${nome} ${cognome}`));
    if (!p) {
      try {
        await c.query('SAVEPOINT s');
        const ins = await c.query(`INSERT INTO persona (nome, cognome, email, reparto, stato, stato_workspace, data_ingresso, note)
          VALUES ($1,$2,$3,$4,$5,$5,$6,$7) RETURNING id`,
          [nome, cognome, email, reparto, stato, creato,
            `Aggiunto da Workspace il ${new Date().toLocaleDateString('it-IT', { timeZone: 'Europe/Rome' })}`]);
        visti.add(ins.rows[0].id); nuovi++;
      } catch (e) {
        await c.query('ROLLBACK TO s');
        if (e.code !== '23505') throw e;
        avvisi.push(`${n ? 'Riga ' + n + ': ' : ''}${nome} ${cognome} duplica un'altra persona (email o nome già presenti), saltata`);
      }
      continue;
    }
    visti.add(p.id);
    try {
      await c.query('SAVEPOINT s');
      await c.query(`UPDATE persona SET email = $1, reparto = coalesce(reparto, $2), data_ingresso = coalesce(data_ingresso, $3::date),
          stato_workspace = $4 WHERE id = $5`, [email, reparto, creato, stato, p.id]);
    } catch (e) {
      await c.query('ROLLBACK TO s');
      if (e.code !== '23505') throw e;
      avvisi.push(`${n ? 'Riga ' + n + ': ' : ''}l'email ${email} è già di un'altra persona, ${nome} ${cognome} non aggiornata`); continue;
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
}

module.exports = { sincronizza, norm, locale };
