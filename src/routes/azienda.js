// Albero: /az/:azienda  ->  panoramica, una pagina per tipologia di asset, persone;
// sotto PC/Server il controllo antivirus, sotto Telefono le SIM. Usa gli stessi elenchi del resto dell'app con i filtri già impostati.
const router = require('express').Router();
const asset = require('./asset');
const persone = require('./persone');
const sim = require('./sim');
const dashboard = require('./dashboard');
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

function schede(az, tip, attiva) {
  const base = `/az/${az.slug}/${tip.slug}`;
  const s = [{ k: 'elenco', label: 'Elenco', href: base, n: tip.vivi }];
  if (tip.antivirus) s.push({ k: 'antivirus', label: 'Antivirus', href: `${base}/antivirus`, n: tip.antivirus.problemi, allarme: tip.antivirus.problemi > 0 });
  if (tip.sim !== null) s.push({ k: 'sim', label: 'SIM', href: `${base}/sim`, n: tip.sim });
  return s.length > 1 ? s.map((x) => ({ ...x, on: x.k === attiva })) : [];
}

router.get('/:az', async (req, res, next) => {
  try {
    const az = req.az;
    const [attenzione, recenti] = await Promise.all([
      query(`SELECT a.id, a.codice, a.tipologia, a.marca, a.modello, p.nome || ' ' || p.cognome AS persona
             FROM asset a JOIN stato_asset s ON s.nome = a.stato LEFT JOIN persona p ON p.id = a.persona_id
             WHERE a.azienda_id = $1 AND a.stato = 'Da verificare' ORDER BY a.id`, [az.id]),
      query(`SELECT m.data, m.tipo, a.codice, a.id AS asset_id FROM movimento m JOIN asset a ON a.id = m.asset_id
             WHERE a.azienda_id = $1 ORDER BY m.data DESC, m.id DESC LIMIT 6`, [az.id]),
    ]);
    res.render('azienda', { az, attenzione: attenzione.rows, recenti: recenti.rows });
  } catch (e) { next(e); }
});

router.get('/:az/persone', (req, res, next) => {
  contesto(req, res, { azienda: req.az.nome }, { az: req.az, tip: null, base: `/az/${req.az.slug}/persone`, titolo: 'Persone', fissi: ['azienda'], tabs: [] });
  return persone.elenco(req, res, next);
});

router.get('/:az/:tip', (req, res, next) => {
  const { az, tip } = req;
  contesto(req, res, { azienda: az.nome, tipologia: tip.nome },
    { az, tip, base: `/az/${az.slug}/${tip.slug}`, titolo: tip.nome, fissi: ['azienda', 'tipologia'], tabs: schede(az, tip, 'elenco') });
  return asset.elenco(req, res, next);
});

router.get('/:az/:tip/antivirus', (req, res, next) => {
  const { az, tip } = req;
  if (!tip.antivirus) return next('route');
  contesto(req, res, { azienda: az.nome, tipologia: tip.nome },
    { az, tip, base: `/az/${az.slug}/${tip.slug}/antivirus`, titolo: `${tip.nome} · Antivirus`, fissi: ['azienda', 'tipologia'], tabs: schede(az, tip, 'antivirus') });
  return dashboard.antivirusElenco(req, res, next);
});

router.get('/:az/:tip/sim', (req, res, next) => {
  const { az, tip } = req;
  if (tip.sim === null) return next('route');
  contesto(req, res, { azienda: az.nome },
    { az, tip, base: `/az/${az.slug}/${tip.slug}/sim`, titolo: `${tip.nome} · SIM`, fissi: ['azienda'], tabs: schede(az, tip, 'sim') });
  return sim.elenco(req, res, next);
});

module.exports = router;
