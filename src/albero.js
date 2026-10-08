// Dati dell'albero di navigazione: Azienda > tipologie di asset (con Antivirus sotto PC/Server e SIM sotto Telefono) + Persone.
const { query } = require('./db');

const ORDINE = ['PC', 'Mac', 'Tablet', 'Telefono', 'Server', 'Monitor', 'Stampante', 'Rete', 'Altro'];
const CON_ANTIVIRUS = ['PC', 'Server'];
const slug = (t) => String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

// azienda "effettiva" di una persona: quella indicata, altrimenti quella del primo asset che ha in uso
const PERSONA_AZIENDA = `coalesce(p.azienda_id, (SELECT a.azienda_id FROM asset a WHERE a.persona_id = p.id ORDER BY a.id LIMIT 1))`;
// azienda "effettiva" di una SIM: quella del telefono in cui è montata, altrimenti la propria
const SIM_AZIENDA = `coalesce((SELECT a.azienda_id FROM asset a WHERE a.id = s.asset_id), s.azienda_id)`;

async function caricaAlbero() {
  const [az, asset, av, sim, pers] = await Promise.all([
    query('SELECT id, nome FROM azienda ORDER BY id'),
    query(`SELECT a.azienda_id, a.tipologia, count(*)::int AS tot, count(*) FILTER (WHERE NOT s.fuori)::int AS vivi
           FROM asset a JOIN stato_asset s ON s.nome = a.stato GROUP BY 1, 2`),
    query(`SELECT a.azienda_id, a.tipologia, count(*)::int AS tot, count(*) FILTER (WHERE v.antivirus <> 'OK')::int AS problemi
           FROM v_controllo_antivirus v JOIN asset a ON a.codice = v.codice GROUP BY 1, 2`),
    query(`SELECT ${SIM_AZIENDA} AS azienda_id, count(*)::int AS n FROM sim s GROUP BY 1`),
    query(`SELECT ${PERSONA_AZIENDA} AS azienda_id, count(*)::int AS n FROM persona p WHERE p.stato = 'Attivo' GROUP BY 1`),
  ]);
  return az.rows.map((a) => {
    const tipologie = ORDINE.map((nome) => {
      const t = asset.rows.find((x) => x.azienda_id === a.id && x.tipologia === nome);
      if (!t) return null;
      const v = av.rows.find((x) => x.azienda_id === a.id && x.tipologia === nome);
      return {
        nome, slug: slug(nome), vivi: t.vivi, tot: t.tot,
        antivirus: CON_ANTIVIRUS.includes(nome) && v ? { tot: v.tot, problemi: v.problemi } : null,
        sim: nome === 'Telefono' ? (sim.rows.find((x) => x.azienda_id === a.id) || { n: 0 }).n : null,
      };
    }).filter(Boolean);
    return { id: a.id, nome: a.nome, slug: slug(a.nome), tipologie,
      persone: (pers.rows.find((x) => x.azienda_id === a.id) || { n: 0 }).n,
      vivi: tipologie.reduce((t, x) => t + x.vivi, 0) };
  });
}

module.exports = { caricaAlbero, slug, SIM_AZIENDA, PERSONA_AZIENDA, ORDINE };
