-- Le eliminazioni (asset, persone, SIM) lasciano traccia in Movimenti; lo storico di un asset eliminato resta leggibile.
-- Idempotente. Uso: psql -h localhost -U UTENTE NOMEDB -f migrazioni/004_registro_eliminazioni.sql
BEGIN;
ALTER TABLE movimento ALTER COLUMN asset_id DROP NOT NULL;
ALTER TABLE movimento ADD COLUMN IF NOT EXISTS oggetto text;   -- descrizione di ciò che è stato eliminato / dell'asset eliminato
ALTER TABLE movimento ADD COLUMN IF NOT EXISTS utente text;    -- chi ha fatto l'operazione (email)
DO $$
DECLARE v_nome text;
BEGIN
  SELECT conname INTO v_nome FROM pg_constraint
   WHERE conrelid = 'movimento'::regclass AND contype = 'f' AND confrelid = 'asset'::regclass;
  IF v_nome IS NOT NULL THEN EXECUTE format('ALTER TABLE movimento DROP CONSTRAINT %I', v_nome); END IF;
  ALTER TABLE movimento ADD CONSTRAINT movimento_asset_id_fkey FOREIGN KEY (asset_id) REFERENCES asset ON DELETE SET NULL;
END $$;
COMMIT;
