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

// numeri di cespite alfanumerici in ordine "naturale": prima i numerici (2, 10, 48), poi gli altri (A12, B3); i vuoti in fondo
// (col::text: funziona anche prima della migrazione 005, quando la colonna è ancora un intero)
const cespiteOrd = (col) => [`NULLIF(substring(${col}::text from '^[0-9]{1,15}'), '')::bigint`, `upper(${col}::text)`];
// numero di cespite scritto dall'utente -> forma ammessa dal database (maiuscolo, senza spazi ai bordi) o un messaggio di errore
function cespiteNumero(v) {
  const n = String(v === undefined || v === null ? '' : v).trim().toUpperCase();
  if (!n) return { numero: null };
  if (!/^[A-Z0-9][A-Z0-9._/-]{0,29}$/.test(n)) return { errore: 'Il numero di cespite può contenere lettere, cifre e i simboli . _ / - (senza spazi), fino a 30 caratteri.' };
  return { numero: n };
}

module.exports = { ordine, t, tn, cespiteOrd, cespiteNumero };
