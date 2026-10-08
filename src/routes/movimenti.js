const router = require('express').Router();
const { query, nul } = require('../db');

router.get('/', async (req, res, next) => {
  try {
    const { q = '', tipo = '' } = req.query;
    const p = []; const w = [];
    if (tipo) { p.push(tipo); w.push(`m.tipo = $${p.length}`); }
    if (q) { p.push(`%${q}%`); w.push(`(a.codice ILIKE $${p.length} OR coalesce(d.nome || ' ' || d.cognome,'') ILIKE $${p.length} OR coalesce(t.nome || ' ' || t.cognome,'') ILIKE $${p.length})`); }
    const [r, tipi] = await Promise.all([
      query(`SELECT m.*, a.codice, d.nome || ' ' || d.cognome AS da, t.nome || ' ' || t.cognome AS a
             FROM movimento m JOIN asset a ON a.id = m.asset_id
             LEFT JOIN persona d ON d.id = m.da_persona_id LEFT JOIN persona t ON t.id = m.a_persona_id
             ${w.length ? 'WHERE ' + w.join(' AND ') : ''} ORDER BY m.data DESC, m.id DESC LIMIT 500`, p),
      query('SELECT DISTINCT tipo FROM movimento ORDER BY tipo'),
    ]);
    res.render('movimenti_lista', { righe: r.rows, tipi: tipi.rows.map((x) => x.tipo), filtri: { q, tipo } });
  } catch (e) { next(e); }
});

// annotazione manuale su un asset (i movimenti di consegna/cambio stato nascono dal trigger)
router.post('/', async (req, res, next) => {
  try {
    const nota = nul(req.body.note);
    if (!nota || !req.body.asset_id) return res.redirect('back');
    await query(`INSERT INTO movimento (data, tipo, asset_id, note, automatico) VALUES (coalesce($1::date, current_date), 'Nota', $2, $3, false)`,
      [nul(req.body.data), req.body.asset_id, nota]);
    res.redirect('/asset/' + encodeURIComponent(req.body.asset_id));
  } catch (e) { next(e); }
});

module.exports = router;
