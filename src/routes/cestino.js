// Cestino: tutto ciò che è uscito dall'azienda e non è più in contabilità (stati "fuori": Venduto, Ceduto, Macerato,
// Smarrito/Rubato), più lo storico dei cespiti ante 2018. Serve a ritrovarne traccia; da qui si può ripristinare.
const router = require('express').Router();
const { query } = require('../db');
const { inviaXlsx, num, vuota } = require('../export');
const { ordine, t } = require('../ordina');
const { storico } = require('./cespiti');

const ORD = {
  dispositivo: { etichetta: 'Dispositivo', col: [t('marca'), t('modello')] },
  cespite: { etichetta: 'Cespite', col: ['cespite'] },
  stato: { etichetta: 'Stato', col: ['lower(stato)'] },
  dismissione: { etichetta: 'Dismesso il', col: ['data_dismissione'] },
  persona: { etichetta: 'Ultimo assegnatario', col: ['lower(ultimo)'] },
  azienda: { etichetta: 'Azienda', col: ['lower(azienda)'] },
  importo: { etichetta: 'Importo', col: ['importo'] },
  acquisto: { etichetta: 'Data acquisto', col: ['data_acquisto'] },
};

router.get('/', async (req, res, next) => {
  try {
    if (req.query.vista === 'storico') return storico(req, res, next);
    const { q = '', stato = '', tipologia = '', azienda = '', anno = '' } = req.query;
    const where = []; const p = [];
    if (q) { p.push(`%${q}%`); where.push(`(cespite::text ILIKE $${p.length} OR codice ILIKE $${p.length} OR coalesce(modello,'') ILIKE $${p.length} OR coalesce(marca,'') ILIKE $${p.length}
      OR coalesce(serial,'') ILIKE $${p.length} OR coalesce(hostname,'') ILIKE $${p.length} OR coalesce(ultimo,'') ILIKE $${p.length})`); }
    if (stato) { p.push(stato); where.push(`stato = $${p.length}`); }
    if (tipologia) { p.push(tipologia); where.push(`tipologia = $${p.length}`); }
    if (azienda) { p.push(azienda); where.push(`azienda = $${p.length}`); }
    if (/^\d{4}$/.test(anno)) { p.push(Number(anno)); where.push(`extract(year FROM data_dismissione) = $${p.length}`); }
    if (!req.query.ord && !req.query.dir) req.query = { ...req.query, dir: 'desc' };   // di partenza: dismessi da meno tempo in alto
    const ord = ordine(req, ORD, 'dismissione', 'id');
    const base = `FROM (SELECT v.*, (SELECT pe.nome || ' ' || pe.cognome FROM movimento m JOIN persona pe ON pe.id = m.da_persona_id
        WHERE m.asset_id = v.id ORDER BY m.data DESC, m.id DESC LIMIT 1) AS ultimo FROM v_asset v WHERE v.fuori) x`;
    const r = await query(`SELECT * ${base} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY ${ord.sql}`, p);
    if (vuota(req)) {
      return inviaXlsx(res, 'cestino', [{ nome: 'Cestino', righe: r.rows, colonne: [
        { h: 'N. cespite', v: (x) => x.cespite, t: 'num' }, { h: 'Tipologia', v: (x) => x.tipologia }, { h: 'Marca', v: (x) => x.marca }, { h: 'Modello', v: (x) => x.modello },
        { h: 'Stato', v: (x) => x.stato }, { h: 'Dismesso il', v: (x) => x.data_dismissione, t: 'data' }, { h: 'Ultimo assegnatario', v: (x) => x.ultimo },
        { h: 'Azienda', v: (x) => x.azienda }, { h: 'Fornitore', v: (x) => x.fornitore }, { h: 'Serial', v: (x) => x.serial }, { h: 'Hostname', v: (x) => x.hostname },
        { h: 'Data acquisto', v: (x) => x.data_acquisto, t: 'data' }, { h: 'Importo €', v: (x) => num(x.importo), t: 'euro' }, { h: 'Note', v: (x) => x.note }, { h: 'Codice interno', v: (x) => x.codice }] }]);
    }
    const [cs, anni, fil, ns] = await Promise.all([
      query(`SELECT stato, count(*)::int AS n, coalesce(sum(importo), 0) AS valore ${base} GROUP BY stato`),
      query(`SELECT DISTINCT extract(year FROM data_dismissione)::int AS a ${base} WHERE data_dismissione IS NOT NULL ORDER BY a DESC`),
      query(`SELECT (SELECT array_agg(nome ORDER BY ordine) FROM stato_asset WHERE fuori) AS stati, (SELECT array_agg(nome ORDER BY nome) FROM tipologia) AS tipologie,
                    (SELECT array_agg(nome ORDER BY id) FROM azienda) AS aziende`),
      query('SELECT count(*)::int AS n FROM cespite_storico'),
    ]);
    const conteggi = Object.fromEntries(cs.rows.map((x) => [x.stato, x.n]));
    res.render('cestino', { ord, righe: r.rows, conteggi, totale: cs.rows.reduce((a, x) => a + x.n, 0), valore: cs.rows.reduce((a, x) => a + Number(x.valore), 0),
      filtri: { q, stato, tipologia, azienda, anno }, stati: fil.rows[0].stati || [], tipologie: fil.rows[0].tipologie || [], aziende: fil.rows[0].aziende || [], anni: anni.rows.map((x) => x.a), nStorico: ns.rows[0].n });
  } catch (e) { next(e); }
});

module.exports = router;
