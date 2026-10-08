// Import di una fattura di acquisto da XML (FatturaPA) o da testo di un PDF, in due passi:
// 1) /anteprima legge il file e mostra una bozza modificabile (nulla viene salvato, nessun file resta sul server);
// 2) /conferma salva fornitore, fattura e asset (nuovi o collegati) in un'unica transazione.
const router = require('express').Router();
const { query, pool, nul } = require('../db');
const { leggiXml, leggiPdf, classifica, seriali, nomeBreve, norm, numIt } = require('../fattura');
const { parseData } = require('../csv');

const MAX_RIGHE = 200; const MAX_QTA = 50;

function errore(res, stato, msg) { return res.status(stato).render('importa', { formati: res.locals.formati || {}, esito: { tipo: 'fatture', errore: msg } }); }

const importo = (v) => { const t = String(v === undefined || v === null ? '' : v).trim(); if (!t) return null; const n = /,/.test(t) ? numIt(t) : parseFloat(t); return Number.isFinite(n) ? n : null; };

router.post('/anteprima', async (req, res, next) => {
  try {
    const formato = req.body.formato === 'pdf' ? 'pdf' : 'xml'; const avvisi = [];
    let doc;
    if (formato === 'xml') {
      const docs = leggiXml(req.body.testo);
      if (!docs.length) return errore(res, 400, 'Non riesco a leggere il file come fattura elettronica (FatturaPA XML o .xml.p7m).');
      doc = docs[0];
      if (docs.length > 1) avvisi.push(`Il file contiene ${docs.length} fatture: qui c'è solo la prima, importa il file un'altra volta per le altre.`);
    } else {
      const t = String(req.body.testo || '');
      if (t.replace(/\s/g, '').length < 20) return errore(res, 400, 'Nel PDF non c\'è testo leggibile (forse è una scansione). Usa l\'XML della fattura oppure inserisci le righe a mano.');
      doc = leggiPdf(t);
      avvisi.push('Dati letti da un PDF: i layout cambiano da fornitore a fornitore, controlla con attenzione fornitore, numero, data e righe.');
    }
    if (doc.tipoDocumento === 'TD04') avvisi.push('È una nota di credito: di solito non si creano asset, le righe sono impostate su "Salta".');

    const [aziende, fornitori, tip] = await Promise.all([query('SELECT id, nome FROM azienda ORDER BY id'), query('SELECT id, nome FROM fornitore ORDER BY nome'), query('SELECT nome FROM tipologia ORDER BY nome')]);
    const tipologie = tip.rows.map((x) => x.nome);

    // fornitore: corrispondenza esatta o per nome contenuto ("EFFESISTEMI SRL" -> Effesistemi)
    const nCompleto = norm(doc.fornitore); const nBreve = norm(nomeBreve(doc.fornitore));
    const trovato = fornitori.rows.filter((f) => { const k = norm(f.nome); return k && (k === nBreve || k === nCompleto || (k.length >= 4 && nCompleto.includes(k))); })
      .sort((a, b) => b.nome.length - a.nome.length)[0];
    // azienda: nome dell'azienda contenuto nell'intestatario (o, per i PDF, in tutto il testo)
    const bersaglio = norm(doc.cessionario || doc.testo || '');
    const az = aziende.rows.find((a) => bersaglio.includes(norm(a.nome)) || norm(a.nome).split(' ').slice(0, 2).join(' ') && bersaglio.includes(norm(a.nome).split(' ').slice(0, 2).join(' ')));

    // fattura già registrata?
    let esistente = null;
    if (trovato && doc.numero) {
      const f = (await query(`SELECT f.id, (SELECT count(*)::int FROM asset a WHERE a.fattura_id = f.id) AS n FROM fattura f WHERE f.fornitore_id = $1 AND f.numero = $2 AND f.data IS NOT DISTINCT FROM $3::date`,
        [trovato.id, doc.numero, doc.data])).rows[0];
      if (f) esistente = { id: f.id, nAsset: f.n };
    }

    // asset già presenti con gli stessi seriali
    const serialiRiga = doc.righe.map((r) => seriali(r.descrizione, ...(r.riferimenti || [])));
    const tuttiSeriali = [...new Set(serialiRiga.flat())];
    const presenti = tuttiSeriali.length ? (await query(`SELECT id, codice, marca, modello, upper(serial) AS serial, fattura_id FROM asset WHERE upper(serial) = ANY($1)`, [tuttiSeriali])).rows : [];

    const righe = doc.righe.map((r, i) => {
      const c = classifica(r.descrizione); const sr = serialiRiga[i];
      const gia = presenti.find((p) => sr.includes(p.serial));
      const hardware = c.tipologia !== 'Altro' && !c.servizio;
      let azione = hardware ? 'nuovo' : 'salta'; let nota = '';
      if (gia) { azione = 'collega'; nota = `Già presente: ${gia.codice} (${[gia.marca, gia.modello].filter(Boolean).join(' ') || 'senza modello'}), seriale ${gia.serial}`; }
      else if (esistente && esistente.nAsset > 0) { azione = 'salta'; nota = 'Fattura già registrata con asset collegati: riga lasciata su "Salta" per non duplicare.'; }
      if (doc.tipoDocumento === 'TD04') azione = 'salta';
      if (c.servizio) nota = nota || 'Sembra un servizio (spedizione, canone, assistenza…).';
      return { descrizione: r.descrizione, azione, asset: gia ? gia.codice : '', collegato: gia ? nota : '', nota: gia ? '' : nota, tipologia: c.tipologia, marca: c.marca,
        modello: String(r.descrizione || '').slice(0, 120), serial: r.quantita === 1 && sr.length === 1 && !gia ? sr[0] : '', importo: r.prezzoUnitario, qta: Math.min(Math.max(Math.round(r.quantita) || 1, 1), MAX_QTA),
        totaleRiga: r.importo, incerta: !!r.incerta };
    });
    if (!righe.length) avvisi.push('Non ho trovato righe: aggiungile a mano qui sotto.');

    res.render('fattura_anteprima', { nome: req.body.nome, avvisi, aziende: aziende.rows, fornitori: fornitori.rows, tipologie, righe,
      b: { formato, numero: doc.numero, data: doc.data, totale: doc.totale, piva: doc.piva, cessionario: doc.cessionario, fornitoreOriginale: doc.fornitore,
        fornitoreId: trovato ? trovato.id : '', fornitoreNuovo: trovato ? '' : nomeBreve(doc.fornitore), aziendaId: az ? az.id : '', esistente } });
  } catch (e) { next(e); }
});

router.post('/conferma', async (req, res, next) => {
  const b = req.body; const avvisi = []; const creati = [];
  const n = Math.min(Math.max(parseInt(b.n, 10) || 0, 0), MAX_RIGHE);
  const numero = nul(b.numero); const data = nul(b.data) ? (/^\d{4}-\d{2}-\d{2}$/.test(b.data) ? b.data : (parseData(b.data, 'dmy') || '').slice(0, 10) || null) : null;
  const righe = [...Array(n).keys()].map((i) => ({ i, azione: b['azione_' + i], asset: nul(b['asset_' + i]), tipologia: nul(b['tipologia_' + i]), marca: nul(b['marca_' + i]),
    modello: nul(b['modello_' + i]), serial: nul(b['serial_' + i]), importo: importo(b['importo_' + i]), qta: Math.min(Math.max(parseInt(b['qta_' + i], 10) || 1, 1), MAX_QTA), descr: b['descr_' + i] }))
    .filter((r) => r.azione === 'nuovo' || r.azione === 'collega');
  if (!numero) return errore(res, 400, 'Manca il numero della fattura.');
  if (!nul(b.fornitore_id) && !nul(b.fornitore_nome)) return errore(res, 400, 'Scegli un fornitore esistente oppure scrivi il nome di uno nuovo.');
  if (righe.some((r) => r.azione === 'nuovo') && !nul(b.azienda_id)) return errore(res, 400, 'Per creare nuovi asset scegli l\'azienda.');
  const stato = ['Disponibile', 'In esercizio', 'Da verificare'].includes(b.stato) ? b.stato : 'Disponibile';
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    let fid = nul(b.fornitore_id) ? Number(b.fornitore_id) : null;
    if (fid) { if (!(await c.query('SELECT 1 FROM fornitore WHERE id = $1', [fid])).rows[0]) { await c.query('ROLLBACK'); return errore(res, 400, 'Fornitore non valido.'); } }
    else {
      const nome = nul(b.fornitore_nome);
      const ex = await c.query('SELECT id FROM fornitore WHERE lower(nome) = lower($1)', [nome]);
      fid = ex.rows[0] ? ex.rows[0].id : (await c.query('INSERT INTO fornitore (nome) VALUES ($1) RETURNING id', [nome])).rows[0].id;
      if (!ex.rows[0]) avvisi.push(`Fornitore nuovo creato: ${nome}`);
    }
    let fa = (await c.query('SELECT id FROM fattura WHERE fornitore_id = $1 AND numero = $2 AND data IS NOT DISTINCT FROM $3::date', [fid, numero, data])).rows[0];
    const nColl = fa ? (await c.query('SELECT count(*)::int n FROM asset WHERE fattura_id = $1', [fa.id])).rows[0].n : 0;
    if (fa && nColl > 0 && b.forza !== '1' && righe.some((r) => r.azione === 'nuovo')) {
      await c.query('ROLLBACK');
      return errore(res, 400, `La fattura ${numero} è già registrata con ${nColl} asset collegati: per non duplicarli, spunta "Voglio comunque creare altri asset" oppure imposta le righe su "Salta" o "Collega".`);
    }
    if (!fa) fa = (await c.query('INSERT INTO fattura (fornitore_id, numero, data) VALUES ($1,$2,$3) RETURNING id', [fid, numero, data])).rows[0];
    else avvisi.push(`La fattura ${numero} era già registrata: riusata.`);
    let nuovi = 0; let collegati = 0;
    for (const r of righe) {
      const etichetta = r.descr ? `"${String(r.descr).slice(0, 40)}"` : `riga ${r.i + 1}`;
      if (r.azione === 'collega') {
        const m = String(r.asset || '').toUpperCase().match(/^(?:AST-)?(\d+)$/);
        if (!m) { avvisi.push(`${etichetta}: codice asset non valido (${r.asset || 'vuoto'}), non collegata`); continue; }
        const as = (await c.query('SELECT id, codice, fornitore_id, fattura_id FROM asset WHERE id = $1 FOR UPDATE', [+m[1]])).rows[0];
        if (!as) { avvisi.push(`${etichetta}: ${r.asset} non esiste`); continue; }
        if (as.fornitore_id && as.fornitore_id !== fid) { avvisi.push(`${etichetta}: ${as.codice} ha un altro fornitore, non collegato`); continue; }
        if (as.fattura_id && as.fattura_id !== fa.id) { avvisi.push(`${etichetta}: ${as.codice} è già collegato a un'altra fattura, non toccato`); continue; }
        await c.query(`UPDATE asset SET fornitore_id = $1, fattura_id = $2, data_acquisto = coalesce(data_acquisto, $3::date), importo = coalesce(importo, $4) WHERE id = $5`, [fid, fa.id, data, r.importo, as.id]);
        collegati++; creati.push({ id: as.id, titolo: `${as.codice} collegato alla fattura` });
        continue;
      }
      if (!r.tipologia) { avvisi.push(`${etichetta}: manca la tipologia, saltata`); continue; }
      for (let k = 0; k < r.qta; k++) {
        try {
          await c.query('SAVEPOINT s');
          const serial = r.qta === 1 ? r.serial : null;
          const ins = await c.query(`INSERT INTO asset (tipologia, stato, azienda_id, marca, modello, serial, importo, data_acquisto, fornitore_id, fattura_id)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id, codice`, [r.tipologia, stato, b.azienda_id, r.marca, r.modello, serial, r.importo, data, fid, fa.id]);
          nuovi++; creati.push({ id: ins.rows[0].id, titolo: `${ins.rows[0].codice} · ${[r.marca, r.modello].filter(Boolean).join(' ') || r.tipologia}` });
        } catch (e) {
          await c.query('ROLLBACK TO s');
          if (e.code === '23505') { avvisi.push(`${etichetta}: il seriale ${r.serial} esiste già, asset non creato`); break; }
          if (e.code && /^23/.test(e.code)) { avvisi.push(`${etichetta}: dati non validi (${e.detail || e.message}), asset non creato`); break; }
          throw e;
        }
      }
      if (r.qta > 1 && r.serial) avvisi.push(`${etichetta}: con più pezzi il seriale non è stato assegnato, aggiungilo dalla scheda di ogni asset`);
    }
    await c.query('COMMIT');
    res.render('importa', { formati: res.locals.formati || {}, esito: { tipo: 'fatture', riepilogo: `Fattura ${numero} registrata: ${nuovi} asset nuovi, ${collegati} collegati.`, avvisi, creati } });
  } catch (e) { await c.query('ROLLBACK').catch(() => {}); next(e); } finally { c.release(); }
});

module.exports = router;
