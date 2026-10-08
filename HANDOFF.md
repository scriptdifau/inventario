# Inventario IT → database relazionale (stato al 08/10/2026)

## Obiettivo
Sostituire il Google Sheet "Inventario_IT_2026" (Cart'armata edizioni / Le parole che servono) con un'app Node.js + PostgreSQL su SiteGround (piani GrowBig e GoGeek: Node.js e PostgreSQL ok), codice su GitHub con deploy automatico.

## Fatto
- `schema.sql` — 12 tabelle (azienda, fornitore, tipologia, stato_asset, persona, cespite, fattura, asset, sim, movimento, antivirus_import, antivirus_dispositivo), trigger `asset_registra_movimento` (movimenti e data dismissione automatici), viste `v_asset`, `v_asset_vivi`, `v_riepilogo`, `v_acquisti_per_anno`, `v_controllo_antivirus`. Provato su PGlite.
- `importa.py` — legge l'export xlsx del foglio e genera `import.sql` + `report.txt` + `fornitori.txt`. Rieseguibile.
- Verifica: importi Riepilogo identici al foglio (Cart'armata 72.464,16 €; Le parole 5.257,97 €), 80 asset, 46 persone, 26 SIM, 65 fatture, 33 movimenti. Controllo antivirus coincide con quello del foglio (restano due differenze volute: AST-002 non in uso, AST-019 venduto).

## Regole di dominio
- Stati: Assegnato, In esercizio, Disponibile, Da verificare, Non aziendale, Estinto, Venduto, Ceduto, Macerato, Smarrito/Rubato. Uscita = Venduto/Ceduto/Macerato/Smarrito/Rubato (spariscono da viste e conteggi). Importo del Riepilogo = Assegnato+In esercizio+Disponibile+Estinto.
- Gli asset non si cancellano mai. ID AST-xxx / SIM-xxx stabili (AST-077 non esiste).
- Antivirus: ogni PC/Server Windows attivo (Assegnato, In esercizio, Da verificare; OS vuoto = Windows) deve comparire nell'ultimo report. Hostname Windows troncati a 15 caratteri (NetBIOS): confronto esatto o sui primi 15. Soglia "stantio": 20 giorni rispetto alla data del report.
- Un cespite può coprire più asset; una fattura più asset; il numero di fattura non è unico (chiave: fornitore+numero+data).

## Decisioni di Fau (08/10/2026)
- Lorena Colnaghi è collaboratrice con PC proprio: non va in Asset.
- AST-009 distrutto (Macerato). SRVAPP01 (AST-002) non in uso (Estinto, fuori dal controllo antivirus).
- Elisa Pedretti ha due PC (AST-014, AST-075): restano entrambi finché non decide; uno si libererà.
- Alberto Dragone senza email: corretto.
- Maria Santagata è tornata: Attivo, assegnatario di AST-018.
- Duplicato AST-082 e RAM di AST-073 corretti da Fau nel foglio.

## Da fare
1. App Node.js (Fastify/Express + pg): elenco/scheda/modifica asset, persone, SIM, movimenti; viste Riepilogo/Dashboard; login Google Workspace limitato a @terre.it; nessuna pagina pubblica.
2. Upload CSV antivirus, import fatture, sincronizzazione Workspace (oggi in Apps Script `SincronizzaDipendenti.gs`).
3. Backup giornaliero del database; verificare cron/processi persistenti sul piano SiteGround.
4. Cespiti ante 2018 (foglio storico) non ancora importati.
5. Dopo il passaggio: foglio in sola lettura per un mese.
