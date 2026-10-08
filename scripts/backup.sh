#!/usr/bin/env bash
# Backup giornaliero del database: dump SQL compresso, rotazione, controllo di integrità.
# Uso:  DATABASE_URL=postgres://... scripts/backup.sh
# Variabili: BACKUP_DIR (default ./backups), KEEP_DAYS (default 30)
set -euo pipefail
: "${DATABASE_URL:?DATABASE_URL non impostata}"
DIR="${BACKUP_DIR:-$(dirname "$0")/../backups}"
KEEP="${KEEP_DAYS:-30}"
mkdir -p "$DIR"
chmod 700 "$DIR"
OUT="$DIR/inventario-$(date +%Y%m%d-%H%M%S).sql.gz"
TMP="$OUT.part"
trap 'rm -f "$TMP"' EXIT

pg_dump --no-owner --no-privileges "$DATABASE_URL" | gzip -9 > "$TMP"
gzip -t "$TMP"                                   # archivio leggibile
zcat "$TMP" | grep -q 'CREATE TABLE public.asset ' || { echo "Dump senza la tabella asset: scartato" >&2; exit 1; }
mv "$TMP" "$OUT"
find "$DIR" -name 'inventario-*.sql.gz' -mtime +"$KEEP" -delete
echo "Backup scritto: $OUT ($(du -h "$OUT" | cut -f1))"
