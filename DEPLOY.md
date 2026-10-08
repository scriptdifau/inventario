# Deploy su SiteGround

Guida passo-passo. **Prima verifica la sezione 0**: alcuni requisiti non sono confermati dalla documentazione pubblica
e, se mancano, il piano condiviso non basta.

## 0. Verifiche preliminari (go / no-go)

Chiedi al supporto SiteGround (o controlla in Site Tools) e annota la risposta:

| Requisito | Perché serve | Esito |
|---|---|---|
| **PostgreSQL** (non solo MySQL) sul piano | l'app e lo schema sono PostgreSQL (trigger, viste, `GENERATED`) | ☐ |
| **Node.js ≥ 20.12** eseguibile (gestore app in Site Tools o via SSH) | `package.json` richiede ≥ 20.12 | ☐ |
| **Processo persistente** (l'app resta in esecuzione, riavvio automatico) | l'app è un server, non uno script | ☐ |
| **Reverse proxy / porta** verso un dominio HTTPS | il login Google richiede HTTPS | ☐ |
| **SSH** + **Cron Jobs** | deploy e backup notturno | ☐ |
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

## 4. Codice e configurazione
```bash
ssh utente@server
git clone https://github.com/scriptdifau/inventario.git && cd inventario
npm ci --omit=dev
cp .env.example .env && chmod 600 .env
```
Compila `.env` (mai nel repository):
```
NODE_ENV=production
DATABASE_URL=postgres://utente:password@host:5432/inventario
PORT=<porta assegnata dal gestore app>
BASE_URL=https://inventario.terre.it
SESSION_SECRET=<openssl rand -hex 32>
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
```
In produzione l'app rifiuta di partire senza `SESSION_SECRET`; **non** impostare `DEV_LOGIN_EMAIL`.

## 5. Avvio e persistenza
- Con il gestore Node.js di Site Tools (se presente): radice app = cartella del repo, file di avvio `server.js`.
- Altrimenti da SSH con un process manager (es. `pm2 start server.js --name inventario && pm2 save`, più avvio al boot
  se consentito dal piano).
- Controllo: `curl https://inventario.terre.it/healthz` → `ok`.

## 6. Prima verifica funzionale
1. Apri l'URL: deve rimandarti al login Google (nessuna pagina pubblica).
2. Accedi con un account per **ciascuno dei tre domini**: se uno viene rifiutato, controlla il messaggio e il claim `hd`
   (l'app richiede che sia nell'elenco dei domini).
3. Un account `@gmail.com` deve essere rifiutato.
4. Dashboard: importi Cart'armata 72.464,16 €, Le parole 5.257,97 €; 80 asset, 46 persone.
5. Modifica un asset di prova (stato/assegnatario) e verifica il movimento; poi ripristinalo.

## 7. Backup notturno
```
30 2 * * * cd /percorso/inventario && set -a && . ./.env && set +a && BACKUP_DIR=/percorso/backup scripts/backup.sh >> /percorso/backup/backup.log 2>&1
```
Poi: (a) prova un ripristino su un database di prova (`zcat file.sql.gz | psql nuovo`), (b) copia i backup fuori dal
server (es. Drive): un backup sullo stesso server non protegge dalla perdita del server.

## 8. Aggiornamenti
Manuale: `git pull && npm ci --omit=dev` e riavvio dell'app. Le modifiche allo schema sono in `migrazioni/`
(applicale con `psql -f`, in ordine, prima del riavvio).

Deploy automatico (da attivare quando la sezione 0 è chiara): workflow GitHub Actions su push a `main` che entra
in SSH ed esegue i comandi sopra. Servono i secret `DEPLOY_HOST`, `DEPLOY_USER`, `DEPLOY_KEY` (chiave dedicata, solo
per questa cartella).
```yaml
# .github/workflows/deploy.yml
on: { push: { branches: [main] } }
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: appleboy/ssh-action@v1
        with:
          host: ${{ secrets.DEPLOY_HOST }}
          username: ${{ secrets.DEPLOY_USER }}
          key: ${{ secrets.DEPLOY_KEY }}
          script: cd ~/inventario && git pull --ff-only && npm ci --omit=dev && pm2 restart inventario
```

## 9. Dopo il passaggio
Il foglio resta come riferimento (permessi da definire). Importa regolarmente il report antivirus e l'export utenti
Workspace dalla pagina **Importa**.
