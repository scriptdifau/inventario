const router = require('express').Router();
const { query } = require('../db');

// Cespiti ante 2018: storico di sola lettura per la quadratura con l'amministrazione
router.get('/', async (req, res, next) => {
  try {
    const [r, t] = await Promise.all([
      query('SELECT * FROM cespite_storico ORDER BY numero'),
      query('SELECT coalesce(sum(da_trovare_eliminare),0) AS te, coalesce(sum(da_abbinare),0) AS ab FROM cespite_storico'),
    ]);
    res.render('cespiti', { righe: r.rows, tot: t.rows[0] });
  } catch (e) { next(e); }
});

module.exports = router;
