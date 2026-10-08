-- Numeri di fattura importati dal foglio come numeri decimali: "4198.0" -> "4198".
-- Sicura da rilanciare: tocca solo i numeri fatti di sole cifre seguite da ".0", salta (e segnala) quelli che
-- andrebbero a coincidere con un'altra fattura dello stesso fornitore e data, e non modifica nient'altro.
-- Uso:  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f migrazioni/003_numero_fattura.sql
BEGIN;

CREATE TEMP TABLE _prima AS SELECT id, numero FROM fattura;

-- fatture il cui numero corretto esisterebbe già: non si toccano
CREATE TEMP TABLE _in_conflitto AS
SELECT f.id, f.numero
FROM fattura f
WHERE f.numero ~ '^[0-9]+\.0$'
  AND EXISTS (SELECT 1 FROM fattura g
              WHERE g.id <> f.id AND g.fornitore_id = f.fornitore_id
                AND g.numero = regexp_replace(f.numero, '\.0$', '') AND g.data IS NOT DISTINCT FROM f.data);

UPDATE fattura f
SET numero = regexp_replace(f.numero, '\.0$', '')
WHERE f.numero ~ '^[0-9]+\.0$' AND f.id NOT IN (SELECT id FROM _in_conflitto);

SELECT (SELECT count(*) FROM _prima p JOIN fattura f USING (id) WHERE p.numero <> f.numero) AS corrette,
       (SELECT count(*) FROM _in_conflitto) AS saltate_per_conflitto,
       (SELECT count(*) FROM fattura WHERE numero ~ '\.0$') AS ancora_con_punto_zero,
       (SELECT count(*) FROM fattura) AS fatture_totali;

COMMIT;
