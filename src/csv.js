// Parser CSV minimale (RFC 4180): virgolette, a capo nei campi, BOM, separatore , o ; rilevato dalla prima riga.
function parseCsv(testo) {
  let t = String(testo || '').replace(/^﻿/, '');
  const prima = t.split(/\r?\n/, 1)[0];
  const sep = (prima.match(/;/g) || []).length > (prima.match(/,/g) || []).length ? ';' : ',';
  const righe = []; let riga = []; let cella = ''; let q = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (q) {
      if (c === '"') { if (t[i + 1] === '"') { cella += '"'; i++; } else q = false; } else cella += c;
    } else if (c === '"') q = true;
    else if (c === sep) { riga.push(cella); cella = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && t[i + 1] === '\n') i++;
      riga.push(cella); cella = ''; righe.push(riga); riga = [];
    } else cella += c;
  }
  if (cella !== '' || riga.length) { riga.push(cella); righe.push(riga); }
  const nonVuote = righe.filter((r) => r.some((x) => x.trim() !== ''));
  if (!nonVuote.length) return [];
  const intest = nonVuote[0].map((h) => h.trim());
  return nonVuote.slice(1).map((r) => Object.fromEntries(intest.map((h, i) => [h, (r[i] ?? '').trim()])));
}

// valore di una colonna cercando fra più nomi possibili (senza maiuscole/spazi/[Required])
const norm = (h) => h.toLowerCase().replace(/\[.*?\]/g, '').replace(/[^a-z0-9]/g, '');
function col(riga, ...nomi) {
  const mappa = new Map(Object.keys(riga).map((k) => [norm(k), k]));
  for (const n of nomi) { const k = mappa.get(norm(n)); if (k !== undefined && riga[k] !== '') return riga[k]; }
  return null;
}

// "2026-10-08", "08/10/2026", "10/08/2026 14:30" (mm/gg se il primo numero <= 12 e il secondo > 12 non è ambiguo)
// formato = 'mdy' | 'dmy' per i casi ambigui
function parseData(v, formato = 'dmy') {
  if (!v) return null;
  let m = String(v).trim().match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/);
  let y, mo, d, h = 0, mi = 0;
  if (m) { [, y, mo, d] = m; h = m[4] || 0; mi = m[5] || 0; }
  else {
    m = String(v).trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})(?:\s+(\d{1,2}):(\d{2}))?/);
    if (!m) return null;
    let a = +m[1], b = +m[2]; y = +m[3]; if (y < 100) y += 2000;
    if (a > 12) { d = a; mo = b; } else if (b > 12) { mo = a; d = b; } else if (formato === 'mdy') { mo = a; d = b; } else { d = a; mo = b; }
    h = m[4] || 0; mi = m[5] || 0;
  }
  const dt = new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi));
  if (dt.getUTCMonth() !== +mo - 1 || dt.getUTCDate() !== +d) return null;
  return `${String(y).padStart(4, '0')}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}` + (m[4] !== undefined ? ` ${String(h).padStart(2, '0')}:${String(mi).padStart(2, '0')}` : '');
}

module.exports = { parseCsv, col, parseData };
