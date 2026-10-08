const router = require('express').Router();
const { query } = require('../db');

router.get('/', async (req, res, next) => {
  try {
    const [riep, anni, av, daVer, ultimiMov] = await Promise.all([
      query(`SELECT azienda, tipologia, assegnato, in_esercizio, disponibile, da_verificare, non_aziendale, estinto,
                    venduto + ceduto + macerato + smarrito_rubato AS usciti, totale, importo
             FROM v_riepilogo WHERE totale > 0 ORDER BY azienda, tipologia`),
      query('SELECT azienda, anno, n_asset, valore FROM v_acquisti_per_anno ORDER BY anno DESC, azienda'),
      query(`SELECT antivirus, count(*)::int AS n FROM v_controllo_antivirus GROUP BY antivirus ORDER BY antivirus`),
      query(`SELECT codice, tipologia, assegnato_a, modello FROM v_asset_vivi WHERE stato = 'Da verificare' ORDER BY codice`),
      query(`SELECT m.data, m.tipo, a.codice, m.stato_prima, m.stato_dopo FROM movimento m JOIN asset a ON a.id = m.asset_id
             ORDER BY m.data DESC, m.id DESC LIMIT 10`),
    ]);
    const totali = {};
    for (const r of riep.rows) totali[r.azienda] = (totali[r.azienda] || 0) + Number(r.importo);
    res.render('dashboard', { riep: riep.rows, anni: anni.rows, av: av.rows, daVer: daVer.rows, ultimiMov: ultimiMov.rows, totali });
  } catch (e) { next(e); }
});

router.get('/antivirus', async (req, res, next) => {
  try {
    const r = await query(`SELECT * FROM v_controllo_antivirus ORDER BY (antivirus = 'OK'), codice`);
    const imp = await query('SELECT importato, file_nome FROM antivirus_import ORDER BY id DESC LIMIT 1');
    res.render('antivirus', { righe: r.rows, ultimo: imp.rows[0] });
  } catch (e) { next(e); }
});

module.exports = router;
