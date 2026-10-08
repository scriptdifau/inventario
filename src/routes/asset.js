const router = require('express').Router();
const { query, nul, pool } = require('../db');
const { inviaXlsx, num, vuota } = require('../export');
const { ordine, t, tn } = require('../ordina');

const ORD_ASSET = {
  dispositivo: { etichetta: 'Dispositivo', col: [t('marca'), t('modello')] },
  cespite: { etichetta: 'Cespite', col: ['cespite'] },
  persona: { etichetta: 'Persona (cognome)', col: ['k_cognome', 'k_nome'] },
  nome: { etichetta: 'Persona (nome)', col: ['k_nome', 'k_cognome'] },
  stato: { etichetta: 'Stato', col: ['lower(stato)'] },
  azienda: { etichetta: 'Azienda', col: ['lower(azienda)'] },
  importo: { etichetta: 'Importo', col: ['importo'] },
  acquisto: { etichetta: 'Data acquisto', col: ['data_acquisto'] },
};

async function lookup() {
  const [az, tip, st, pe, fo] = await Promise.all([
    query('SELECT id, nome FROM azienda ORDER BY id'),
    query('SELECT nome FROM tipologia'),
    query('SELECT nome FROM stato_asset ORDER BY ordine'),
    query(`SELECT id, nome || ' ' || cognome AS nome, stato FROM persona ORDER BY cognome, nome`),
    query('SELECT id, nome FROM fornitore ORDER BY nome'),
  ]);
  return { aziende: az.rows, tipologie: tip.rows.map((r) => r.nome), stati: st.rows.map((r) => r.nome), persone: pe.rows, fornitori: fo.rows };
}

async function elenco(req, res, next) {
  try {
    const { q = '', stato = '', tipologia = '', azienda = '', uscita = '', av = '' } = req.query;
    const where = []; const p = [];
    if (!uscita) where.push('NOT fuori');
    if (q) { p.push(`%${q}%`); where.push(`(cespite::text ILIKE $${p.length} OR coalesce(sim_numero,'') ILIKE $${p.length} OR codice ILIKE $${p.length} OR coalesce(assegnato_a,'') ILIKE $${p.length} OR coalesce(modello,'') ILIKE $${p.length}
      OR coalesce(marca,'') ILIKE $${p.length} OR coalesce(serial,'') ILIKE $${p.length} OR coalesce(hostname,'') ILIKE $${p.length})`); }
    if (stato) { p.push(stato); where.push(`stato = $${p.length}`); }
    if (tipologia) { p.push(tipologia); where.push(`tipologia = $${p.length}`); }
    if (azienda) { p.push(azienda); where.push(`azienda = $${p.length}`); }
    if (av === 'problemi') where.push("av_stato IS NOT NULL AND av_stato <> 'OK'");
    if (av === 'ok') where.push("av_stato = 'OK'");
    const ord = ordine(req, ORD_ASSET, 'persona', 'id');
    // k_cognome/k_nome: ordine per cognome della persona (v_asset ha solo "Nome Cognome")
    const r = await query(`SELECT * FROM (SELECT v.*, ${tn('pe.cognome')} AS k_cognome, ${tn('pe.nome')} AS k_nome, av.antivirus AS av_stato, av.ultimo_rilevato AS av_visto,
        sm.numero AS sim_numero, sm.stato AS sim_stato, sm.operatore AS sim_operatore, sm.piano AS sim_piano, sm.costo_mensile AS sim_costo
        FROM v_asset v LEFT JOIN asset a ON a.id = v.id LEFT JOIN persona pe ON pe.id = a.persona_id LEFT JOIN v_controllo_antivirus av ON av.codice = v.codice
        LEFT JOIN LATERAL (SELECT numero, stato, operatore, piano, costo_mensile FROM sim s WHERE s.asset_id = v.id ORDER BY (s.stato = 'Cessata'), s.id LIMIT 1) sm ON true) x
      ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY ${ord.sql}`, p);
    if (vuota(req)) {
      return inviaXlsx(res, 'asset', [{ nome: 'Asset', righe: r.rows, colonne: [
        { h: 'N. cespite', v: (x) => x.cespite, t: 'num' }, { h: 'Tipologia', v: (x) => x.tipologia }, { h: 'Stato', v: (x) => x.stato },
        { h: 'Assegnato a', v: (x) => x.assegnato_a }, { h: 'Marca', v: (x) => x.marca }, { h: 'Modello', v: (x) => x.modello },
        { h: 'RAM (GB)', v: (x) => x.ram_gb, t: 'num' }, { h: 'Storage (GB)', v: (x) => x.storage_gb, t: 'num' },
        { h: 'Sistema operativo', v: (x) => x.sistema_operativo }, { h: 'Serial', v: (x) => x.serial }, { h: 'Hostname', v: (x) => x.hostname },
        { h: 'Antivirus', v: (x) => (x.av_stato === 'OK' ? 'Sì' : x.av_stato === 'Mancante' ? 'No' : x.av_stato) },
        { h: 'Azienda', v: (x) => x.azienda }, { h: 'Fornitore', v: (x) => x.fornitore },
        { h: 'Numero SIM', v: (x) => x.sim_numero }, { h: 'Stato SIM', v: (x) => x.sim_stato }, { h: 'Operatore SIM', v: (x) => x.sim_operatore },
        { h: 'Piano SIM', v: (x) => x.sim_piano }, { h: 'Costo mensile SIM €', v: (x) => num(x.sim_costo), t: 'euro' },
        { h: 'N. fattura', v: (x) => x.n_fattura }, { h: 'Data acquisto', v: (x) => x.data_acquisto, t: 'data' },
        { h: 'Importo €', v: (x) => num(x.importo), t: 'euro' }, { h: 'Data dismissione', v: (x) => x.data_dismissione, t: 'data' },
        { h: 'Note', v: (x) => x.note }, { h: 'Codice interno', v: (x) => x.codice }] }]);
    }
    // conteggi per stato (asset in vita) per i filtri rapidi
    const cw = ['NOT fuori']; const cp = [];
    if (azienda) { cp.push(azienda); cw.push(`azienda = $${cp.length}`); }
    if (tipologia) { cp.push(tipologia); cw.push(`tipologia = $${cp.length}`); }
    const cs = await query(`SELECT stato, count(*)::int AS n FROM v_asset WHERE ${cw.join(' AND ')} GROUP BY stato`, cp);
    const conteggi = Object.fromEntries(cs.rows.map((x) => [x.stato, x.n]));
    // antivirus: quanti PC/server attivi hanno problemi, nell'ambito della pagina; data dell'ultimo report
    const aw = []; const ap = [];
    if (azienda) { ap.push(azienda); aw.push(`v.azienda = $${ap.length}`); }
    if (tipologia) { ap.push(tipologia); aw.push(`a.tipologia = $${ap.length}`); }
    const avc = (await query(`SELECT count(*)::int AS tot, count(*) FILTER (WHERE v.antivirus <> 'OK')::int AS problemi
      FROM v_controllo_antivirus v JOIN asset a ON a.codice = v.codice ${aw.length ? 'WHERE ' + aw.join(' AND ') : ''}`, ap)).rows[0];
    const rep = (await query('SELECT importato FROM antivirus_import ORDER BY id DESC LIMIT 1')).rows[0];
    res.render('asset_lista', { ord, righe: r.rows, filtri: { q, stato, tipologia, azienda, uscita, av }, conteggi, avc, reportAv: rep && rep.importato, ...(await lookup()) });
  } catch (e) { next(e); }
}
router.get('/', elenco);

const CAMPI = ['tipologia', 'stato', 'persona_id', 'marca', 'modello', 'ram_gb', 'storage_gb', 'sistema_operativo', 'serial', 'hostname',
  'azienda_id', 'fornitore_id', 'data_acquisto', 'importo', 'data_dismissione', 'note'];

router.get('/nuovo', async (req, res, next) => {
  try { res.render('asset_form', { a: { stato: 'Disponibile', azienda_id: req.query.azienda_id, tipologia: req.query.tipologia }, nuovo: true, fatture: [], ...(await lookup()) }); } catch (e) { next(e); }
});

async function fatture(fornitoreId) {
  if (!fornitoreId) return [];
  return (await query('SELECT id, numero, data FROM fattura WHERE fornitore_id = $1 ORDER BY data DESC NULLS LAST, numero', [fornitoreId])).rows;
}

async function salva(req, id) {
  const v = CAMPI.map((c) => nul(req.body[c]));
  // cespite: (azienda, numero) -> riga cespite
  let cespiteId = null;
  const num = nul(req.body.cespite_numero);
  if (num && nul(req.body.azienda_id)) {
    const c = await query(`INSERT INTO cespite (azienda_id, numero) VALUES ($1, $2)
      ON CONFLICT (azienda_id, numero) DO UPDATE SET numero = EXCLUDED.numero RETURNING id`, [req.body.azienda_id, num]);
    cespiteId = c.rows[0].id;
  }
  // fattura: solo se coerente col fornitore (la FK composta lo impone comunque)
  const fatturaId = nul(req.body.fattura_id);
  const cols = [...CAMPI, 'cespite_id', 'fattura_id'];
  const vals = [...v, cespiteId, fatturaId];
  if (id) {
    const set = cols.map((c, i) => `${c} = $${i + 1}`).join(', ');
    await query(`UPDATE asset SET ${set} WHERE id = $${cols.length + 1}`, [...vals, id]);
    return id;
  }
  const r = await query(`INSERT INTO asset (${cols.join(',')}) VALUES (${cols.map((_, i) => '$' + (i + 1)).join(',')}) RETURNING id`, vals);
  return r.rows[0].id;
}

router.post('/nuovo', async (req, res, next) => {
  try { res.redirect('/asset/' + await salva(req)); } catch (e) { rerender(e, req, res, next, true); }
});

async function rerender(e, req, res, next, nuovo) {
  if (!e.code || !/^23/.test(e.code)) return next(e);
  try {
    const l = await lookup();
    res.status(400).render('asset_form', { a: { ...req.body, codice: req.body.codice }, nuovo, fatture: await fatture(req.body.fornitore_id),
      errore: e.constraint === 'assegnatario_coerente'
        ? 'Incoerenza stato/assegnatario: "Assegnato" richiede una persona; In esercizio, Disponibile, Estinto e gli stati di uscita non possono averne.'
        : e.constraint === 'asset_serial_uq' ? 'Esiste già un asset con questo serial.' : 'Dati non validi: ' + (e.detail || e.message), ...l });
  } catch (e2) { next(e2); }
}

router.get('/:id(\\d+)', async (req, res, next) => {
  try {
    const a = await query('SELECT * FROM v_asset WHERE id = $1', [req.params.id]);
    if (!a.rows[0]) return next();
    const [mov, sim, avs] = await Promise.all([
      query(`SELECT m.*, d.nome || ' ' || d.cognome AS da, t.nome || ' ' || t.cognome AS a FROM movimento m
             LEFT JOIN persona d ON d.id = m.da_persona_id LEFT JOIN persona t ON t.id = m.a_persona_id
             WHERE m.asset_id = $1 ORDER BY m.data DESC, m.id DESC`, [req.params.id]),
      query(`SELECT s.*, p.nome || ' ' || p.cognome AS persona FROM sim s LEFT JOIN persona p ON p.id = s.persona_id WHERE s.asset_id = $1 ORDER BY (s.stato = 'Cessata'), s.id`, [req.params.id]),
      query('SELECT antivirus, dispositivo_report, ultimo_rilevato FROM v_controllo_antivirus WHERE codice = $1', [a.rows[0].codice]),
    ]);
    res.render('asset_scheda', { a: a.rows[0], mov: mov.rows, sim: sim.rows, av: avs.rows[0] || null });
  } catch (e) { next(e); }
});

router.get('/:id(\\d+)/modifica', async (req, res, next) => {
  try {
    const r = await query(`SELECT a.*, a.codice, c.numero AS cespite_numero FROM asset a LEFT JOIN cespite c ON c.id = a.cespite_id WHERE a.id = $1`, [req.params.id]);
    if (!r.rows[0]) return next();
    res.render('asset_form', { a: r.rows[0], nuovo: false, fatture: await fatture(r.rows[0].fornitore_id), ...(await lookup()) });
  } catch (e) { next(e); }
});

router.post('/:id(\\d+)/modifica', async (req, res, next) => {
  try {
    const ex = await query('SELECT codice FROM asset WHERE id = $1', [req.params.id]);
    if (!ex.rows[0]) return next();
    req.body.codice = ex.rows[0].codice;
    await salva(req, req.params.id);
    res.redirect('/asset/' + req.params.id);
  } catch (e) { req.body.id = req.params.id; rerender(e, req, res, next, false); }
});

// eliminazione definitiva dell'asset; resta traccia in Movimenti (tipo "Eliminazione") e lo storico precedente
// resta leggibile (movimento.asset_id passa a NULL, la descrizione è in `oggetto`).
// Le SIM montate restano, senza telefono e con l'azienda dell'asset; il cespite si cancella solo se nessun altro asset lo usa.
router.post('/:id(\\d+)/elimina', async (req, res, next) => {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const a = (await c.query(`SELECT a.id, a.azienda_id, a.cespite_id, a.persona_id, a.stato, a.tipologia, a.marca, a.modello, a.serial, a.hostname, ce.numero AS cespite
      FROM asset a LEFT JOIN cespite ce ON ce.id = a.cespite_id WHERE a.id = $1 FOR UPDATE OF a`, [req.params.id])).rows[0];
    if (!a) { await c.query('ROLLBACK'); return next(); }
    const oggetto = [[a.marca, a.modello].filter(Boolean).join(' ') || a.tipologia, a.cespite ? 'cespite ' + a.cespite : null,
      a.serial ? 'serial ' + a.serial : null, a.hostname].filter(Boolean).join(' · ');
    await c.query('UPDATE sim SET asset_id = NULL, azienda_id = coalesce(azienda_id, $2) WHERE asset_id = $1', [a.id, a.azienda_id]);
    await c.query('UPDATE movimento SET oggetto = $2 WHERE asset_id = $1', [a.id, oggetto]);
    await c.query(`INSERT INTO movimento (tipo, da_persona_id, stato_prima, oggetto, utente, note) VALUES ('Eliminazione', $1, $2, $3, $4, $5)`,
      [a.persona_id, a.stato, oggetto, req.session.utente && req.session.utente.email, `${a.tipologia} eliminato definitivamente`]);
    await c.query('DELETE FROM asset WHERE id = $1', [a.id]);
    if (a.cespite_id) await c.query('DELETE FROM cespite c WHERE c.id = $1 AND NOT EXISTS (SELECT 1 FROM asset x WHERE x.cespite_id = c.id)', [a.cespite_id]);
    await c.query('COMMIT');
    res.redirect('/movimenti');
  } catch (e) { await c.query('ROLLBACK').catch(() => {}); next(e); } finally { c.release(); }
});

// fatture di un fornitore (per il menu a cascata del form)
router.get('/fatture', async (req, res, next) => {
  try { res.json(await fatture(req.query.fornitore_id)); } catch (e) { next(e); }
});

module.exports = router;
module.exports.elenco = elenco;
