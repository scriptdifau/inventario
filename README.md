# Inventario IT

App Node.js (Express + EJS + PostgreSQL) che sostituisce il foglio "Inventario_IT_2026". Vedi `HANDOFF.md` per contesto e regole di dominio.

## Avvio locale
```
createdb inventario
psql inventario -f schema.sql -f import.sql
cp .env.example .env     # DATABASE_URL, SESSION_SECRET, credenziali Google
npm install && npm start
```
In sviluppo si può impostare `DEV_LOGIN_EMAIL` per saltare Google (ignorato con `NODE_ENV=production`).

## Login
Google OAuth ("Applicazione web"): redirect URI `BASE_URL/auth/callback`. Accettati solo account della stessa Workspace: email verificata e claim `hd` in `ALLOWED_DOMAINS` (default `terre.it`, `leparolecheservono.it`, `falacosagiusta.org`). Ogni pagina richiede login; pubblici solo `/auth/*` e `/healthz`.

## Test
`DATABASE_URL=... npm test` (usa il database caricato; ripristina le modifiche che fa).

## Stato
Passo 1 (HANDOFF) fatto: asset (elenco/scheda/modifica/nuovo), persone, SIM, movimenti, dashboard/riepilogo, controllo antivirus (sola lettura). Gli asset non si cancellano. Punto 2 (pagina **Importa**): upload CSV antivirus, import fatture (con collegamento agli asset) e utenti Workspace da export CSV della console Admin (la sync via API Admin SDK richiede un service account: non fatta). Punto 4: cespiti ante 2018 in `cespite_storico` (pagina **Cespiti ante 2018**, sola lettura, totali quadrati col foglio); si ricarica con `python3 -I importa_cespiti.py inventario.xlsx cartella` + `import_cespiti.sql`. Per un database già esistente: `psql -f migrazioni/002_cespite_storico.sql`.

## Struttura delle pagine
Albero a sinistra: **Dashboard** > **Cart'armata** / **Le parole** > una pagina per ogni tipologia di asset (PC, Mac, Tablet, Telefono, Server, Altro…) più **Persone**. In fondo: Movimenti, Cespiti ante 2018, Importa e gli elenchi completi (tutti gli asset, tutte le persone). Indirizzi: `/az/<azienda>/<tipologia>` e `/az/<azienda>/persone`. Le pagine usano gli stessi elenchi con azienda e tipologia già impostate, quindi filtri e Excel funzionano ovunque. Una persona appartiene all'azienda indicata o, se manca, a quella del suo primo asset; una SIM a quella del telefono in cui è montata.

**Identificazione degli asset**: il codice interno `AST-xxx` non si mostra più; un asset si riconosce da marca/modello e dal **numero di cespite** (si cerca anche per cespite). Il codice resta nel database, nell'indirizzo (`/asset/<id>`) e come ultima colonna "Codice interno" del file Excel degli asset. Un cespite può coprire più asset; molti telefoni non ne hanno.

**SIM**: non c'è più una pagina dedicata. Sulle righe dei telefoni c'è il simbolo della SIM (blu = attiva, giallo = sospesa o da verificare, grigio = cessata; il numero si legge passando il mouse), e il dettaglio (numero, stato, operatore, piano, costo, giga, "saponetta", note) sta nella **scheda del telefono**, dove si aggiunge e si modifica la SIM. Si cerca il telefono anche dal numero della SIM. Le SIM non montate su un telefono (SIM dati o di scorta) stanno in fondo alla pagina **Telefono** dell'azienda; una SIM nuova richiede il telefono oppure l'azienda, così non si perde. L'Excel dei telefoni ha le colonne della SIM.

**Antivirus**: non c'è più una pagina dedicata. Sulle righe dei PC e dei server attivi c'è un simbolo: scudo verde = antivirus attivo e aggiornato, scudo giallo = nel report ma da verificare (non visto da più di 20 giorni o non protetto), scudo rosso barrato = assente dal report. Il filtro "Antivirus da sistemare" (anche dal riquadro della Dashboard) elenca i casi da risolvere; l'ultimo report si carica da **Importa**.

## Ordinamento
Le liste (asset, SIM, persone, antivirus, cespiti) si ordinano cliccando l'intestazione di una colonna (di nuovo per invertire) o dal menu "Ordina per" (telefono e schede delle persone); l'ordine sta nell'indirizzo (`?ord=<colonna>&dir=asc|desc`) e vale anche per Excel. Predefinito: per **cognome** della persona (chi non ne ha, in fondo); nell'antivirus prima i problemi, poi per persona. Sono ammesse solo le colonne previste: altri valori vengono ignorati. I movimenti restano in ordine di data.

## Migrazioni del database
I file in `migrazioni/` si applicano una volta, in ordine, con `psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f migrazioni/NNN_nome.sql`, **prima** di usare la versione dell'app che li richiede. Sono pensati per poter essere rilanciati senza danni. `003_numero_fattura.sql` toglie il ".0" finale dai numeri di fattura importati dal foglio (`4198.0` → `4198`), salta e segnala i numeri che andrebbero a duplicarne un altro, e stampa un riepilogo (corrette / saltate / fatture totali).

## Esportazione Excel
Ogni vista (Dashboard, Asset, Persone, SIM, Movimenti, Antivirus, Cespiti ante 2018) ha il link **Scarica Excel**: scarica un `.xlsx` con gli stessi filtri attivi nella pagina (aggiungendo `xlsx=1` all'indirizzo). Il Movimenti scarica tutte le righe filtrate, non solo le ultime 500. Il file è generato da `src/xlsx.js`, senza dipendenze aggiuntive.

## Backup (punto 3)
`scripts/backup.sh` fa un dump SQL compresso in `BACKUP_DIR` (default `./backups`), lo controlla (gzip + presenza della tabella asset) e tiene gli ultimi `KEEP_DAYS` giorni (30). Serve `pg_dump` nel PATH.
```
# crontab / Cron Jobs di SiteGround, ogni notte alle 02:30
30 2 * * * cd /percorso/app && DATABASE_URL=... BACKUP_DIR=/percorso/backup scripts/backup.sh >> backup.log 2>&1
```
Ripristino: `createdb nuovo && zcat inventario-AAAAMMGG-HHMMSS.sql.gz | psql nuovo` (provato). Un backup che resta sullo stesso server non protegge dalla perdita del server: va copiato altrove (es. Drive).
Da verificare sul piano SiteGround (non controllabile da qui): disponibilità di `pg_dump`, dei Cron Jobs e di un processo Node persistente.

Restano i punti 5 (foglio in sola lettura per un mese) e la sincronizzazione Workspace via API.

Per la messa in produzione vedi `DEPLOY.md`.
