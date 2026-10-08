const router = require('express').Router();
const { query } = require('../db');
const { inviaXlsx, num, vuota } = require('../export');

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
    if (vuota(req)) {
      return inviaXlsx(res, 'dashboard', [
        { nome: 'Riepilogo', righe: riep.rows, colonne: [
          { h: 'Azienda', v: (x) => x.azienda }, { h: 'Tipologia', v: (x) => x.tipologia }, { h: 'Assegnato', v: (x) => x.assegnato, t: 'num' },
          { h: 'In esercizio', v: (x) => x.in_esercizio, t: 'num' }, { h: 'Disponibile', v: (x) => x.disponibile, t: 'num' },
          { h: 'Da verificare', v: (x) => x.da_verificare, t: 'num' }, { h: 'Non aziendale', v: (x) => x.non_aziendale, t: 'num' },
          { h: 'Estinto', v: (x) => x.estinto, t: 'num' }, { h: 'Usciti', v: (x) => x.usciti, t: 'num' },
          { h: 'Totale', v: (x) => x.totale, t: 'num' }, { h: 'Importo €', v: (x) => num(x.importo), t: 'euro' }] },
        { nome: 'Acquisti per anno', righe: anni.rows, colonne: [
          { h: 'Anno', v: (x) => x.anno, t: 'num' }, { h: 'Azienda', v: (x) => x.azienda },
          { h: 'N. asset', v: (x) => x.n_asset, t: 'num' }, { h: 'Valore €', v: (x) => num(x.valore), t: 'euro' }] },
      ]);
    }
    const totali = {};
    for (const r of riep.rows) totali[r.azienda] = (totali[r.azienda] || 0) + Number(r.importo);
    res.render('dashboard', { riep: riep.rows, anni: anni.rows, av: av.rows, daVer: daVer.rows, ultimiMov: ultimiMov.rows, totali });
  } catch (e) { next(e); }
});

router.get('/antivirus', async (req, res, next) => {
  try {
    const r = await query(`SELECT * FROM v_controllo_antivirus ORDER BY (antivirus = 'OK'), codice`);
    const imp = await query('SELECT importato, file_nome FROM antivirus_import ORDER BY id DESC LIMIT 1');
    if (vuota(req)) {
      return inviaXlsx(res, 'antivirus', [{ nome: 'Controllo antivirus', righe: r.rows, colonne: [
        { h: 'ID', v: (x) => x.codice }, { h: 'Azienda', v: (x) => x.azienda }, { h: 'Stato asset', v: (x) => x.stato },
        { h: 'Assegnato a', v: (x) => x.assegnato_a }, { h: 'Hostname', v: (x) => x.hostname }, { h: 'Antivirus', v: (x) => x.antivirus },
        { h: 'Dispositivo nel report', v: (x) => x.dispositivo_report }, { h: 'Ultimo rilevato', v: (x) => x.ultimo_rilevato, t: 'dataora' }] }]);
    }
    res.render('antivirus', { righe: r.rows, ultimo: imp.rows[0] });
  } catch (e) { next(e); }
});

module.exports = router;
