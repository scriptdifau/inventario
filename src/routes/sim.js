// SIM: niente elenco (le SIM si vedono sul telefono a cui sono abbinate); qui restano solo i moduli di inserimento e modifica.
const router = require('express').Router();
const { query, nul } = require('../db');

const CAMPI = ['numero', 'stato', 'persona_id', 'operatore', 'piano', 'costo_mensile', 'azienda_id', 'asset_id', 'giga_telefono', 'saponetta', 'giga_saponetta', 'note'];
const STATI = ['Attiva', 'Sospesa', 'Cessata', 'Da verificare'];

async function lookup() {
  const [az, pe, tel] = await Promise.all([
    query('SELECT id, nome FROM azienda ORDER BY id'),
    query(`SELECT id, nome || ' ' || cognome AS nome FROM persona ORDER BY cognome, nome`),
    query(`SELECT id, cespite, coalesce(marca,'') || ' ' || coalesce(modello,'') AS nome FROM v_asset_vivi WHERE tipologia = 'Telefono' ORDER BY id`),
  ]);
  return { aziende: az.rows, persone: pe.rows, telefoni: tel.rows, stati: STATI };
}

// una SIM deve poter essere ritrovata: sul suo telefono o, se non ne ha, nella pagina Telefono della sua azienda
function controlla(body) {
  if (!nul(body.asset_id) && !nul(body.azienda_id)) return 'Indica il telefono in cui è montata oppure l\'azienda, altrimenti la SIM non si ritrova.';
  return null;
}

async function salva(req, id) {
  const body = { ...req.body, saponetta: req.body.saponetta === '' || req.body.saponetta === undefined ? null : req.body.saponetta === 'true' };
  const v = CAMPI.map((c) => (c === 'saponetta' ? body.saponetta : nul(body[c])));
  if (id) {
    await query(`UPDATE sim SET ${CAMPI.map((c, i) => `${c} = $${i + 1}`).join(', ')} WHERE id = $${CAMPI.length + 1}`, [...v, id]);
    return id;
  }
  return (await query(`INSERT INTO sim (${CAMPI.join(',')}) VALUES (${CAMPI.map((_, i) => '$' + (i + 1)).join(',')}) RETURNING id`, v)).rows[0].id;
}

// dopo il salvataggio si torna dove la SIM si vede: il suo telefono, o la pagina Telefono dell'azienda
function destinazione(res, body) {
  if (nul(body.asset_id)) return '/asset/' + Number(body.asset_id);
  const az = (res.locals.albero || []).find((a) => String(a.id) === String(body.azienda_id));
  return az ? `/az/${az.slug}/telefono` : '/';
}

async function errForm(e, req, res, next, nuova, messaggio) {
  if (!messaggio && (!e.code || !/^23/.test(e.code))) return next(e);
  res.status(400).render('sim_form', { s: req.body, nuova, ...(await lookup()),
    errore: messaggio || (e.code === '23505' ? 'Esiste già una SIM con questo numero.' : 'Dati non validi: ' + (e.detail || e.message)) });
}

router.get('/nuova', async (req, res, next) => {
  try {
    const s = { stato: 'Attiva', asset_id: nul(req.query.asset_id) };
    res.render('sim_form', { s, nuova: true, ...(await lookup()) });
  } catch (e) { next(e); }
});

router.post('/nuova', async (req, res, next) => {
  const msg = controlla(req.body);
  if (msg) return errForm(null, req, res, next, true, msg);
  try { await salva(req); res.redirect(destinazione(res, req.body)); } catch (e) { errForm(e, req, res, next, true); }
});

router.get('/:id(\\d+)/modifica', async (req, res, next) => {
  try {
    const s = await query('SELECT * FROM sim WHERE id = $1', [req.params.id]);
    if (!s.rows[0]) return next();
    res.render('sim_form', { s: s.rows[0], nuova: false, ...(await lookup()) });
  } catch (e) { next(e); }
});

router.post('/:id(\\d+)/modifica', async (req, res, next) => {
  const msg = controlla(req.body);
  if (msg) { req.body.id = req.params.id; return errForm(null, req, res, next, false, msg); }
  try { await salva(req, req.params.id); res.redirect(destinazione(res, req.body)); }
  catch (e) { req.body.id = req.params.id; errForm(e, req, res, next, false); }
});

router.post('/:id(\\d+)/elimina', async (req, res, next) => {
  try {
    const s = (await query('SELECT asset_id, azienda_id FROM sim WHERE id = $1', [req.params.id])).rows[0];
    if (!s) return next();
    await query('DELETE FROM sim WHERE id = $1', [req.params.id]);
    res.redirect(destinazione(res, s));
  } catch (e) { next(e); }
});

module.exports = router;
