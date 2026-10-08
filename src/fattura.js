// Lettura delle fatture di acquisto: XML FatturaPA (anche .xml.p7m) e testo estratto da un PDF.
// Nessuna dipendenza: piccolo parser XML tollerante (basta per FatturaPA) e euristiche per il PDF.
const { parseData } = require('./csv');

// ---------- XML ----------
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const decodifica = (t) => String(t).replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
  if (e[0] === '#') { const n = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return Number.isFinite(n) ? String.fromCodePoint(n) : m; }
  return ENT[e.toLowerCase()] !== undefined ? ENT[e.toLowerCase()] : m;
});

// il file può essere XML puro, firmato (.p7m, con l'XML in chiaro dentro) o l'XML in base64
function estraiXml(testo) {
  let t = String(testo || '');
  if (!/[<]/.test(t.slice(0, 2000)) && /^[A-Za-z0-9+/=\s]+$/.test(t.slice(0, 200))) {
    try { t = Buffer.from(t.replace(/\s+/g, ''), 'base64').toString('latin1'); } catch (e) { /* non era base64 */ }
  }
  const ini = t.search(/<(\w+:)?FatturaElettronica[\s>]/);
  if (ini < 0) return null;
  const fine = t.search(/<\/(\w+:)?FatturaElettronica>/);
  if (fine < 0) return null;
  return t.slice(ini, fine) + t.slice(fine).match(/<\/(\w+:)?FatturaElettronica>/)[0];
}

// albero { nome (senza prefisso), testo, figli: [] }
function parseXml(xml) {
  const radice = { nome: '#', testo: '', figli: [] }; const pila = [radice];
  const re = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[([\s\S]*?)\]\]>|<(\/?)([A-Za-z_][\w.\-:]*)[^>]*?(\/?)>|([^<]+)/g;
  let m;
  while ((m = re.exec(xml))) {
    const cur = pila[pila.length - 1];
    if (m[1] !== undefined) cur.testo += m[1];
    else if (m[3]) {
      const nome = m[3].replace(/^.*:/, '');
      if (m[2]) { if (pila.length > 1) pila.pop(); }
      else { const n = { nome, testo: '', figli: [] }; cur.figli.push(n); if (!m[4]) pila.push(n); }
    } else if (m[5] !== undefined) cur.testo += decodifica(m[5]);
  }
  return radice;
}
const figli = (n, nome) => (n ? n.figli.filter((f) => f.nome === nome) : []);
const trova = (n, ...percorso) => percorso.reduce((x, nome) => (x ? figli(x, nome)[0] : undefined), n);
const testo = (n, ...percorso) => { const x = trova(n, ...percorso); return x ? x.testo.trim() : ''; };
const numXml = (v) => { const n = parseFloat(String(v || '').replace(',', '.')); return Number.isFinite(n) ? n : null; };

function anagrafica(n) {
  const a = trova(n, 'DatiAnagrafici', 'Anagrafica');
  const nome = testo(a, 'Denominazione') || [testo(a, 'Nome'), testo(a, 'Cognome')].filter(Boolean).join(' ');
  return { nome, piva: testo(n, 'DatiAnagrafici', 'IdFiscaleIVA', 'IdCodice') || testo(n, 'DatiAnagrafici', 'CodiceFiscale') };
}

// -> [{ formato:'xml', tipoDocumento, fornitore, piva, cessionario, numero, data, totale, righe:[{descrizione, quantita, importo, prezzoUnitario, riferimenti}] }]
function leggiXml(testoFile) {
  const xml = estraiXml(testoFile);
  if (!xml) return [];
  const rad = parseXml(xml);
  const fe = rad.figli.find((f) => f.nome === 'FatturaElettronica');
  if (!fe) return [];
  const testa = trova(fe, 'FatturaElettronicaHeader');
  const cedente = anagrafica(trova(testa, 'CedentePrestatore')); const cess = anagrafica(trova(testa, 'CessionarioCommittente'));
  return figli(fe, 'FatturaElettronicaBody').map((body) => {
    const gen = trova(body, 'DatiGenerali', 'DatiGeneraliDocumento');
    const righe = figli(trova(body, 'DatiBeniServizi'), 'DettaglioLinee').map((l) => {
      const qta = numXml(testo(l, 'Quantita')) || 1;
      const tot = numXml(testo(l, 'PrezzoTotale')); const unit = numXml(testo(l, 'PrezzoUnitario'));
      const rif = [...figli(l, 'AltriDatiGestionali').map((a) => [testo(a, 'TipoDato'), testo(a, 'RiferimentoTesto')].filter(Boolean).join(' ')),
        ...figli(l, 'CodiceArticolo').map((c) => [testo(c, 'CodiceTipo'), testo(c, 'CodiceValore')].filter(Boolean).join(' '))].filter(Boolean);
      return { descrizione: testo(l, 'Descrizione'), quantita: qta, importo: tot, prezzoUnitario: unit !== null ? unit : (tot !== null ? tot / qta : null), riferimenti: rif };
    });
    return { formato: 'xml', tipoDocumento: testo(gen, 'TipoDocumento'), fornitore: cedente.nome, piva: cedente.piva, cessionario: cess.nome,
      numero: testo(gen, 'Numero'), data: testo(gen, 'Data').slice(0, 10) || null, totale: numXml(testo(gen, 'ImportoTotaleDocumento')), righe };
  });
}

// ---------- PDF (testo già estratto, una riga per riga di pagina) ----------
const numIt = (v) => { const n = parseFloat(String(v).replace(/\./g, '').replace(',', '.')); return Number.isFinite(n) ? n : null; };
const SALTA_RIGA = /totale|imponibile|\biva\b|sconto|scadenza|pagamento|iban|bonifico|bollo|arrotond|pagina|riepilogo|acconto|resto/i;

function leggiPdf(testoPdf) {
  const t = String(testoPdf || '').replace(/\r/g, '');
  const righeTesto = t.split('\n').map((r) => r.replace(/\s+/g, ' ').trim()).filter(Boolean);
  const piva = (t.match(/P\.?\s?IVA[:\s]*(?:IT)?\s*(\d{11})/i) || [])[1] || '';
  const numero = ((t.match(/(?:fattura|fatt\.?|documento|invoice)\s*(?:n(?:\.|°|r\.?|umero)?|no\.?)\s*[:\-]?\s*([A-Z0-9][A-Z0-9/.\-]{0,24})/i) || [])[1]
    || (t.match(/\bn(?:\.|°)\s*([A-Z0-9][A-Z0-9/\-]{0,24})/i) || [])[1] || '').replace(/[.\-/]+$/, '');
  const dm = t.match(/data(?:\s+(?:fattura|documento|emissione))?\s*[:\-]?\s*(\d{1,2}[/.\-]\d{1,2}[/.\-]\d{2,4})/i) || t.match(/(\d{1,2}[/.\-]\d{1,2}[/.\-]\d{4})/);
  const d = dm ? parseData(dm[1].replace(/[.\-]/g, '/'), 'dmy') : null;
  let totale = null;
  for (const r of righeTesto) {
    const m = r.match(/totale\s+(?:documento|fattura|da pagare|complessivo|importo)?\s*(?:€|eur)?\s*([\d.]*\d,\d{2})/i);
    if (m && numIt(m[1]) !== null && (totale === null || numIt(m[1]) > totale)) totale = numIt(m[1]);
  }
  const fornitore = righeTesto.find((r) => r.length > 2 && /[A-Za-z]{3}/.test(r) && !/^(fattura|invoice|documento|pagina|data|p\.?\s?iva|cod)/i.test(r)) || '';
  const righe = [];
  for (const r of righeTesto) {
    if (SALTA_RIGA.test(r)) continue;
    let m = r.match(/^(.{6,}?)\s+(\d+(?:[.,]\d+)?)\s+(?:€\s*)?([\d.]*\d,\d{2})\s+(?:€\s*)?([\d.]*\d,\d{2})(?:\s+\d{1,2}(?:,\d+)?\s*%?)?$/);
    if (m && /[A-Za-z]{3}/.test(m[1])) { const q = numIt(m[2]) || 1; righe.push({ descrizione: m[1], quantita: q, importo: numIt(m[4]), prezzoUnitario: numIt(m[3]), riferimenti: [], incerta: true }); continue; }
    m = r.match(/^(.{8,}?)\s+(?:€\s*)?([\d.]*\d,\d{2})\s*€?$/);
    if (m && /[A-Za-z]{4}/.test(m[1])) righe.push({ descrizione: m[1], quantita: 1, importo: numIt(m[2]), prezzoUnitario: numIt(m[2]), riferimenti: [], incerta: true });
  }
  return { formato: 'pdf', tipoDocumento: '', fornitore, piva, cessionario: '', numero, data: d ? d.slice(0, 10) : null, totale, righe, testo: t };
}

// ---------- classificazione delle righe ----------
const TIPI = [
  ['Mac', /\b(macbook|imac|mac ?mini|mac ?studio|mac ?pro)\b/i],
  ['Telefono', /\b(iphone|smartphone|cellulare|galaxy ?[sazm]\d|pixel ?\d|redmi|oneplus)\b/i],
  ['Tablet', /\b(ipad|tablet|galaxy tab)\b/i],
  ['Server', /\b(server|nas)\b/i],
  ['Rete', /\b(router|switch|access ?point|firewall|unifi|ubiquiti|modem)\b/i],
  ['Stampante', /\b(stampante|printer|multifunzione|plotter)\b/i],
  ['Monitor', /\b(monitor|display|schermo)\b/i],
  ['PC', /\b(notebook|laptop|portatile|computer|\bpc\b|desktop|thinkpad|probook|elitebook|latitude|vivobook|zenbook|ideapad|aspire|inspiron|thinkcentre|optiplex)\b/i],
];
const MARCHE = ['Apple', 'HP', 'Lenovo', 'Dell', 'Asus', 'Acer', 'Samsung', 'Huawei', 'Xiaomi', 'Google', 'Microsoft', 'LG', 'Epson', 'Canon', 'Brother', 'Ubiquiti', 'TP-Link', 'Logitech', 'Synology', 'Msi', 'Honor', 'Oppo'];
const SERVIZI = /spedizion|trasport|consegna|canone|abbonament|assistenza|licenza|garanzia|installazion|sconto|bollo|ricarica|traffico|servizio|noleggio|dominio|hosting|manodopera|intervento|contributo|imballo/i;

function classifica(descrizione) {
  const d = String(descrizione || '');
  const tipo = (TIPI.find(([, re]) => re.test(d)) || [])[0] || 'Altro';
  const marca = MARCHE.find((m) => new RegExp('(^|[^A-Za-z])' + m.replace('-', '[- ]?') + '([^A-Za-z]|$)', 'i').test(d)) || (tipo === 'Mac' || tipo === 'Telefono' && /iphone/i.test(d) || tipo === 'Tablet' && /ipad/i.test(d) ? 'Apple' : '');
  return { tipologia: tipo, marca, servizio: SERVIZI.test(d) };
}

// seriali dichiarati nella descrizione o nei riferimenti: "S/N: XXXX", "SN XXXX", "Serial number XXXX", "Matricola XXXX"
function seriali(...testi) {
  const out = new Set();
  const re = /(?:\bS\/?N\b|\bseriale?(?: number)?\b|\bserial(?: number)?\b|\bmatricola\b|\bIMEI\b)\s*[:.#\-]?\s*([A-Z0-9][A-Z0-9\-]{5,})/gi;
  for (const t of testi) { let m; while ((m = re.exec(String(t || '')))) out.add(m[1].toUpperCase()); }
  return [...out];
}

const norm = (t) => String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
const SUFFISSI = /\b(s\.?\s?r\.?\s?l\.?s?|s\.?\s?p\.?\s?a\.?|s\.?\s?n\.?\s?c\.?|s\.?\s?a\.?\s?s\.?|a socio unico|unipersonale|societa .*|società .*)\b\.?/gi;
// nome del fornitore come lo si scriverebbe a mano: senza forma giuridica
const nomeBreve = (n) => String(n || '').replace(SUFFISSI, '').replace(/[,;.\s]+$/g, '').replace(/\s+/g, ' ').trim()
  .replace(/^(.*)$/, (s) => (s === s.toUpperCase() ? s.toLowerCase().replace(/(^|\s)(\S)/g, (m, a, b) => a + b.toUpperCase()) : s));

module.exports = { estraiXml, parseXml, leggiXml, leggiPdf, classifica, seriali, nomeBreve, norm, numIt, numXml };
