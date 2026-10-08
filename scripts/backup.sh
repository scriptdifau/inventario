#!/usr/bin/env bash
# Backup del database: dump SQL compresso, controllo di integrità, rotazione. Pensato per girare da cron.
#
# Collegamento al database, in uno di questi modi:
#   - DATABASE_URL=postgres://utente:password@host:5432/db      (la password con simboli va codificata)
#   - oppure le variabili PGHOST / PGUSER / PGDATABASE (e PGPORT) con la password in ~/.pgpass
#     (riga  host:porta:database:utente:password , permessi 600): così la password non compare nei comandi.
# Altre variabili: BACKUP_DIR (predefinita ./backups), KEEP_DAYS (predefinita 30).
set -euo pipefail
if [ -z "${DATABASE_URL:-}" ] && [ -z "${PGDATABASE:-}" ]; then
  echo "Indica DATABASE_URL oppure PGDATABASE (con PGHOST e PGUSER)" >&2; exit 2
fi
DIR="${BACKUP_DIR:-$(dirname "$0")/../backups}"
KEEP="${KEEP_DAYS:-30}"
mkdir -p "$DIR"
chmod 700 "$DIR"
OUT="$DIR/inventario-$(date +%Y%m%d-%H%M%S).sql.gz"
TMP="$OUT.part"
trap 'rm -f "$TMP"' EXIT

# senza richieste di password: da cron nessuno potrebbe rispondere
pg_dump --no-owner --no-privileges --no-password ${DATABASE_URL:+"$DATABASE_URL"} | gzip -9 > "$TMP"
gzip -t "$TMP"                                   # archivio leggibile
zcat "$TMP" | grep -q 'CREATE TABLE public.asset ' || { echo "Dump senza la tabella asset: scartato" >&2; exit 1; }
mv "$TMP" "$OUT"
ln -sf "$(basename "$OUT")" "$DIR/ultimo.sql.gz"  # sempre l'ultimo, comodo da scaricare
find "$DIR" -name 'inventario-*.sql.gz' -mtime +"$KEEP" -delete
echo "$(date '+%F %T') backup ok: $OUT ($(du -h "$OUT" | cut -f1))"
