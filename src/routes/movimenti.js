const router = require('express').Router();
const { query, nul } = require('../db');
const { inviaXlsx, vuota } = require('../export');

router.get('/', async (req, res, next) => {
  try {
    const { q = '', tipo = '' } = req.query;
    const p = []; const w = [];
    if (tipo) { p.push(tipo); w.push(`m.tipo = $${p.length}`); }
    if (q) { p.push(`%${q}%`); w.push(`(a.codice ILIKE $${p.length} OR coalesce(m.oggetto,'') ILIKE $${p.length} OR c.numero::text ILIKE $${p.length} OR coalesce(a.marca,'') || ' ' || coalesce(a.modello,'') ILIKE $${p.length} OR coalesce(d.nome || ' ' || d.cognome,'') ILIKE $${p.length} OR coalesce(t.nome || ' ' || t.cognome,'') ILIKE $${p.length})`); }
    const [r, tipi] = await Promise.all([
      query(`SELECT m.*, a.marca, a.modello, a.tipologia, c.numero AS cespite, d.nome || ' ' || d.cognome AS da, t.nome || ' ' || t.cognome AS a
             FROM movimento m LEFT JOIN asset a ON a.id = m.asset_id LEFT JOIN cespite c ON c.id = a.cespite_id
             LEFT JOIN persona d ON d.id = m.da_persona_id LEFT JOIN persona t ON t.id = m.a_persona_id
             ${w.length ? 'WHERE ' + w.join(' AND ') : ''} ORDER BY m.data DESC, m.id DESC ${vuota(req) ? '' : 'LIMIT 500'}`, p),
      query('SELECT DISTINCT tipo FROM movimento ORDER BY tipo'),
    ]);
    if (vuota(req)) {
      return inviaXlsx(res, 'movimenti', [{ nome: 'Movimenti', righe: r.rows, colonne: [
        { h: 'Data', v: (x) => x.data, t: 'data' }, { h: 'Tipo', v: (x) => x.tipo }, { h: 'Asset', v: (x) => [x.marca, x.modello].filter(Boolean).join(' ') || x.tipologia || x.oggetto }, { h: 'N. cespite', v: (x) => x.cespite, t: 'num' },
        { h: 'Da', v: (x) => x.da }, { h: 'A', v: (x) => x.a }, { h: 'Stato prima', v: (x) => x.stato_prima },
        { h: 'Stato dopo', v: (x) => x.stato_dopo }, { h: 'Note', v: (x) => x.note }, { h: 'Automatico', v: (x) => x.automatico }, { h: 'Utente', v: (x) => x.utente }] }]);
    }
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
