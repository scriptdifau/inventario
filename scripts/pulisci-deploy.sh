#!/usr/bin/env bash
# Tiene solo le ultime N cartelle di deploy di SiteGround (.nodeapp/<id>) e cancella le più vecchie:
# ogni deploy ne crea una nuova (con node_modules, ~1.500 file) e le vecchie occupano inode inutilmente.
#
#   pulisci-deploy.sh             prova: elenca cosa cancellerebbe, non tocca nulla
#   pulisci-deploy.sh --applica   cancella davvero
#
# Variabili: NODEAPP_DIR (default ~/www/faustot14.sg-host.com/public_html/.nodeapp), KEEP (default 3, minimo 2).
# Da cron va chiamato da una copia fissa (es. ~/bin/pulisci-deploy.sh), non dalla cartella del deploy.
set -euo pipefail

DIR="${NODEAPP_DIR:-$HOME/www/faustot14.sg-host.com/public_html/.nodeapp}"
KEEP="${KEEP:-3}"
APPLICA=0
[ "${1:-}" = "--applica" ] && APPLICA=1
log() { echo "$(date '+%Y-%m-%d %H:%M:%S') pulisci-deploy: $*"; }

case "$DIR" in */.nodeapp) ;; *) log "ERRORE: $DIR non finisce con /.nodeapp, mi fermo"; exit 2 ;; esac
[ -d "$DIR" ] || { log "ERRORE: cartella $DIR non trovata"; exit 2; }
case "$KEEP" in ''|*[!0-9]*) log "ERRORE: KEEP deve essere un numero"; exit 2 ;; esac
[ "$KEEP" -ge 2 ] || { log "ERRORE: KEEP minimo 2 (quella attiva e la precedente)"; exit 2; }

cd "$DIR"
# solo le cartelle dei deploy (<numero>-<sigla>), dalla più recente alla più vecchia
mapfile -t tutte < <(ls -dt -- [0-9]*-*/ 2>/dev/null | sed 's#/$##' || true)
n=${#tutte[@]}
if [ "$n" -le "$KEEP" ]; then log "ok: $n cartelle di deploy, ne tengo $KEEP, niente da fare"; exit 0; fi

log "$n cartelle di deploy, tengo le $KEEP più recenti: ${tutte[*]:0:$KEEP}"
tolte=0
for d in "${tutte[@]:$KEEP}"; do
  if [ -n "$(find "$d" -maxdepth 0 -mmin -10 2>/dev/null)" ]; then log "salto $d (modificata da meno di 10 minuti, forse un deploy in corso)"; continue; fi
  if [ "$APPLICA" -eq 1 ]; then rm -rf -- "$d"; log "cancellata $d"; tolte=$((tolte + 1)); else log "[prova] cancellerei $d"; fi
done
[ "$APPLICA" -eq 1 ] && log "ok: cancellate $tolte cartelle" || log "prova finita: ripeti con --applica per cancellare davvero"
