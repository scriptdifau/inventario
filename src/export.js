const { xlsx } = require('./xlsx');

const MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

// invia il file Excel; i filtri della vista sono già applicati nelle righe passate
function inviaXlsx(res, nomeFile, fogli) {
  const oggi = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Rome' }).replace(/-/g, '');
  res.set({ 'Content-Type': MIME, 'Content-Disposition': `attachment; filename="${nomeFile}-${oggi}.xlsx"` });
  res.send(xlsx(fogli));
}

const num = (v) => (v === null || v === undefined ? null : Number(v));
const vuota = (req) => req.query.xlsx === '1';

module.exports = { inviaXlsx, num, vuota };
