try { process.loadEnvFile(); } catch { /* .env opzionale */ }
const { creaApp } = require('./src/app');

const port = process.env.PORT || 3000;
creaApp().listen(port, () => console.log(`Inventario in ascolto su :${port}`));
