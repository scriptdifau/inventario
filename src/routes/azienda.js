// Albero: /az/:azienda  ->  panoramica, una pagina per tipologia di asset, persone;
// (antivirus e SIM sono simboli sulle righe dei PC e dei telefoni). Usa gli stessi elenchi del resto dell'app con i filtri già impostati.
const router = require('express').Router();
const asset = require('./asset');
const persone = require('./persone');
const { query } = require('../db');

// risolve l'azienda dallo slug; altrimenti passa oltre (404)
router.param('az', (req, res, next, valore) => {
  req.az = (res.locals.albero || []).find((a) => a.slug === valore);
  return req.az ? next() : next('route');
});
router.param('tip', (req, res, next, valore) => {
  req.tip = req.az.tipologie.find((t) => t.slug === valore);
  return req.tip ? next() : next('route');
});

// impone i filtri della pagina (non modificabili dall'utente) e il contesto per le viste
function contesto(req, res, filtri, ctx) {
  req.query = { ...req.query, ...filtri };
  res.locals.ctx = ctx;
}

router.get('/:az', async (req, res, next) => {
  try {
    const az = req.az;
    const [attenzione, recenti] = await Promise.all([
      query(`SELECT a.id, a.tipologia, a.marca, a.modello, c.numero AS cespite, p.nome || ' ' || p.cognome AS persona
             FROM asset a JOIN stato_asset s ON s.nome = a.stato LEFT JOIN persona p ON p.id = a.persona_id LEFT JOIN cespite c ON c.id = a.cespite_id
             WHERE a.azienda_id = $1 AND a.stato = 'Da verificare' ORDER BY a.id`, [az.id]),
      query(`SELECT m.data, m.tipo, a.id AS asset_id, a.tipologia, a.marca, a.modello, c.numero AS cespite FROM movimento m JOIN asset a ON a.id = m.asset_id LEFT JOIN cespite c ON c.id = a.cespite_id
             WHERE a.azienda_id = $1 ORDER BY m.data DESC, m.id DESC LIMIT 6`, [az.id]),
    ]);
    res.render('azienda', { az, attenzione: attenzione.rows, recenti: recenti.rows });
  } catch (e) { next(e); }
});

router.get('/:az/persone', (req, res, next) => {
  contesto(req, res, { azienda: req.az.nome }, { az: req.az, tip: null, base: `/az/${req.az.slug}/persone`, titolo: 'Persone', fissi: ['azienda'] });
  return persone.elenco(req, res, next);
});

router.get('/:az/:tip', (req, res, next) => {
  const { az, tip } = req;
  contesto(req, res, { azienda: az.nome, tipologia: tip.nome },
    { az, tip, base: `/az/${az.slug}/${tip.slug}`, titolo: tip.nome, fissi: ['azienda', 'tipologia'] });
  // sulla pagina dei telefoni: le SIM dell'azienda che non sono montate su nessun telefono (es. SIM dati)
  if (tip.sim === null) return asset.elenco(req, res, next);
  query(`SELECT s.id, s.numero, s.stato, s.operatore, s.piano, s.costo_mensile, s.note FROM sim s
         WHERE s.asset_id IS NULL AND s.azienda_id = $1 ORDER BY (s.stato = 'Cessata'), s.id`, [az.id])
    .then((r) => { res.locals.simLibere = r.rows; return asset.elenco(req, res, next); }, next);
});

module.exports = router;
