const router = require('express').Router();
const { query, nul } = require('../db');
const { inviaXlsx, vuota } = require('../export');
const { PERSONA_AZIENDA } = require('../albero');

const CAMPI = ['nome', 'cognome', 'email', 'azienda_id', 'reparto', 'stato', 'data_ingresso', 'data_uscita', 'note'];
const aziende = async () => (await query('SELECT id, nome FROM azienda ORDER BY id')).rows;

async function elenco(req, res, next) {
  try {
    const { q = '', stato = 'Attivo', azienda = '' } = req.query;
    const p = []; const w = [];
    if (azienda) { p.push(azienda); w.push(`az.nome = $${p.length}`); }
    if (stato) { p.push(stato); w.push(`p.stato = $${p.length}`); }
    if (q) { p.push(`%${q}%`); w.push(`(p.nome || ' ' || p.cognome ILIKE $${p.length} OR coalesce(p.email,'') ILIKE $${p.length})`); }
    const r = await query(`SELECT p.*, az.nome AS azienda,
        (SELECT count(*)::int FROM asset a JOIN stato_asset s ON s.nome = a.stato WHERE a.persona_id = p.id AND NOT s.fuori) AS n_asset
      FROM persona p LEFT JOIN azienda az ON az.id = ${PERSONA_AZIENDA} ${w.length ? 'WHERE ' + w.join(' AND ') : ''} ORDER BY p.cognome, p.nome`, p);
    if (vuota(req)) {
      return inviaXlsx(res, 'persone', [{ nome: 'Persone', righe: r.rows, colonne: [
        { h: 'Cognome', v: (x) => x.cognome }, { h: 'Nome', v: (x) => x.nome }, { h: 'Email', v: (x) => x.email },
        { h: 'Azienda', v: (x) => x.azienda }, { h: 'Reparto', v: (x) => x.reparto }, { h: 'Stato', v: (x) => x.stato },
        { h: 'Stato Workspace', v: (x) => x.stato_workspace }, { h: 'Data ingresso', v: (x) => x.data_ingresso, t: 'data' },
        { h: 'Data uscita', v: (x) => x.data_uscita, t: 'data' }, { h: 'N. asset', v: (x) => x.n_asset, t: 'num' },
        { h: 'Note', v: (x) => x.note }] }]);
    }
    res.render('persone_lista', { righe: r.rows, filtri: { q, stato, azienda } });
  } catch (e) { next(e); }
}
router.get('/', elenco);

router.get('/nuova', async (req, res, next) => {
  try { res.render('persona_form', { p: { stato: 'Attivo' }, nuova: true, aziende: await aziende() }); } catch (e) { next(e); }
});

async function salva(req, id) {
  const v = CAMPI.map((c) => nul(req.body[c]));
  if (v[2]) v[2] = v[2].toLowerCase();
  if (id) {
    await query(`UPDATE persona SET ${CAMPI.map((c, i) => `${c} = $${i + 1}`).join(', ')} WHERE id = $${CAMPI.length + 1}`, [...v, id]);
    return id;
  }
  return (await query(`INSERT INTO persona (${CAMPI.join(',')}) VALUES (${CAMPI.map((_, i) => '$' + (i + 1)).join(',')}) RETURNING id`, v)).rows[0].id;
}

async function errForm(e, req, res, next, nuova) {
  if (!e.code || !/^23/.test(e.code)) return next(e);
  res.status(400).render('persona_form', { p: req.body, nuova, aziende: await aziende(),
    errore: e.code === '23505' ? 'Esiste già una persona con questo nome o questa email.' : 'Dati non validi: ' + (e.detail || e.message) });
}

router.post('/nuova', async (req, res, next) => {
  try { res.redirect('/persone/' + await salva(req)); } catch (e) { errForm(e, req, res, next, true); }
});

router.get('/:id(\\d+)', async (req, res, next) => {
  try {
    const p = await query(`SELECT p.*, az.nome AS azienda FROM persona p LEFT JOIN azienda az ON az.id = p.azienda_id WHERE p.id = $1`, [req.params.id]);
    if (!p.rows[0]) return next();
    const [asset, sim] = await Promise.all([
      query(`SELECT v.id, v.codice, v.tipologia, v.marca, v.modello, v.stato, v.hostname FROM v_asset v JOIN asset a ON a.id = v.id
             WHERE a.persona_id = $1 AND NOT v.fuori ORDER BY v.id`, [req.params.id]),
      query('SELECT id, codice, numero, stato, operatore FROM sim WHERE persona_id = $1 ORDER BY id', [req.params.id]),
    ]);
    res.render('persona_scheda', { p: p.rows[0], asset: asset.rows, sim: sim.rows });
  } catch (e) { next(e); }
});

router.get('/:id(\\d+)/modifica', async (req, res, next) => {
  try {
    const p = await query('SELECT * FROM persona WHERE id = $1', [req.params.id]);
    if (!p.rows[0]) return next();
    res.render('persona_form', { p: p.rows[0], nuova: false, aziende: await aziende() });
  } catch (e) { next(e); }
});

router.post('/:id(\\d+)/modifica', async (req, res, next) => {
  try { await salva(req, req.params.id); res.redirect('/persone/' + req.params.id); }
  catch (e) { req.body.id = req.params.id; errForm(e, req, res, next, false); }
});

module.exports = router;
module.exports.elenco = elenco;
