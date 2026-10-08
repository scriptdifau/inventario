// Generatore minimale di file .xlsx (Office Open XML in uno zip), senza dipendenze.
// Uso: xlsx([{ nome, colonne: [{ h, v: riga => valore, t?: 'data'|'dataora'|'euro'|'num' }], righe: [...] }]) -> Buffer
const zlib = require('zlib');

const TABELLA_CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = TABELLA_CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function zip(files) {
  const parti = []; const centrale = []; let offset = 0;
  for (const f of files) {
    const nome = Buffer.from(f.name, 'utf8');
    const dati = Buffer.from(f.data, 'utf8');
    const comp = zlib.deflateRawSync(dati);
    const crc = crc32(dati);
    const loc = Buffer.alloc(30);
    loc.writeUInt32LE(0x04034b50, 0); loc.writeUInt16LE(20, 4); loc.writeUInt16LE(0x0800, 6); loc.writeUInt16LE(8, 8);
    loc.writeUInt16LE(0, 10); loc.writeUInt16LE(0x21, 12);                      // ora 00:00, data 1980-01-01
    loc.writeUInt32LE(crc, 14); loc.writeUInt32LE(comp.length, 18); loc.writeUInt32LE(dati.length, 22);
    loc.writeUInt16LE(nome.length, 26); loc.writeUInt16LE(0, 28);
    parti.push(loc, nome, comp);
    const cen = Buffer.alloc(46);
    cen.writeUInt32LE(0x02014b50, 0); cen.writeUInt16LE(20, 4); cen.writeUInt16LE(20, 6); cen.writeUInt16LE(0x0800, 8); cen.writeUInt16LE(8, 10);
    cen.writeUInt16LE(0, 12); cen.writeUInt16LE(0x21, 14);
    cen.writeUInt32LE(crc, 16); cen.writeUInt32LE(comp.length, 20); cen.writeUInt32LE(dati.length, 24);
    cen.writeUInt16LE(nome.length, 28); cen.writeUInt32LE(offset, 42);
    centrale.push(cen, nome);
    offset += loc.length + nome.length + comp.length;
  }
  const dir = Buffer.concat(centrale);
  const fine = Buffer.alloc(22);
  fine.writeUInt32LE(0x06054b50, 0); fine.writeUInt16LE(files.length, 8); fine.writeUInt16LE(files.length, 10);
  fine.writeUInt32LE(dir.length, 12); fine.writeUInt32LE(offset, 16);
  return Buffer.concat([...parti, dir, fine]);
}

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
  .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');           // caratteri non ammessi in XML
const lettera = (n) => { let s = ''; for (n += 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s; return s; };

// data/ora in fuso Europe/Rome -> numero seriale di Excel (giorni dal 30/12/1899)
function seriale(d) {
  const p = new Date(d).toLocaleString('sv-SE', { timeZone: 'Europe/Rome' });   // "2026-10-08 14:30:00"
  const m = p.match(/^(\d{4})-(\d{2})-(\d{2})(?: (\d{2}):(\d{2}):(\d{2}))?/);
  if (!m) return null;
  return (Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0)) - Date.UTC(1899, 11, 30)) / 86400000;
}

// stili: 0 normale, 1 intestazione, 2 data, 3 data e ora, 4 euro
const STILE = { data: 2, dataora: 3, euro: 4 };

function cella(rif, valore, tipo) {
  if (valore === null || valore === undefined || valore === '') return '';
  if (tipo === 'data' || tipo === 'dataora') {
    let n = seriale(valore);
    if (n !== null && tipo === 'data') n = Math.floor(n);             // solo il giorno, senza ora
    return n === null ? '' : `<c r="${rif}" s="${STILE[tipo]}"><v>${n}</v></c>`;
  }
  if (tipo === 'euro' || tipo === 'num' || typeof valore === 'number') {
    const n = Number(valore);
    if (Number.isFinite(n)) return `<c r="${rif}"${tipo === 'euro' ? ` s="${STILE.euro}"` : ''}><v>${n}</v></c>`;
  }
  if (typeof valore === 'boolean') valore = valore ? 'Sì' : 'No';
  // stringa inline: mai interpretata come formula, anche se inizia con = + - @
  return `<c r="${rif}" t="inlineStr"><is><t xml:space="preserve">${esc(valore)}</t></is></c>`;
}

function foglio({ colonne, righe }) {
  const larg = colonne.map((c) => String(c.h).length);
  const celle = righe.map((r) => colonne.map((c) => c.v(r)));
  celle.forEach((riga) => riga.forEach((v, i) => {
    if (v !== null && v !== undefined && !(v instanceof Date)) larg[i] = Math.max(larg[i], Math.min(String(v).length, 60));
    else if (v instanceof Date) larg[i] = Math.max(larg[i], 16);
  }));
  const ultima = lettera(colonne.length - 1) + (righe.length + 1);
  let x = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">';
  x += '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>';
  x += '<cols>' + larg.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${Math.min(w + 2, 62)}" customWidth="1"/>`).join('') + '</cols><sheetData>';
  x += '<row r="1">' + colonne.map((c, i) => `<c r="${lettera(i)}1" s="1" t="inlineStr"><is><t>${esc(c.h)}</t></is></c>`).join('') + '</row>';
  celle.forEach((riga, k) => {
    x += `<row r="${k + 2}">` + riga.map((v, i) => cella(lettera(i) + (k + 2), v, colonne[i].t)).join('') + '</row>';
  });
  x += `</sheetData><autoFilter ref="A1:${ultima}"/></worksheet>`;
  return x;
}

const STILI = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
  + '<numFmts count="2"><numFmt numFmtId="164" formatCode="dd/mm/yyyy"/><numFmt numFmtId="165" formatCode="dd/mm/yyyy hh:mm"/></numFmts>'
  + '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>'
  + '<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>'
  + '<fill><patternFill patternType="solid"><fgColor rgb="FFDDE5F3"/><bgColor indexed="64"/></patternFill></fill></fills>'
  + '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>'
  + '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
  + '<cellXfs count="5"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'
  + '<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/>'
  + '<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>'
  + '<xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>'
  + '<xf numFmtId="4" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs>'
  + '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>';

function xlsx(fogli) {
  const nomi = fogli.map((f, i) => esc(String(f.nome || `Foglio${i + 1}`).replace(/[\\/?*[\]:]/g, ' ').slice(0, 31)));
  const files = [
    { name: '[Content_Types].xml', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
      + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>'
      + '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
      + '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'
      + fogli.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('') + '</Types>' },
    { name: '_rels/.rels', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
      + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>' },
    { name: 'xl/workbook.xml', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>'
      + nomi.map((n, i) => `<sheet name="${n}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('') + '</sheets></workbook>' },
    { name: 'xl/_rels/workbook.xml.rels', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
      + fogli.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')
      + `<Relationship Id="rId${fogli.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>` },
    { name: 'xl/styles.xml', data: STILI },
    ...fogli.map((f, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, data: foglio(f) })),
  ];
  return zip(files);
}

module.exports = { xlsx, seriale };
