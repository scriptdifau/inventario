const router = require('express').Router();
const { query, nul } = require('../db');
const { inviaXlsx, num, vuota } = require('../export');
const { SIM_AZIENDA } = require('../albero');
const { ordine, t, tn } = require('../ordina');

const ORD_SIM = {
  numero: { etichetta: 'Numero', col: ['s.numero'] },
  persona: { etichetta: 'Persona', col: [tn('pe.cognome'), tn('pe.nome')] },
  piano: { etichetta: 'Piano', col: [t('s.piano')] },
  costo: { etichetta: 'Costo mensile', col: ['s.costo_mensile'] },
  stato: { etichetta: 'Stato', col: ['lower(s.stato)'] },
  operatore: { etichetta: 'Operatore', col: [t('s.operatore')] },
};

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

async function elenco(req, res, next) {
  try {
    const { q = '', stato = '', azienda = '' } = req.query;
    const p = []; const w = [];
    if (azienda) { p.push(azienda); w.push(`az.nome = $${p.length}`); }
    if (stato) { p.push(stato); w.push(`s.stato = $${p.length}`); }
    if (q) { p.push(`%${q}%`); w.push(`(s.codice ILIKE $${p.length} OR coalesce(s.numero,'') ILIKE $${p.length} OR pe.nome || ' ' || pe.cognome ILIKE $${p.length})`); }
    const ord = ordine(req, ORD_SIM, 'persona', 's.id');
    const r = await query(`SELECT s.*, pe.nome || ' ' || pe.cognome AS persona, a.marca AS tel_marca, a.modello AS tel_modello, ac.numero AS tel_cespite, az.nome AS azienda
      FROM sim s LEFT JOIN persona pe ON pe.id = s.persona_id LEFT JOIN asset a ON a.id = s.asset_id LEFT JOIN cespite ac ON ac.id = a.cespite_id LEFT JOIN azienda az ON az.id = ${SIM_AZIENDA}
      ${w.length ? 'WHERE ' + w.join(' AND ') : ''} ORDER BY ${ord.sql}`, p);
    if (vuota(req)) {
      return inviaXlsx(res, 'sim', [{ nome: 'SIM', righe: r.rows, colonne: [
        { h: 'ID', v: (x) => x.codice }, { h: 'Numero', v: (x) => x.numero }, { h: 'Stato', v: (x) => x.stato },
        { h: 'Assegnata a', v: (x) => x.persona }, { h: 'Operatore', v: (x) => x.operatore }, { h: 'Piano', v: (x) => x.piano },
        { h: 'Costo mensile €', v: (x) => num(x.costo_mensile), t: 'euro' }, { h: 'Azienda', v: (x) => x.azienda },
        { h: 'Telefono', v: (x) => [x.tel_marca, x.tel_modello].filter(Boolean).join(' ') }, { h: 'Cespite telefono', v: (x) => x.tel_cespite, t: 'num' }, { h: 'Giga telefono', v: (x) => x.giga_telefono },
        { h: 'Saponetta', v: (x) => x.saponetta }, { h: 'Giga saponetta', v: (x) => x.giga_saponetta }, { h: 'Note', v: (x) => x.note }] }]);
    }
    res.render('sim_lista', { ord, righe: r.rows, filtri: { q, stato, azienda }, stati: STATI });
  } catch (e) { next(e); }
}
router.get('/', elenco);

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
module.exports.elenco = elenco;
