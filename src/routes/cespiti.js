const router = require('express').Router();
const { query } = require('../db');
const { inviaXlsx, num, vuota } = require('../export');

// Cespiti ante 2018: storico di sola lettura per la quadratura con l'amministrazione
router.get('/', async (req, res, next) => {
  try {
    const [r, t] = await Promise.all([
      query('SELECT * FROM cespite_storico ORDER BY numero'),
      query('SELECT coalesce(sum(da_trovare_eliminare),0) AS te, coalesce(sum(da_abbinare),0) AS ab FROM cespite_storico'),
    ]);
    if (vuota(req)) {
      return inviaXlsx(res, 'cespiti-ante-2018', [{ nome: 'Cespiti ante 2018', righe: r.rows, colonne: [
        { h: 'N. cespite', v: (x) => x.numero, t: 'num' }, { h: 'Categoria', v: (x) => x.categoria }, { h: 'Data', v: (x) => x.data, t: 'data' },
        { h: 'Fornitore', v: (x) => x.fornitore }, { h: 'Descrizione', v: (x) => x.descrizione },
        { h: 'Da trovare o eliminare', v: (x) => num(x.da_trovare_eliminare), t: 'euro' }, { h: 'Da abbinare', v: (x) => num(x.da_abbinare), t: 'euro' },
        { h: 'Note', v: (x) => x.note }] }]);
    }
    res.render('cespiti', { righe: r.rows, tot: t.rows[0] });
  } catch (e) { next(e); }
});

module.exports = router;
