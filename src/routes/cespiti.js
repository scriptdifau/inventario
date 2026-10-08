const { query } = require('../db');
const { inviaXlsx, num, vuota } = require('../export');
const { ordine, t } = require('../ordina');

const ORD_CESPITI = {
  numero: { etichetta: 'N. cespite', col: ['numero'] },
  categoria: { etichetta: 'Categoria', col: [t('categoria')] },
  data: { etichetta: 'Data', col: ['data'] },
  fornitore: { etichetta: 'Fornitore', col: [t('fornitore')] },
  descrizione: { etichetta: 'Descrizione', col: [t('descrizione')] },
  trovare: { etichetta: 'Da trovare o eliminare', col: ['da_trovare_eliminare'] },
  abbinare: { etichetta: 'Da abbinare', col: ['da_abbinare'] },
};

// Storico dei cespiti ante 2018 (sola lettura), ora una scheda del Cestino (vista=storico)
async function storico(req, res, next) {
  try {
    const ord = ordine(req, ORD_CESPITI, 'numero', 'id');
    const [r, tot] = await Promise.all([
      query(`SELECT * FROM cespite_storico ORDER BY ${ord.sql}`),
      query('SELECT coalesce(sum(da_trovare_eliminare),0) AS te, coalesce(sum(da_abbinare),0) AS ab FROM cespite_storico'),
    ]);
    if (vuota(req)) {
      return inviaXlsx(res, 'cespiti-ante-2018', [{ nome: 'Cespiti ante 2018', righe: r.rows, colonne: [
        { h: 'N. cespite', v: (x) => x.numero, t: 'num' }, { h: 'Categoria', v: (x) => x.categoria }, { h: 'Data', v: (x) => x.data, t: 'data' },
        { h: 'Fornitore', v: (x) => x.fornitore }, { h: 'Descrizione', v: (x) => x.descrizione },
        { h: 'Da trovare o eliminare', v: (x) => num(x.da_trovare_eliminare), t: 'euro' }, { h: 'Da abbinare', v: (x) => num(x.da_abbinare), t: 'euro' },
        { h: 'Note', v: (x) => x.note }] }]);
    }
    res.render('cespiti', { ord, righe: r.rows, tot: tot.rows[0], nAsset: await nCestino() });
  } catch (e) { next(e); }
}

const nCestino = async () => (await query('SELECT count(*)::int n FROM asset a JOIN stato_asset s ON s.nome = a.stato WHERE s.fuori')).rows[0].n;

module.exports = { storico, nCestino };
