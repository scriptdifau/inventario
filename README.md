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
Passo 1 (HANDOFF) fatto: asset (elenco/scheda/modifica/nuovo), persone, SIM, movimenti, dashboard/riepilogo, controllo antivirus (sola lettura). Asset, persone e SIM si possono eliminare dalla scheda (con conferma): l asset porta via il suo storico movimenti, la persona solo se non ha asset assegnati. Punto 2 (pagina **Importa**): upload CSV antivirus, import fatture (con collegamento agli asset) e utenti Workspace da export CSV della console Admin; in più la **sincronizzazione diretta con la Directory API** (pulsante "Sincronizza ora" e `scripts/sincronizza-workspace.js` da cron, vedi DEPLOY.md 7b). Punto 4: cespiti ante 2018 in `cespite_storico` (nel **Cestino**, scheda "Storico cespiti ante 2018", sola lettura, totali quadrati col foglio); si ricarica con `python3 -I importa_cespiti.py inventario.xlsx cartella` + `import_cespiti.sql`. Per un database già esistente: `psql -f migrazioni/002_cespite_storico.sql`.

## Struttura delle pagine
Albero a sinistra: **Dashboard** > **Cart'armata** / **Le parole** > una pagina per ogni tipologia di asset (PC, Mac, Tablet, Telefono, Server, Altro…) più **Persone**. In fondo: Movimenti, Cestino, Importa e gli elenchi completi (tutti gli asset, tutte le persone). Indirizzi: `/az/<azienda>/<tipologia>` e `/az/<azienda>/persone`. Le pagine usano gli stessi elenchi con azienda e tipologia già impostate, quindi filtri e Excel funzionano ovunque. Una persona appartiene all'azienda indicata o, se manca, a quella del suo primo asset; una SIM a quella del telefono in cui è montata.

**Identificazione degli asset**: il codice interno `AST-xxx` non si mostra più; un asset si riconosce da marca/modello e dal **numero di cespite** (si cerca anche per cespite). Il codice resta nel database, nell'indirizzo (`/asset/<id>`) e come ultima colonna "Codice interno" del file Excel degli asset. Un cespite può coprire più asset; molti telefoni non ne hanno.

**SIM**: non c'è più una pagina dedicata. Sulle righe dei telefoni c'è il simbolo della SIM (blu = attiva, giallo = sospesa o da verificare, grigio = cessata; il numero si legge passando il mouse), e il dettaglio (numero, stato, operatore, piano, costo, giga, "saponetta", note) sta nella **scheda del telefono**, dove si aggiunge e si modifica la SIM. Si cerca il telefono anche dal numero della SIM. Le SIM non montate su un telefono (SIM dati o di scorta) stanno in fondo alla pagina **Telefono** dell'azienda; una SIM nuova richiede il telefono oppure l'azienda, così non si perde. L'Excel dei telefoni ha le colonne della SIM.

**Antivirus**: non c'è più una pagina dedicata. Sulle righe dei PC e dei server attivi c'è un simbolo: scudo verde = antivirus attivo e aggiornato, scudo giallo = nel report ma da verificare (non visto da più di 20 giorni o non protetto), scudo rosso barrato = assente dal report. Il filtro "Antivirus da sistemare" (anche dal riquadro della Dashboard) elenca i casi da risolvere; l'ultimo report si carica da **Importa**.

## Ordinamento
Le liste (asset, SIM, persone, antivirus, cespiti) si ordinano cliccando l'intestazione di una colonna (di nuovo per invertire) o dal menu "Ordina per" (telefono e schede delle persone); l'ordine sta nell'indirizzo (`?ord=<colonna>&dir=asc|desc`) e vale anche per Excel. Predefinito: per **cognome** della persona (chi non ne ha, in fondo); nell'antivirus prima i problemi, poi per persona. Sono ammesse solo le colonne previste: altri valori vengono ignorati. I movimenti restano in ordine di data.

## Migrazioni del database
I file in `migrazioni/` si applicano una volta, in ordine, con `psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f migrazioni/NNN_nome.sql`, **prima** di usare la versione dell'app che li richiede. Sono pensati per poter essere rilanciati senza danni. `003_numero_fattura.sql` toglie il ".0" finale dai numeri di fattura importati dal foglio (`4198.0` → `4198`), salta e segnala i numeri che andrebbero a duplicarne un altro, e stampa un riepilogo (corrette / saltate / fatture totali).

## Esportazione Excel
Ogni vista (Dashboard, Asset, Persone, SIM, Movimenti, Antivirus, Cestino) ha il link **Scarica Excel**: scarica un `.xlsx` con gli stessi filtri attivi nella pagina (aggiungendo `xlsx=1` all'indirizzo). Il Movimenti scarica tutte le righe filtrate, non solo le ultime 500. Il file è generato da `src/xlsx.js`, senza dipendenze aggiuntive.

## Backup
`scripts/backup.sh` fa un dump SQL compresso in `BACKUP_DIR` (predefinita `./backups`), lo controlla (gzip + presenza della tabella asset), tiene gli ultimi `KEEP_DAYS` giorni (30) e aggiorna `ultimo.sql.gz`. Ci si collega con `DATABASE_URL` oppure con `PGHOST`/`PGUSER`/`PGDATABASE` e la password in `~/.pgpass` (così non compare nei comandi); non chiede mai password, quindi va bene da cron. Serve `pg_dump`. Passi completi per SiteGround (copia fissa in `~/bin`, cron, ripristino, copia fuori dal server) in `DEPLOY.md`, sezione 7. Ripristino provato: in un database vuoto, `zcat ultimo.sql.gz | psql ...`.

Restano i punti 5 (foglio in sola lettura per un mese) e la sincronizzazione Workspace via API.

Per la messa in produzione vedi `DEPLOY.md`.

**Età dell'hardware**: nelle liste degli asset ogni dispositivo con data di acquisto mostra l'età (per PC, Mac e server in giallo oltre 4 anni e in rosso oltre 6; soglie con `ETA_ATTENZIONE` / `ETA_SOSTITUIRE`). Il filtro **Età** ("oltre 4 / oltre 6 anni"), l'ordinamento per età e la colonna "Età (anni)" dell'Excel aiutano a trovare cosa sostituire; la Dashboard ha il riquadro **Età dei computer** (media e quanti oltre soglia, con link alla lista filtrata). Importando il **report antivirus** il sistema operativo degli asset con lo stesso hostname si aggiorna da solo.

**Import delle fatture (XML e PDF)**: in **Importa**, "Fattura di acquisto". Si carica l'XML della fattura elettronica (anche `.xml.p7m`) oppure il PDF (il testo viene estratto dal browser con pdf.js, caricato da cdnjs; i PDF scansionati senza testo non funzionano). L'app mostra una **bozza modificabile** (nulla è salvato): fornitore (riconosciuto anche da "EFFESISTEMI SRL" → Effesistemi), numero, data, azienda (dall'intestatario) e le righe; per ognuna si sceglie se **creare un asset nuovo** (con quantità N crea N asset), **collegarla a un asset esistente** (proposto in automatico se il seriale della riga è già in archivio) o **saltarla** (spedizioni, canoni, servizi sono già proposti come saltati). Alla conferma registra fornitore, fattura e asset in un'unica transazione. Una fattura già registrata con asset collegati non crea duplicati se non lo si chiede esplicitamente. Dal PDF le righe sono una stima: vanno controllate. Il file non resta sul server.

**Cestino**: raccoglie tutto ciò che è uscito dall'azienda e non è più in contabilità, per ritrovarne traccia. In contabilità restano gli stati fino a **Estinto** compreso; **Venduto, Ceduto, Macerato e Smarrito/Rubato** mandano l'asset nel Cestino (esce dagli elenchi, dai conteggi e dal valore a bilancio; resta cercabile con "anche nel Cestino" e nella pagina Cestino con filtri per stato, tipologia, azienda e anno di uscita, ultimo assegnatario, importo ed Excel). Dalla scheda di un asset nel Cestino si può **Ripristinare** (torna Disponibile, con il movimento registrato). Una seconda scheda, "Storico cespiti ante 2018", contiene il vecchio elenco di sola lettura (il vecchio indirizzo `/cespiti` porta lì). Nel form di modifica gli stati sono raggruppati: "In contabilità" e "Dismesso: va nel Cestino".
