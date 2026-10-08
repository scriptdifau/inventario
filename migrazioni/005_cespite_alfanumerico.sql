-- Il numero di cespite diventa alfanumerico (es. "48", "A12", "2019/07"): lettere maiuscole, cifre e . _ / -, fino a 30 caratteri.
-- Idempotente. Le viste che usano la colonna vengono ricreate (identiche). Uso: psql -h localhost -U UTENTE NOMEDB -f migrazioni/005_cespite_alfanumerico.sql
BEGIN;
DO $mig$
BEGIN
  IF (SELECT data_type FROM information_schema.columns WHERE table_name = 'cespite' AND column_name = 'numero') = 'integer' THEN
    DROP VIEW IF EXISTS v_controllo_antivirus;
    DROP VIEW IF EXISTS v_asset_vivi;
    DROP VIEW IF EXISTS v_asset;
    ALTER TABLE cespite ALTER COLUMN numero TYPE text USING numero::text;
    ALTER TABLE cespite ADD CONSTRAINT cespite_numero_formato CHECK (numero ~ '^[A-Z0-9][A-Z0-9._/-]{0,29}$');
    EXECUTE $v$
CREATE VIEW v_asset AS
SELECT a.id, a.codice, a.tipologia, a.stato, p.nome || ' ' || p.cognome AS assegnato_a,
       a.marca, a.modello, a.ram_gb, a.storage_gb, a.sistema_operativo, a.serial, a.hostname,
       az.nome AS azienda, c.numero AS cespite, f.nome AS fornitore, fa.numero AS n_fattura,
       a.data_acquisto, extract(year FROM a.data_acquisto)::int AS anno,
       a.importo, a.data_dismissione, a.note, s.fuori
FROM asset a
JOIN stato_asset s ON s.nome = a.stato
JOIN azienda az    ON az.id = a.azienda_id
LEFT JOIN persona p      ON p.id = a.persona_id
LEFT JOIN cespite c      ON c.id = a.cespite_id
LEFT JOIN fattura fa     ON fa.id = a.fattura_id
LEFT JOIN fornitore f    ON f.id = a.fornitore_id;
    $v$;
    EXECUTE $v$ CREATE VIEW v_asset_vivi AS SELECT * FROM v_asset WHERE NOT fuori; $v$;
    EXECUTE $v$
CREATE VIEW v_controllo_antivirus AS
WITH ultimo AS (SELECT id, importato FROM antivirus_import ORDER BY id DESC LIMIT 1),
rep AS (SELECT d.*, host_norm(d.dispositivo) AS h, u.importato
        FROM antivirus_dispositivo d JOIN ultimo u ON u.id = d.import_id)
SELECT a.codice, a.azienda, a.stato, a.assegnato_a, a.hostname,
       CASE WHEN r.dispositivo IS NULL THEN 'Mancante'
            WHEN r.stato = 'Protetto' AND r.ultimo_rilevato >= r.importato - interval '20 days' THEN 'OK'
            ELSE 'Da verificare' END AS antivirus,
       r.dispositivo AS dispositivo_report, r.ultimo_rilevato
FROM v_asset_vivi a
LEFT JOIN rep r
  ON host_norm(a.hostname) <> ''
 AND (r.h = host_norm(a.hostname) OR left(r.h,15) = left(host_norm(a.hostname),15))
-- Regola: ogni PC/Server Windows ATTIVO (Assegnato, In esercizio, Da verificare) deve avere un antivirus.
-- Sistema operativo vuoto = si presume Windows. Estinto/Disponibile non sono "attivi".
WHERE a.tipologia IN ('PC','Server')
  AND (a.sistema_operativo IS NULL OR a.sistema_operativo ILIKE 'Windows%')
  AND a.stato IN ('Assegnato','In esercizio','Da verificare');
    $v$;
  END IF;
END
$mig$;
COMMIT;
