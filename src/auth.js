const crypto = require('crypto');
const { OAuth2Client } = require('google-auth-library');

const domain = () => (process.env.ALLOWED_DOMAIN || 'terre.it').toLowerCase();
const isProd = () => process.env.NODE_ENV === 'production';
const base = () => (process.env.BASE_URL || 'http://localhost:3000').replace(/\/$/, '');

function client() {
  return new OAuth2Client(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET, `${base()}/auth/callback`);
}

// l'email deve essere verificata, del dominio e (se presente) con hd coerente
function emailAmmessa(payload) {
  const email = String(payload.email || '').toLowerCase();
  return payload.email_verified === true && email.endsWith('@' + domain()) && (!payload.hd || payload.hd.toLowerCase() === domain());
}

// tutto richiede login, tranne /auth/* e /healthz
function richiediLogin(req, res, next) {
  if (req.session.utente) return next();
  if (req.method === 'GET') req.session.dopoLogin = req.originalUrl;
  return res.redirect('/auth/login');
}

function csrf(req, res, next) {
  if (!req.session.csrf) req.session.csrf = crypto.randomBytes(24).toString('hex');
  res.locals.csrf = req.session.csrf;
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
    const a = Buffer.from(String(req.body && req.body._csrf || ''));
    const b = Buffer.from(req.session.csrf);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return res.status(403).send('Token CSRF non valido');
  }
  next();
}

function routes(router) {
  router.get('/auth/login', (req, res) => {
    if (!isProd() && process.env.DEV_LOGIN_EMAIL) {
      req.session.utente = { email: process.env.DEV_LOGIN_EMAIL.toLowerCase(), nome: 'Sviluppo' };
      return res.redirect(req.session.dopoLogin || '/');
    }
    if (!process.env.GOOGLE_CLIENT_ID) return res.status(500).send('Login Google non configurato (GOOGLE_CLIENT_ID).');
    const state = crypto.randomBytes(16).toString('hex');
    req.session.oauthState = state;
    res.redirect(client().generateAuthUrl({ scope: ['openid', 'email', 'profile'], state, hd: domain(), prompt: 'select_account' }));
  });

  router.get('/auth/callback', async (req, res) => {
    try {
      const { code, state } = req.query;
      if (!code || !state || state !== req.session.oauthState) return res.status(400).send('Richiesta di login non valida');
      delete req.session.oauthState;
      const c = client();
      const { tokens } = await c.getToken(String(code));
      const ticket = await c.verifyIdToken({ idToken: tokens.id_token, audience: process.env.GOOGLE_CLIENT_ID });
      const p = ticket.getPayload();
      if (!emailAmmessa(p)) return res.status(403).send(`Accesso consentito solo agli account @${domain()}`);
      const dopo = req.session.dopoLogin || '/';
      req.session.utente = { email: p.email.toLowerCase(), nome: p.name || p.email };
      delete req.session.dopoLogin;
      res.redirect(dopo);
    } catch (e) {
      console.error('Errore login', e.message);
      res.status(401).send('Login non riuscito');
    }
  });

  router.post('/auth/logout', (req, res) => { req.session = null; res.redirect('/auth/login'); });
}

module.exports = { richiediLogin, csrf, routes, emailAmmessa };
