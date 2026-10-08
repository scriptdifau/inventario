const path = require('path');
const express = require('express');
const cookieSession = require('cookie-session');
const auth = require('./auth');

function creaApp() {
  const app = express();
  const prod = process.env.NODE_ENV === 'production';
  if (prod) app.set('trust proxy', 1);
  if (prod && !process.env.SESSION_SECRET) throw new Error('SESSION_SECRET mancante');

  app.set('view engine', 'ejs');
  app.set('views', path.join(__dirname, '..', 'views'));
  app.disable('x-powered-by');

  app.use((req, res, next) => {
    res.set({ 'X-Frame-Options': 'DENY', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin',
      'Cache-Control': 'no-store' });
    next();
  });
  app.get('/healthz', (req, res) => res.send('ok'));

  // Dietro il proxy di SiteGround la richiesta arriva all'app in HTTP senza X-Forwarded-Proto: la libreria dei cookie
  // si rifiuta (in silenzio) di impostare un cookie secure e il login fallisce. Se BASE_URL è https, il TLS è terminato dal proxy.
  if (prod && /^https:/i.test(process.env.BASE_URL || '')) {
    app.use((req, res, next) => { Object.defineProperty(req, 'protocol', { value: 'https', configurable: true }); next(); });
  }
  app.use(cookieSession({ name: 'inv', keys: [process.env.SESSION_SECRET || 'solo-sviluppo'], maxAge: 8 * 3600 * 1000,
    httpOnly: true, sameSite: 'lax', secure: prod, }));
  app.use(express.urlencoded({ extended: false, limit: '5mb' }));
  auth.routes(app);
  app.use(auth.richiediLogin);
  app.use(auth.csrf);
  app.use('/static', express.static(path.join(__dirname, '..', 'public')));

  app.use((req, res, next) => {
    res.locals.utente = req.session.utente;
    res.locals.path = req.path;
    // link "Scarica Excel": stessa vista, stessi filtri
    res.locals.xlsUrl = req.path + '?' + new URLSearchParams({ ...req.query, xlsx: '1' }).toString();
    res.locals.errore = null;
    res.locals.data = (d) => (d ? new Date(d).toLocaleDateString('it-IT', { timeZone: 'Europe/Rome' }) : '');
    res.locals.iso = (d) => (d instanceof Date ? d.toLocaleDateString('sv-SE', { timeZone: 'Europe/Rome' }) : d || '');
    res.locals.euro = (n) => (n === null || n === undefined || n === '' ? '' : Number(n).toLocaleString('it-IT', { style: 'currency', currency: 'EUR', useGrouping: 'always' }));
    res.locals.euroK = (n) => (Number(n) >= 1000 ? (Number(n) / 1000).toLocaleString('it-IT', { maximumFractionDigits: 1 }) + ' k€' : Math.round(Number(n)) + ' €');
    res.locals.slug = (t) => String(t || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    res.locals.iniziali = (t) => String(t || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((x) => x[0].toUpperCase()).join('');
    res.locals.tinta = (t) => { let h = 0; for (const c of String(t || '')) h = (h * 31 + c.charCodeAt(0)) % 360; return h; };
    next();
  });

  app.use('/', require('./routes/dashboard'));
  app.use('/asset', require('./routes/asset'));
  app.use('/persone', require('./routes/persone'));
  app.use('/sim', require('./routes/sim'));
  app.use('/movimenti', require('./routes/movimenti'));
  app.use('/cespiti', require('./routes/cespiti'));
  app.use('/importa', require('./routes/importa'));

  app.use((req, res) => res.status(404).render('errore', { messaggio: 'Pagina non trovata' }));
  app.use((err, req, res, next) => {
    console.error(err);
    // violazioni di vincoli del database -> messaggio leggibile
    if (err.code && /^23/.test(err.code)) return res.status(400).render('errore', { messaggio: messaggioVincolo(err) });
    res.status(500).render('errore', { messaggio: 'Errore interno' });
  });
  return app;
}

function messaggioVincolo(err) {
  if (err.constraint === 'assegnatario_coerente')
    return 'Incoerenza stato/assegnatario: "Assegnato" richiede una persona; In esercizio, Disponibile, Estinto e gli stati di uscita non possono averne.';
  if (err.constraint === 'asset_serial_uq') return 'Esiste già un asset con questo serial.';
  if (err.code === '23505') return 'Valore già presente (duplicato).';
  if (err.code === '23503') return 'Riferimento non valido o ancora in uso.';
  return 'Dati non validi: ' + (err.detail || err.message);
}

module.exports = { creaApp };
