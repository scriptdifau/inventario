const router = require('express').Router();
const { query, nul } = require('../db');

const CAMPI = ['numero', 'stato', 'persona_id', 'operatore', 'piano', 'costo_mensile', 'azienda_id', 'asset_id', 'giga_telefono', 'saponetta', 'giga_saponetta', 'note'];
const STATI = ['Attiva', 'Sospesa', 'Cessata', 'Da verificare'];

async function lookup() {
  const [az, pe, tel] = await Promise.all([
    query('SELECT id, nome FROM azienda ORDER BY id'),
    query(`SELECT id, nome || ' ' || cognome AS nome FROM persona ORDER BY cognome, nome`),
    query(`SELECT codice, id, coalesce(marca,'') || ' ' || coalesce(modello,'') AS nome FROM v_asset_vivi WHERE tipologia = 'Telefono' ORDER BY id`),
  ]);
  return { aziende: az.rows, persone: pe.rows, telefoni: tel.rows, stati: STATI };
}

router.get('/', async (req, res, next) => {
  try {
    const { q = '', stato = '' } = req.query;
    const p = []; const w = [];
    if (stato) { p.push(stato); w.push(`s.stato = $${p.length}`); }
    if (q) { p.push(`%${q}%`); w.push(`(s.codice ILIKE $${p.length} OR coalesce(s.numero,'') ILIKE $${p.length} OR pe.nome || ' ' || pe.cognome ILIKE $${p.length})`); }
    const r = await query(`SELECT s.*, pe.nome || ' ' || pe.cognome AS persona, a.codice AS asset_codice, az.nome AS azienda
      FROM sim s LEFT JOIN persona pe ON pe.id = s.persona_id LEFT JOIN asset a ON a.id = s.asset_id LEFT JOIN azienda az ON az.id = s.azienda_id
      ${w.length ? 'WHERE ' + w.join(' AND ') : ''} ORDER BY s.id`, p);
    res.render('sim_lista', { righe: r.rows, filtri: { q, stato }, stati: STATI });
  } catch (e) { next(e); }
});

router.get('/nuova', async (req, res, next) => {
  try { res.render('sim_form', { s: { stato: 'Attiva' }, nuova: true, ...(await lookup()) }); } catch (e) { next(e); }
});

async function salva(req, id) {
  const body = { ...req.body, saponetta: req.body.saponetta === '' || req.body.saponetta === undefined ? null : req.body.saponetta === 'true' };
  const v = CAMPI.map((c) => (c === 'saponetta' ? body.saponetta : nul(body[c])));
  if (id) {
    await query(`UPDATE sim SET ${CAMPI.map((c, i) => `${c} = $${i + 1}`).join(', ')} WHERE id = $${CAMPI.length + 1}`, [...v, id]);
    return id;
  }
  return (await query(`INSERT INTO sim (${CAMPI.join(',')}) VALUES (${CAMPI.map((_, i) => '$' + (i + 1)).join(',')}) RETURNING id`, v)).rows[0].id;
}

async function errForm(e, req, res, next, nuova) {
  if (!e.code || !/^23/.test(e.code)) return next(e);
  res.status(400).render('sim_form', { s: req.body, nuova, ...(await lookup()),
    errore: e.code === '23505' ? 'Esiste già una SIM con questo numero.' : 'Dati non validi: ' + (e.detail || e.message) });
}

router.post('/nuova', async (req, res, next) => {
  try { await salva(req); res.redirect('/sim'); } catch (e) { errForm(e, req, res, next, true); }
});

router.get('/:id(\\d+)/modifica', async (req, res, next) => {
  try {
    const s = await query('SELECT * FROM sim WHERE id = $1', [req.params.id]);
    if (!s.rows[0]) return next();
    res.render('sim_form', { s: s.rows[0], nuova: false, ...(await lookup()) });
  } catch (e) { next(e); }
});

router.post('/:id(\\d+)/modifica', async (req, res, next) => {
  try { await salva(req, req.params.id); res.redirect('/sim'); }
  catch (e) { req.body.id = req.params.id; errForm(e, req, res, next, false); }
});

module.exports = router;
