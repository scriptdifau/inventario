// Ordinamento delle liste: ?ord=<colonna>&dir=asc|desc, solo colonne previste (mai testo dell'utente nell'SQL).
// mappa: { chiave: { col: ['espressione SQL', ...], etichetta } }; i vuoti vanno sempre in fondo.
function ordine(req, mappa, predefinita, finale = '') {
  const richiesta = Object.prototype.hasOwnProperty.call(mappa, req.query.ord) ? req.query.ord : null;
  const chiave = richiesta || predefinita;
  const dir = req.query.dir === 'desc' ? 'desc' : 'asc';
  const sql = mappa[chiave].col.map((e) => `${e} ${dir} NULLS LAST`).join(', ') + (finale ? ', ' + finale : '');
  return { chiave, dir, sql, esplicito: !!richiesta,
    colonne: Object.entries(mappa).map(([k, v]) => ({ k, label: v.etichetta })) };
}

// testo senza maiuscole: l'ordine alfabetico non dipende dalle maiuscole né dalla collation del database
const t = (c) => `lower(coalesce(${c}, ''))`;
// persone senza nome vanno in fondo: NULL e non '' (le espressioni con coalesce darebbero stringa vuota = prime)
const tn = (c) => `lower(${c})`;

module.exports = { ordine, t, tn };
