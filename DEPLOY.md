# Deploy su SiteGround

Guida passo-passo. **Prima verifica la sezione 0**: alcuni requisiti non sono confermati dalla documentazione pubblica
e, se mancano, il piano condiviso non basta.

## 0. Verifiche preliminari (go / no-go)

Chiedi al supporto SiteGround (o controlla in Site Tools) e annota la risposta:

| Requisito | Perché serve | Esito |
|---|---|---|
| **PostgreSQL** (non solo MySQL) sul piano | l'app e lo schema sono PostgreSQL (trigger, viste, `GENERATED`) | ☐ |
| **Node.js ≥ 20.12** (gestore app in Site Tools) | `package.json` richiede ≥ 20.12 | ☐ |
| **Processo persistente** (l'app resta in esecuzione, riavvio automatico) | l'app è un server, non uno script | ☐ |
| **Reverse proxy / porta** verso un dominio HTTPS | il login Google richiede HTTPS | ☐ |
| **SSH** + **Cron Jobs** | backup notturno e diagnosi (il deploy è automatico) | ☐ |
| `pg_dump` disponibile | `scripts/backup.sh` | ☐ |

Se PostgreSQL o un processo Node persistente non sono disponibili sul piano condiviso, le alternative sono: database
PostgreSQL esterno (es. Neon, Supabase, Aiven) con l'app su SiteGround, oppure SiteGround Cloud / un piccolo VPS.
Non procedere oltre finché la tabella non è chiara.

## 1. Dominio e HTTPS
1. Scegli il sottodominio, es. `inventario.terre.it`, e puntalo al sito/app su SiteGround.
2. Attiva Let's Encrypt (Site Tools → Sicurezza → HTTPS) e forza HTTPS.
3. Annota l'URL pubblico: sarà `BASE_URL` (senza `/` finale).

## 2. Login Google (Google Cloud Console)
1. Progetto → API e servizi → Schermata consenso OAuth: tipo **Interno** (solo la Workspace).
2. Credenziali → Crea ID client OAuth → **Applicazione web**.
3. URI di reindirizzamento autorizzato: `https://inventario.terre.it/auth/callback` (= `BASE_URL/auth/callback`).
4. Copia ID client e segreto client.
5. Workspace con più domini: l'app accetta `terre.it`, `leparolecheservono.it`, `falacosagiusta.org`
   (`ALLOWED_DOMAINS`). Con schermata "Interno" accedono comunque solo account della vostra organizzazione.

## 3. Database
```bash
createdb inventario            # oppure dal pannello di SiteGround
psql "$DATABASE_URL" -f schema.sql -f import.sql -f import_cespiti.sql
```
Sono i dati del foglio al 08/10/2026. Se prima del passaggio il foglio cambia, rigenera `import.sql`
con `python3 -I importa.py inventario.xlsx cartella` e ricarica **su un database vuoto** (lo schema non è idempotente).
Se il database è esterno, aggiungi `?sslmode=require` a `DATABASE_URL`.

## 4. Codice: deploy automatico da GitHub (Site Tools → Node.js)
SiteGround collega il repository e rifà il deploy a ogni push sul branch scelto.
1. *Node.js → Deployment*: metodo **GitHub**, repository `scriptdifau/inventario`, **branch `main`**, deployment automatico **attivo**.
2. Preset framework **Express**, gestore pacchetti **npm**, **Node ≥ 20.12** (consigliata la più recente disponibile), comando di build e directory di output vuoti.
3. Il codice finisce in una cartella nascosta, es. `~/www/DOMINIO/public_html/.nodeapp/<id>-origin/app_source`
   (`ls -a` per vederla). Ogni deploy può ricrearla: **non** metterci file a mano.

## 5. Configurazione (variabili d'ambiente) e avvio
Il `.env` non sta su GitHub, quindi un deploy che ricrea la cartella lo perde. **Imposta le variabili nel pannello**
(*Node.js → variabili d'ambiente*, se presente): sopravvivono ai deploy e hanno la precedenza sul file.
```
NODE_ENV=production
BASE_URL=https://inventario.terre.it        # l'indirizzo pubblico, senza / finale
SESSION_SECRET=<openssl rand -hex 32>
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
DATABASE_URL=postgres://utente:password@host:5432/nomedb
```
Non impostare `DEV_LOGIN_EMAIL`; in produzione l'app non parte senza `SESSION_SECRET`. In alternativa un `.env` nella
cartella dell'app (formato `CHIAVE=valore`), con il rischio di perderlo al deploy.
- All'avvio l'app scrive nel log `.env caricato (…), Node vXX` oppure `.env NON trovato`. Se le variabili sono nel pannello
  la seconda riga è normale.
- Riavvia dal pannello dopo ogni modifica alle variabili. Controllo: `https://DOMINIO/healthz` → `ok`.

## 6. Prima verifica funzionale
1. Apri l'URL: deve rimandarti al login Google (nessuna pagina pubblica).
2. Accedi con un account per **ciascuno dei tre domini**: se uno viene rifiutato, controlla il messaggio e il claim `hd`
   (l'app richiede che sia nell'elenco dei domini).
3. Un account `@gmail.com` deve essere rifiutato.
   Se il login finisce in "Richiesta di login non valida": usa `https://` e parti sempre da `/auth/login`.
4. Dashboard: importi Cart'armata 72.464,16 €, Le parole 5.257,97 €; 80 asset, 46 persone.
5. Modifica un asset di prova (stato/assegnatario) e verifica il movimento; poi ripristinalo.

## 7. Backup notturno
`scripts/backup.sh` fa un dump SQL compresso, lo controlla (gzip + presenza della tabella `asset`), tiene gli ultimi 30 giorni
e aggiorna il collegamento `ultimo.sql.gz`. **Da cron non va chiamato dalla cartella del deploy** (cambia nome a ogni
aggiornamento): se ne tiene una copia fissa in `~/bin`.
1. Password fuori dai comandi, in `~/.pgpass` (permessi 600), scritta senza che compaia a schermo né nella cronologia:
   ```
   read -rs -p "Password del database: " PW; echo
   printf 'localhost:5432:NOMEDB:UTENTE:%s\n' "$PW" > ~/.pgpass; chmod 600 ~/.pgpass; unset PW
   ```
2. Copia dello script e configurazione (host, utente, database, cartella dei backup) in testa al file:
   ```
   mkdir -p ~/bin && cp .../app_source/scripts/backup.sh ~/bin/backup-inventario.sh
   # in cima, dopo la riga #!/usr/bin/env bash, aggiungi:
   export PATH="$HOME/bin:/usr/local/bin:/usr/bin:/bin:$PATH" PGHOST=localhost PGPORT=5432 PGUSER=UTENTE PGDATABASE=NOMEDB BACKUP_DIR="$HOME/backup-inventario"
   ```
3. Prova a mano (`~/bin/backup-inventario.sh`), poi cron (Site Tools → Dev → Cron Jobs, oppure `crontab -e`), per esempio ogni notte alle 02:30:
   ```
   30 2 * * * /home/UTENTE_SSH/bin/backup-inventario.sh >> /home/UTENTE_SSH/backup-inventario/backup.log 2>&1
   ```
   Il giorno dopo controlla `tail ~/backup-inventario/backup.log`: deve esserci una riga `backup ok`.
4. **Ripristino** (provato): in un database vuoto, `zcat ~/backup-inventario/ultimo.sql.gz | psql -h localhost -U UTENTE NOMEDB_VUOTO`.
5. Un backup che resta sullo stesso server non protegge dalla perdita del server: scarica ogni tanto `ultimo.sql.gz`
   (SFTP o `scp -P 18765 UTENTE_SSH@HOST:backup-inventario/ultimo.sql.gz .`) e tienilo altrove (es. Drive).

## 7b. Sincronizzazione con Google Workspace (Directory API)
L'app legge gli utenti direttamente da Google e applica le regole di `SincronizzaDipendenti.gs` (abbina per `nomecognome`
dell'email, scrive solo `stato_workspace`, non tocca `stato`, crea le persone nuove, segnala chi è sparito). Un solo
account di servizio basta per i tre domini, perché sono la stessa Workspace.
1. **Google Cloud Console**, stesso progetto del login: *API e servizi → Libreria* → abilita **Admin SDK API**. Poi
   *IAM e amministrazione → Account di servizio → Crea* (nome `inventario-sync`, nessun ruolo), apri l'account →
   *Chiavi → Aggiungi chiave → JSON*: scarica il file. Dai dettagli dell'account copia l'**ID client** (numero lungo, "ID univoco").
2. **Console di amministrazione** (serve un super amministratore): admin.google.com → *Sicurezza → Controllo di accesso e dei dati →
   Controlli API → Gestisci delega a livello di dominio → Aggiungi nuova*: ID client del punto 1, ambito
   `https://www.googleapis.com/auth/admin.directory.user.readonly`. Autorizza.
3. **Sul server** metti la chiave fuori dalla cartella del deploy (cambia a ogni aggiornamento), per esempio via SFTP in
   `~/segreti/workspace-sa.json`, poi `chmod 600 ~/segreti/workspace-sa.json`. Non va mai in chat né su GitHub.
4. **Variabili** nel pannello Node.js (poi *Esegui il deployment*):
   `GOOGLE_SA_KEY_FILE=/home/UTENTE_SSH/segreti/workspace-sa.json` e `WORKSPACE_ADMIN_EMAIL=` l'email di un amministratore
   (è l'account che l'app "impersona" per leggere la directory).
5. **Prova**: in Importa il pulsante *Sincronizza ora*. Se Google risponde `unauthorized_client` o `access_denied`
   la delega del punto 2 non è attiva (ID client o ambito sbagliati; a volte servono alcuni minuti).
6. **Notturna (facoltativa)**: da cron non si vedono le variabili del pannello: crea `~/segreti/inventario.env` (permessi 600) con
   `DATABASE_URL=…`, `GOOGLE_SA_KEY_FILE=…`, `WORKSPACE_ADMIN_EMAIL=…` e uno script fisso `~/bin/sincronizza-workspace.sh`:
   ```
   #!/usr/bin/env bash
   export ENV_FILE="$HOME/segreti/inventario.env"
   cd "$(ls -dt $HOME/www/*/public_html/.nodeapp/*/app_source | head -1)" || exit 1
   exec /PERCORSO/DI/node scripts/sincronizza-workspace.js
   ```
   (`/PERCORSO/DI/node` si vede con `which node` dalla SSH). Cron, per esempio ogni notte alle 03:15:
   `15 3 * * * /home/UTENTE_SSH/bin/sincronizza-workspace.sh >> /home/UTENTE_SSH/sincronizza.log 2>&1`;
   nel log deve comparire `workspace ok`.

## 8. Aggiornamenti
Si fanno da soli: ogni merge su `main` avvia un deploy. Controlla in *Node.js → Deployment* che sia completato e
riavvia l'app se serve. Le modifiche allo schema sono in `migrazioni/`: applicale con `psql -f`, in ordine, **prima** di
unire la modifica che le usa.

## 9. Dopo il passaggio
Il foglio resta come riferimento (permessi da definire). Importa regolarmente il report antivirus e l'export utenti
Workspace dalla pagina **Importa**.
