const fs = require('fs');
// Carica .env dalla cartella dell'app (non dalla cartella corrente: dopo un riavvio dal pannello può essere diversa)
// e senza dipendere da process.loadEnvFile (Node >= 20.12). Le variabili già presenti nell'ambiente hanno la precedenza.
function caricaEnv(file) {
  let testo;
  try { testo = fs.readFileSync(file, 'utf8'); } catch { return false; }
  for (const riga of testo.split(/\r?\n/)) {
    const m = riga.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!m || riga.trim().startsWith('#')) continue;
    let v = m[2];
    if (/^(["']).*\1$/.test(v)) v = v.slice(1, -1);
    else v = v.replace(/\s+#.*$/, '');
    if (!(m[1] in process.env)) process.env[m[1]] = v;
  }
  return true;
}

module.exports = { caricaEnv };
