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
Google OAuth ("Applicazione web"): redirect URI `BASE_URL/auth/callback`. Accettati solo account Workspace `@ALLOWED_DOMAIN` (default `terre.it`) con email verificata. Ogni pagina richiede login; pubblici solo `/auth/*` e `/healthz`.

## Test
`DATABASE_URL=... npm test` (usa il database caricato; ripristina le modifiche che fa).

## Stato
Passo 1 (HANDOFF) fatto: asset (elenco/scheda/modifica/nuovo), persone, SIM, movimenti, dashboard/riepilogo, controllo antivirus (sola lettura). Gli asset non si cancellano. Restano i punti 2–5.
