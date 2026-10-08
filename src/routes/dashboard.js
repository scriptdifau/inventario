const router = require('express').Router();
const { query } = require('../db');
const { inviaXlsx, num, vuota } = require('../export');
const { slug: slugAz } = require('../albero');

router.get('/', async (req, res, next) => {
  try {
    const [riep, anni, av, daVer, ultimiMov] = await Promise.all([
      query(`SELECT azienda, tipologia, assegnato, in_esercizio, disponibile, da_verificare, non_aziendale, estinto,
                    venduto + ceduto + macerato + smarrito_rubato AS usciti, totale, importo
             FROM v_riepilogo WHERE totale > 0 ORDER BY azienda, tipologia`),
      query('SELECT azienda, anno, n_asset, valore FROM v_acquisti_per_anno ORDER BY anno DESC, azienda'),
      query(`SELECT antivirus, count(*)::int AS n FROM v_controllo_antivirus GROUP BY antivirus ORDER BY antivirus`),
      query(`SELECT id, tipologia, assegnato_a, marca, modello, cespite FROM v_asset_vivi WHERE stato = 'Da verificare' ORDER BY id`),
      query(`SELECT m.data, m.tipo, a.id AS asset_id, a.tipologia, a.marca, a.modello, c.numero AS cespite, m.stato_prima, m.stato_dopo
             FROM movimento m JOIN asset a ON a.id = m.asset_id LEFT JOIN cespite c ON c.id = a.cespite_id
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
    // una scheda per azienda: asset in vita, importo, ripartizione per stato e per tipologia
    const STATI = ['assegnato', 'in_esercizio', 'disponibile', 'da_verificare', 'non_aziendale', 'estinto'];
    const aziende = [];
    for (const r of riep.rows) {
      let a = aziende.find((x) => x.nome === r.azienda);
      if (!a) { a = { nome: r.azienda, slug: slugAz(r.azienda), vivi: 0, importo: 0, stati: Object.fromEntries(STATI.map((k) => [k, 0])), tipologie: [] }; aziende.push(a); }
      const vivi = Number(r.totale) - Number(r.usciti);
      a.vivi += vivi; a.importo += Number(r.importo);
      STATI.forEach((k) => { a.stati[k] += Number(r[k]); });   // i conteggi arrivano come stringhe (bigint)
      if (vivi > 0) a.tipologie.push({ tipologia: r.tipologia, vivi, importo: Number(r.importo) });
    }
    aziende.forEach((a) => a.tipologie.sort((x, y) => y.vivi - x.vivi));
    const avn = Object.fromEntries(av.rows.map((x) => [x.antivirus, x.n]));
    const avTot = av.rows.reduce((t, x) => t + x.n, 0);

    // grafico acquisti per anno: barre impilate per azienda (SVG calcolato qui, il template lo disegna)
    const anniAsc = [...new Set(anni.rows.map((x) => x.anno))].sort((x, y) => x - y);
    const barre = anniAsc.map((anno) => {
      const parti = aziende.map((a, i) => ({ azienda: a.nome, i, valore: Number((anni.rows.find((x) => x.anno === anno && x.azienda === a.nome) || {}).valore || 0) }));
      return { anno, parti, totale: parti.reduce((t, p) => t + p.valore, 0) };
    });
    const max = Math.max(1, ...barre.map((b) => b.totale));
    const H = 150; const W = 640; const passo = W / Math.max(barre.length, 1); const bw = Math.min(40, passo * 0.6);
    barre.forEach((b, k) => {
      b.x = k * passo + (passo - bw) / 2; b.w = bw; let y = H;
      b.parti.forEach((p) => { p.h = (p.valore / max) * H; y -= p.h; p.y = y; });
      b.yTot = y;
    });
    res.render('dashboard', { aziende, av: avn, avTot, daVer: daVer.rows, ultimiMov: ultimiMov.rows, barre, grafico: { W, H } });
  } catch (e) { next(e); }
});


module.exports = router;
